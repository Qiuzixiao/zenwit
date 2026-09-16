import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createWorkspaceBackend } from '../lib/index.js'
import { createWorkbenchBackend } from '../lib/workbench/backend.js'

/** One live backend pair over a real socket, plus a registered project. */
async function fixture(t, options) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'zenwit-wb-api-')))
  const homeDir = join(dir, 'home')
  const projectsDir = join(dir, 'projects')
  mkdirSync(homeDir, { recursive: true })
  mkdirSync(projectsDir, { recursive: true })
  let workspace
  let workbench
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/desktop/workbench')) return void workbench.handle(req, res)
    return void workspace.handle(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  workspace = createWorkspaceBackend({ homeDir, projectsDir, expectedOrigin: origin })
  workbench = createWorkbenchBackend({ expectedOrigin: origin, isProjectPath: workspace.isSafeProjectPath, ...(options ?? {}) })
  t.after(async () => {
    workspace.dispose()
    workbench.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  /** One workbench method call over the wire. */
  async function call(method, payload = {}, headers = {}) {
    const response = await fetch(origin + '/api/desktop/workbench', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ method, ...payload }),
    })
    return { status: response.status, body: await response.json() }
  }

  /** Register one project through the library API and return its path. */
  async function project(name = 'Notes') {
    const response = await fetch(origin + '/api/desktop/projects', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    })
    assert.equal(response.status, 200, 'project creation failed')
    return (await response.json()).project.path
  }

  return { dir, origin, call, project }
}

test('workbench methods answer over the project-scoped envelope', async (t) => {
  const { call, project } = await fixture(t)
  const root = await project('Notes')

  const session = await call('session.cwd', { project: root, sessionId: 's1' })
  assert.equal(session.status, 200)
  assert.equal(session.body.value.cwd, root)
  assert.equal(session.body.value.root, 'Notes')
  assert.equal(session.body.value.sessionId, 's1')

  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  const tree = await call('fs.tree', { project: root })
  assert.equal(tree.status, 200)
  assert.deepEqual(tree.body.value.entries.map(entry => entry.name), ['src'])
  const nested = await call('fs.tree', { project: root, path: join(root, 'src') })
  assert.deepEqual(nested.body.value.entries.map(entry => entry.name), ['a.ts'])

  const read = await call('fs.read', { project: root, path: join(root, 'src', 'a.ts') })
  assert.equal(read.body.value.kind, 'text')
  assert.match(read.body.value.content, /export const a = 1/)

  const search = await call('fs.search', { project: root, query: 'a.ts' })
  assert.deepEqual(search.body.value.matches, [join('src', 'a.ts')])
})

test('workbench writes, renames and removes inside the project only', async (t) => {
  const { call, project } = await fixture(t)
  const root = await project('Notes')

  const write = await call('fs.write', { project: root, path: join(root, 'docs', 'new.md'), content: '# hi' })
  assert.equal(write.status, 200)
  assert.equal(readFileSync(join(root, 'docs', 'new.md'), 'utf8'), '# hi')

  const renamed = await call('fs.rename', { project: root, path: join(root, 'docs', 'new.md'), name: 'readme.md' })
  assert.equal(renamed.status, 200)
  assert.equal(existsSync(join(root, 'docs', 'readme.md')), true)

  const removed = await call('fs.remove', { project: root, path: join(root, 'docs') })
  assert.equal(removed.status, 200)
  assert.equal(existsSync(join(root, 'docs')), false)

  const escape = await call('fs.write', { project: root, path: join(root, '..', 'escape.txt'), content: 'x' })
  assert.equal(escape.status, 403)
  assert.equal(existsSync(join(root, '..', 'escape.txt')), false)
})

test('binary reads report a head instead of text', async (t) => {
  const { call, project } = await fixture(t)
  const root = await project('Notes')
  writeFileSync(join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]))
  const read = await call('fs.read', { project: root, path: join(root, 'blob.bin') })
  assert.equal(read.body.value.kind, 'binary')
  assert.equal(typeof read.body.value.head, 'string')
  assert.equal(read.body.value.size, 4)
})

test('uploads stream bytes and create missing parents', async (t) => {
  const { origin, project } = await fixture(t)
  const root = await project('Notes')
  const url = `${origin}/api/desktop/workbench/upload?project=${encodeURIComponent(root)}&dir=${encodeURIComponent(root)}&path=${encodeURIComponent('media/clip.bin')}`
  const response = await fetch(url, { method: 'POST', headers: { origin }, body: Buffer.from('abcdef') })
  assert.equal(response.status, 200)
  const value = (await response.json()).value
  assert.equal(value.size, 6)
  assert.equal(readFileSync(join(root, 'media', 'clip.bin'), 'utf8'), 'abcdef')
})

test('git methods read a real repository inside the project', async (t) => {
  const { call, project } = await fixture(t)
  const root = await project('Notes')
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { cwd: root, encoding: 'utf8' })
  try {
    git('init', '-q')
  } catch {
    t.skip('git is unavailable')
    return
  }
  writeFileSync(join(root, 'a.txt'), 'one\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\n')

  const status = await call('git.status', { project: root })
  assert.equal(status.status, 200)
  assert.ok(JSON.stringify(status.body.value).includes('a.txt'))

  const diff = await call('git.diff', { project: root, path: 'a.txt' })
  assert.match(diff.body.value.diff, /\+two/)

  const log = await call('git.log', { project: root, count: 5 })
  assert.equal(log.body.value.length, 1)

  await call('git.stage', { project: root, path: 'a.txt' })
  await call('git.commit', { project: root, message: 'second' })
  const after = await call('git.log', { project: root, count: 5 })
  assert.equal(after.body.value.length, 2)

  // The history row's patch and the cherry-pick action answer under the names
  // the browser half calls.
  const patch = await call('git.commit-diff', { project: root, hash: after.body.value[0].hash })
  assert.match(patch.body.value.diff, /second|a\.txt/u)
  const branch = await call('git.branch', { project: root })
  assert.equal(branch.body.value.current.length > 0, true)
  const failed = await call('git.cherry-pick', { project: root, hash: 'deadbeefdeadbeef' })
  assert.notEqual(failed.status, 200)
})

test('the workbench refuses unregistered projects, foreign origins and unknown methods', async (t) => {
  const { dir, origin, call, project } = await fixture(t)
  const root = await project('Notes')
  const outsider = realpathSync(mkdtempSync(join(tmpdir(), 'zenwit-wb-outside-')))
  t.after(() => rmSync(outsider, { recursive: true, force: true }))

  const unregistered = await call('fs.tree', { project: outsider })
  assert.equal(unregistered.status, 403)
  assert.equal(unregistered.body.error.code, 'forbidden')

  const unknown = await call('nope.method', { project: root })
  assert.equal(unknown.status, 404)

  const foreign = await call('fs.tree', { project: root }, { origin: 'http://evil.example' })
  assert.equal(foreign.status, 403)

  const wrongMethod = await fetch(origin + '/api/desktop/workbench', { method: 'GET', headers: { origin } })
  assert.equal(wrongMethod.status, 405)

  const notJson = await fetch(origin + '/api/desktop/workbench', {
    method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: 'x',
  })
  assert.equal(notJson.status, 415)
  assert.ok(dir.length > 0)
})

test('the terminal dependency probe answers with the repair hint', async (t) => {
  const unavailable = {
    open: async () => { throw new Error('unavailable') },
    get: () => undefined,
    close: () => undefined,
    available: async () => ({ available: false, detail: 'node-pty failed to load' }),
    dispose: () => undefined,
  }
  const broken = await fixture(t, { shells: unavailable })
  const status = await broken.call('terminal.deps', { project: '/tmp' })
  assert.equal(status.status, 200)
  assert.equal(status.body.value.ok, false)
  assert.match(status.body.value.cause, /node-pty/u)
  assert.equal(typeof status.body.value.command, 'string')

  const healthy = await fixture(t, {
    shells: {
      open: async () => { throw new Error('unused') },
      get: () => undefined,
      close: () => undefined,
      available: async () => ({ available: true }),
      dispose: () => undefined,
    },
  })
  assert.deepEqual((await healthy.call('terminal.deps', { project: '/tmp' })).body.value, { ok: true })
})

test('preview routes serve project bytes and sandbox the HTML preview', async (t) => {
  const { origin, project } = await fixture(t)
  const root = await project('Notes')
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'assets', 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  writeFileSync(join(root, 'page.html'), '<html><link rel="stylesheet" href="./style.css"></html>')
  writeFileSync(join(root, 'style.css'), 'body { color: red }')

  const mediaUrl = `${origin}/api/desktop/workbench/file?project=${encodeURIComponent(root)}&path=${encodeURIComponent(join(root, 'assets', 'pixel.png'))}`
  const media = await fetch(mediaUrl, { headers: { origin } })
  assert.equal(media.status, 200)
  assert.equal(media.headers.get('content-type'), 'image/png')
  assert.equal(Buffer.from(await media.arrayBuffer()).length, 8)

  const download = await fetch(mediaUrl + '&download=1', { headers: { origin } })
  assert.match(download.headers.get('content-disposition') ?? '', /^attachment; filename\*=UTF-8''pixel\.png$/u)

  // The HTML URL carries the project and the absolute file path as encoded
  // segments (see the client encoder in workbench/html-route.ts).
  const htmlUrlFor = (file) => `${origin}/api/desktop/workbench/html/${encodeURIComponent(root)}/${file.split(/[\\/]+/u).filter(Boolean).map(encodeURIComponent).join('/')}`
  const htmlUrl = htmlUrlFor(join(root, 'page.html'))
  const html = await fetch(htmlUrl, { headers: { origin } })
  assert.equal(html.status, 200)
  assert.match(html.headers.get('content-security-policy') ?? '', /^sandbox /u)
  assert.match(await html.text(), /style\.css/u)

  // The previewed page's own relative asset resolves inside the same prefix.
  const asset = await fetch(htmlUrlFor(join(root, 'style.css')), { headers: { origin } })
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type') ?? '', /^text\/css/u)

  // Containment and trust refusals.
  const escaped = await fetch(`${origin}/api/desktop/workbench/file?project=${encodeURIComponent(root)}&path=${encodeURIComponent('/etc/hosts')}`, { headers: { origin } })
  assert.equal(escaped.status, 403)
  const foreign = await fetch(mediaUrl, { headers: { origin, 'sec-fetch-site': 'cross-site' } })
  assert.equal(foreign.status, 403)
  const unregistered = await fetch(`${origin}/api/desktop/workbench/file?project=${encodeURIComponent('/tmp')}&path=${encodeURIComponent('/tmp/x')}`, { headers: { origin } })
  assert.equal(unregistered.status, 403)
  // A prefix without a project/path is a bad request; a path outside the
  // route is not found.
  const malformed = await fetch(`${origin}/api/desktop/workbench/html/`, { headers: { origin } })
  assert.equal(malformed.status, 400)
  const notFound = await fetch(`${origin}/api/desktop/workbench/nope`, { headers: { origin } })
  assert.equal(notFound.status, 404)
})
test('the engine settings store merges patches under a revision guard', async (t) => {
  const settingsDir = realpathSync(mkdtempSync(join(tmpdir(), 'zenwit-wb-prefs-')))
  t.after(() => rmSync(settingsDir, { recursive: true, force: true }))
  const { call } = await fixture(t, { settingsFile: join(settingsDir, 'prefs.json') })
  assert.deepEqual((await call('settings.get', {})).body.value, {})

  const first = await call('settings.update', { patch: { autoSave: true } })
  assert.equal(first.status, 200)
  assert.equal(first.body.value.revision, 1)
  assert.deepEqual(first.body.value.value, { autoSave: true })

  const merged = await call('settings.update', { patch: { theme: 'dark' }, expectedRevision: 1 })
  assert.deepEqual(merged.body.value.value, { autoSave: true, theme: 'dark' })
  assert.equal(merged.body.value.revision, 2)

  // A stale writer is refused instead of overwriting the newer document.
  const stale = await call('settings.update', { patch: { theme: 'light' }, expectedRevision: 1 })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.code, 'settings-conflict')
  assert.deepEqual((await call('settings.get', {})).body.value.value, { autoSave: true, theme: 'dark' })
})

test('the shell, terminal close and external-open methods answer', async (t) => {
  const closed = []
  const shells = {
    open: async () => { throw new Error('unused') },
    get: () => undefined,
    close: (key) => { closed.push(key) },
    available: async () => ({ available: true }),
    shellInfo: () => ({ shell: '/bin/zsh', name: 'zsh' }),
    dispose: () => undefined,
  }
  const revealed = []
  const { call, project } = await fixture(t, {
    shells,
    nativeAction: (action, path) => { revealed.push([action, path]) },
  })
  const root = await project('Notes')

  assert.deepEqual((await call('shell.get', {})).body.value, { shell: '/bin/zsh', name: 'zsh' })
  assert.deepEqual((await call('pty.close', { sessionId: 's1', tab: 'terminal:1' })).body.value, { ok: true })
  assert.deepEqual(closed, ['s1:terminal:1'])

  const session = await call('session.cwd', { project: root, sessionId: 's1' })
  assert.deepEqual(session.body.value, { sessionId: 's1', cwd: root, root: 'Notes', parent: join(root, '..') })

  const opened = await call('open.external', { action: 'reveal', path: join(root, 'a.txt') })
  assert.deepEqual(opened.body.value, { started: true })
  assert.deepEqual(revealed, [['reveal', join(root, 'a.txt')]])
  // Reveal is an operating-system action on a path the caller already names
  // absolutely; a relative path is refused.
  const outside = await call('open.external', { action: 'reveal', path: join(root, '..', 'elsewhere.txt') })
  assert.deepEqual(outside.body.value, { started: true })
  const relative = await call('open.external', { action: 'reveal', path: 'notes.md' })
  assert.equal(relative.status, 400)
})

test('the browser probe reports framing headers', async (t) => {
  const probeServer = createServer((req, res) => {
    if (req.url === '/blocked') {
      res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' })
      res.end('<html></html>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" })
    res.end('<html></html>')
  })
  probeServer.listen(0, '127.0.0.1')
  await once(probeServer, 'listening')
  t.after(async () => {
    probeServer.closeAllConnections()
    await new Promise(resolve => probeServer.close(resolve))
  })
  const origin = `http://127.0.0.1:${probeServer.address().port}`
  const { call } = await fixture(t)

  const blocked = await call('browser.probe', { url: origin + '/blocked' })
  assert.equal(blocked.body.value.reachable, true)
  assert.equal(blocked.body.value.status, 200)
  assert.equal(blocked.body.value.xFrameOptions, 'DENY')

  const ancestor = await call('browser.probe', { url: origin + '/csp' })
  assert.deepEqual(ancestor.body.value.frameAncestors, ["'none'"])

  const unreachable = await call('browser.probe', { url: 'http://127.0.0.1:1/' })
  assert.deepEqual(unreachable.body.value, { reachable: false })

  const invalid = await call('browser.probe', { url: 'file:///etc/hosts' })
  assert.equal(invalid.status, 400)
})

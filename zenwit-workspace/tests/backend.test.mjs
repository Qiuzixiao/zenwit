import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, request } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createWorkspaceBackend, PROJECT_API_PATHS, apply, inject } from '../lib/index.js'
import { DocumentRecoveryStore } from '../lib/document-recovery.js'

async function fixture(t, extra = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'zenwit-workspace-')))
  const homeDir = join(dir, 'home')
  const projectsDir = join(dir, 'projects')
  let backend
  const server = createServer((req, res) => backend.handle(req, res))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  backend = createWorkspaceBackend({ homeDir, projectsDir, expectedOrigin: origin, ...extra })
  t.after(async () => {
    backend.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })
  async function api(route = '', method = 'GET', body, headers = {}) {
    const response = await fetch(origin + '/api/desktop/projects' + route, {
      method, headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  async function project(name = 'Notes') {
    const response = await api('', 'POST', { name })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    return response.body.project.path
  }
  return { dir, homeDir, projectsDir, origin, backend, api, project }
}
const query = (path, suffix = '') => '?path=' + encodeURIComponent(path) + suffix

test('existing folders are explicitly adopted, remain contained, and can be forgotten without deleting files', async t => {
  const f = await fixture(t)
  const external = join(f.dir, 'existing')
  mkdirSync(external)
  writeFileSync(join(external, 'notes.txt'), 'keep me')
  assert.equal((await f.api('/structure' + query(external))).status, 403)
  const adopted = await f.api('/adopt', 'POST', { path: external })
  assert.equal(adopted.status, 200)
  assert.equal(adopted.body.project.canDelete, false)
  assert.equal((await f.api('/adopt', 'POST', { path: external })).status, 200)
  assert.equal((await f.api()).body.projects.length, 1)
  assert.equal((await f.api('/file' + query(join(external, 'notes.txt')))).body.content, 'keep me')
  assert.equal((await f.api('/file', 'POST', { path: join(external, 'notes.txt'), content: 'edited', expectedContent: 'keep me' })).status, 200)
  assert.equal((await f.api('/node', 'POST', { path: join(external, 'new.txt'), kind: 'file' })).status, 200)
  assert.equal((await f.api('/node', 'PATCH', { path: join(external, 'new.txt'), newName: 'renamed.txt' })).status, 200)
  assert.equal((await f.api('/node', 'DELETE', { path: join(external, 'renamed.txt') })).status, 200)
  assert.equal((await f.api('/file' + query(join(f.dir, 'outside.txt')))).status, 403)
  assert.equal((await f.api('/delete', 'POST', { path: external })).status, 403)
  assert.equal((await f.api('/forget', 'POST', { path: external })).status, 200)
  assert.equal(readFileSync(join(external, 'notes.txt'), 'utf8'), 'edited')
  assert.equal((await f.api('/structure' + query(external))).status, 403)
  assert.equal((await f.api()).body.projects.length, 0)
  assert.equal((await f.api('/adopt', 'POST', { path: f.homeDir })).status, 403)
  assert.equal((await f.api('/adopt', 'POST', { path: f.dir })).status, 403)
})

test('generic registry persists, creates empty projects, tags and deletion match legacy HTTP shapes', async t => {
  const f = await fixture(t)
  assert.deepEqual((await f.api()).body, { root: f.projectsDir, projects: [] })
  const path = await f.project('My notes')
  assert.equal(path, join(f.projectsDir, 'My-notes'))
  assert.deepEqual(readdirSync(path), [])
  let summary = (await f.api()).body.projects[0]
  assert.equal(summary.agentId, undefined)
  assert.deepEqual(summary.tags, [])
  const registry = JSON.parse(readFileSync(join(f.homeDir, 'workspace/projects.json'), 'utf8'))
  assert.ok(registry.projects[path])
  const second = createWorkspaceBackend({ homeDir: f.homeDir, projectsDir: f.projectsDir, expectedOrigin: f.origin })
  assert.equal(second.isSafeProjectPath(path), true)
  second.dispose()
  summary = (await f.api('', 'PATCH', { path, tags: [' Code ', 'code', '文档'] })).body.project
  assert.deepEqual(summary.tags, ['Code', '文档'])
  assert.equal((await f.api('', 'PATCH', { path, tags: [''] })).status, 400)
  assert.notEqual(await f.project('My notes'), path)
  assert.equal((await f.api('/delete', 'POST', { path })).status, 200)
  assert.equal(existsSync(path), false)
  assert.equal(JSON.parse(readFileSync(join(f.homeDir, 'workspace/projects.json'), 'utf8')).projects[path], undefined)
  const another = await f.project()
  assert.equal((await f.api('?action=delete', 'POST', { path: another })).status, 200)
})

test('node create/rename/delete, structure and resources preserve frontend vocabulary', async t => {
  const f = await fixture(t)
  const path = await f.project()
  const folder = join(path, 'drafts')
  assert.equal((await f.api('/node', 'POST', { path: folder, kind: 'directory' })).body.node.kind, 'directory')
  const file = join(folder, 'note.md')
  assert.equal((await f.api('/node', 'POST', { path: file, kind: 'file' })).status, 200)
  const tree = (await f.api('/structure' + query(path))).body
  assert.equal(tree.root, 'Notes')
  assert.equal(tree.truncated, false)
  assert.equal(tree.tree[0].kind, 'dir')
  assert.equal(tree.tree[0].children[0].path, file)
  assert.equal((await f.api('/resources' + query(path))).body.resources[0].name, 'drafts/note.md')
  assert.equal((await f.api('/node', 'POST', { path: file, kind: 'file' })).status, 409)
  const renamed = (await f.api('/node', 'PATCH', { path: file, newName: 'next.md' })).body.path
  assert.equal(renamed, join(folder, 'next.md'))
  assert.equal((await f.api('/node', 'DELETE', { path: folder })).status, 200)
  assert.equal(existsSync(renamed), false)
  assert.equal((await f.api('/node', 'DELETE', { path })).status, 403)
})

test('structure and resources omit dependency caches instead of walking them', async t => {
  const f = await fixture(t)
  const path = await f.project()
  mkdirSync(join(path, 'notes'))
  writeFileSync(join(path, 'notes', 'a.md'), '# a')
  mkdirSync(join(path, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(path, 'node_modules', 'dep', 'README.md'), '# dependency')
  const structure = (await f.api('/structure' + query(path))).body
  assert.equal(structure.truncated, false)
  assert.deepEqual(structure.tree.map(node => node.name), ['notes'])
  const resources = (await f.api('/resources' + query(path))).body
  assert.equal(resources.truncated, false)
  assert.deepEqual(resources.resources.map(entry => entry.name), ['notes/a.md'])
})

test('text save requires observed content and never overwrites stale or deleted files', async t => {
  const f = await fixture(t)
  const path = join(await f.project(), 'note.txt')
  const save = body => f.api('/file', 'POST', { path, ...body })
  assert.equal((await save({ content: 'one' })).status, 428)
  assert.equal((await save({ content: 'one', expectedContent: null })).status, 200)
  assert.equal((await f.api('/file' + query(path))).body.content, 'one')
  writeFileSync(path, 'external')
  const conflict = await save({ content: 'two', expectedContent: 'one' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.content, 'external')
  assert.equal(readFileSync(path, 'utf8'), 'external')
  assert.equal((await save({ content: 'two', expectedContent: 'external' })).status, 200)
  rmSync(path)
  assert.equal((await save({ content: 'three', expectedContent: 'two' })).status, 409)
  assert.equal((await f.api('/file' + query(path, '&sync=1'))).body.content, null)
  assert.equal((await save({ content: 'restored', expectedContent: null })).status, 200)
  const results = await Promise.all(['a', 'b'].map(content => save({ content, expectedContent: 'restored' })))
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
})

test('draft recovery survives disk deletion; guarded discard and checkpoint history remain private', async t => {
  const f = await fixture(t)
  const path = join(await f.project(), 'note.md')
  const save = body => f.api('/file', 'POST', { path, ...body })
  await save({ content: 'base', expectedContent: null })
  await save({ action: 'draft', content: 'draft', baseline: 'base' })
  await save({ action: 'discard-draft', expectedDraft: 'older' })
  assert.equal((await f.api('/file' + query(path))).body.recovery.content, 'draft')
  rmSync(path)
  const missing = await f.api('/file' + query(path))
  assert.equal(missing.status, 404)
  assert.equal(missing.body.content, null)
  assert.equal(missing.body.recovery.baseline, 'base')
  await save({ action: 'checkpoint', content: 'checkpoint' })
  await save({ content: 'draft', expectedContent: null })
  const recovered = (await f.api('/file' + query(path))).body
  assert.equal(recovered.recovery, null)
  assert.ok(recovered.versions.some(v => v.content === 'checkpoint'))
  assert.deepEqual(readdirSync(join(f.projectsDir, 'Notes')), ['note.md'])
  for (const body of [{ action: 'draft', content: 'x' }, { action: 'unknown', content: 'x' }, { content: 4 }]) {
    assert.equal((await save(body)).status, 400)
  }
})

test('binary import is exclusive, bounded, and confined to the selected project', async t => {
  const f = await fixture(t)
  const path = await f.project()
  const other = await f.project('Other')
  async function upload(destinationPath, name, data) {
    return fetch(f.origin + '/api/desktop/projects/import?' + new URLSearchParams({ projectPath: path, destinationPath, name }), {
      method: 'POST', headers: { origin: f.origin }, body: data,
    })
  }
  const data = Buffer.from([0, 255, 128, 1])
  assert.equal((await upload(path, 'image.bin', data)).status, 200)
  assert.deepEqual(readFileSync(join(path, 'image.bin')), data)
  assert.equal((await upload(path, 'image.bin', 'replacement')).status, 409)
  assert.equal((await upload(other, 'other.bin', data)).status, 403)
  assert.equal((await upload(path, '../escape', data)).status, 400)
})

test('same-origin authorization rejects forged host, cross-origin, absent origin and bad JSON', async t => {
  const f = await fixture(t)
  assert.equal((await f.api('', 'POST', { name: 'x' }, { origin: 'https://evil.test' })).status, 403)
  const forgedHost = await new Promise((resolve, reject) => {
    const req = request(f.origin + '/api/desktop/projects', { headers: { origin: f.origin, host: 'evil.test' } }, res => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(forgedHost, 403)
  assert.equal((await f.api('', 'GET', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await f.api('', 'GET', undefined, { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin', referer: f.origin + '/' })).status, 403)
  let result = await fetch(f.origin + '/api/desktop/projects')
  assert.equal(result.status, 403)
  result = await fetch(f.origin + '/api/desktop/projects', { headers: { 'sec-fetch-site': 'same-origin', referer: f.origin + '/' } })
  assert.equal(result.status, 200)
  assert.equal((await f.api('', 'POST', null)).status, 400)
  assert.equal((await f.api('', 'POST', [])).status, 400)
  assert.equal((await f.api('', 'POST', { name: 'x' }, { 'content-type': 'text/plain' })).status, 415)
  result = await fetch(f.origin + '/api/desktop/projects', { method: 'POST', headers: { origin: f.origin, 'content-type': 'application/json' }, body: '{' })
  assert.equal(result.status, 400)
  assert.equal((await f.api('', 'PUT')).status, 405)
  assert.equal((await f.api('/unknown')).status, 404)
  assert.equal((await f.api('', 'POST', { name: 'x'.repeat(2 * 1024 * 1024) })).status, 413)
})

test('containment denies traversal, forged registration, sibling prefixes, metadata, symlinks and special nodes', async t => {
  const f = await fixture(t)
  const path = await f.project()
  const other = await f.project('Other')
  writeFileSync(join(other, 'secret'), 'secret')
  const unregistered = join(f.projectsDir, 'forged')
  mkdirSync(join(unregistered, '.zenwit-project'), { recursive: true })
  writeFileSync(join(unregistered, '.zenwit-project/project.json'), '{}')
  assert.equal((await f.api('/structure' + query(unregistered))).status, 403)
  assert.equal((await f.api()).body.projects.length, 2)
  symlinkSync(other, join(path, 'linked'), 'dir')
  symlinkSync(join(f.dir, 'missing'), join(path, 'dangling'))
  for (const target of [join(path, 'linked/secret'), join(path, 'dangling'), join(f.homeDir, 'workspace/projects.json'), path + '/../Other/secret', path + '/.zenwit-project/project.json', f.projectsDir + '-other/file']) {
    assert.equal((await f.api('/file' + query(target))).status, 403, target)
    assert.equal((await f.api('/file', 'POST', { path: target, content: 'bad', expectedContent: null })).status, 403, target)
  }
  assert.deepEqual((await f.api('/structure' + query(path))).body.tree, [])
  assert.equal((await f.api('/node', 'DELETE', { path: join(path, 'linked') })).status, 403)
  for (const name of ['..', 'bad/name', 'NUL', '.zenwit-project']) {
    assert.equal((await f.api('/node', 'PATCH', { path: join(other, 'secret'), newName: name })).status, 400)
  }
  assert.equal(readFileSync(join(other, 'secret'), 'utf8'), 'secret')
  assert.equal((await f.api('/delete', 'POST', { path: f.projectsDir })).status, 403)
})

test('native actions are optional capabilities and validate paths before invoking', async t => {
  const actions = []
  const f = await fixture(t, { nativeAction: (...args) => actions.push(args) })
  const path = await f.project()
  assert.equal((await f.api('/reveal', 'POST', { path })).status, 200)
  assert.deepEqual(actions, [['reveal', path]])
  assert.equal((await f.api('/terminal', 'POST', { path: f.homeDir })).status, 403)
  assert.equal(actions.length, 1)
  const g = await fixture(t)
  assert.equal((await g.api('/reveal', 'POST', { path: await g.project() })).status, 501)
})

test('SSE emits ready and file changes, then releases connections on dispose', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const path = await f.project()
  const response = await fetch(f.origin + '/api/desktop/projects/changes' + query(path), { headers: { origin: f.origin } })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const reader = response.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /data: ready/)
  writeFileSync(join(path, 'new.txt'), 'hello')
  assert.match(new TextDecoder().decode((await reader.read()).value), /data: changed/)
  f.backend.dispose()
  while (!(await reader.read()).done) { /* drain queued notifications */ }
})

test('Cordis face registers exact routes with connection fence and lifecycle disposal', async t => {
  const f = await fixture(t)
  const routes = []
  const cleanup = []
  assert.deepEqual(inject, ['webServer', 'connection'])
  apply({
    webServer: { port: 1234, register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1) } },
    connection: { requestRejection: () => 401 },
    effect(callback) { cleanup.push(callback()) },
  }, { homeDir: f.homeDir, projectsDir: f.projectsDir })
  assert.deepEqual(routes.map(route => route.path), PROJECT_API_PATHS)
  assert.ok(routes.every(route => route.kind === 'exact'))
  let code, body
  await routes[0].handler({}, { writeHead(status) { code = status }, end(value) { body = value } })
  assert.equal(code, 401)
  assert.deepEqual(JSON.parse(body), { error: 'unauthorized' })
  cleanup.reverse().forEach(stop => stop())
  assert.equal(routes.length, 0)
})

test('recovery bounds checkpoint count and budget without evicting drafts', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'zenwit-recovery-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new DocumentRecoveryStore(dir)
  const record = store.read('project', 'file')
  record.draft = { content: 'keep', baseline: '', time: 1 }
  for (let index = 0; index < 60; index++) store.checkpoint(record, String(index))
  store.update('project', record)
  assert.equal(store.read('project', 'file').versions.length, 50)
  store.checkpoint(record, '59')
  assert.equal(record.versions.length, 50)
  const big = store.read('project', 'large')
  store.checkpoint(big, 'x'.repeat(101 * 1024 * 1024))
  store.update('project', big)
  assert.equal(store.read('project', 'large').versions.length, 0)
  assert.equal(store.read('project', 'file').draft.content, 'keep')
})

test('streamed import rechecks containment after body receipt and rejects oversized streams', async t => {
  const f = await fixture(t)
  const project = await f.project()
  const destination = join(project, 'uploads')
  mkdirSync(destination)
  const outside = join(f.dir, 'outside')
  mkdirSync(outside)
  async function importRequest(chunks, headers = {}) {
    let status, body
    const req = {
      method: 'POST',
      url: '/api/desktop/projects/import?' + new URLSearchParams({ projectPath: project, destinationPath: destination, name: 'upload.bin' }),
      headers: { origin: f.origin, host: new URL(f.origin).host, ...headers },
      socket: { remoteAddress: '127.0.0.1' },
      [Symbol.asyncIterator]: chunks,
    }
    const res = { writeHead(code) { status = code }, end(value) { body = JSON.parse(value) } }
    await f.backend.handle(req, res)
    return { status, body }
  }
  assert.equal((await importRequest(async function* () { yield Buffer.from('x') }, { 'content-length': String(101 * 1024 * 1024) })).status, 413)
  assert.equal((await importRequest(async function* () {
    const chunk = Buffer.alloc(1024 * 1024)
    for (let index = 0; index < 101; index++) yield chunk
  })).status, 413)
  assert.equal(existsSync(join(destination, 'upload.bin')), false)
  const result = await importRequest(async function* () {
    yield Buffer.from('first')
    rmSync(destination, { recursive: true })
    symlinkSync(outside, destination, 'dir')
    yield Buffer.from('second')
  })
  assert.equal(result.status, 403)
  assert.equal(existsSync(join(outside, 'upload.bin')), false)
})

test('corrupt registry fails closed and never gets replaced by a new project', async t => {
  const f = await fixture(t)
  await f.project()
  const registry = join(f.homeDir, 'workspace/projects.json')
  writeFileSync(registry, '{invalid')
  assert.equal((await f.api()).status, 500)
  assert.equal((await f.api('', 'POST', { name: 'Next' })).status, 500)
  assert.equal(existsSync(join(f.projectsDir, 'Next')), false)
  assert.equal(readFileSync(registry, 'utf8'), '{invalid')
})

test('binary previews preserve bytes and related resources stay inside the source project', async t => {
  const f = await fixture(t)
  const project = await f.project()
  const other = await f.project('Other')
  mkdirSync(join(project, 'pages'))
  const html = join(project, 'pages/index.html')
  const image = join(project, 'image.png')
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 13, 10])
  writeFileSync(html, '<html></html>')
  writeFileSync(image, bytes)
  writeFileSync(join(other, 'private.css'), 'secret')
  const raw = route => fetch(f.origin + '/api/desktop/projects/file' + route, { headers: { origin: f.origin } })
  let response = await raw(query(image, '&raw=1'))
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  assert.equal(response.headers.get('content-type'), 'application/octet-stream')
  assert.equal(response.headers.get('content-disposition'), 'attachment')
  assert.match(response.headers.get('content-security-policy'), /sandbox/)
  response = await raw(query(html, '&raw=1&relative=' + encodeURIComponent('../image.png')))
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  for (const path of ['../../Other/private.css', '../../home/workspace/projects.json', '../.zenwit-project/private']) {
    assert.equal((await raw(query(html, '&raw=1&relative=' + encodeURIComponent(path)))).status, 403)
  }
  symlinkSync(join(other, 'private.css'), join(project, 'linked.css'))
  assert.equal((await raw(query(html, '&raw=1&relative=../linked.css'))).status, 403)
  assert.equal((await f.api('/file' + query(image))).status, 415)
  assert.equal((await f.api('/file', 'POST', { path: image, content: 'overwrite', expectedContent: '' })).status, 415)
  assert.deepEqual(readFileSync(image), bytes)
  assert.equal((await fetch(f.origin + '/api/desktop/projects/file' + query(image, '&raw=1'), { headers: { origin: 'https://untrusted.example' } })).status, 403)
})

test('streams media with real MIME, ranges, ETag, conditional requests, and containment', async t => {
  const f = await fixture(t)
  const project = await f.project('Media')
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251))
  const clip = join(project, 'clip.mp4')
  writeFileSync(clip, bytes)
  const stream = (path, suffix = '') => fetch(f.origin + '/api/desktop/projects/file' + query(path, suffix), { headers: { origin: f.origin } })
  const ranged = (path, range) => fetch(f.origin + '/api/desktop/projects/file' + query(path, '&stream=1'), { headers: { origin: f.origin, range } })

  const full = await stream(clip, '&stream=1')
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('content-type'), 'video/mp4')
  assert.equal(full.headers.get('content-disposition'), 'inline')
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff')
  const etag = full.headers.get('etag')
  assert.ok(etag)
  assert.ok(full.headers.get('last-modified'))
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)

  const partial = await ranged(clip, 'bytes=10-19')
  assert.equal(partial.status, 206)
  assert.equal(partial.headers.get('content-range'), `bytes 10-19/${bytes.length}`)
  assert.equal(partial.headers.get('content-length'), '10')
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(10, 20))

  const suffix = await ranged(clip, 'bytes=-5')
  assert.equal(suffix.status, 206)
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(bytes.length - 5))

  const open = await ranged(clip, 'bytes=4090-')
  assert.equal(open.status, 206)
  assert.deepEqual(Buffer.from(await open.arrayBuffer()), bytes.subarray(4090))

  const unsatisfiable = await ranged(clip, 'bytes=99999-')
  assert.equal(unsatisfiable.status, 416)
  assert.equal(unsatisfiable.headers.get('content-range'), `bytes */${bytes.length}`)

  const notModified = await fetch(f.origin + '/api/desktop/projects/file' + query(clip, '&stream=1'), { headers: { origin: f.origin, 'if-none-match': etag } })
  assert.equal(notModified.status, 304)

  const svg = join(project, 'evil.svg')
  writeFileSync(svg, '<svg onload="alert(1)"/>')
  const svgResponse = await stream(svg, '&stream=1')
  assert.equal(svgResponse.status, 200)
  assert.equal(svgResponse.headers.get('content-type'), 'application/octet-stream')
  assert.equal(svgResponse.headers.get('content-disposition'), 'attachment')
  assert.match(svgResponse.headers.get('content-security-policy'), /sandbox/)

  const bin = join(project, 'blob.bin')
  writeFileSync(bin, Buffer.from([0, 1, 2]))
  const binResponse = await stream(bin, '&stream=1')
  assert.equal(binResponse.headers.get('content-type'), 'application/octet-stream')
  assert.equal(binResponse.headers.get('content-disposition'), 'attachment')

  const other = await f.project('Other')
  writeFileSync(join(other, 'secret.mp4'), bytes)
  // Authority is project-scoped, not workspace-scoped: any registered project's file streams.
  assert.equal((await stream(join(other, 'secret.mp4'), '&stream=1')).status, 200)
  // A relative reference must stay inside the current project.
  assert.equal((await stream(join(project, 'pages/index.html'), '&stream=1&relative=' + encodeURIComponent('../../Other/secret.mp4'))).status, 403)
  assert.equal((await stream(join(project, 'missing.mp4'), '&stream=1')).status, 404)
})

test('detects the text encoding and saves back in the original encoding', async t => {
  const f = await fixture(t)
  const project = await f.project('Encoded')

  // GBK (gb18030) CSV: 你好,1
  const legacy = join(project, 'legacy.csv')
  writeFileSync(legacy, Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0x2C, 0x31, 0x0A, 0x0A]))
  const read = await f.api('/file' + query(legacy))
  assert.equal(read.status, 200)
  assert.equal(read.body.encoding, 'gb18030')
  assert.equal(read.body.content, '你好,1\n\n')

  const outgoing = '再见,2'
  const saved = await f.api('/file', 'POST', { path: legacy, content: outgoing, expectedContent: read.body.content, encoding: 'gb18030' })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal(new TextDecoder('gb18030').decode(readFileSync(legacy)), outgoing)

  // UTF-16LE with BOM.
  const note = join(project, 'note.txt')
  writeFileSync(note, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('line', 'utf16le')]))
  const utf16 = await f.api('/file' + query(note))
  assert.equal(utf16.body.encoding, 'utf-16le')
  assert.equal(utf16.body.content, 'line')

  // Unrecognized bytes stay a binary refusal.
  const blob = join(project, 'blob.dat')
  writeFileSync(blob, Buffer.from([0x00, 0x00, 0x41, 0x7F, 0x00, 0xE2, 0x99, 0x00, 0x00, 0x9D, 0x00, 0x81]))
  assert.equal((await f.api('/file' + query(blob))).status, 415)
})



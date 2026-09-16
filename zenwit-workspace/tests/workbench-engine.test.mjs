import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDirectory, compareEntries, requireAbsolute, isWithin, parentOf, rootLabel } from '../lib/workbench/tree.js'
import { resolveWorkspacePath, resolveWorkspaceWritePath } from '../lib/workbench/containment.js'
import { writeWorkspaceUpload, renameWorkspaceEntry, removeWorkspaceEntry } from '../lib/workbench/operations.js'
import { searchFiles } from '../lib/workbench/search.js'
import { parsePorcelainZ, parseLogLines, parseWorktreeList, status, diff, log, commit, stage } from '../lib/workbench/git.js'
import { WorkbenchError } from '../lib/workbench/wire.js'

/** One real temporary workspace; removed when the test ends. */
function workspace(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'zenwit-wb-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Drain an async iterable of byte chunks. */
async function* bytes(...parts) {
  for (const part of parts) yield Buffer.from(part)
}

test('listing one level stays lazy and sorts directories first', async (t) => {
  const dir = workspace(t)
  mkdirSync(join(dir, 'zeta'))
  mkdirSync(join(dir, 'Alpha'))
  writeFileSync(join(dir, 'beta.txt'), 'b')
  writeFileSync(join(dir, '.hidden'), 'h')
  mkdirSync(join(dir, 'Alpha', 'nested'))
  writeFileSync(join(dir, 'Alpha', 'nested', 'deep.txt'), 'd')

  const listing = await listDirectory(dir)
  assert.deepEqual(listing.entries.map(e => e.name), ['Alpha', 'zeta', '.hidden', 'beta.txt'])
  assert.equal(listing.path, dir)
  assert.equal(listing.truncated, false)
  // Lazy: one level only — no descendant rows.
  assert.equal(listing.entries.some(e => e.name === 'nested' || e.name === 'deep.txt'), false)
  assert.equal(listing.entries.find(e => e.name === '.hidden').hidden, true)
  assert.equal(listing.entries.find(e => e.name === 'beta.txt').isDir, false)
})

test('listing reports truncation instead of scanning past the cap', async (t) => {
  const dir = workspace(t)
  for (let index = 0; index < 12; index += 1) writeFileSync(join(dir, `f${index}.txt`), 'x')
  const listing = await listDirectory(dir, 5)
  assert.equal(listing.entries.length, 5)
  assert.equal(listing.truncated, true)
})

test('symlinks follow their target kind and dangling links are flagged', async (t) => {
  const dir = workspace(t)
  mkdirSync(join(dir, 'real-dir'))
  writeFileSync(join(dir, 'real-file.txt'), 'x')
  symlinkSync(join(dir, 'real-dir'), join(dir, 'link-dir'))
  symlinkSync(join(dir, 'real-file.txt'), join(dir, 'link-file'))
  symlinkSync(join(dir, 'missing'), join(dir, 'link-broken'))

  const listing = await listDirectory(dir)
  const byName = Object.fromEntries(listing.entries.map(entry => [entry.name, entry]))
  assert.equal(byName['link-dir'].isDir, true)
  assert.equal(byName['link-dir'].isSymlink, true)
  assert.equal(byName['link-dir'].broken, false)
  assert.equal(byName['link-file'].isDir, false)
  assert.equal(byName['link-broken'].broken, true)
})

test('path helpers keep OS semantics', () => {
  assert.equal(requireAbsolute('/tmp/x'), '/tmp/x')
  assert.throws(() => requireAbsolute('relative/x'), (error) => error instanceof WorkbenchError && error.code === 'fs-error')
  assert.equal(isWithin('/a/b', '/a/b/c'), true)
  assert.equal(isWithin('/a/b', '/a/bc'), false)
  assert.equal(parentOf('/a/b'), '/a')
  assert.equal(parentOf('/'), undefined)
  assert.equal(rootLabel('/a/b/'), 'b')
  assert.ok(compareEntries({ isDir: true, name: 'b' }, { isDir: false, name: 'a' }) < 0)
  assert.ok(compareEntries({ isDir: false, name: 'A' }, { isDir: false, name: 'b' }) < 0)
})

test('containment refuses escapes and canonicalizes write destinations', async (t) => {
  const dir = workspace(t)
  const outside = workspace(t)
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'file.txt'), 'x')
  writeFileSync(join(outside, 'secret.txt'), 'x')

  assert.equal(await resolveWorkspacePath(dir, join(dir, 'sub', 'file.txt')), join(dir, 'sub', 'file.txt'))
  await assert.rejects(
    () => resolveWorkspacePath(dir, join(dir, '..')),
    (error) => error instanceof WorkbenchError && error.code === 'forbidden' && error.status === 403,
  )
  await assert.rejects(
    () => resolveWorkspacePath(dir, join(outside, 'secret.txt')),
    (error) => error instanceof WorkbenchError && error.code === 'forbidden',
  )

  // A link that leaves the workspace cannot smuggle a read.
  symlinkSync(outside, join(dir, 'escape'))
  await assert.rejects(
    () => resolveWorkspacePath(dir, join(dir, 'escape', 'secret.txt')),
    (error) => error instanceof WorkbenchError && error.code === 'forbidden',
  )

  // Missing destinations resolve through their nearest existing ancestor.
  assert.equal(await resolveWorkspaceWritePath(dir, join(dir, 'new', 'deep', 'file.txt')), join(dir, 'new', 'deep', 'file.txt'))
  await assert.rejects(
    () => resolveWorkspaceWritePath(dir, join(dir, 'escape', 'new.txt')),
    (error) => error instanceof WorkbenchError && error.code === 'forbidden',
  )
})

test('upload writes bytes atomically and creates missing parents', async (t) => {
  const dir = workspace(t)
  const written = await writeWorkspaceUpload({
    cwd: dir, dir, relativePath: 'docs/guide/readme.md', chunks: bytes('# hi', '\n'), limit: 1024,
  })
  assert.equal(written.path, join(dir, 'docs', 'guide', 'readme.md'))
  assert.equal(readFileSync(written.path, 'utf8'), '# hi\n')
  assert.equal(written.size, 5)

  await assert.rejects(
    () => writeWorkspaceUpload({ cwd: dir, dir, relativePath: '../escape.txt', chunks: bytes('x'), limit: 1024 }),
    (error) => error instanceof WorkbenchError,
  )
  await assert.rejects(
    () => writeWorkspaceUpload({ cwd: dir, dir, relativePath: 'big.bin', chunks: bytes('0123456789'), limit: 4 }),
    (error) => error instanceof WorkbenchError,
  )
  assert.equal(existsSync(join(dir, 'big.bin')), false)
})

test('rename and remove stay inside the workspace', async (t) => {
  const dir = workspace(t)
  mkdirSync(join(dir, 'pkg'))
  writeFileSync(join(dir, 'pkg', 'old.txt'), 'x')

  const renamed = await renameWorkspaceEntry({ cwd: dir, path: join(dir, 'pkg', 'old.txt'), name: 'new.txt' })
  assert.equal(renamed.path, join(dir, 'pkg', 'new.txt'))
  assert.equal(existsSync(join(dir, 'pkg', 'old.txt')), false)

  await removeWorkspaceEntry({ cwd: dir, path: join(dir, 'pkg') })
  assert.equal(existsSync(join(dir, 'pkg')), false)

  await assert.rejects(
    () => removeWorkspaceEntry({ cwd: dir, path: dir }),
    (error) => error instanceof WorkbenchError,
  )
})

test('filename search walks nested levels but skips noise directories', async (t) => {
  const dir = workspace(t)
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true })
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'src', 'deep', 'needle.txt'), 'x')
  writeFileSync(join(dir, 'node_modules', 'pkg', 'needle.txt'), 'x')
  writeFileSync(join(dir, 'src', 'other.txt'), 'x')

  const found = await searchFiles(dir, 'needle')
  assert.deepEqual(found.matches, [join('src', 'deep', 'needle.txt')])
  assert.equal(found.truncated, false)

  const capped = await searchFiles(dir, 'txt', { maxMatches: 1 })
  assert.equal(capped.matches.length, 1)
  assert.equal(capped.truncated, true)
})

test('git porcelain parsers read the CLI output shapes', () => {
  const status = parsePorcelainZ(' M src/a.ts\u0000?? new.txt\u0000A  staged.md\u0000')
  assert.equal(status.length, 3)
  assert.equal(status[0].path, 'src/a.ts')
  assert.equal(status[2].path, 'staged.md')

  const worktrees = parseWorktreeList('worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD def456\ndetached\n')
  assert.equal(worktrees.length, 2)
  assert.equal(worktrees[0].path, '/repo')
  assert.equal(worktrees[1].branch, 'HEAD')

  const entries = parseLogLines('abc123\u001ffirst commit\u001fAda\u001f2026-09-01 00:00:00 +0800\u001fabc123full\u001fHEAD -> main')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].subject, 'first commit')
})

test('git operations work against a real repository', async (t) => {
  const dir = workspace(t)
  const run = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { cwd: dir, encoding: 'utf8' })
  try {
    run('init', '-q')
  } catch {
    t.skip('git is unavailable')
    return
  }
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  run('add', 'a.txt')
  run('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')

  const before = await status(dir)
  assert.ok(JSON.stringify(before).includes('a.txt'))
  const patch = await diff(dir, 'a.txt', false)
  assert.ok(patch.includes('+two'))
  const entries = await log(dir, 5)
  assert.equal(entries.length, 1)
  assert.ok(JSON.stringify(entries[0]).includes('init'))

  await stage(dir, 'a.txt')
  await commit(dir, 'second')
  assert.deepEqual((await log(dir, 5)).length, 2)
  assert.equal(statSync(join(dir, '.git')).isDirectory(), true)
})

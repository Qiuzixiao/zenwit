import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('locally packed runtimes retain integrity checks without claiming an upstream commit', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'dsh-local-runtime-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, content) => {
    const target = resolve(root, path)
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  const json = (path, content) => write(path, JSON.stringify(content))
  const channels = Object.fromEntries(['stable', 'beta'].map(channel => [channel, {
    package: channel === 'stable' ? 'dsh-plugin-desktop' : 'dsh-plugin-desktop-beta',
    sourceVersion: '1.0.0',
    commit: 'original-upstream-commit',
  }]))
  json('upstream.json', { repository: 'https://example.com/original.git', activeChannel: 'beta', channels })
  json('package.json', {})
  for (const name of ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-community-market']) {
    json(`${name}/package.json`, { dependencies: { '@deepseek-ai/dsh': '1.0.0' } })
  }
  const tarball = 'deepseek-ai-dsh-1.0.0.tgz'
  write(`deepseek-harness/dist/npm/${tarball}`, 'local runtime bytes')
  write('deepseek-harness/dist/npm/publish-order.txt', `${tarball}\n`)
  write('scripts/sync-vendored-runtime.mjs', '')
  const script = resolve(root, 'scripts/sync-vendored-runtime.mjs')
  copyFileSync(resolve(import.meta.dirname, 'sync-vendored-runtime.mjs'), script)
  for (const channel of ['stable', 'beta']) {
    execFileSync(process.execPath, [script, '--write', '--channel', channel])
  }
  const manifest = JSON.parse(readFileSync(resolve(root, 'vendor/dsh-runtime/1.0.0/manifest.json'), 'utf8'))
  assert.equal(manifest.source, 'local')
  assert.equal(manifest.commit, undefined)
  for (const channel of ['stable', 'beta']) {
    assert.match(execFileSync(process.execPath, [script, '--check', '--channel', channel], { encoding: 'utf8' }), /local source/)
  }
  write(`vendor/dsh-runtime/1.0.0/${tarball}`, 'tampered runtime bytes')
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /integrity differs/)
})

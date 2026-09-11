import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('layout accepts editable kernel source without Git or a matching upstream version', t => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'dsh-local-layout-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  for (const file of [
    'package.json', 'upstream.json', 'scripts/verify-layout.mjs',
    'dsh-plugin-desktop/package.json', 'dsh-plugin-desktop-beta/package.json',
    'dsh-community-fabric/package.json', 'dsh-community-market/package.json',
    'deepseek-harness/package.json',
  ]) {
    const target = resolve(fixture, file)
    mkdirSync(resolve(target, '..'), { recursive: true })
    copyFileSync(resolve(root, file), target)
  }
  writeFileSync(resolve(fixture, 'CLAUDE.md'), 'AGENTS.md\n')
  const kernelPath = resolve(fixture, 'deepseek-harness/package.json')
  const kernel = JSON.parse(readFileSync(kernelPath, 'utf8'))
  kernel.version = '9.0.0-local'
  writeFileSync(kernelPath, JSON.stringify(kernel))
  const script = resolve(fixture, 'scripts/verify-layout.mjs')
  assert.match(execFileSync(process.execPath, [script], { encoding: 'utf8' }), /locally owned kernel/)

  for (const nestedGit of ['directory', 'file']) {
    const gitPath = resolve(fixture, 'deepseek-harness/.git')
    if (nestedGit === 'directory') mkdirSync(gitPath)
    else writeFileSync(gitPath, 'gitdir: ../.git/modules/deepseek-harness\n')
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /not a nested Git repository or submodule/)
    rmSync(gitPath, { recursive: true })
  }
})

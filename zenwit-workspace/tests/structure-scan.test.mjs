/** Bounded project scans: dependency-cache exclusion, entry budget, retained depth and detail contract. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProjectResources, scanProjectTree } from '../lib/structure-scan.js'

function project(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'zenwit-scan-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('scans omit dependency caches and private names, and keep the markdown detail contract', t => {
  const root = project(t)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'main.ts'), 'x')
  writeFileSync(join(root, 'notes.md'), 'hello world')
  mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'x')
  writeFileSync(join(root, 'node_modules', 'dep', 'README.md'), '# dependency')
  writeFileSync(join(root, '.env'), 'SECRET=1')

  const tree = scanProjectTree(root, 100)
  assert.equal(tree.truncated, false)
  assert.deepEqual(tree.entries.map(node => node.name).sort(), ['notes', 'src'])
  assert.deepEqual(tree.entries.find(node => node.name === 'notes'), { name: 'notes', path: join(root, 'notes.md'), kind: 'file', detail: '2 字' })
  assert.deepEqual(tree.entries.find(node => node.name === 'src').children.map(node => node.name), ['main.ts'])

  const resources = scanProjectResources(root, root, 100)
  assert.equal(resources.truncated, false)
  assert.deepEqual(resources.entries.map(entry => entry.name), ['notes.md'])
})

test('the entry budget bounds both scans and reports truncation at the boundary', t => {
  const root = project(t)
  for (const name of ['a.md', 'b.md', 'c.md']) writeFileSync(join(root, name), '# title')

  const exact = scanProjectTree(root, 3)
  assert.equal(exact.truncated, false)
  assert.equal(exact.entries.length, 3)
  const bounded = scanProjectTree(root, 2)
  assert.equal(bounded.truncated, true)
  assert.equal(bounded.entries.length, 2)

  const resourcesExact = scanProjectResources(root, root, 3)
  assert.equal(resourcesExact.truncated, false)
  assert.equal(resourcesExact.entries.length, 3)
  const resourcesBounded = scanProjectResources(root, root, 2)
  assert.equal(resourcesBounded.truncated, true)
  assert.equal(resourcesBounded.entries.length, 2)
})

test('scans retain the level 0-8 depth limit', t => {
  const root = project(t)
  const nested = Array.from({ length: 9 }, (_, index) => 'd' + (index + 1)).reduce((dir, name) => {
    const next = join(dir, name)
    mkdirSync(next)
    return next
  }, root)
  const atLimit = join(root, ...Array.from({ length: 8 }, (_, index) => 'd' + (index + 1)), 'shallow.md')
  const beyondLimit = join(nested, 'deep.md')
  writeFileSync(atLimit, '# shallow')
  writeFileSync(beyondLimit, '# deep')

  assert.deepEqual(scanProjectResources(root, root, 100).entries.map(entry => entry.name), ['d1/d2/d3/d4/d5/d6/d7/d8/shallow.md'])

  // The level-8 directory is listed, but the walk does not descend into level 9.
  let cursor = scanProjectTree(root, 100).entries[0]
  for (let level = 1; level < 8; level += 1) cursor = cursor.children[0]
  assert.deepEqual(cursor.children.map(node => node.name), ['d9', 'shallow'])
  assert.deepEqual(cursor.children[0].children, [])
})

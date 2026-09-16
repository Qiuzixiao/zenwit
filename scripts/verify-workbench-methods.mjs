/**
 * Guard the workbench engine's Client ↔ Host method contract.
 *
 * The engine's browser half calls named methods over one endpoint; the
 * Host half answers them from its own dispatch table (the package's built-in
 * methods plus the host-supplied `extra` table). Nothing in TypeScript
 * connects the two — a rename on either side compiles and then fails at
 * runtime with a 404 — so this check reads both sides' source and reports
 * drift.
 *
 * Known gaps are listed explicitly. They are features whose Host half is not
 * ported yet (the client ships the views); the list is the place a new gap
 * must be declared, and removing an entry is what finishing one means.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const CLIENT_ROOT = join(root, 'deepseek-harness/packages/client/ui-workbench/src/client/workbench')
const HOST_BACKEND = join(root, 'zenwit-workspace/src/workbench/backend.ts')
const HOST_EXTRAS = [
  join(root, 'dsh-plugin-desktop/src/workspace.ts'),
  join(root, 'dsh-plugin-desktop/src/workbench-sidechat.ts'),
  join(root, 'dsh-plugin-desktop-beta/src/workspace.ts'),
  join(root, 'dsh-plugin-desktop-beta/src/workbench-sidechat.ts'),
]

/** Engine features whose Host half is not ported yet (see the module comment). */
const KNOWN_GAPS = new Set([])

/** Every source file under one directory tree. */
function sources(directory) {
  const found = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...sources(path))
    else if (/\.tsx?$/u.test(entry)) found.push(path)
  }
  return found
}

/** Method names the browser half calls: `call<T>('ns.method'` / `call('ns.method'`. */
function clientMethods() {
  const names = new Set()
  const pattern = /\bcall(?:<[^>]*>)?\(\s*'([a-zA-Z][\w-]*(?:\.[\w-]+)+)'/gu
  for (const file of sources(CLIENT_ROOT)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(pattern)) names.add(match[1])
  }
  return names
}

/** Method names a Host module declares as table keys: `'ns.method': `. */
function hostMethods(files) {
  const names = new Set()
  const pattern = /^\s*'([a-zA-Z][\w-]*(?:\.[\w-]+)+)':/gmu
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(pattern)) names.add(match[1])
  }
  return names
}

/** Method names the backend declares as not ported yet (`NOT_PORTED_METHODS`). */
function notPortedMethods() {
  const text = readFileSync(HOST_BACKEND, 'utf8')
  const start = text.indexOf('const NOT_PORTED_METHODS')
  if (start === -1) return new Set()
  const end = text.indexOf('])', start)
  const block = text.slice(start, end === -1 ? undefined : end)
  const names = new Set()
  for (const match of block.matchAll(/\['([\w.-]+)',/gu)) names.add(match[1])
  return names
}

const called = clientMethods()
const served = hostMethods([HOST_BACKEND, ...HOST_EXTRAS])
const notPorted = notPortedMethods()
const missing = [...called].filter(name => !served.has(name) && !KNOWN_GAPS.has(name)).sort()
const undeclared = [...served].filter(name => !called.has(name)).sort()
const staleGaps = [...KNOWN_GAPS].filter(name => served.has(name) || !called.has(name)).sort()

if (missing.length > 0) {
  process.stderr.write(`verify-workbench-methods: the browser half calls methods the host does not serve:\n${missing.map(name => `- ${name}\n`).join('')}`)
  process.exit(1)
}
if (staleGaps.length > 0) {
  process.stderr.write(`verify-workbench-methods: KNOWN_GAPS entries that are served or no longer called:\n${staleGaps.map(name => `- ${name}\n`).join('')}`)
  process.exit(1)
}
// The transport's "not ported yet" answers and this list must be the same
// set: a gap the backend still 404s shows a developer string, and a method
// answered 501 while listed as served hides a missing implementation.
const unlisted = [...notPorted].filter(name => !KNOWN_GAPS.has(name)).sort()
const unanswered = [...KNOWN_GAPS].filter(name => !notPorted.has(name)).sort()
if (unlisted.length > 0 || unanswered.length > 0) {
  process.stderr.write(
    'verify-workbench-methods: the backend\'s NOT_PORTED_METHODS and KNOWN_GAPS disagree:\n'
    + [...unlisted.map(name => `- ${name} answered 501 but not declared in KNOWN_GAPS\n`),
       ...unanswered.map(name => `- ${name} declared as a gap but answered with an unknown-method 404\n`)].join(''),
  )
  process.exit(1)
}
if (undeclared.length > 0) {
  process.stdout.write(`verify-workbench-methods: host methods no client call reaches (review, not a failure): ${undeclared.join(', ')}\n`)
}
process.stdout.write(
  `verify-workbench-methods: ${String(called.size)} client method(s) are served by the host`
  + ` (${String(KNOWN_GAPS.size)} declared gap(s), all answered 501 with a product sentence);`
  + ` sources: ${relative(root, CLIENT_ROOT)}, ${relative(root, HOST_BACKEND)}\n`,
)

import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const fail = message => { throw new Error(`verify-layout: ${message}`) }

const workspace = readJson('package.json')
const upstream = readJson('upstream.json')
const stablePlugin = readJson('dsh-plugin-desktop/package.json')
const betaPlugin = readJson('dsh-plugin-desktop-beta/package.json')
const fabric = readJson('dsh-community-fabric/package.json')
const market = readJson('dsh-community-market/package.json')
const upstreamPackage = readJson('deepseek-harness/package.json')

if (stablePlugin.name !== 'dsh-plugin-desktop') fail('the stable Desktop workspace must retain dsh-plugin-desktop')
if (betaPlugin.name !== 'dsh-plugin-desktop-beta') fail('the Beta Desktop workspace must publish as dsh-plugin-desktop-beta')
if (!['stable', 'beta'].includes(upstream.activeChannel)) fail('the runtime must use a declared release channel')
const activeUpstream = upstream.channels?.[upstream.activeChannel]
if (activeUpstream === undefined) fail('the active upstream channel is missing')

if (workspace.packageManager !== 'yarn@4.18.0') {
  fail('the product workspace must pin yarn@4.18.0')
}
if (JSON.stringify(workspace.workspaces) !== JSON.stringify([
  'dsh-plugin-desktop',
  'dsh-plugin-desktop-beta',
  'dsh-community-fabric',
  'dsh-community-market',
])) {
  fail('the root Yarn workspace must contain the desktop, community-fabric, and community-market packages')
}
for (const [name, manifest] of [
  ['dsh-plugin-desktop', stablePlugin],
  ['dsh-plugin-desktop-beta', betaPlugin],
  ['dsh-community-fabric', fabric],
  ['dsh-community-market', market],
]) {
  if (manifest.packageManager !== undefined) fail(`${name} must inherit the root Yarn release`)
}
if (fabric.name !== 'dsh-community-fabric') fail('the Fabric workspace must own dsh-community-fabric')
if (market.name !== 'dsh-community-market') fail('the market workspace must own dsh-community-market')
const claudePath = resolve(root, 'CLAUDE.md')
const claudeStat = lstatSync(claudePath)
// Windows checkouts materialize the symlink as a regular file holding the
// target name; accept both forms so the pointer stays verified on every host.
const claudeTarget = claudeStat.isSymbolicLink()
  ? readlinkSync(claudePath)
  : readFileSync(claudePath, 'utf8').trim()
if (claudeTarget !== 'AGENTS.md') {
  fail('CLAUDE.md must link to the outer repository AGENTS.md')
}
for (const legacyFile of [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'dsh-plugin-desktop/pnpm-lock.yaml',
  'dsh-plugin-desktop/pnpm-workspace.yaml',
  'dsh-plugin-desktop-beta/pnpm-lock.yaml',
  'dsh-plugin-desktop-beta/pnpm-workspace.yaml',
  'dsh-community-fabric/pnpm-lock.yaml',
  'dsh-community-fabric/pnpm-workspace.yaml',
  'dsh-community-market/pnpm-lock.yaml',
  'dsh-community-market/pnpm-workspace.yaml',
]) {
  if (existsSync(resolve(root, legacyFile))) fail(`${legacyFile} must not exist`)
}
if (existsSync(resolve(root, 'deepseek-harness/.git'))) {
  fail('deepseek-harness must be owned source, not a nested Git repository or submodule')
}
if (typeof upstreamPackage.packageManager !== 'string' || !upstreamPackage.packageManager.startsWith('pnpm@')) {
  fail('the upstream checkout must retain its pnpm package manager')
}

for (const [owner, manifest] of [
  ['root', workspace],
  ['stable desktop', stablePlugin],
  ['beta desktop', betaPlugin],
  ['fabric', fabric],
  ['market', market],
]) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'resolutions']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== 'string') continue
      if (/^(?:workspace|portal|link):/u.test(range)
        || (range.startsWith('file:') && range.includes('deepseek-harness'))) {
        fail(`${owner} ${field}.${name} bypasses the published DSH package boundary`)
      }
    }
  }
}

for (const [channel, plugin] of [['stable', stablePlugin], ['beta', betaPlugin]]) {
  const metadata = upstream.channels?.[channel]
  if (metadata?.package !== plugin.name) fail(`${channel} upstream metadata points at the wrong package`)
  for (const name of Object.keys(plugin.dependencies).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))) {
    if (plugin.dependencies[name] !== metadata.runtimePackageVersion) {
      fail(`${plugin.name} ${name} must use the recorded ${channel} DSH runtime package family`)
    }
  }
}

process.stdout.write('verify-layout: dual Desktop workspaces and locally owned kernel source are consistent\n')

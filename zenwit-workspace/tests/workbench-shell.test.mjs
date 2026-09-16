import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundTranscript, createShellRegistry, TRANSCRIPT_LIMIT } from '../lib/workbench/shell.js'

/** One scripted PTY: records what the session wrote and can emit output/exit. */
function fakeSpawn() {
  const processes = []
  const spawn = {
    spawn(options) {
      const dataListeners = new Set()
      const exitListeners = new Set()
      const process = {
        options,
        writes: [],
        resizes: [],
        kills: [],
        alive: true,
        pid: 1000 + processes.length,
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener) },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener) },
        write(data) { process.writes.push(data) },
        resize(cols, rows) { process.resizes.push([cols, rows]) },
        kill(signal) { process.kills.push(signal); process.alive = false },
        emitData(chunk) { for (const listener of [...dataListeners]) listener(chunk) },
        emitExit(event) { process.alive = false; for (const listener of [...exitListeners]) listener(event) },
      }
      processes.push(process)
      return process
    },
  }
  return { spawn, processes }
}

test('a shell session carries writes, resizes, output and replay', async () => {
  const { spawn, processes } = fakeSpawn()
  const registry = createShellRegistry({ spawn, env: { PATH: '/usr/bin' }, shell: '/bin/zsh' })
  const session = await registry.open({ key: 'session:tab1', cwd: '/project', cols: 80, rows: 24 })
  const child = processes[0]
  assert.equal(child.options.cwd, '/project')
  assert.equal(child.options.cols, 80)
  assert.equal(child.options.shell, '/bin/zsh')
  assert.equal(child.options.env.PATH, '/usr/bin')

  const chunks = []
  session.onData(chunk => chunks.push(chunk))
  child.emitData('hello ')
  child.emitData('world')
  session.write('ls\n')
  session.resize(100, 30)
  assert.deepEqual(chunks, ['hello ', 'world'])
  assert.deepEqual(child.writes, ['ls\n'])
  assert.deepEqual(child.resizes, [[100, 30]])

  // A reattaching browser replays everything the shell printed.
  assert.equal(session.transcript(), 'hello world')
  assert.equal(registry.get('session:tab1'), session)
  assert.equal((await registry.open({ key: 'session:tab1', cwd: '/other', cols: 10, rows: 5 })), session)

  session.kill()
  assert.deepEqual(child.kills, [undefined])
})

test('exit clears the key, notifies once and stops further writes', async () => {
  const { spawn, processes } = fakeSpawn()
  const registry = createShellRegistry({ spawn })
  const session = await registry.open({ key: 'k', cwd: '/project', cols: 80, rows: 24 })
  const events = []
  session.onExit(event => events.push(event))
  processes[0].emitExit({ exitCode: 0 })
  assert.deepEqual(events, [{ exitCode: 0 }])
  assert.equal(session.alive, false)
  assert.equal(registry.get('k'), undefined)
  session.write('ignored')
  assert.deepEqual(processes[0].writes, [])
  registry.dispose()
})

test('the transcript is bounded without splitting a character', () => {
  assert.equal(boundTranscript('short', 64), 'short')
  const text = '你'.repeat(10)
  const bounded = boundTranscript(text, 7)
  assert.ok(Buffer.byteLength(bounded, 'utf8') <= 7)
  assert.ok(text.endsWith(bounded))
  const big = 'x'.repeat(TRANSCRIPT_LIMIT + 100)
  assert.equal(Buffer.byteLength(boundTranscript(big, TRANSCRIPT_LIMIT), 'utf8'), TRANSCRIPT_LIMIT)
})

test('a failing PTY dependency is reported, not thrown at load', async () => {
  const registry = createShellRegistry({
    spawn: { spawn() { throw new Error('spawn is unavailable') } },
  })
  assert.deepEqual(await registry.available(), { available: true })
  const failing = createShellRegistry()
  const before = await failing.available()
  // The real addon may or may not load in this environment; either way the
  // probe answers with a boolean and a detail string when it fails.
  assert.equal(typeof before.available, 'boolean')
  if (!before.available) assert.equal(typeof before.detail, 'string')
  failing.dispose()
})

test('dispose closes every session', async () => {
  const { spawn, processes } = fakeSpawn()
  const registry = createShellRegistry({ spawn })
  await registry.open({ key: 'a', cwd: '/p', cols: 80, rows: 24 })
  await registry.open({ key: 'b', cwd: '/p', cols: 80, rows: 24 })
  registry.dispose()
  assert.equal(registry.get('a'), undefined)
  assert.equal(registry.get('b'), undefined)
  assert.equal(processes.every(process => process.kills.length === 1), true)
})

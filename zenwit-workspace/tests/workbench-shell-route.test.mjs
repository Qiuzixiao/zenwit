import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'
import { createShellRegistry } from '../lib/workbench/shell.js'
import { createShellUpgradeHandler, PTY_DEPS_MISSING_REASON, TERMINAL_UPGRADE_PATH } from '../lib/workbench/shell-route.js'

/** One scripted PTY (no native addon needed). */
function fakeSpawn() {
  const processes = []
  return {
    processes,
    spawn: {
      spawn(options) {
        const dataListeners = new Set()
        const exitListeners = new Set()
        const process = {
          options, writes: [], resizes: [],
          pid: 4000 + processes.length,
          onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener) },
          onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener) },
          write(data) { process.writes.push(data) },
          resize(cols, rows) { process.resizes.push([cols, rows]) },
          kill() {},
          emitData(chunk) { for (const listener of [...dataListeners]) listener(chunk) },
        }
        processes.push(process)
        return process
      },
    },
  }
}

/** A live upgrade endpoint over a real socket. */
async function fixture(t, options = {}) {
  const fake = fakeSpawn()
  const registry = options.registry ?? createShellRegistry({ spawn: fake.spawn, shell: '/bin/sh' })
  const handler = createShellUpgradeHandler({
    registry,
    isProjectPath: options.isProjectPath ?? (() => true),
    repair: { command: 'reinstall the desktop app', profile: null },
  })
  const server = createServer()
  server.on('upgrade', (req, socket, head) => handler.handle(req, socket, head))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `ws://127.0.0.1:${server.address().port}`
  // Upgraded sockets are not counted by closeAllConnections, so every socket
  // this fixture hands out is terminated before the server is closed.
  const sockets = []
  t.after(async () => {
    for (const socket of sockets) socket.terminate()
    handler.dispose()
    registry.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const connect = (query = 'cwd=/project&tab=t1&sessionId=s1') => {
    const socket = new WebSocket(origin + TERMINAL_UPGRADE_PATH + '?' + query)
    sockets.push(socket)
    return socket
  }
  return { fake, registry, connect }
}

/** Wait until `check` holds (the attach path is asynchronous). */
async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('waitFor timed out')
}

test('a terminal socket attaches, streams, resizes and replays after a reconnect', async (t) => {
  const { fake, connect } = await fixture(t)
  const socket = connect()
  // The listener is attached before the handshake completes: the transcript
  // replay of a reconnect arrives immediately after open.
  const first = []
  socket.on('message', (data) => first.push(data.toString()))
  await once(socket, 'open')
  await waitFor(() => fake.processes.length === 1)
  const child = fake.processes[0]
  assert.equal(child.options.cwd, '/project')
  assert.equal(child.options.cols, 80)

  child.emitData('hello from the shell\r\n')
  await waitFor(() => first.length > 0)
  assert.deepEqual(first, ['hello from the shell\r\n'])

  socket.send('ls\n')
  socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(child.writes, ['ls\n'])
  assert.deepEqual(child.resizes, [[120, 40]])

  // A reload reconnects: the transcript replays before new output streams.
  socket.close()
  await once(socket, 'close')
  const second = connect()
  const replayed = []
  second.on('message', (data) => replayed.push(data.toString()))
  await once(second, 'open')
  await waitFor(() => replayed.length > 0)
  assert.deepEqual(replayed, ['hello from the shell\r\n'])
  second.close()
})

test('a broken PTY dependency closes with the dependency marker', async (t) => {
  const broken = {
    open: async () => { throw new Error('unavailable') },
    get: () => undefined,
    close: () => undefined,
    available: async () => ({ available: false, detail: 'node-pty failed to load' }),
    dispose: () => undefined,
  }
  const { connect } = await fixture(t, { registry: broken })
  const socket = connect()
  const [code, reason] = await new Promise((resolve) => {
    socket.on('close', (closeCode, closeReason) => resolve([closeCode, closeReason.toString()]))
  })
  assert.equal(code, 1011)
  assert.equal(reason, PTY_DEPS_MISSING_REASON)
})

test('a socket for an unregistered project is refused', async (t) => {
  const { connect } = await fixture(t, { isProjectPath: () => false })
  const socket = connect()
  const [code, reason] = await new Promise((resolve) => {
    socket.on('close', (closeCode, closeReason) => resolve([closeCode, closeReason.toString()]))
  })
  assert.equal(code, 1011)
  assert.match(reason, /^shell-not-found:/u)
})

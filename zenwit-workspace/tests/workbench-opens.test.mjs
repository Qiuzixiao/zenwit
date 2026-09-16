import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'
import { createOpenRegistry } from '../lib/workbench/opens.js'
import { createOpenUpgradeHandler, OPEN_UPGRADE_PATH } from '../lib/workbench/opens-route.js'

test('a queued open waits for a view and is consumed on send', () => {
  const registry = createOpenRegistry()
  const delivered = []
  const first = registry.enqueue({ sessionId: 's1', kind: 'file', target: '/p/a.ts', title: 'a.ts' })
  assert.equal(first.delivered, false)
  assert.equal(registry.pending('s1'), 1)

  const detach = registry.attach('s1', request => delivered.push(request))
  assert.deepEqual(delivered.map(request => request.target), ['/p/a.ts'])
  assert.equal(registry.pending('s1'), 0)

  // A second view attached later sees only what arrives after it attached:
  // a delivered open is never replayed onto a fresh socket.
  detach()
  const later = []
  registry.attach('s1', request => later.push(request))
  assert.deepEqual(later, [])
})

test('a live open reaches every attached view', () => {
  const registry = createOpenRegistry()
  const a = []
  const b = []
  registry.attach('s1', request => a.push(request))
  registry.attach('s1', request => b.push(request))
  const result = registry.enqueue({ sessionId: 's1', kind: 'url', target: 'https://example.com', title: 'example' })
  assert.equal(result.delivered, true)
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.equal(a[0].kind, 'url')
  registry.drain()
  assert.equal(registry.pending('s1'), 0)
  registry.dispose()
})

test('the open socket replays queued requests and streams live ones', async (t) => {
  const registry = createOpenRegistry()
  const handler = createOpenUpgradeHandler(registry)
  const server = createServer()
  server.on('upgrade', (req, socket, head) => handler.handle(req, socket, head))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `ws://127.0.0.1:${server.address().port}`
  const sockets = []
  t.after(async () => {
    for (const socket of sockets) socket.terminate()
    handler.dispose()
    registry.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  // Queued while nothing was attached, plus one queued *after* the socket
  // opens: both arrive, in order.
  registry.enqueue({ sessionId: 's1', kind: 'folder', target: '/p/docs', title: 'docs' })
  const socket = new WebSocket(origin + OPEN_UPGRADE_PATH + '?sessionId=s1')
  sockets.push(socket)
  const received = []
  socket.on('message', (data) => received.push(JSON.parse(data.toString())))
  await once(socket, 'open')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(received.map(request => request.target), ['/p/docs'])

  registry.enqueue({ sessionId: 's1', kind: 'file', target: '/p/b.ts', title: 'b.ts' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(received.map(request => request.target), ['/p/docs', '/p/b.ts'])
  assert.match(received[0].id, /^open-/u)

  // Another session's requests do not leak into this view.
  registry.enqueue({ sessionId: 'other', kind: 'file', target: '/p/c.ts', title: 'c.ts' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(received.length, 2)
})

test('the open socket refuses a connection without a session', async (t) => {
  const registry = createOpenRegistry()
  const handler = createOpenUpgradeHandler(registry)
  const server = createServer()
  server.on('upgrade', (req, socket, head) => handler.handle(req, socket, head))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}${OPEN_UPGRADE_PATH}`)
  t.after(async () => {
    socket.terminate()
    handler.dispose()
    registry.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const [code] = await new Promise((resolve) => {
    socket.on('close', (closeCode, reason) => resolve([closeCode, reason.toString()]))
  })
  assert.equal(code, 1008)
})

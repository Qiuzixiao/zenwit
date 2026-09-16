/**
 * WebSocket route for model-driven opens.
 *
 * The client attaches with `?sessionId=<id>`; every request the model queued
 * for that session is replayed, then live requests stream as they arrive
 * (see {@link createOpenRegistry} for the delivery rules).
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { OpenRegistry } from './opens.js'

/** The exact upgrade path the client connects to. */
export const OPEN_UPGRADE_PATH = '/api/desktop/workbench/ws/agent-opens'

/**
 * Create the upgrade handler for the open-request route.
 * @param registry - the delivery registry the model's tool writes into.
 * @returns the handler plus its disposer.
 */
export function createOpenUpgradeHandler(
  registry: OpenRegistry,
): { handle(req: IncomingMessage, socket: Duplex, head: Buffer): void; dispose(): void } {
  const server = new WebSocketServer({ noServer: true })

  const attach = (ws: WebSocket, req: IncomingMessage): void => {
    const url = new URL(req.url ?? '/', 'http://workbench.internal')
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (sessionId === '') {
      ws.close(1008, 'sessionId is required')
      return
    }
    const detach = registry.attach(sessionId, (request) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(request))
    })
    ws.on('close', detach)
    ws.on('error', detach)
  }

  return {
    handle(req, socket, head) {
      server.handleUpgrade(req, socket, head, (ws) => { attach(ws, req) })
    },
    dispose() { server.close() },
  }
}

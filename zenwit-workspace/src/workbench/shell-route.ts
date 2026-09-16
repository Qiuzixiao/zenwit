/**
 * WebSocket upgrade handler for the workbench terminal.
 *
 * Wire contract (shared with the client view):
 *
 * - client → host: raw text (keystrokes), or a JSON control frame
 *   `{ type: 'resize', cols, rows }` | `{ type: 'close' }` | `{ type: 'park' }`;
 * - host → client: terminal output as text frames;
 * - a refusal closes with code 1011 and reason `pty-deps-missing` (the native
 *   addon did not load) or `shell-not-found:<name>` (the configured shell is
 *   not executable) — the client turns both into a localized banner.
 *
 * A detached socket (a reload, a dropped link) leaves the session running and
 * `park`ed: the next attach replays the transcript before streaming again.
 * Only `close` (or the process exiting) ends the session.
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { requireAbsolute } from './tree.js'
import type { ShellRegistry, ShellSession } from './shell.js'

/** The exact upgrade path the client connects to. */
export const TERMINAL_UPGRADE_PATH = '/api/desktop/workbench/ws/terminal'

/** Close reason reported when the PTY dependency is unusable. */
export const PTY_DEPS_MISSING_REASON = 'pty-deps-missing'

/** Close reason prefix reported when the configured shell cannot be started. */
export const SHELL_NOT_FOUND_PREFIX = 'shell-not-found:'

/** Options of one upgrade handler. */
export interface ShellUpgradeOptions {
  /** The PTY registry backing every terminal. */
  registry: ShellRegistry
  /** Whether a directory is a registered project. */
  isProjectPath(path: string): boolean
  /** Repair hint reported by the dependency probe. */
  repair: { command: string; profile: string | null; note?: string }
}

/** The deps response the client renders when the addon is broken. */
export interface ShellDepsResponse {
  ok: boolean
  cause?: string
  command?: string
  profile?: string | null
  note?: string
}

/**
 * Probe the PTY dependency and describe the repair.
 * @param options - registry and repair hint.
 * @returns the client-facing status.
 */
export async function shellDepsStatus(options: Pick<ShellUpgradeOptions, 'registry' | 'repair'>): Promise<ShellDepsResponse> {
  const status = await options.registry.available()
  if (status.available) return { ok: true }
  return {
    ok: false,
    cause: status.detail ?? 'unknown',
    command: options.repair.command,
    profile: options.repair.profile,
    ...(options.repair.note === undefined ? {} : { note: options.repair.note }),
  }
}

/** Whether a spawn failure means the shell executable is missing. */
function shellMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || /not found|no such file/iu.test(error instanceof Error ? error.message : '')
}

/**
 * Create the upgrade handler for the terminal route.
 * @param options - registry, project predicate and repair hint.
 * @returns the handler the webserver calls with the raw socket.
 */
export function createShellUpgradeHandler(
  options: ShellUpgradeOptions,
): { handle(req: IncomingMessage, socket: Duplex, head: Buffer): void; dispose(): void } {
  const server = new WebSocketServer({ noServer: true })

  const attach = async (ws: WebSocket, req: IncomingMessage): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://workbench.internal')
    const project = url.searchParams.get('cwd') ?? ''
    const tab = url.searchParams.get('tab') ?? 'terminal'
    const sessionId = url.searchParams.get('sessionId') ?? 'session'
    const key = `${sessionId}:${tab}`

    if (project === '' || !options.isProjectPath(requireAbsolute(project))) {
      ws.close(1011, SHELL_NOT_FOUND_PREFIX + 'project')
      return
    }
    const deps = await shellDepsStatus(options)
    if (!deps.ok) {
      ws.close(1011, PTY_DEPS_MISSING_REASON)
      return
    }

    let session: ShellSession
    try {
      session = await options.registry.open({ key, cwd: project, cols: 80, rows: 24 })
    } catch (error) {
      ws.close(1011, shellMissing(error) ? SHELL_NOT_FOUND_PREFIX + (options.repair.profile ?? '') : PTY_DEPS_MISSING_REASON)
      return
    }

    if (ws.readyState !== ws.OPEN) return
    // Replay before streaming: the attach point is the transcript's end.
    const replay = session.transcript()
    if (replay !== '') ws.send(replay)
    const offData = session.onData((chunk) => { if (ws.readyState === ws.OPEN) ws.send(chunk) })
    const offExit = session.onExit(() => { offData(); if (ws.readyState === ws.OPEN) ws.close(1000) })

    ws.on('message', (raw, isBinary) => {
      const text = isBinary ? raw.toString('utf8') : raw.toString()
      if (text.startsWith('{')) {
        try {
          const frame = JSON.parse(text) as { type?: unknown; cols?: unknown; rows?: unknown }
          if (frame.type === 'resize' && typeof frame.cols === 'number' && typeof frame.rows === 'number') {
            session.resize(frame.cols, frame.rows)
            return
          }
          if (frame.type === 'close') {
            session.kill()
            return
          }
          if (frame.type === 'park') return
        } catch {
          // A malformed control frame is treated as keystrokes; the terminal
          // must not lose input because of a stray brace.
        }
      }
      session.write(text)
    })
    ws.on('close', () => { offData(); offExit() })
  }

  return {
    handle(req, socket, head) {
      server.handleUpgrade(req, socket, head, (ws) => { void attach(ws, req) })
    },
    dispose() { server.close() },
  }
}

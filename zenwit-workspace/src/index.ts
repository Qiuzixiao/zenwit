/** Cordis host face. No Electron, desktop, screenplay, or kernel runtime import. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { join } from 'node:path'
import { createWorkspaceBackend, PROJECT_API_PATHS, type WorkspaceOptions } from './backend.js'
import { createWorkbenchBackend, WORKBENCH_API_PATHS } from './workbench/backend.js'
import { PREVIEW_HTML_PREFIX } from './workbench/preview.js'
import { createShellRegistry } from './workbench/shell.js'
import { createShellUpgradeHandler, TERMINAL_UPGRADE_PATH } from './workbench/shell-route.js'
import { createOpenRegistry } from './workbench/opens.js'
import { createOpenUpgradeHandler, OPEN_UPGRADE_PATH } from './workbench/opens-route.js'

export { createWorkspaceBackend, PROJECT_API_PATHS, type WorkspaceOptions } from './backend.js'
export { createWorkbenchBackend, WORKBENCH_API_PATHS, type WorkbenchOptions } from './workbench/backend.js'
export { createChangesOpsMethod, type ChangesOpsResult, type WorkbenchSessionEvent } from './workbench/changes.js'
export { createSubagentsLiveMethod, type SubagentEntry, type SubagentsLiveDeps } from './workbench/subagents.js'
export { lastActivity, contentText, type LastActivity } from './workbench/subagent-activity.js'
export { createJobsOutputMethod, createJobsKillMethod, type JobOutputResult } from './workbench/jobs.js'
export { PREVIEW_HTML_PREFIX, PREVIEW_MEDIA_PATH } from './workbench/preview.js'
export { TERMINAL_UPGRADE_PATH } from './workbench/shell-route.js'
export { OPEN_UPGRADE_PATH } from './workbench/opens-route.js'
export {
  SIDE_BOUNDARY_PREFIX,
  SIDE_BOUNDARY_PROMPT,
  SIDE_INJECTION_PLUGIN,
  SIDE_THREAD_DEFAULT_NAME,
  SIDE_THREAD_MARK,
  boundaryDelivered,
  buildOpenTurnSnapshot,
  buildSidechatInheritance,
  hasDanglingToolCall,
  isContextInjectionMessage,
  sideLabel,
  threadOwnLogEvents,
  type SeedEvent,
  type SidechatInheritance,
  type SidechatLiveChunk,
  type SidechatThreadInfo,
} from './workbench/sidechat.js'
export type { ProjectSummary, ProjectLibrarySnapshot, ProjectCreated } from './types.js'

export const name = 'zenwit-workspace'
export const inject = ['webServer', 'connection']

/** Structural service boundary allows use with Cordis without coupling core HTTP to it. */
export interface WorkspaceHostContext {
  webServer: {
    port: number
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }): () => void
    /** Exact-path upgrade registration (the terminal socket). */
    registerUpgrade?(route: { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void }): () => void
  }
  connection: { requestRejection(req: IncomingMessage): number | undefined }
  /**
   * Kernel session store. Host-supplied methods that read the session log
   * (the workbench's file lens) receive it structurally, so this package
   * still imports no kernel runtime.
   */
  sessions?: { get(id: string): { snapshotEvents(): readonly unknown[] } | undefined }
  /** Service lookup (Cordis `ctx.get`); host-supplied methods read optional services with it. */
  get?(name: string): unknown
  effect(callback: () => () => void, description: string): unknown
  /** Service publication; absent on stripped hosts that only fetch routes. */
  provide?(name: string, value: unknown): void
}

export type Config = Omit<WorkspaceOptions, 'expectedOrigin'> & {
  expectedOrigin?: string
  /** Absolute path of the workbench preference document; defaults under the home directory. */
  settingsFile?: string
  /**
   * Host-supplied methods needing services this package does not own, for
   * example the session-log lens (`changes.ops`). `dsh-plugin-desktop`
   * supplies them from the kernel services it already injects.
   */
  extra?: Record<string, (payload: unknown) => Promise<unknown> | unknown>
}

export function apply(ctx: WorkspaceHostContext, config: Config = {}): void {
  const expectedOrigin = config.expectedOrigin ?? `http://127.0.0.1:${ctx.webServer.port}`
  const backend = createWorkspaceBackend({ ...config, expectedOrigin })
  // The workbench engine shares the project library's trust boundary: a method
  // may only name a directory the library has registered.
  const shells = createShellRegistry()
  // The engine's preferences live beside the project library. A host that
  // resolved no home directory simply has no settings store (the methods
  // answer 501 instead of silently dropping writes).
  const settingsFile = config.settingsFile ?? (config.homeDir === undefined
    ? undefined
    : join(config.homeDir, 'workspace', 'workbench-preferences.json'))
  const workbench = createWorkbenchBackend({
    expectedOrigin,
    isProjectPath: backend.isSafeProjectPath,
    shells,
    ...(settingsFile === undefined ? {} : { settingsFile }),
    ...(config.nativeAction === undefined ? {} : { nativeAction: config.nativeAction }),
    ...(config.extra === undefined ? {} : { extra: config.extra }),
  })
  const terminal = createShellUpgradeHandler({
    registry: shells,
    isProjectPath: backend.isSafeProjectPath,
    repair: {
      command: 'reinstall the desktop app',
      profile: null,
      note: 'the terminal needs the native PTY addon that ships with the app',
    },
  })
  ctx.effect(() => () => {
    backend.dispose()
    workbench.dispose()
    terminal.dispose()
    shells.dispose()
  }, 'zenwit-workspace: dispose backends')
  // The terminal socket is the one upgrade route this package owns; a host
  // without upgrade support simply does not offer terminals.
  const opens = createOpenRegistry()
  const openRoute = createOpenUpgradeHandler(opens)
  if (ctx.webServer.registerUpgrade !== undefined) {
    const registerUpgrade = ctx.webServer.registerUpgrade.bind(ctx.webServer)
    ctx.effect(() => registerUpgrade({ path: TERMINAL_UPGRADE_PATH, handler: terminal.handle }), 'zenwit-workspace: terminal socket')
    ctx.effect(() => registerUpgrade({ path: OPEN_UPGRADE_PATH, handler: openRoute.handle }), 'zenwit-workspace: open-request socket')
  }
  // The model-facing tool (registered by the host plugin that owns tools)
  // pushes through this service; the route above delivers to the browser.
  ctx.provide?.('workbenchOpens', { enqueue: (request: Parameters<typeof opens.enqueue>[0]) => opens.enqueue(request) })
  ctx.effect(() => () => { openRoute.dispose(); opens.dispose() }, 'zenwit-workspace: dispose open requests')
  /** One route behind the shared loopback-trust rejection. */
  const register = (path: string, handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>, kind: 'exact' | 'prefix' = 'exact'): void => {
    ctx.effect(() => ctx.webServer.register({
      kind, path,
      async handler(req, res) {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'cache-control': 'no-store', 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
          return
        }
        await handle(req, res)
      },
    }), `zenwit-workspace: ${path}`)
  }
  for (const path of PROJECT_API_PATHS) register(path, (req, res) => backend.handle(req, res))
  for (const path of WORKBENCH_API_PATHS) register(path, (req, res) => workbench.handle(req, res))
  // The HTML preview URL is path-encoded (project + file path), so its route
  // matches a prefix: the previewed page's own relative assets resolve back
  // into the same prefix and stay inside the route.
  register(PREVIEW_HTML_PREFIX.replace(/\/$/u, ''), (req, res) => workbench.handle(req, res), 'prefix')
}

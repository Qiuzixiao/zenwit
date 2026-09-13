/** Cordis host face. No Electron, desktop, screenplay, or kernel runtime import. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createWorkspaceBackend, PROJECT_API_PATHS, type WorkspaceOptions } from './backend.js'

export { createWorkspaceBackend, PROJECT_API_PATHS, type WorkspaceOptions } from './backend.js'
export type { ProjectSummary, ProjectLibrarySnapshot, ProjectCreated } from './types.js'

export const name = 'zenwit-workspace'
export const inject = ['webServer', 'connection']

/** Structural service boundary allows use with Cordis without coupling core HTTP to it. */
export interface WorkspaceHostContext {
  webServer: {
    port: number
    register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }): () => void
  }
  connection: { requestRejection(req: IncomingMessage): number | undefined }
  effect(callback: () => () => void, description: string): unknown
}

export type Config = Omit<WorkspaceOptions, 'expectedOrigin'> & { expectedOrigin?: string }

export function apply(ctx: WorkspaceHostContext, config: Config = {}): void {
  const backend = createWorkspaceBackend({ ...config, expectedOrigin: config.expectedOrigin ?? `http://127.0.0.1:${ctx.webServer.port}` })
  ctx.effect(() => () => backend.dispose(), 'zenwit-workspace: dispose file subscriptions')
  for (const path of PROJECT_API_PATHS) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path,
      async handler(req, res) {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'cache-control': 'no-store', 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
          return
        }
        await backend.handle(req, res)
      },
    }), `zenwit-workspace: ${path}`)
  }
}

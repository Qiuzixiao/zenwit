import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketSettingsDocument } from '../src/catalog/source-store.js'
import { ZENWIT_SOURCE } from '../src/adapters/zenwit.js'
import { marketRoutes, registerMarketRoutes } from '../src/host/routes.js'

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
interface MarketServer { readonly baseUrl: string; readonly close: () => Promise<void> }
interface SharedMarketSettings { document: MarketSettingsDocument }
async function startMarketServer(
  settings: SharedMarketSettings,
): Promise<MarketServer> {
  const routes = new Map<string, RouteHandler>()
  const scope = {
    get: () => settings.document,
    update: async (patch: object) => {
      settings.document = { ...settings.document, ...patch as Partial<MarketSettingsDocument> }
    },
  } as unknown as SettingsScope<MarketSettingsDocument>
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = routes.get(pathname)
    if (handler === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    void Promise.resolve(handler(req, res)).catch((cause: unknown) => {
      res.statusCode = 500
      res.end(cause instanceof Error ? cause.message : String(cause))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  const ctx = {
    webServer: {
      port,
      register: (route: { readonly path: string; readonly handler: RouteHandler }) => {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
    logger: { error: vi.fn() },
  } as unknown as Context
  const disposeRoutes = registerMarketRoutes(ctx, scope)
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      disposeRoutes()
      await closeServer(server)
    },
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })
}


describe('Zenwit Host routes', () => {
  afterEach(() => vi.restoreAllMocks())
  it('always exposes the fixed enabled source even with legacy records', async () => {
    const settings = { document: { sources: [{ ...ZENWIT_SOURCE, adapterId: 'market.standard-http-v1', manifestUrl: 'https://other.example/source.json' }] } }
    const server = await startMarketServer(settings)
    try {
      const response = await fetch(server.baseUrl + marketRoutes.state)
      expect(response.status).toBe(200)
      const state = await response.json()
      expect(state.sources).toHaveLength(1)
      expect(state.sources[0]).toMatchObject(ZENWIT_SOURCE)
      expect(state.builtIns.map((provider: { key: string }) => provider.key)).toEqual(['zenwit'])
    } finally { await server.close() }
  })
  it.each(['add-standard', 'add-builtin', 'select', 'remove', 'move'])('rejects the retired source operation %s', async action => {
    const settings: SharedMarketSettings = { document: { sources: [] } }
    const server = await startMarketServer(settings)
    try {
      const response = await fetch(server.baseUrl + marketRoutes.sources, {
        method: 'POST', headers: { origin: server.baseUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ action, manifestUrl: 'https://other.example/source.json' }),
      })
      expect(response.status).toBe(410)
      expect(settings.document.sources).toEqual([])
    } finally { await server.close() }
  })
  it('rejects cross-origin catalog reads before network access', async () => {
    const server = await startMarketServer({ document: { sources: [] } })
    try {
      const response = await fetch(server.baseUrl + marketRoutes.catalog, { headers: { origin: 'https://other.example', 'sec-fetch-site': 'cross-site' } })
      expect(response.status).toBe(403)
    } finally { await server.close() }
  })
})

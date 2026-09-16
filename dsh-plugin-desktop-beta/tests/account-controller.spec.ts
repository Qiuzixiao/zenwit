import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import DesktopAccountController, {
  GATEWAY_CREDENTIAL_REF,
  GATEWAY_PROVIDER_API,
  GATEWAY_PROVIDER_ROUTE,
  GATEWAY_PROVIDER_SETTINGS_NAMESPACE,
  desktopDeviceIdentity,
  desktopGatewayAccountPath,
  type DesktopAccountControllerBootstrap,
} from '../src/account-controller.ts'
import {
  GATEWAY_API_BASE,
  GATEWAY_DEVICE_LOGS_URL,
  GATEWAY_DEVICE_OVERVIEW_URL,
  GATEWAY_DEVICE_POLL_URL,
  GATEWAY_DEVICE_START_URL,
  GATEWAY_MODELS_URL,
  type GatewayClock,
  type GatewayRequest,
} from '../src/gateway-auth.ts'

const VERIFIER_BYTES = Uint8Array.from({ length: 32 }, (_value, index) => index)
const DEVICE_CODE = 'D'.repeat(43)
const RELAY_KEY = 'K'.repeat(48)
const INSTALLATION_ID = '01234567-89ab-4cde-8f01-23456789abcd'

interface FakeClock extends GatewayClock {
  advance(milliseconds: number): void
}

function fakeClock(): FakeClock {
  let current = 1_000_000
  return {
    now: () => current,
    sleep: async (milliseconds) => { current += milliseconds },
    advance: (milliseconds) => { current += milliseconds },
  }
}

function startResponse(): Response {
  return Response.json({
    success: true,
    data: {
      device_code: DEVICE_CODE,
      user_code: 'ABCD-2345',
      verification_uri: 'https://ai.zenwit.cn/device',
      interval: 2,
      expires_in: 600,
    },
  })
}

function approvedResponse(): Response {
  return Response.json({
    success: true,
    data: {
      status: 'approved',
      key: RELAY_KEY,
      token_id: 12,
      name: 'ZenwitAI Desktop - MacBook Pro - a1b2c3d4',
      user: { id: 1, username: 'zenwit', display_name: 'Zenwit User', group: 'default', quota: 12_345 },
    },
  })
}

interface Harness {
  readonly controller: DesktopAccountController
  readonly credentials: CredentialProvider
  readonly store: Map<string, string>
  readonly openExternal: ReturnType<typeof vi.fn>
  readonly settingsGet: ReturnType<typeof vi.fn>
  readonly settingsUpdate: ReturnType<typeof vi.fn>
  readonly settingsMutate: ReturnType<typeof vi.fn>
  readonly directory: string
}

function createHarness(
  directory: string,
  respond: GatewayRequest,
  overrides: Partial<DesktopAccountControllerBootstrap> = {},
): Harness {
  const store = new Map<string, string>()
  const credentials = {
    set: vi.fn(async (ref: string, value: string) => { store.set(ref, value) }),
    unset: vi.fn(async (ref: string) => { store.delete(ref) }),
    describe: vi.fn(async (ref: string) => ({ configured: store.has(ref), writable: true })),
    resolve: vi.fn(async (ref: string) => {
      const value = store.get(ref)
      return value === undefined ? undefined : { value, source: 'file' }
    }),
  } as unknown as CredentialProvider
  const settingsGet = vi.fn((_namespace: string) => ({ providers: {} }))
  const settingsUpdate = vi.fn(async (_namespace: string, _patch: object) => {})
  const settingsMutate = vi.fn(async (_namespace: string, _ops: readonly unknown[]) => {})
  const settings = {
    get: settingsGet,
    update: settingsUpdate,
    mutate: settingsMutate,
  } as unknown as Context['settings']
  const openExternal = vi.fn(async () => {})
  const controller = new DesktopAccountController({
    userDataDirectory: directory,
    installationId: INSTALLATION_ID,
    openExternal,
    credentials: () => credentials,
    settings: () => settings,
    gateway: { clock: fakeClock(), randomBytes: () => VERIFIER_BYTES, request: respond },
    hostname: () => 'MacBook Pro',
    ...overrides,
  })
  return { controller, credentials, store, openExternal, settingsGet, settingsUpdate, settingsMutate, directory }
}

/** Wait for the background ceremony to reach a terminal account state. */
async function settle(harness: Harness): Promise<Awaited<ReturnType<DesktopAccountController['status']>>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = await harness.controller.status()
    if (status.state !== 'signing-in') return status
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return await harness.controller.status()
}

/** Wait for the background provider reconciliation to settle on one state. */
async function waitForProvider(
  harness: Harness,
  provider: 'ready' | 'degraded',
): Promise<Awaited<ReturnType<DesktopAccountController['status']>>> {
  let status = await harness.controller.status()
  for (let attempt = 0; attempt < 50 && status.provider !== provider; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
    status = await harness.controller.status()
  }
  return status
}

describe('desktop account controller', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-account-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('stores the credential, the provider route, and secret-free account metadata', async () => {
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      if (url === GATEWAY_MODELS_URL) return Response.json({ data: [{ id: 'deepseek-v4-flash' }, { id: 'zenai-pro' }] })
      throw new Error('unexpected URL')
    })

    const started = await harness.controller.signIn()
    expect(started.state).toBe('signing-in')
    expect(started.user_code).toBe('ABCD-2345')
    expect(started.verification_uri).toBe('https://ai.zenwit.cn/device')
    expect(harness.openExternal).toHaveBeenCalledWith('https://ai.zenwit.cn/device?code=ABCD-2345')

    const status = await settle(harness)
    expect(status.state).toBe('signed-in')
    expect(status.provider).toBe('ready')
    expect(status.user?.username).toBe('zenwit')
    expect(status.device).toBe('MacBook Pro')
    expect(harness.store.get(GATEWAY_CREDENTIAL_REF)).toBe(RELAY_KEY)
    expect(harness.settingsUpdate).toHaveBeenCalledWith(GATEWAY_PROVIDER_SETTINGS_NAMESPACE, {
      providers: {
        [GATEWAY_PROVIDER_ROUTE]: {
          apiKeyEnv: GATEWAY_CREDENTIAL_REF,
          baseURL: GATEWAY_API_BASE,
          api: GATEWAY_PROVIDER_API,
          models: [{ id: 'deepseek-v4-flash' }, { id: 'zenai-pro' }],
        },
      },
    })

    const path = desktopGatewayAccountPath(directory)
    const text = await readFile(path, 'utf8')
    expect(text).not.toContain(RELAY_KEY)
    expect(JSON.parse(text)).toMatchObject({
      version: 1,
      device: { name: 'MacBook Pro', id: desktopDeviceIdentity(directory, INSTALLATION_ID) },
      token: { id: 12 },
      provider: { route: GATEWAY_PROVIDER_ROUTE, base_url: GATEWAY_API_BASE, ready: true, models: ['deepseek-v4-flash', 'zenai-pro'] },
    })
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('keeps the signed-in account but reports a degraded route when the catalog cannot be read', async () => {
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      return new Response('unavailable', { status: 503 })
    })

    await harness.controller.signIn()
    const status = await settle(harness)

    expect(status.state).toBe('signed-in')
    expect(status.provider).toBe('degraded')
    expect(status.error).toBe('provider-unavailable')
    expect(harness.store.get(GATEWAY_CREDENTIAL_REF)).toBe(RELAY_KEY)
    expect(harness.settingsUpdate).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(desktopGatewayAccountPath(directory), 'utf8')))
      .toMatchObject({ provider: { ready: false, models: [] } })
  })

  it('cancels an in-flight ceremony and returns to the signed-out state', async () => {
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      return await new Promise<Response>(() => {})
    })

    expect((await harness.controller.signIn()).state).toBe('signing-in')
    const cancelled = await harness.controller.cancel()

    expect(cancelled.state).toBe('signed-out')
    expect(cancelled.user_code).toBeUndefined()
    expect(cancelled.error).toBeUndefined()
  })

  it('signs out by clearing the credential, the route, and the account file', async () => {
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      return Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
    })

    await harness.controller.signIn()
    expect((await settle(harness)).state).toBe('signed-in')

    const signedOut = await harness.controller.signOut()

    expect(signedOut.state).toBe('signed-out')
    expect(harness.store.has(GATEWAY_CREDENTIAL_REF)).toBe(false)
    expect(harness.credentials.unset).toHaveBeenCalledWith(GATEWAY_CREDENTIAL_REF)
    expect(harness.settingsMutate).toHaveBeenCalledWith(GATEWAY_PROVIDER_SETTINGS_NAMESPACE, [
      { op: 'unset', path: ['providers', GATEWAY_PROVIDER_ROUTE] },
    ])
    await expect(stat(desktopGatewayAccountPath(directory))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a signed-out account when the stored credential disappears', async () => {
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      return Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
    })

    await harness.controller.signIn()
    expect((await settle(harness)).state).toBe('signed-in')
    harness.store.delete(GATEWAY_CREDENTIAL_REF)

    const status = await harness.controller.status()

    expect(status.state).toBe('signed-out')
    expect(status.error).toBe('credential-missing')
  })

  it('reconciles a degraded route once the relay catalog answers', async () => {
    let catalogAvailable = false
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      return catalogAvailable
        ? Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
        : new Response('unavailable', { status: 503 })
    })

    await harness.controller.signIn()
    expect((await settle(harness)).provider).toBe('degraded')
    // Let the refused background attempt finish before the retry is measured.
    await new Promise(resolve => setTimeout(resolve, 0))

    catalogAvailable = true
    const clock = fakeClock()
    const writesBefore = harness.settingsUpdate.mock.calls.length
    const reconciled = new DesktopAccountController({
      userDataDirectory: directory,
      installationId: INSTALLATION_ID,
      openExternal: async () => {},
      credentials: () => harness.credentials,
      settings: () => ({ get: harness.settingsGet, update: harness.settingsUpdate, mutate: harness.settingsMutate }) as unknown as Context['settings'],
      gateway: { clock, randomBytes: () => VERIFIER_BYTES, request: async (url) => {
        if (url === GATEWAY_MODELS_URL) return Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
        throw new Error('unexpected URL')
      } },
    })

    const before = await reconciled.status()
    expect(before.provider).toBe('degraded')
    clock.advance(60_000)
    const after = await waitForProvider({ ...harness, controller: reconciled }, 'ready')

    expect(after.state).toBe('signed-in')
    expect(after.provider).toBe('ready')
    expect(harness.settingsUpdate.mock.calls.length).toBe(writesBefore + 1)
    await expect(readFile(desktopGatewayAccountPath(directory), 'utf8'))
      .resolves.toContain('deepseek-v4-flash')
  })

  it('retries a degraded route on demand without touching the stored credential', async () => {
    let catalogAvailable = false
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      return catalogAvailable
        ? Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
        : new Response('unavailable', { status: 503 })
    })

    await harness.controller.signIn()
    expect((await settle(harness)).provider).toBe('degraded')

    const stillDegraded = await harness.controller.retryProvider()
    expect(stillDegraded.provider).toBe('degraded')
    expect(harness.store.get(GATEWAY_CREDENTIAL_REF)).toBe(RELAY_KEY)
    expect(harness.credentials.set).toHaveBeenCalledTimes(1)

    catalogAvailable = true
    const recovered = await harness.controller.retryProvider()

    expect(recovered.state).toBe('signed-in')
    expect(recovered.provider).toBe('ready')
    expect(recovered.error).toBeUndefined()
    expect(harness.store.get(GATEWAY_CREDENTIAL_REF)).toBe(RELAY_KEY)
    expect(harness.credentials.set).toHaveBeenCalledTimes(1)
    expect(harness.credentials.unset).not.toHaveBeenCalled()
  })

  it('fails loud without the Desktop installation identity', async () => {
    const harness = createHarness(directory, async () => startResponse())
    const withoutIdentity = new DesktopAccountController({
      userDataDirectory: directory,
      openExternal: async () => {},
      credentials: () => harness.credentials,
      settings: () => ({ get: harness.settingsGet, update: harness.settingsUpdate, mutate: harness.settingsMutate }) as unknown as Context['settings'],
    })

    await expect(withoutIdentity.signIn())
      .rejects.toThrow('ZenwitAI sign-in requires the Desktop installation identity')
  })

  it('reads the owner overview and one usage page without exposing the relay token', async () => {
    const calls: Array<{ url: string; authorization: unknown }> = []
    const record = (url: string, init: RequestInit): void => {
      calls.push({ url, authorization: (init.headers as Record<string, string>)['authorization'] })
    }
    const harness = createHarness(directory, async (url, init) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      if (url === GATEWAY_MODELS_URL) return Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
      if (url === GATEWAY_DEVICE_OVERVIEW_URL) {
        record(url, init)
        return Response.json({
          success: true,
          data: {
            user: {
              id: 1,
              username: 'zenwit',
              display_name: 'Zenwit User',
              email: 'user@example.com',
              group: 'default',
              quota: 1_000_000,
              used_quota: 250_000,
              request_count: 7,
              created_at: 1_700_000_000,
            },
            today: { quota: 50_000 },
            month: { quota: 200_000 },
            server_time: 1_700_100_000,
          },
        })
      }
      if (url.startsWith(`${GATEWAY_DEVICE_LOGS_URL}?`)) {
        record(url, init)
        return Response.json({
          success: true,
          data: {
            page: 2,
            page_size: 20,
            total: 41,
            items: [{
              id: 9,
              created_at: 1_700_100_000,
              model_name: 'deepseek-v4-pro',
              quota: 12_713,
              prompt_tokens: 9_774,
              completion_tokens: 94,
              use_time: 4,
              is_stream: true,
            }],
          },
        })
      }
      throw new Error('unexpected URL')
    })

    await harness.controller.signIn()
    await settle(harness)

    const overview = await harness.controller.overview()
    expect(overview).toEqual({
      state: 'signed-in',
      user: {
        id: 1,
        username: 'zenwit',
        display_name: 'Zenwit User',
        email: 'user@example.com',
        group: 'default',
        quota: 1_000_000,
        used_quota: 250_000,
        request_count: 7,
        created_at: 1_700_000_000,
      },
      today_quota: 50_000,
      month_quota: 200_000,
      server_time: 1_700_100_000,
    })

    const usage = await harness.controller.usage({ page: 2, page_size: 20 })
    expect(usage).toEqual({
      state: 'signed-in',
      page: 2,
      page_size: 20,
      total: 41,
      items: [{
        id: 9,
        created_at: 1_700_100_000,
        model_name: 'deepseek-v4-pro',
        quota: 12_713,
        prompt_tokens: 9_774,
        completion_tokens: 94,
        use_time: 4,
        is_stream: true,
      }],
    })
    expect(calls.map(call => call.authorization)).toEqual([
      `Bearer sk-${RELAY_KEY}`,
      `Bearer sk-${RELAY_KEY}`,
    ])
    expect(calls[1]?.url).toBe(`${GATEWAY_DEVICE_LOGS_URL}?p=2&page_size=20`)
    expect(JSON.stringify(overview)).not.toContain(RELAY_KEY)
    expect(JSON.stringify(usage)).not.toContain(RELAY_KEY)
  })

  it('answers owner reads without contacting the gateway when signed out', async () => {
    const harness = createHarness(directory, async () => {
      throw new Error('the gateway must not be contacted')
    })

    expect(await harness.controller.overview()).toEqual({ state: 'signed-out' })
    expect(await harness.controller.usage({ page: 1, page_size: 20 })).toEqual({ state: 'signed-out' })
  })

  it('reports a vanished credential instead of reading the gateway', async () => {
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      if (url === GATEWAY_MODELS_URL) return Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
      throw new Error('the gateway must not be read without a credential')
    })
    await harness.controller.signIn()
    expect((await settle(harness)).state).toBe('signed-in')
    harness.store.delete(GATEWAY_CREDENTIAL_REF)

    expect(await harness.controller.overview()).toEqual({ state: 'signed-out', error: 'credential-missing' })
    expect(await harness.controller.usage({ page: 1, page_size: 20 }))
      .toEqual({ state: 'signed-out', error: 'credential-missing' })
  })

  it('maps refused, malformed, and unreachable owner reads onto stable tokens', async () => {
    let mode: 'refused' | 'malformed' | 'unreachable' = 'refused'
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      if (url === GATEWAY_MODELS_URL) return Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
      if (mode === 'refused') return new Response('refused', { status: 401 })
      if (mode === 'malformed') return Response.json({ success: true, data: { user: { id: 1 } } })
      throw new Error('offline')
    })
    await harness.controller.signIn()
    await settle(harness)

    expect(await harness.controller.overview()).toEqual({ state: 'signed-in', error: 'credential-rejected' })
    mode = 'malformed'
    expect(await harness.controller.overview()).toEqual({ state: 'signed-in', error: 'gateway-malformed' })
    expect(await harness.controller.usage({ page: 1, page_size: 20 }))
      .toEqual({ state: 'signed-in', error: 'gateway-malformed' })
    mode = 'unreachable'
    expect(await harness.controller.overview()).toEqual({ state: 'signed-in', error: 'gateway-unreachable' })
  })

  it('ignores a corrupt account file instead of failing the status read', async () => {
    const harness = createHarness(directory, async () => startResponse())
    const path = desktopGatewayAccountPath(directory)
    await mkdir(join(directory, 'identity'), { recursive: true })
    await writeFile(path, '{not json', { mode: 0o600 })

    const status = await harness.controller.status()

    expect(status.state).toBe('signed-out')
  })
})

// A copied profile carries the same stored installation identity, so identity
// must also fold in where the profile lives: that is what keeps a second copy
// from presenting itself as this installation and rotating its credential away.
describe('desktop installation identity', () => {
  it('is stable per directory and distinct across directories', () => {
    const first = desktopDeviceIdentity('/tmp/zenwit-a', INSTALLATION_ID)
    const again = desktopDeviceIdentity('/tmp/zenwit-a', INSTALLATION_ID)
    const copy = desktopDeviceIdentity('/tmp/zenwit-b', INSTALLATION_ID)
    expect(first).toBe(again)
    expect(first).not.toBe(copy)
    expect(first).toMatch(/^[0-9a-f]{16}$/u)
  })
})
// A revoked credential is durable account state: the account stays signed in,
// the renderer can say why, and one re-sign-in repairs it. Before this the panel
// kept reporting a connected account and only the two read cards failed.
describe('revoked device credential', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zenwit-account-revoked-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reports the credential as rejected and the route as degraded', async () => {
    const refuse = () => Response.json(
      { success: false, code: 'token_revoked', message: 'Invalid token' },
      { status: 401 },
    )
    const harness = createHarness(directory, async (url) => {
      if (url === GATEWAY_DEVICE_START_URL) return startResponse()
      if (url === GATEWAY_DEVICE_POLL_URL) return approvedResponse()
      if (url === GATEWAY_MODELS_URL) return Response.json({ data: [{ id: 'deepseek-v4-flash' }] })
      if (url === GATEWAY_DEVICE_OVERVIEW_URL) return refuse()
      if (url.startsWith(GATEWAY_DEVICE_LOGS_URL + '?')) return refuse()
      return new Response('{}', { status: 404 })
    })
    await harness.controller.signIn()
    expect((await settle(harness)).state).toBe('signed-in')
    expect((await harness.controller.status()).credential).not.toBe('rejected')

    const overview = await harness.controller.overview()
    expect(overview).toMatchObject({ state: 'signed-in', error: 'credential-rejected' })

    expect(await harness.controller.status()).toMatchObject({
      state: 'signed-in',
      credential: 'rejected',
      provider: 'degraded',
    })
  })
})

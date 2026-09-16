import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCOUNT_USAGE_PAGE_SIZE,
  MAX_ACCOUNT_USAGE_PAGE,
  MAX_ACCOUNT_USAGE_PAGE_SIZE,
  desktopAccountRouteConstants,
  handleDesktopAccountCancelRequest,
  handleDesktopAccountOverviewRequest,
  handleDesktopAccountProviderRetryRequest,
  handleDesktopAccountSignInRequest,
  handleDesktopAccountSignOutRequest,
  handleDesktopAccountStatusRequest,
  handleDesktopAccountUsageRequest,
} from '../src/account-route.ts'
import { DESKTOP_ACCOUNT_USAGE_PATH } from '../src/account-contract.ts'
import type DesktopAccountController from '../src/account-controller.ts'

const ORIGIN = 'http://127.0.0.1:43120'

function request(
  method = 'POST',
  headers: Record<string, string> = { origin: ORIGIN },
  url?: string,
): IncomingMessage {
  return {
    method,
    headers: { ...headers, host: '127.0.0.1:43120' },
    socket: { remoteAddress: '127.0.0.1' },
    ...(url === undefined ? {} : { url }),
  } as unknown as IncomingMessage
}

function jsonRequest(value: unknown, headers: Record<string, string> = { origin: ORIGIN }): IncomingMessage {
  const req = Readable.from([JSON.stringify(value)]) as unknown as IncomingMessage
  req.method = 'POST'
  req.headers = { ...headers, host: '127.0.0.1:43120', 'content-type': 'application/json' }
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } })
  return req
}

function response(): ServerResponse & { body: string } {
  const res = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { res.body = body ?? '' }),
  }
  return res as unknown as ServerResponse & typeof res
}

function controller(overrides: Partial<Record<'status' | 'signIn' | 'cancel' | 'signOut' | 'overview' | 'usage', unknown>> = {}) {
  return {
    status: vi.fn(async () => ({ state: 'signed-out', provider: 'none' })),
    signIn: vi.fn(async () => ({ state: 'signing-in', provider: 'none', user_code: 'ABCD-2345', verification_uri: 'https://ai.zenwit.cn/device' })),
    cancel: vi.fn(async () => ({ state: 'signed-out', provider: 'none' })),
    signOut: vi.fn(async () => ({ state: 'signed-out', provider: 'none' })),
    retryProvider: vi.fn(async () => ({ state: 'signed-in', provider: 'ready' })),
    overview: vi.fn(async () => ({ state: 'signed-in', today_quota: 0, month_quota: 0, server_time: 1 })),
    usage: vi.fn(async () => ({ state: 'signed-in', page: 1, page_size: 20, total: 0, items: [] })),
    ...overrides,
  } as unknown as DesktopAccountController
}

describe('desktop account routes', () => {
  it('reports the account state to a same-origin loopback GET', async () => {
    const res = response()
    const account = controller()

    await handleDesktopAccountStatusRequest(request('GET'), res, ORIGIN, account)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ state: 'signed-out', provider: 'none' })
  })

  it('rejects a mutating request without the exact same-origin marker', async () => {
    const res = response()
    const account = controller()

    await handleDesktopAccountSignInRequest(request('POST', { origin: 'https://example.com' }), res, ORIGIN, account)

    expect(res.statusCode).toBe(403)
    expect(account.signIn).not.toHaveBeenCalled()
  })

  it('rejects a non-loopback request before any account work', async () => {
    const res = response()
    const account = controller()
    const req = request('POST')
    Object.defineProperty(req, 'socket', { value: { remoteAddress: '10.0.0.4' } })

    await handleDesktopAccountSignOutRequest(req, res, ORIGIN, account)

    expect(res.statusCode).toBe(403)
    expect(account.signOut).not.toHaveBeenCalled()
  })

  it('requires an exact empty JSON body and the declared method', async () => {
    const nonJson = response()
    await handleDesktopAccountSignInRequest(request('POST'), nonJson, ORIGIN, controller())
    expect(nonJson.statusCode).toBe(415)

    const nonEmpty = response()
    await handleDesktopAccountCancelRequest(jsonRequest({ cancel: true }), nonEmpty, ORIGIN, controller())
    expect(nonEmpty.statusCode).toBe(400)

    const wrongMethod = response()
    await handleDesktopAccountCancelRequest(request('GET'), wrongMethod, ORIGIN, controller())
    expect(wrongMethod.statusCode).toBe(405)
  })

  it('starts, cancels, and ends the ceremony through the controller', async () => {
    const started = response()
    await handleDesktopAccountSignInRequest(jsonRequest({}), started, ORIGIN, controller())
    expect(started.statusCode).toBe(200)
    expect(JSON.parse(started.body).state).toBe('signing-in')

    const cancelled = response()
    await handleDesktopAccountCancelRequest(jsonRequest({}), cancelled, ORIGIN, controller())
    expect(cancelled.statusCode).toBe(200)

    const signedOut = response()
    await handleDesktopAccountSignOutRequest(jsonRequest({}), signedOut, ORIGIN, controller())
    expect(signedOut.statusCode).toBe(200)
  })

  it('forces one provider retry from an exact empty same-origin request', async () => {
    const res = response()
    const account = controller()

    await handleDesktopAccountProviderRetryRequest(jsonRequest({}), res, ORIGIN, account)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ state: 'signed-in', provider: 'ready' })
    expect(account.retryProvider).toHaveBeenCalledOnce()
  })

  it('serves the owner overview to a same-origin loopback GET', async () => {
    const res = response()
    const account = controller()

    await handleDesktopAccountOverviewRequest(request('GET'), res, ORIGIN, account)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ state: 'signed-in', today_quota: 0, month_quota: 0, server_time: 1 })
    expect(account.overview).toHaveBeenCalledOnce()
  })

  it('bounds the usage query and defaults an omitted page request', async () => {
    const defaults = response()
    const defaulted = controller()
    await handleDesktopAccountUsageRequest(request('GET'), defaults, ORIGIN, defaulted)
    expect(defaults.statusCode).toBe(200)
    expect(defaulted.usage).toHaveBeenCalledWith({ page: 1, page_size: DEFAULT_ACCOUNT_USAGE_PAGE_SIZE })

    const explicit = response()
    const paged = controller()
    await handleDesktopAccountUsageRequest(
      request('GET', { origin: ORIGIN }, `${DESKTOP_ACCOUNT_USAGE_PATH}?p=3&page_size=50`),
      explicit,
      ORIGIN,
      paged,
    )
    expect(explicit.statusCode).toBe(200)
    expect(paged.usage).toHaveBeenCalledWith({ page: 3, page_size: 50 })

    for (const query of ['p=0', 'p=abc', 'p=1.5', `p=${String(MAX_ACCOUNT_USAGE_PAGE + 1)}`, 'page_size=0', `page_size=${String(MAX_ACCOUNT_USAGE_PAGE_SIZE + 1)}`]) {
      const rejected = response()
      const account = controller()
      await handleDesktopAccountUsageRequest(
        request('GET', { origin: ORIGIN }, `${DESKTOP_ACCOUNT_USAGE_PATH}?${query}`),
        rejected,
        ORIGIN,
        account,
      )
      expect(rejected.statusCode).toBe(400)
      expect(account.usage).not.toHaveBeenCalled()
    }
  })

  it('refuses an owner read outside the loopback origin, on a wrong method, or across origins', async () => {
    const crossOrigin = response()
    const crossed = controller()
    await handleDesktopAccountOverviewRequest(
      request('GET', { origin: 'https://example.com' }),
      crossOrigin,
      ORIGIN,
      crossed,
    )
    expect(crossOrigin.statusCode).toBe(403)
    expect(crossed.overview).not.toHaveBeenCalled()

    const foreign = response()
    const offLoopback = controller()
    const external = request('GET')
    Object.defineProperty(external, 'socket', { value: { remoteAddress: '10.0.0.4' } })
    await handleDesktopAccountUsageRequest(external, foreign, ORIGIN, offLoopback)
    expect(foreign.statusCode).toBe(403)
    expect(offLoopback.usage).not.toHaveBeenCalled()

    const wrongMethod = response()
    await handleDesktopAccountUsageRequest(request('POST'), wrongMethod, ORIGIN, controller())
    expect(wrongMethod.statusCode).toBe(405)
  })

  it('reports a stable owner-read failure without exposing the native cause', async () => {
    const overview = response()
    await handleDesktopAccountOverviewRequest(request('GET'), overview, ORIGIN, controller({
      overview: vi.fn(async () => { throw new Error('private native failure') }),
    }))
    expect(overview.statusCode).toBe(500)
    expect(JSON.parse(overview.body)).toEqual({ error: 'the account overview is unavailable' })

    const usage = response()
    await handleDesktopAccountUsageRequest(request('GET'), usage, ORIGIN, controller({
      usage: vi.fn(async () => { throw new Error('private native failure') }),
    }))
    expect(usage.statusCode).toBe(500)
    expect(JSON.parse(usage.body)).toEqual({ error: 'the account usage is unavailable' })
  })

  it('bounds the accepted request body', async () => {
    expect(desktopAccountRouteConstants.maxBodyBytes).toBe(4 * 1024)
    const oversized = Readable.from(['{}']) as unknown as IncomingMessage
    oversized.method = 'POST'
    oversized.headers = {
      host: '127.0.0.1:43120',
      origin: ORIGIN,
      'content-type': 'application/json',
      'content-length': String(desktopAccountRouteConstants.maxBodyBytes + 1),
    }
    Object.defineProperty(oversized, 'socket', { value: { remoteAddress: '127.0.0.1' } })

    const res = response()
    await handleDesktopAccountSignInRequest(oversized, res, ORIGIN, controller())

    expect(res.statusCode).toBe(413)
    expect(JSON.parse(res.body)).toEqual({ error: 'request body is too large' })
  })

  it('reports a stable failure without exposing the native cause', async () => {
    const res = response()
    const account = controller({
      status: vi.fn(async () => { throw new Error('private native failure') }),
    })

    await handleDesktopAccountStatusRequest(request('GET'), res, ORIGIN, account)

    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ error: 'the account state is unavailable' })
  })
})

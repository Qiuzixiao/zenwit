/** Strict loopback HTTP handlers for the private Desktop account API. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type DesktopAccountController from './account-controller.ts'
import type {
  DesktopAccountErrorResponse,
  DesktopAccountUsageQuery,
} from './account-contract.ts'

const MAX_ACCOUNT_BODY_BYTES = 4 * 1024

/** Highest one-based usage page the route forwards. */
export const MAX_ACCOUNT_USAGE_PAGE = 1_000

/** Highest usage page size the route forwards. */
export const MAX_ACCOUNT_USAGE_PAGE_SIZE = 50

/** Page size used when the request omits one. */
export const DEFAULT_ACCOUNT_USAGE_PAGE_SIZE = 20

class BodyTooLargeError extends Error {}

function finishJson(
  res: ServerResponse,
  statusCode: number,
  value: object,
  allow?: 'GET' | 'POST',
): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

function error(message: string): DesktopAccountErrorResponse {
  return { error: message }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]'
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1' || address === '127.0.0.1') return true
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length)
    return mapped.startsWith('127.')
  }
  return address.startsWith('127.')
}

function expectedLoopbackOrigin(expectedOrigin: string): URL | undefined {
  try {
    const url = new URL(expectedOrigin)
    if (url.origin !== expectedOrigin || url.protocol !== 'http:'
      || url.username !== '' || url.password !== ''
      || !isLoopbackHostname(url.hostname)) return undefined
    return url
  } catch {
    return undefined
  }
}

function exactHeaderOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.origin === value ? value : undefined
  } catch {
    return undefined
  }
}

function referrerOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/**
 * Require the actual socket and Host to stay on the configured loopback origin.
 * A mutating request must carry the exact Origin. A read-only browser GET may
 * use the standard same-origin fetch metadata plus its same-origin referrer,
 * because browsers commonly omit Origin on same-origin GET requests.
 */
function isSameOriginLoopbackRequest(
  req: IncomingMessage,
  expectedOrigin: string,
  mutating: boolean,
): boolean {
  const expected = expectedLoopbackOrigin(expectedOrigin)
  if (expected === undefined || !isLoopbackAddress(req.socket.remoteAddress)) return false
  if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (exactHeaderOrigin(req.headers.origin) === expected.origin) {
    return req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin'
  }
  if (mutating) return false
  return req.headers['sec-fetch-site'] === 'same-origin'
    && referrerOrigin(req.headers.referer) === expected.origin
}

function isJsonRequest(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) throw new SyntaxError('invalid content length')
    if (Number(declaredLength) > MAX_ACCOUNT_BODY_BYTES) throw new BodyTooLargeError()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_ACCOUNT_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isEmptyRequest(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 0
}

const INVALID_BODY = Symbol('invalid body')

async function parsePostBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | typeof INVALID_BODY> {
  if (!isJsonRequest(req)) {
    finishJson(res, 415, error('content type must be application/json'))
    return INVALID_BODY
  }
  try {
    return await readJson(req)
  } catch (cause) {
    const tooLarge = cause instanceof BodyTooLargeError
    finishJson(res, tooLarge ? 413 : 400, error(tooLarge ? 'request body is too large' : 'invalid JSON request'))
    return INVALID_BODY
  }
}

/** Accept one bounded positive integer query value. */
function boundedPositiveInteger(value: string | null, max: number): number | undefined {
  if (value === null || !/^[0-9]{1,9}$/u.test(value)) return undefined
  const parsed = Number(value)
  return parsed >= 1 && parsed <= max ? parsed : undefined
}

/**
 * Read the bounded page request from the query string.
 * @param req - the loopback request whose query is read.
 * @returns the accepted page request, or undefined when any value is out of bounds.
 */
function parseUsageQuery(req: IncomingMessage): DesktopAccountUsageQuery | undefined {
  const query = new URLSearchParams((req.url ?? '').split('?', 2)[1] ?? '')
  const rawPage = query.get('p')
  const rawSize = query.get('page_size')
  const page = rawPage === null ? 1 : boundedPositiveInteger(rawPage, MAX_ACCOUNT_USAGE_PAGE)
  const pageSize = rawSize === null
    ? DEFAULT_ACCOUNT_USAGE_PAGE_SIZE
    : boundedPositiveInteger(rawSize, MAX_ACCOUNT_USAGE_PAGE_SIZE)
  if (page === undefined || pageSize === undefined) return undefined
  return { page, page_size: pageSize }
}

/** Serve the renderer-safe account state. */
export async function handleDesktopAccountStatusRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopAccountController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'GET') return finishJson(res, 405, error('method not allowed'), 'GET')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    return finishJson(res, 403, error('forbidden'))
  }
  try {
    finishJson(res, 200, await controller.status())
  } catch (cause) {
    reportError('read the ZenwitAI account state', cause)
    finishJson(res, 500, error('the account state is unavailable'))
  }
}

/** Start one device-authorization ceremony from an exact empty request. */
export async function handleDesktopAccountSignInRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopAccountController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid sign-in request'))
  try {
    finishJson(res, 200, await controller.signIn())
  } catch (cause) {
    reportError('start ZenwitAI sign-in', cause)
    finishJson(res, 500, error('the sign-in ceremony could not be started'))
  }
}

/** Cancel the in-flight ceremony from an exact empty request. */
export async function handleDesktopAccountCancelRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopAccountController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid cancel request'))
  try {
    finishJson(res, 200, await controller.cancel())
  } catch (cause) {
    reportError('cancel ZenwitAI sign-in', cause)
    finishJson(res, 500, error('the sign-in ceremony could not be cancelled'))
  }
}

/** Clear the account from an exact empty request. */
export async function handleDesktopAccountSignOutRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopAccountController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid sign-out request'))
  try {
    finishJson(res, 200, await controller.signOut())
  } catch (cause) {
    reportError('sign out of ZenwitAI', cause)
    finishJson(res, 409, error('the account could not be signed out'))
  }
}

/** Force one provider-route attempt from an exact empty request. */
export async function handleDesktopAccountProviderRetryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopAccountController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isEmptyRequest(value)) return finishJson(res, 400, error('invalid provider retry request'))
  try {
    finishJson(res, 200, await controller.retryProvider())
  } catch (cause) {
    reportError('retry the ZenwitAI provider route', cause)
    finishJson(res, 409, error('the provider route could not be retried'))
  }
}

/** Serve the account owner's balance and consumption totals. */
export async function handleDesktopAccountOverviewRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopAccountController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'GET') return finishJson(res, 405, error('method not allowed'), 'GET')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    return finishJson(res, 403, error('forbidden'))
  }
  try {
    finishJson(res, 200, await controller.overview())
  } catch (cause) {
    reportError('read the ZenwitAI account overview', cause)
    finishJson(res, 500, error('the account overview is unavailable'))
  }
}

/** Serve one bounded page of the account owner's consumption records. */
export async function handleDesktopAccountUsageRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopAccountController,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'GET') return finishJson(res, 405, error('method not allowed'), 'GET')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const query = parseUsageQuery(req)
  if (query === undefined) return finishJson(res, 400, error('invalid usage query'))
  try {
    finishJson(res, 200, await controller.usage(query))
  } catch (cause) {
    reportError('read the ZenwitAI account usage', cause)
    finishJson(res, 500, error('the account usage is unavailable'))
  }
}

export const desktopAccountRouteConstants = Object.freeze({
  maxBodyBytes: MAX_ACCOUNT_BODY_BYTES,
  maxUsagePage: MAX_ACCOUNT_USAGE_PAGE,
  maxUsagePageSize: MAX_ACCOUNT_USAGE_PAGE_SIZE,
  defaultUsagePageSize: DEFAULT_ACCOUNT_USAGE_PAGE_SIZE,
})

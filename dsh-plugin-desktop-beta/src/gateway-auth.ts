/** Device-authorization protocol for the ZenwitAI account gateway. */

import { createHash, randomBytes as randomEntropy } from 'node:crypto'

/** Console origin owning the browser sign-in session and its host-only refresh cookie. */
export const GATEWAY_CONSOLE_ORIGIN = 'https://ai.zenwit.cn'

/** Device-authorization start endpoint on the console origin. */
export const GATEWAY_DEVICE_START_URL = `${GATEWAY_CONSOLE_ORIGIN}/api/user/device/start`

/** Device-authorization poll endpoint on the console origin. */
export const GATEWAY_DEVICE_POLL_URL = `${GATEWAY_CONSOLE_ORIGIN}/api/user/device/poll`

/**
 * Owner-scoped account overview for a device relay token.
 *
 * The route family that minted the token answers this read, so it stays on the
 * console origin beside start and poll; the relay origin serves model traffic.
 */
export const GATEWAY_DEVICE_OVERVIEW_URL = `${GATEWAY_CONSOLE_ORIGIN}/api/user/device/overview`

/** Owner-scoped consumption records for a device relay token. */
export const GATEWAY_DEVICE_LOGS_URL = `${GATEWAY_CONSOLE_ORIGIN}/api/user/device/logs`

/** OpenAI-compatible relay origin serving the issued per-device key. */
export const GATEWAY_API_ORIGIN = 'https://api.zenwit.cn'

/**
 * Relay base URL handed to an OpenAI-compatible provider profile.
 *
 * The adapter appends the operation path verbatim (`/chat/completions`), so the
 * version prefix belongs here. The bare origin addresses the console's SPA
 * fallback and answers HTML, which a stream reader reports as a truncated
 * stream rather than an error. Deriving both this and the catalog URL from one
 * constant keeps the two call sites from disagreeing about the prefix.
 */
export const GATEWAY_API_BASE = `${GATEWAY_API_ORIGIN}/v1`

/** Model catalog endpoint used to populate the signed-in provider route. */
export const GATEWAY_MODELS_URL = `${GATEWAY_API_BASE}/models`

/** Entropy bytes in one PKCE code verifier. */
export const GATEWAY_CODE_VERIFIER_BYTES = 32

/** Poll interval used when the service omits one. */
export const GATEWAY_DEFAULT_POLL_INTERVAL_MS = 2_000

/** Ceremony lifetime used when the service omits one. */
export const GATEWAY_DEFAULT_EXPIRES_IN_MS = 600_000

/** Maximum response body bytes accepted from the gateway. */
export const MAX_GATEWAY_RESPONSE_BYTES = 64 * 1024

/** Maximum model ids accepted from the relay catalog. */
export const MAX_GATEWAY_MODELS = 512

const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{20,128}$/u
const USER_CODE_PATTERN = /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/u
const OPAQUE_SECRET_PATTERN = /^[\x21-\x7e]{8,256}$/u
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u

/** Fetch-compatible request function used by the device-authorization flow. */
export type GatewayRequest = (url: string, init: RequestInit) => Promise<Response>

/**
 * Injected time source. Tests replace both members so a ceremony needs no real
 * timer; production uses the host clock and an abortable timer.
 */
export interface GatewayClock {
  /** Current wall-clock time in milliseconds. */
  now(): number
  /** Resolve after the delay, or reject when the caller aborts. */
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>
}

/** Stable failure categories of the device-authorization flow. */
export type GatewayAuthFailureCode =
  /** The gateway could not be reached or answered with an unexpected HTTP status. */
  | 'unreachable'
  /** A response body did not match the frozen wire contract. */
  | 'malformed'
  /** The gateway reported an API error: an unknown, expired, consumed, or mismatched ceremony. */
  | 'refused'
  /** The local ceremony deadline elapsed while the gateway still reported pending. */
  | 'expired'
  /** The caller aborted the ceremony. */
  | 'cancelled'

/** Failure raised by every step of the device-authorization flow. */
export class GatewayAuthError extends Error {
  /**
   * @param code - stable failure category.
   * @param message - operator-readable detail that never contains a device code, verifier, or relay key.
   * @param retryable - whether re-running the ceremony could succeed unchanged.
   * @param cause - underlying transport or parse failure, when one exists.
   */
  constructor(
    readonly code: GatewayAuthFailureCode,
    message: string,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'GatewayAuthError'
  }
}

/** One started device-authorization ceremony. */
export interface GatewayDeviceAuthorization {
  /** Opaque polling secret; never placed in a URL, log line, or user-visible string. */
  readonly deviceCode: string
  /** Short single-use code the user confirms in the browser. */
  readonly userCode: string
  /** Approval page opened in the system browser, without the code query yet. */
  readonly verificationUri: string
  /** Complete approval URL including the user code. */
  readonly approvalUrl: string
  /** PKCE verifier presented only to the poll endpoint. */
  readonly codeVerifier: string
  /** Delay between polls in milliseconds. */
  readonly intervalMs: number
  /** Local deadline in milliseconds since the epoch. */
  readonly expiresAt: number
}

/** Account facts returned with an approved ceremony. */
export interface GatewayAccountUser {
  readonly id: number
  readonly username: string
  readonly display_name?: string
  readonly group?: string
  readonly quota?: number
}

/** Approved ceremony carrying the per-device relay key. */
export interface GatewayApprovedDevice {
  readonly status: 'approved'
  /** Per-device relay token; a secret that only ever reaches the credential store. */
  readonly key: string
  readonly tokenId: number
  /** Server-side token name minted for this device. */
  readonly name: string
  readonly user: GatewayAccountUser
}

/** One poll outcome: the user has not approved yet, or the ceremony completed. */
export type GatewayDevicePollResult =
  | { readonly status: 'pending'; readonly intervalMs: number }
  | GatewayApprovedDevice

/** Shared injectable seams for every device-authorization step. */
export interface GatewayAuthOptions {
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: GatewayRequest
  /** Optional clock and sleep seam; tests supply a deterministic implementation. */
  readonly clock?: GatewayClock
  /** Caller-owned cancellation signal. */
  readonly signal?: AbortSignal
}

/** Inputs for one `start` call. */
export interface GatewayStartOptions extends GatewayAuthOptions {
  /** Human device name recorded in the minted token name. */
  readonly deviceName: string
  /** Stable, non-secret per-device identifier recorded in the minted token name. */
  readonly deviceId: string
  /** Optional entropy source; tests supply deterministic bytes. */
  readonly randomBytes?: (size: number) => Uint8Array
}

/** Inputs for one `poll` call. */
export interface GatewayPollOptions extends GatewayAuthOptions {
  /** Ceremony returned by {@link startGatewayDeviceAuthorization}. */
  readonly device: GatewayDeviceAuthorization
}

/** Inputs for the complete bounded ceremony. */
export interface GatewayAwaitOptions extends GatewayPollOptions {
  /** Optional per-poll observer used for diagnostics without exposing secrets. */
  readonly onPending?: () => void
}

/** Inputs for relay model discovery. */
export interface GatewayModelsOptions extends GatewayAuthOptions {
  /** Relay token presented as the bearer credential. */
  readonly key: string
}

/** Encode bytes as unpadded base64url. */
function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Build one PKCE code verifier from caller-supplied entropy.
 * @param bytes - at least 32 bytes of entropy.
 * @returns unpadded base64url verifier.
 */
export function createGatewayCodeVerifier(bytes: Uint8Array): string {
  if (bytes.byteLength < GATEWAY_CODE_VERIFIER_BYTES) {
    throw new TypeError(`gateway code verifier needs at least ${String(GATEWAY_CODE_VERIFIER_BYTES)} bytes`)
  }
  return base64Url(bytes.subarray(0, GATEWAY_CODE_VERIFIER_BYTES))
}

/**
 * Derive the PKCE challenge presented to the start endpoint.
 * @param verifier - verifier returned by {@link createGatewayCodeVerifier}.
 * @returns unpadded base64url SHA-256 of the verifier.
 */
export function gatewayCodeChallenge(verifier: string): string {
  if (verifier.length === 0) throw new TypeError('gateway code verifier must not be empty')
  return base64Url(createHash('sha256').update(verifier, 'utf8').digest())
}

function defaultRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

function defaultClock(): GatewayClock {
  return {
    now: () => Date.now(),
    sleep: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(cancelledFailure())
        return
      }
      const cancel = (): void => {
        clearTimeout(timer)
        reject(cancelledFailure())
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', cancel)
        resolve()
      }, milliseconds)
      signal?.addEventListener('abort', cancel, { once: true })
    }),
  }
}

function cancelledFailure(): GatewayAuthError {
  return new GatewayAuthError('cancelled', 'gateway sign-in was cancelled', true)
}

function unreachableFailure(detail: string, cause?: unknown): GatewayAuthError {
  return new GatewayAuthError('unreachable', `gateway is unreachable: ${detail}`, true, cause)
}

function malformedFailure(detail: string): GatewayAuthError {
  return new GatewayAuthError('malformed', `gateway response is malformed: ${detail}`, false)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw cancelledFailure()
}

/**
 * Read a response body, refusing anything above {@link MAX_GATEWAY_RESPONSE_BYTES}.
 * @param response - response whose body is read to completion or to the limit.
 * @returns the decoded body text.
 * @throws {GatewayAuthError} with code `malformed` when the declared or actual body exceeds the limit.
 */
export async function readLimitedGatewayBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_GATEWAY_RESPONSE_BYTES)) {
    throw malformedFailure('response body is too large')
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_GATEWAY_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw malformedFailure('response body is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** POST one JSON body and return the parsed envelope, rejecting any other status. */
async function postGatewayJson(
  request: GatewayRequest,
  url: string,
  body: object,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  throwIfAborted(signal)
  let response: Response
  try {
    response = await request(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (cause) {
    if (signal?.aborted === true) throw cancelledFailure()
    throw unreachableFailure('request failed', cause)
  }
  if (response.status !== 200) {
    throw unreachableFailure(`HTTP ${String(response.status)}`)
  }
  let value: unknown
  try {
    value = JSON.parse(await readLimitedGatewayBody(response))
  } catch (cause) {
    if (cause instanceof GatewayAuthError) throw cause
    throw malformedFailure('body is not JSON')
  }
  if (!isRecord(value)) throw malformedFailure('body is not an object')
  return value
}

function parseApprovalUri(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw malformedFailure('verification_uri is missing')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw malformedFailure('verification_uri is not a URL')
  }
  if (url.protocol !== 'https:' || url.origin !== GATEWAY_CONSOLE_ORIGIN
    || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw malformedFailure('verification_uri is outside the console origin')
  }
  return url.href
}

function parsePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw malformedFailure(`${field} is not a positive number`)
  }
  return value
}

function parseUser(value: unknown): GatewayAccountUser {
  if (!isRecord(value)
    || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)
    || typeof value.username !== 'string' || value.username.length === 0 || value.username.length > 256) {
    throw malformedFailure('approved user facts are incomplete')
  }
  return Object.freeze({
    id: value.id,
    username: value.username,
    ...(typeof value.display_name === 'string' && value.display_name.length <= 256
      ? { display_name: value.display_name }
      : {}),
    ...(typeof value.group === 'string' && value.group.length <= 256 ? { group: value.group } : {}),
    ...(typeof value.quota === 'number' && Number.isFinite(value.quota) ? { quota: value.quota } : {}),
  })
}

/**
 * Start one device-authorization ceremony.
 *
 * The returned device code and verifier are secrets: they stay in memory and
 * are never placed in a URL, a log line, or a user-visible string.
 * @param options - device identity, entropy seam, clock, and cancellation.
 * @returns the started ceremony with its local deadline.
 */
export async function startGatewayDeviceAuthorization(
  options: GatewayStartOptions,
): Promise<GatewayDeviceAuthorization> {
  const entropy = options.randomBytes ?? randomEntropy
  const codeVerifier = createGatewayCodeVerifier(entropy(GATEWAY_CODE_VERIFIER_BYTES))
  const envelope = await postGatewayJson(
    options.request ?? defaultRequest,
    GATEWAY_DEVICE_START_URL,
    {
      code_challenge: gatewayCodeChallenge(codeVerifier),
      device_name: options.deviceName,
      device_id: options.deviceId,
    },
    options.signal,
  )
  if (envelope['success'] !== true) {
    throw new GatewayAuthError('refused', 'gateway refused the device-authorization start', true)
  }
  const data = envelope['data']
  if (!isRecord(data)) throw malformedFailure('start data is missing')
  const deviceCode = data['device_code']
  const userCode = data['user_code']
  if (typeof deviceCode !== 'string' || !DEVICE_CODE_PATTERN.test(deviceCode)) {
    throw malformedFailure('device_code is missing')
  }
  if (typeof userCode !== 'string' || !USER_CODE_PATTERN.test(userCode)) {
    throw malformedFailure('user_code is missing')
  }
  const verificationUri = parseApprovalUri(data['verification_uri'])
  const intervalMs = data['interval'] === undefined
    ? GATEWAY_DEFAULT_POLL_INTERVAL_MS
    : parsePositiveNumber(data['interval'], 'interval') * 1_000
  const expiresInMs = data['expires_in'] === undefined
    ? GATEWAY_DEFAULT_EXPIRES_IN_MS
    : parsePositiveNumber(data['expires_in'], 'expires_in') * 1_000
  const clock = options.clock ?? defaultClock()

  return Object.freeze({
    deviceCode,
    userCode,
    verificationUri,
    approvalUrl: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
    codeVerifier,
    intervalMs,
    expiresAt: clock.now() + expiresInMs,
  })
}

/**
 * Run one poll of a started ceremony.
 *
 * A missing, expired, consumed, or verifier-mismatched ceremony arrives as an
 * HTTP 200 body carrying `success: false`, which becomes a non-retryable
 * {@link GatewayAuthError} carrying the gateway's own message.
 * @param options - started ceremony, request seam, and cancellation.
 * @returns the pending interval or the approved relay facts.
 */
export async function pollGatewayDeviceAuthorization(
  options: GatewayPollOptions,
): Promise<GatewayDevicePollResult> {
  const envelope = await postGatewayJson(
    options.request ?? defaultRequest,
    GATEWAY_DEVICE_POLL_URL,
    { device_code: options.device.deviceCode, code_verifier: options.device.codeVerifier },
    options.signal,
  )
  if (envelope['success'] !== true) {
    const message = envelope['message']
    throw new GatewayAuthError(
      'refused',
      typeof message === 'string' && message.length > 0 && message.length <= 512
        ? message
        : 'gateway refused the device-authorization poll',
      false,
    )
  }
  const data = envelope['data']
  if (!isRecord(data)) throw malformedFailure('poll data is missing')
  const status = data['status']
  if (status === 'pending') {
    return Object.freeze({
      status: 'pending',
      intervalMs: data['interval'] === undefined
        ? options.device.intervalMs
        : parsePositiveNumber(data['interval'], 'interval') * 1_000,
    })
  }
  if (status !== 'approved') throw malformedFailure('poll status is unknown')

  const key = data['key']
  const tokenId = data['token_id']
  const name = data['name']
  if (typeof key !== 'string' || !OPAQUE_SECRET_PATTERN.test(key)) {
    throw malformedFailure('approved key is missing')
  }
  if (typeof tokenId !== 'number' || !Number.isSafeInteger(tokenId)) {
    throw malformedFailure('approved token_id is missing')
  }
  if (typeof name !== 'string' || name.length === 0 || name.length > 512) {
    throw malformedFailure('approved token name is missing')
  }
  return Object.freeze({
    status: 'approved',
    key,
    tokenId,
    name,
    user: parseUser(data['user']),
  })
}

/**
 * Poll until the user approves or the local ceremony deadline elapses.
 *
 * The browser may decline or simply go away: the gateway keeps answering
 * pending for the whole ceremony lifetime, so the deadline is enforced here.
 * @param options - started ceremony plus the request, clock, and cancellation seams.
 * @returns the approved relay facts.
 * @throws {GatewayAuthError} with code `expired` when the deadline elapses, or the poll failure.
 */
export async function awaitGatewayDeviceAuthorization(
  options: GatewayAwaitOptions,
): Promise<GatewayApprovedDevice> {
  const clock = options.clock ?? defaultClock()
  let intervalMs = options.device.intervalMs
  for (;;) {
    throwIfAborted(options.signal)
    if (clock.now() >= options.device.expiresAt) {
      throw new GatewayAuthError('expired', 'gateway sign-in timed out', true)
    }
    await clock.sleep(intervalMs, options.signal)
    throwIfAborted(options.signal)
    if (clock.now() >= options.device.expiresAt) {
      throw new GatewayAuthError('expired', 'gateway sign-in timed out', true)
    }
    const poll = await pollGatewayDeviceAuthorization(options)
    if (poll.status === 'approved') return poll
    intervalMs = poll.intervalMs
    options.onPending?.()
  }
}

/**
 * Read the relay's model catalog for one issued key.
 *
 * A failed or unusable catalog is never fatal: sign-in keeps the account, and
 * the caller decides whether a route without models can be persisted.
 * @param options - relay key plus the request and cancellation seams.
 * @returns accepted model ids in catalog order, or an empty list when the call or its body fails.
 */
export async function discoverGatewayModels(options: GatewayModelsOptions): Promise<readonly string[]> {
  const request = options.request ?? defaultRequest
  let response: Response
  try {
    response = await request(GATEWAY_MODELS_URL, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${options.key}` },
      cache: 'no-store',
      redirect: 'error',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch {
    return []
  }
  if (response.status !== 200) return []

  let value: unknown
  try {
    value = JSON.parse(await readLimitedGatewayBody(response))
  } catch {
    return []
  }
  if (!isRecord(value) || !Array.isArray(value['data'])) return []

  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value['data']) {
    if (ids.length >= MAX_GATEWAY_MODELS) break
    if (!isRecord(entry)) continue
    const id = entry['id']
    if (typeof id !== 'string' || !MODEL_ID_PATTERN.test(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return Object.freeze(ids)
}

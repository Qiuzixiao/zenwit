/** Desktop account state machine: device sign-in, credential, and provider route. */

import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { hostname as osHostname } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import {
  GATEWAY_API_BASE,
  GATEWAY_DEVICE_LOGS_URL,
  GATEWAY_DEVICE_OVERVIEW_URL,
  awaitGatewayDeviceAuthorization,
  discoverGatewayModels,
  readLimitedGatewayBody,
  startGatewayDeviceAuthorization,
  type GatewayApprovedDevice,
  type GatewayAuthFailureCode,
  type GatewayAuthOptions,
  type GatewayDeviceAuthorization,
  type GatewayRequest,
} from './gateway-auth.ts'
import type {
  DesktopAccountCancelResponse,
  DesktopAccountErrorCode,
  DesktopAccountOverviewResponse,
  DesktopAccountOverviewUserView,
  DesktopAccountProviderRetryResponse,
  DesktopAccountProviderState,
  DesktopAccountSignInResponse,
  DesktopAccountSignOutResponse,
  DesktopAccountStatusResponse,
  DesktopAccountUsageItem,
  DesktopAccountUsageQuery,
  DesktopAccountUsageResponse,
  DesktopAccountUserView,
} from './account-contract.ts'

/** How long a revoked credential stays quiet before it is reported again. */
const CREDENTIAL_REPORT_INTERVAL_MS = 5 * 60 * 1_000

/**
 * Stable identity of one Desktop installation.
 *
 * The stored installation identity is copied together with the user data, so a
 * second copy of a profile would present the same identity and — while
 * supersession was scoped by name — revoke the credential the original app was
 * using. Folding the profile's own directory into the digest makes a copy a
 * different installation, which is what the supersession scope needs.
 * @param userDataDirectory - absolute user-data directory of this installation.
 * @param installationId - persisted installation identity.
 * @returns a 16 character lowercase hex identity.
 */
export function desktopDeviceIdentity(userDataDirectory: string, installationId: string): string {
  let root = resolve(userDataDirectory)
  try { root = realpathSync(userDataDirectory) } catch { /* Keep the resolved path when the directory is not there yet. */ }
  return createHash('sha256').update(root + '\n' + installationId).digest('hex').slice(0, 16)
}

/** Settings namespace owning the pi-ai provider routes. */
export const GATEWAY_PROVIDER_SETTINGS_NAMESPACE = 'llm-pi-ai'

/** Provider route persisted for a signed-in ZenwitAI account. */
export const GATEWAY_PROVIDER_ROUTE = 'zenai'

/** Wire protocol served by the ZenwitAI relay. */
export const GATEWAY_PROVIDER_API = 'openai-completions'

/** Credential reference holding the per-device relay token. */
export const GATEWAY_CREDENTIAL_REF = credentialRef('ZENWIT_GATEWAY_KEY')

/** Relative state location below Electron's userData directory. */
export const DESKTOP_GATEWAY_ACCOUNT_RELATIVE_PATH = join('identity', 'gateway-account.json')

/** Maximum account-state bytes read before treating the file as corrupt. */
export const MAX_DESKTOP_GATEWAY_ACCOUNT_BYTES = 64 * 1024

/** Maximum device name characters accepted before reporting one. */
const MAX_DEVICE_NAME_LENGTH = 64

/** Minimum delay between provider-route reconciliation attempts. */
const PROVIDER_RECONCILE_INTERVAL_MS = 30_000

/** Maximum consumption records accepted from one usage page. */
export const MAX_ACCOUNT_USAGE_ITEMS = 200

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

/** Persisted account facts. The relay token lives only in the credential store. */
export interface DesktopGatewayAccountRecord {
  /** State-file version for the current layout. */
  readonly version: 1
  /** Device identity this account authorized with. */
  readonly device: { readonly name: string; readonly id: string }
  /** Signed-in account facts as the gateway reported them. */
  readonly user: DesktopAccountUserView
  /** Server-side token identity, never its value. */
  readonly token: { readonly id: number; readonly name: string }
  /** Persisted provider route and the catalog it serves. */
  readonly provider: {
    readonly route: string
    readonly base_url: string
    readonly models: readonly string[]
    readonly ready: boolean
  }
  /** ISO-8601 completion time of the ceremony that produced this record. */
  readonly signed_in_at: string
}

/** Injectable transport, clock, and entropy seams for the protocol module. */
export interface GatewaySeams extends GatewayAuthOptions {
  /** Optional entropy source; tests supply deterministic bytes. */
  readonly randomBytes?: (size: number) => Uint8Array
}

/** Launcher and Host capabilities used without exposing them to the renderer. */
export interface DesktopAccountControllerBootstrap {
  /** Electron userData directory owning the account metadata file. */
  readonly userDataDirectory: string
  /** Persistent per-installation UUID used as the server's opaque device id. */
  readonly installationId?: string
  /** Open one already-validated approval URL in the system browser. */
  openExternal(url: string): Promise<void>
  /** Resolve the credential service at call time. */
  credentials(): CredentialProvider
  /** Resolve the settings service at call time. */
  settings(): Context['settings']
  /** Transport, clock, and entropy seams; tests replace them. */
  readonly gateway?: GatewaySeams
  /** Reported device-name source; defaults to the operating-system host name. */
  hostname?(): string
  /** Report one contained background failure to the Host log. */
  reportError?(operation: string, cause: unknown): void
}

interface ActiveCeremony {
  readonly device: GatewayDeviceAuthorization
  readonly deviceName: string
  readonly deviceId: string
  readonly controller: AbortController
}

/** Return the exact account metadata path for one Electron userData directory. */
export function desktopGatewayAccountPath(userDataDirectory: string): string {
  if (userDataDirectory.length === 0
    || /[\0\r\n]/u.test(userDataDirectory)
    || !isAbsolute(userDataDirectory)) {
    throw new TypeError('Desktop userData must be an absolute path without control characters.')
  }
  return join(resolve(userDataDirectory), DESKTOP_GATEWAY_ACCOUNT_RELATIVE_PATH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseUserView(value: unknown): DesktopAccountUserView | undefined {
  if (!isRecord(value)
    || typeof value['id'] !== 'number' || !Number.isSafeInteger(value['id'])
    || typeof value['username'] !== 'string' || value['username'].length === 0) {
    return undefined
  }
  return Object.freeze({
    id: value['id'],
    username: value['username'],
    ...(typeof value['display_name'] === 'string' ? { display_name: value['display_name'] } : {}),
    ...(typeof value['group'] === 'string' ? { group: value['group'] } : {}),
    ...(typeof value['quota'] === 'number' && Number.isFinite(value['quota']) ? { quota: value['quota'] } : {}),
  })
}

function parseAccountRecord(value: unknown): DesktopGatewayAccountRecord | undefined {
  if (!isRecord(value) || value['version'] !== 1) return undefined
  const device = value['device']
  const token = value['token']
  const provider = value['provider']
  const user = parseUserView(value['user'])
  if (user === undefined
    || !isRecord(device) || typeof device['name'] !== 'string' || device['name'].length === 0
    || typeof device['id'] !== 'string' || device['id'].length === 0
    || !isRecord(token) || typeof token['id'] !== 'number' || !Number.isSafeInteger(token['id'])
    || typeof token['name'] !== 'string'
    || !isRecord(provider) || typeof provider['route'] !== 'string'
    || typeof provider['base_url'] !== 'string' || typeof provider['ready'] !== 'boolean'
    || !Array.isArray(provider['models'])
    || provider['models'].some(model => typeof model !== 'string')
    || typeof value['signed_in_at'] !== 'string') {
    return undefined
  }
  const models = provider['models'] as string[]
  return Object.freeze({
    version: 1,
    device: Object.freeze({ name: device['name'], id: device['id'] }),
    user,
    token: Object.freeze({ id: token['id'], name: token['name'] }),
    provider: Object.freeze({
      route: provider['route'],
      base_url: provider['base_url'],
      models: Object.freeze([...models]),
      ready: provider['ready'],
    }),
    signed_in_at: value['signed_in_at'],
  })
}

/**
 * Stable failure of one owner-scoped device read.
 *
 * The code is the only fact that leaves this module: the gateway's own message,
 * the request URL, and the transport cause stay in the Host.
 */
class AccountReadError extends Error {
  /**
   * @param code - stable renderer-visible token for the failure.
   * @param cause - underlying transport, status, or parse failure.
   */
  constructor(
    readonly code: DesktopAccountErrorCode,
    cause?: unknown,
  ) {
    super('desktop account read failed', cause === undefined ? undefined : { cause })
    this.name = 'AccountReadError'
  }
}

/** Read the `data` object of a successful gateway envelope. */
function gatewayData(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value['success'] !== true) return undefined
  const data = value['data']
  return isRecord(data) ? data : undefined
}

/** Accept one non-negative finite quota value. */
function quotaValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Accept one non-negative integer count. */
function countValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Accept one bounded non-empty display string. */
function textValue(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

/** Read a nested `{ quota }` total, as both consumption windows are shaped. */
function windowQuota(value: unknown): number | undefined {
  return isRecord(value) ? quotaValue(value['quota']) : undefined
}

/** Parse the owner facts of one overview read. */
function parseOverviewUser(value: unknown): DesktopAccountOverviewUserView | undefined {
  if (!isRecord(value)
    || typeof value['id'] !== 'number' || !Number.isSafeInteger(value['id'])
    || textValue(value['username'], 256) === undefined) {
    return undefined
  }
  const quota = quotaValue(value['quota'])
  const usedQuota = quotaValue(value['used_quota'])
  const requestCount = countValue(value['request_count'])
  const createdAt = countValue(value['created_at'])
  if (quota === undefined || usedQuota === undefined
    || requestCount === undefined || createdAt === undefined) {
    return undefined
  }
  const displayName = textValue(value['display_name'], 256)
  const email = textValue(value['email'], 256)
  const group = textValue(value['group'], 256)
  return Object.freeze({
    id: value['id'] as number,
    username: value['username'] as string,
    quota,
    used_quota: usedQuota,
    request_count: requestCount,
    created_at: createdAt,
    ...(displayName === undefined ? {} : { display_name: displayName }),
    ...(email === undefined ? {} : { email }),
    ...(group === undefined ? {} : { group }),
  })
}

/** Parse one consumption record; an unusable record is dropped, never guessed. */
function parseUsageItem(value: unknown): DesktopAccountUsageItem | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const createdAt = countValue(value['created_at'])
  const quota = quotaValue(value['quota'])
  const promptTokens = countValue(value['prompt_tokens'])
  const completionTokens = countValue(value['completion_tokens'])
  const useTime = quotaValue(value['use_time'])
  const modelName = textValue(value['model_name'], 256)
  if (typeof id !== 'number' || !Number.isSafeInteger(id)
    || createdAt === undefined || quota === undefined
    || promptTokens === undefined || completionTokens === undefined
    || useTime === undefined || modelName === undefined) {
    return undefined
  }
  return Object.freeze({
    id,
    created_at: createdAt,
    model_name: modelName,
    quota,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    use_time: useTime,
    is_stream: value['is_stream'] === true,
  })
}

/** Parse one bounded page of consumption records; an unusable page is rejected whole. */
function parseUsageItems(value: unknown): readonly DesktopAccountUsageItem[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ACCOUNT_USAGE_ITEMS) return undefined
  const items: DesktopAccountUsageItem[] = []
  for (const entry of value) {
    const item = parseUsageItem(entry)
    if (item === undefined) return undefined
    items.push(item)
  }
  return Object.freeze(items)
}

/** Map one owner-scoped read failure onto its stable renderer-visible token. */
function readErrorFor(cause: unknown): DesktopAccountErrorCode {
  return cause instanceof AccountReadError ? cause.code : 'gateway-unreachable'
}

/** Map one protocol failure onto its stable renderer-visible token. */
function accountErrorFor(cause: unknown): DesktopAccountErrorCode {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    ? (cause as { code?: GatewayAuthFailureCode }).code
    : undefined
  switch (code) {
    case 'malformed': return 'gateway-malformed'
    case 'refused': return 'gateway-refused'
    case 'expired': return 'gateway-expired'
    case 'cancelled': return 'gateway-expired'
    case 'unreachable': return 'gateway-unreachable'
    default: return 'gateway-unreachable'
  }
}

/** Report a device name that is safe to persist and to mint server-side. */
function deviceNameFrom(source: string): string {
  let printable = ''
  for (const character of source) {
    const code = character.codePointAt(0) ?? 32
    printable += code < 32 || code === 127 ? ' ' : character
  }
  const trimmed = printable.trim()
  return trimmed.length === 0 ? 'Desktop' : trimmed.slice(0, MAX_DEVICE_NAME_LENGTH)
}

/**
 * Desktop account state machine.
 *
 * One ceremony at a time owns the account state: the Host polls in the
 * background, stores the relay token in the credential store, and writes the
 * provider route the model picker consumes. The device code, the PKCE
 * verifier, and the relay token are never logged and never persisted outside
 * the credential store.
 */
export default class DesktopAccountController {
  private ceremony: ActiveCeremony | undefined
  private failure: DesktopAccountErrorCode | undefined
  /** Last observed validity of the stored device credential. */
  private credential: 'valid' | 'unknown' | 'rejected' = 'unknown'
  /** When the revoked credential was last reported, so the log stays one line. */
  private credentialReportedAt = 0
  private account: DesktopGatewayAccountRecord | undefined
  private loaded = false
  private reconcileTask: Promise<void> | undefined
  private providerRetryAt = 0

  /**
   * @param bootstrap - launcher capabilities, persistence roots, and protocol seams.
   */
  constructor(private readonly bootstrap: DesktopAccountControllerBootstrap) {}

  /** Read the current account state without touching an in-flight ceremony. */
  async status(): Promise<DesktopAccountStatusResponse> {
    const active = this.ceremony
    if (active !== undefined) {
      return Object.freeze({
        state: 'signing-in',
        device: active.deviceName,
        user_code: active.device.userCode,
        verification_uri: active.device.verificationUri,
        provider: 'none',
        ...(this.failure === undefined ? {} : { error: this.failure }),
      })
    }
    const account = await this.loadAccount()
    if (account === undefined) return this.projectSignedOut()
    // A revoked credential cannot serve the route; reconciling would only write
    // the dead key back into the profile.
    if (!account.provider.ready && this.credential !== 'rejected') this.scheduleProviderReconcile(account)
    return this.projectSignedIn(account)
  }

  /**
   * Start one device-authorization ceremony and return its user code at once.
   * @returns the signing-in projection, or the unchanged signed-out projection with a
   * stable failure token when the gateway refused to start the ceremony.
   * @throws when the Desktop installation identity is unavailable.
   */
  async signIn(): Promise<DesktopAccountSignInResponse> {
    const active = this.ceremony
    if (active !== undefined) {
      return Object.freeze({
        state: 'signing-in',
        device: active.deviceName,
        user_code: active.device.userCode,
        verification_uri: active.device.verificationUri,
        provider: 'none',
        ...(this.failure === undefined ? {} : { error: this.failure }),
      })
    }
    const installationId = this.bootstrap.installationId
    if (installationId === undefined || installationId.length < 8) {
      throw new Error('dsh-plugin-desktop: ZenwitAI sign-in requires the Desktop installation identity')
    }
    const deviceName = deviceNameFrom((this.bootstrap.hostname ?? osHostname)())
    const deviceId = desktopDeviceIdentity(this.bootstrap.userDataDirectory, installationId)
    this.failure = undefined
    let device: GatewayDeviceAuthorization
    try {
      device = await startGatewayDeviceAuthorization({
        ...this.seams(),
        deviceName,
        deviceId,
      })
    } catch (cause) {
      // The request itself was accepted: the refusal is account state, not a
      // route failure, so the renderer can show the stable failure token.
      this.failure = accountErrorFor(cause)
      this.report('start the ZenwitAI sign-in ceremony', cause)
      return this.projectSignedOut()
    }
    const controller = new AbortController()
    const ceremony: ActiveCeremony = { device, deviceName, deviceId, controller }
    this.ceremony = ceremony
    // The system browser is the only user-visible step. A failed launch stays
    // non-fatal because the renderer also offers the approval URL.
    try {
      await this.bootstrap.openExternal(device.approvalUrl)
    } catch (cause) {
      this.report('open the ZenwitAI approval page', cause)
    }
    void this.runCeremony(ceremony)
    return Object.freeze({
      state: 'signing-in',
      device: deviceName,
      user_code: device.userCode,
      verification_uri: device.verificationUri,
      provider: 'none',
    })
  }

  /** Cancel the in-flight ceremony and report the resulting state. */
  async cancel(): Promise<DesktopAccountCancelResponse> {
    this.cancelCeremony()
    this.failure = undefined
    return await this.status()
  }

  /**
   * Clear the credential, the provider route, and the account metadata.
   * @returns the signed-out projection.
   * @throws when the stored credential cannot be removed, leaving the account intact.
   */
  async signOut(): Promise<DesktopAccountSignOutResponse> {
    this.cancelCeremony()
    this.failure = undefined
    this.credential = 'unknown'
    this.credentialReportedAt = 0
    await this.bootstrap.credentials().unset(GATEWAY_CREDENTIAL_REF)
    try {
      const settings = this.bootstrap.settings()
      if (settings.get(GATEWAY_PROVIDER_SETTINGS_NAMESPACE) !== undefined) {
        await settings.mutate(GATEWAY_PROVIDER_SETTINGS_NAMESPACE, [
          { op: 'unset', path: ['providers', GATEWAY_PROVIDER_ROUTE] },
        ])
      }
    } catch (cause) {
      this.report('remove the ZenwitAI provider route', cause)
    }
    try {
      await rm(desktopGatewayAccountPath(this.bootstrap.userDataDirectory), { force: true })
    } catch (cause) {
      this.report('delete the ZenwitAI account metadata', cause)
    }
    this.account = undefined
    this.loaded = true
    return await this.status()
  }

  /**
   * Force one provider-route reconciliation attempt.
   *
   * A retry reads the stored credential and never rewrites it: only a
   * successful catalog read followed by a successful settings write can mark
   * the route ready, so a failed attempt leaves the account exactly as usable
   * as it already was.
   * @returns the fresh account projection.
   */
  async retryProvider(): Promise<DesktopAccountProviderRetryResponse> {
    const account = await this.loadAccount()
    if (account === undefined) return this.projectSignedOut()
    if (account.provider.ready) return this.projectSignedIn(account)
    // Serialize with a scheduled attempt, then force exactly one more.
    const scheduled = this.reconcileTask
    if (scheduled !== undefined) await scheduled
    const latest = this.account
    if (latest === undefined) return this.projectSignedOut()
    if (latest.provider.ready) return this.projectSignedIn(latest)
    this.providerRetryAt = this.clockNow() + PROVIDER_RECONCILE_INTERVAL_MS
    await this.reconcileProviderRoute(latest)
    const settled = this.account
    return settled === undefined ? this.projectSignedOut() : this.projectSignedIn(settled)
  }

  /**
   * Read the account owner's balance and consumption totals.
   *
   * A signed-out installation answers without any gateway request. A read that
   * fails while signed in keeps `signed-in` and carries only its stable token, so
   * the renderer never mistakes a failed read for a signed-out account.
   * @returns the owner's aggregate account facts, or the failure projection.
   */
  async overview(): Promise<DesktopAccountOverviewResponse> {
    const key = await this.deviceKey()
    if (key === undefined) return this.projectSignedOutRead()
    let envelope: unknown
    try {
      envelope = await this.readDeviceJson(GATEWAY_DEVICE_OVERVIEW_URL, key)
    } catch (cause) {
      const code = readErrorFor(cause)
      if (code === 'credential-rejected') this.noteCredential('rejected')
      else this.report('read the ZenwitAI account overview', cause)
      return this.projectReadFailure(code)
    }
    this.noteCredential('valid')
    const data = gatewayData(envelope)
    const user = data === undefined ? undefined : parseOverviewUser(data['user'])
    const todayQuota = data === undefined ? undefined : windowQuota(data['today'])
    const monthQuota = data === undefined ? undefined : windowQuota(data['month'])
    const serverTime = data === undefined ? undefined : countValue(data['server_time'])
    if (user === undefined || todayQuota === undefined || monthQuota === undefined || serverTime === undefined) {
      return this.projectReadFailure('gateway-malformed')
    }
    return Object.freeze({
      state: 'signed-in',
      user,
      today_quota: todayQuota,
      month_quota: monthQuota,
      server_time: serverTime,
    })
  }

  /**
   * Read one page of the account owner's consumption records.
   *
   * The caller bounds the page: `page` and `page_size` are validated at the
   * loopback route before they reach this method.
   * @param query - bounded page request.
   * @returns the owner's records for that page, or the failure projection.
   */
  async usage(query: DesktopAccountUsageQuery): Promise<DesktopAccountUsageResponse> {
    const key = await this.deviceKey()
    if (key === undefined) return this.projectSignedOutRead()
    const url = new URL(GATEWAY_DEVICE_LOGS_URL)
    url.searchParams.set('p', String(query.page))
    url.searchParams.set('page_size', String(query.page_size))
    let envelope: unknown
    try {
      envelope = await this.readDeviceJson(url.href, key)
    } catch (cause) {
      const code = readErrorFor(cause)
      if (code === 'credential-rejected') this.noteCredential('rejected')
      else this.report('read the ZenwitAI account usage', cause)
      return this.projectReadFailure(code)
    }
    this.noteCredential('valid')
    const data = gatewayData(envelope)
    const items = data === undefined ? undefined : parseUsageItems(data['items'])
    const page = data === undefined ? undefined : countValue(data['page'])
    const pageSize = data === undefined ? undefined : countValue(data['page_size'])
    const total = data === undefined ? undefined : countValue(data['total'])
    if (items === undefined || page === undefined || pageSize === undefined || total === undefined) {
      return this.projectReadFailure('gateway-malformed')
    }
    return Object.freeze({
      state: 'signed-in',
      page,
      page_size: pageSize,
      total,
      items,
    })
  }

  /** Abort an in-flight ceremony when the owning plugin disposes. */
  dispose(): void {
    this.cancelCeremony()
  }

  /** Resolve the stored device credential for one owner-scoped read. */
  private async deviceKey(): Promise<string | undefined> {
    if (await this.loadAccount() === undefined) return undefined
    const resolved = await this.bootstrap.credentials().resolve(GATEWAY_CREDENTIAL_REF)
    if (resolved === undefined) {
      // The metadata survived its token. Report the account as signed out rather
      // than sending a read the gateway can only refuse.
      this.failure ??= 'credential-missing'
      return undefined
    }
    return resolved.value
  }

  /**
   * Read one owner-scoped JSON envelope from the gateway console.
   * @param url - absolute gateway URL inside the console origin.
   * @param key - device relay token; it never reaches a log or an error message.
   * @returns the parsed envelope.
   * @throws {AccountReadError} carrying the stable token for the failure.
   */
  private async readDeviceJson(url: string, key: string): Promise<unknown> {
    const request: GatewayRequest = this.seams().request
      ?? ((input, init) => globalThis.fetch(input, init))
    let response: Response
    try {
      response = await request(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${key.startsWith('sk-') ? key : `sk-${key}`}`,
        },
        cache: 'no-store',
        redirect: 'error',
      })
    } catch (cause) {
      throw new AccountReadError('gateway-unreachable', cause)
    }
    if (response.status === 401 || response.status === 403) {
      throw new AccountReadError('credential-rejected')
    }
    if (response.status !== 200) throw new AccountReadError('gateway-unreachable')
    let body: string
    try {
      body = await readLimitedGatewayBody(response)
    } catch (cause) {
      throw new AccountReadError('gateway-malformed', cause)
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(body)
    } catch (cause) {
      throw new AccountReadError('gateway-malformed', cause)
    }
    return envelope
  }

  /** Project the signed-out account for an owner-scoped read. */
  private projectSignedOutRead(): {
    readonly state: 'signed-out'
    readonly error?: DesktopAccountErrorCode
  } {
    return Object.freeze({
      state: 'signed-out',
      ...(this.failure === undefined ? {} : { error: this.failure }),
    })
  }

  /** Project one failed owner-scoped read of an account that stays signed in. */
  private projectReadFailure(code: DesktopAccountErrorCode): {
    readonly state: 'signed-in'
    readonly error: DesktopAccountErrorCode
  } {
    return Object.freeze({ state: 'signed-in', error: code })
  }

  private seams(): GatewaySeams {
    return this.bootstrap.gateway ?? {}
  }

  private report(operation: string, cause: unknown): void {
    this.bootstrap.reportError?.(operation, cause)
  }

  /**
   * Record what the gateway said about the stored device credential.
   *
   * A revoked credential is durable account state, not a transient read error:
   * the panel has to say so and offer the one re-sign-in that repairs it, so the
   * state is kept rather than folded into a per-read failure. Reporting is
   * throttled because a polling panel retries every few seconds.
   * @param state - what the last owner-scoped read observed.
   */
  private noteCredential(state: 'valid' | 'rejected'): void {
    this.credential = state
    if (state === 'valid') return
    const now = Date.now()
    if (now - this.credentialReportedAt < CREDENTIAL_REPORT_INTERVAL_MS) return
    this.credentialReportedAt = now
    this.report('read the ZenwitAI account', new Error('the stored device credential was revoked'))
  }

  private cancelCeremony(): void {
    const active = this.ceremony
    if (active === undefined) return
    this.ceremony = undefined
    active.controller.abort()
  }

  private async runCeremony(ceremony: ActiveCeremony): Promise<void> {
    try {
      const approved = await awaitGatewayDeviceAuthorization({
        ...this.seams(),
        device: ceremony.device,
        signal: ceremony.controller.signal,
      })
      if (ceremony.controller.signal.aborted || this.ceremony !== ceremony) return
      await this.completeSignIn(ceremony, approved)
    } catch (cause) {
      if (ceremony.controller.signal.aborted) return
      this.failure = accountErrorFor(cause)
      this.report('complete the ZenwitAI sign-in ceremony', cause)
    } finally {
      if (this.ceremony === ceremony) this.ceremony = undefined
    }
  }

  private async completeSignIn(
    ceremony: ActiveCeremony,
    approved: GatewayApprovedDevice,
  ): Promise<void> {
    try {
      await this.bootstrap.credentials().set(GATEWAY_CREDENTIAL_REF, approved.key)
      // A fresh credential is valid until a read says otherwise.
      this.credential = 'valid'
      this.credentialReportedAt = 0
    } catch (cause) {
      this.failure = 'credential-unavailable'
      this.report('store the ZenwitAI relay token', cause)
      return
    }
    const models = await discoverGatewayModels({ key: approved.key, ...this.seams() })
    const ready = models.length > 0 ? await this.writeProviderRoute(models) : false
    const record: DesktopGatewayAccountRecord = Object.freeze({
      version: 1,
      device: Object.freeze({ name: ceremony.deviceName, id: ceremony.deviceId }),
      user: approved.user,
      token: Object.freeze({ id: approved.tokenId, name: approved.name }),
      provider: Object.freeze({
        route: GATEWAY_PROVIDER_ROUTE,
        base_url: GATEWAY_API_BASE,
        models: Object.freeze([...models]),
        ready,
      }),
      signed_in_at: new Date(this.clockNow()).toISOString(),
    })
    try {
      await this.writeAccountFile(record)
    } catch (cause) {
      this.failure = 'credential-unavailable'
      this.report('persist the ZenwitAI account metadata', cause)
      return
    }
    this.account = record
    this.loaded = true
    this.failure = ready ? undefined : 'provider-unavailable'
  }

  /** Persist the relay route; a refused write leaves the account usable but degraded. */
  private async writeProviderRoute(models: readonly string[]): Promise<boolean> {
    try {
      await this.bootstrap.settings().update(GATEWAY_PROVIDER_SETTINGS_NAMESPACE, {
        providers: {
          [GATEWAY_PROVIDER_ROUTE]: {
            apiKeyEnv: GATEWAY_CREDENTIAL_REF,
            baseURL: GATEWAY_API_BASE,
            api: GATEWAY_PROVIDER_API,
            models: models.map(id => ({ id })),
          },
        },
      })
      return true
    } catch (cause) {
      this.report('persist the ZenwitAI provider route', cause)
      return false
    }
  }

  private scheduleProviderReconcile(account: DesktopGatewayAccountRecord): void {
    if (this.reconcileTask !== undefined) return
    const now = this.clockNow()
    if (now < this.providerRetryAt) return
    this.providerRetryAt = now + PROVIDER_RECONCILE_INTERVAL_MS
    this.reconcileTask = this.reconcileProviderRoute(account).finally(() => {
      this.reconcileTask = undefined
    })
  }

  private async reconcileProviderRoute(account: DesktopGatewayAccountRecord): Promise<void> {
    try {
      // Read-only credential use: a failed reconciliation never clears,
      // rewrites, or weakens the stored relay token.
      const resolved = await this.bootstrap.credentials().resolve(GATEWAY_CREDENTIAL_REF)
      if (resolved === undefined) return
      const models = await discoverGatewayModels({ key: resolved.value, ...this.seams() })
      if (models.length === 0) return
      if (!await this.writeProviderRoute(models)) return
      const next: DesktopGatewayAccountRecord = Object.freeze({
        ...account,
        provider: Object.freeze({
          route: GATEWAY_PROVIDER_ROUTE,
          base_url: GATEWAY_API_BASE,
          models: Object.freeze([...models]),
          ready: true,
        }),
      })
      await this.writeAccountFile(next)
      this.account = next
      if (this.failure === 'provider-unavailable') this.failure = undefined
    } catch (cause) {
      this.report('reconcile the ZenwitAI provider route', cause)
    }
  }

  private clockNow(): number {
    return this.bootstrap.gateway?.clock?.now() ?? Date.now()
  }

  private async loadAccount(): Promise<DesktopGatewayAccountRecord | undefined> {
    if (!this.loaded) {
      this.loaded = true
      this.account = await this.readAccountFile()
    }
    const account = this.account
    if (account === undefined) return undefined
    const info = await this.bootstrap.credentials().describe(GATEWAY_CREDENTIAL_REF)
    if (!info.configured) {
      // The token was removed outside this controller. Report signed-out
      // without deleting state the user may still want to inspect.
      this.failure ??= 'credential-missing'
      return undefined
    }
    return account
  }

  private projectSignedOut(): DesktopAccountStatusResponse {
    return Object.freeze({
      state: 'signed-out',
      provider: 'none',
      ...(this.failure === undefined ? {} : { error: this.failure }),
    })
  }

  private projectSignedIn(account: DesktopGatewayAccountRecord): DesktopAccountStatusResponse {
    return Object.freeze({
      state: 'signed-in',
      user: account.user,
      device: account.device.name,
      provider: this.providerState(account),
      credential: this.credential,
      ...(this.failure === undefined ? {} : { error: this.failure }),
    })
  }

  private providerState(account: DesktopGatewayAccountRecord): DesktopAccountProviderState {
    // A revoked credential cannot serve the route whatever the profile says.
    if (this.credential === 'rejected') return 'degraded'
    return account.provider.ready ? 'ready' : 'degraded'
  }

  private async readAccountFile(): Promise<DesktopGatewayAccountRecord | undefined> {
    const path = desktopGatewayAccountPath(this.bootstrap.userDataDirectory)
    let text: string
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_DESKTOP_GATEWAY_ACCOUNT_BYTES) {
        this.report('read the ZenwitAI account metadata', new Error('account metadata is not a bounded ordinary file'))
        return undefined
      }
      text = await readFile(path, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.report('read the ZenwitAI account metadata', cause)
      }
      return undefined
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (cause) {
      this.report('read the ZenwitAI account metadata', cause)
      return undefined
    }
    const record = parseAccountRecord(value)
    if (record === undefined) {
      this.report('read the ZenwitAI account metadata', new Error('account metadata is not in the current format'))
    }
    return record
  }

  private async writeAccountFile(record: DesktopGatewayAccountRecord): Promise<void> {
    const path = desktopGatewayAccountPath(this.bootstrap.userDataDirectory)
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    await withFileLock(path, async () => {
      await writeFileAtomic(path, JSON.stringify(record) + '\n', {
        mode: PRIVATE_FILE_MODE,
        dirMode: PRIVATE_DIRECTORY_MODE,
      })
    })
  }
}

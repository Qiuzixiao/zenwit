/** Same-origin browser client for the private Desktop account API. */

const ACCOUNT_STATUS_PATH = '/_dsh/desktop/account/status'
const ACCOUNT_SIGN_IN_PATH = '/_dsh/desktop/account/sign-in'
const ACCOUNT_CANCEL_PATH = '/_dsh/desktop/account/cancel'
const ACCOUNT_SIGN_OUT_PATH = '/_dsh/desktop/account/sign-out'
const ACCOUNT_PROVIDER_RETRY_PATH = '/_dsh/desktop/account/provider/retry'
const ACCOUNT_OVERVIEW_PATH = '/_dsh/desktop/account/overview'
const ACCOUNT_USAGE_PATH = '/_dsh/desktop/account/usage'
const MAX_USERNAME_LENGTH = 256
const MAX_DEVICE_NAME_LENGTH = 256
const USER_CODE_PATTERN = /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/u
const CONSOLE_ORIGIN = 'https://ai.zenwit.cn'
const APPROVAL_PATH = '/device'
const RECHARGE_PATH = '/wallet'

/**
 * Console page that tops up the signed-in account.
 *
 * The desktop renders this as an ordinary external link, so the native shell
 * hands it to the system browser exactly as it does the approval page.
 */
export const DESKTOP_CONSOLE_RECHARGE_URL = `${CONSOLE_ORIGIN}${RECHARGE_PATH}`

/** Account states reported by the Host. */
export type DesktopAccountState = 'signed-out' | 'signing-in' | 'signed-in'

/** Stable failure tokens reported by the Host. */
export type DesktopAccountErrorCode =
  | 'gateway-unreachable'
  | 'gateway-malformed'
  | 'gateway-refused'
  | 'gateway-expired'
  | 'credential-unavailable'
  | 'credential-missing'
  | 'provider-unavailable'
  | 'credential-rejected'

/** Provider-route readiness of the signed-in account. */
export type DesktopAccountProviderState = 'none' | 'ready' | 'degraded'

/**
 * Validity of the stored device credential.
 *
 * `rejected` means the gateway no longer accepts it — another installation
 * rotated it away, or it was revoked. The account stays signed in and one
 * re-sign-in repairs it, so the renderer shows that instead of an unexplained
 * read failure.
 */
export type DesktopAccountCredentialState = 'valid' | 'unknown' | 'rejected'

/** Renderer view of the signed-in account; never contains the relay token. */
export interface DesktopAccountUserView {
  readonly id: number
  readonly username: string
  readonly display_name?: string
  readonly group?: string
  readonly quota?: number
}

/** Complete account projection consumed by the account section. */
export interface DesktopAccountStatusView {
  readonly state: DesktopAccountState
  readonly user?: DesktopAccountUserView
  readonly device?: string
  readonly user_code?: string
  readonly verification_uri?: string
  readonly error?: DesktopAccountErrorCode
  readonly provider: DesktopAccountProviderState
  /** Last observed validity of the stored device credential. */
  readonly credential?: DesktopAccountCredentialState
}

/** Renderer view of the account owner's aggregate facts; never contains the relay token. */
export interface DesktopAccountOverviewUserView {
  readonly id: number
  readonly username: string
  readonly display_name?: string
  readonly email?: string
  readonly group?: string
  /** Remaining balance in internal quota, where 500000 quota is one yuan. */
  readonly quota: number
  /** Lifetime consumed quota. */
  readonly used_quota: number
  /** Lifetime accepted request count. */
  readonly request_count: number
  /** Account creation time in seconds since the epoch. */
  readonly created_at: number
}

/**
 * Balance and consumption totals of the signed-in account.
 *
 * A read that fails while the account stays signed in reports `signed-in` with an
 * error token and no facts, so the renderer never shows a failed read as signed out.
 */
export interface DesktopAccountOverviewView {
  readonly state: 'signed-out' | 'signed-in'
  readonly user?: DesktopAccountOverviewUserView
  /** Consumed quota of the current day, in internal quota. */
  readonly today_quota?: number
  /** Consumed quota of the current month, in internal quota. */
  readonly month_quota?: number
  /** Gateway clock at read time in seconds since the epoch. */
  readonly server_time?: number
  readonly error?: DesktopAccountErrorCode
}

/** One consumption record belonging to the signed-in account. */
export interface DesktopAccountUsageItemView {
  readonly id: number
  /** Request time in seconds since the epoch. */
  readonly created_at: number
  readonly model_name: string
  /** Charged quota, where 500000 quota is one yuan. */
  readonly quota: number
  readonly prompt_tokens: number
  readonly completion_tokens: number
  /** Upstream duration in seconds. */
  readonly use_time: number
  readonly is_stream: boolean
}

/** One bounded page of the signed-in account's consumption records. */
export interface DesktopAccountUsageView {
  readonly state: 'signed-out' | 'signed-in'
  /** One-based page index as answered by the Host. */
  readonly page?: number
  readonly page_size?: number
  /** Total records matching the query, as answered by the Host. */
  readonly total?: number
  readonly items?: readonly DesktopAccountUsageItemView[]
  readonly error?: DesktopAccountErrorCode
}

/** Bounded page request the renderer may ask for. */
export interface DesktopAccountUsageQuery {
  /** One-based page index. */
  readonly page: number
  /** Records per page. */
  readonly page_size: number
}

/** Browser operations consumed by the account section. */
export interface DesktopAccountApi {
  read(): Promise<DesktopAccountStatusView>
  signIn(): Promise<DesktopAccountStatusView>
  cancel(): Promise<DesktopAccountStatusView>
  signOut(): Promise<DesktopAccountStatusView>
  retryProvider(): Promise<DesktopAccountStatusView>
  overview(): Promise<DesktopAccountOverviewView>
  usage(query: DesktopAccountUsageQuery): Promise<DesktopAccountUsageView>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const ACCOUNT_STATES: readonly DesktopAccountState[] = ['signed-out', 'signing-in', 'signed-in']
const ERROR_CODES: readonly DesktopAccountErrorCode[] = [
  'gateway-unreachable',
  'gateway-malformed',
  'gateway-refused',
  'gateway-expired',
  'credential-unavailable',
  'credential-missing',
  'provider-unavailable',
  'credential-rejected',
]
const PROVIDER_STATES: readonly DesktopAccountProviderState[] = ['none', 'ready', 'degraded']
const CREDENTIAL_STATES: readonly DesktopAccountCredentialState[] = ['valid', 'unknown', 'rejected']

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAccountState(value: unknown): value is DesktopAccountState {
  return ACCOUNT_STATES.includes(value as DesktopAccountState)
}

function isErrorCode(value: unknown): value is DesktopAccountErrorCode {
  return ERROR_CODES.includes(value as DesktopAccountErrorCode)
}

function isProviderState(value: unknown): value is DesktopAccountProviderState {
  return PROVIDER_STATES.includes(value as DesktopAccountProviderState)
}

function isCredentialState(value: unknown): value is DesktopAccountCredentialState {
  return CREDENTIAL_STATES.includes(value as DesktopAccountCredentialState)
}

function parseUser(value: unknown): DesktopAccountUserView | undefined {
  if (!isObject(value)
    || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)
    || typeof value.username !== 'string' || value.username.length === 0
    || value.username.length > MAX_USERNAME_LENGTH) {
    return undefined
  }
  return Object.freeze({
    id: value.id,
    username: value.username,
    ...(typeof value.display_name === 'string' ? { display_name: value.display_name } : {}),
    ...(typeof value.group === 'string' ? { group: value.group } : {}),
    ...(typeof value.quota === 'number' && Number.isFinite(value.quota) ? { quota: value.quota } : {}),
  })
}

function parseApprovalUri(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.origin !== CONSOLE_ORIGIN
    || url.pathname !== APPROVAL_PATH || url.search !== '' || url.hash !== ''
    || url.username !== '' || url.password !== '' || url.href !== value) {
    return undefined
  }
  return url.href
}

/** Validate the bounded account projection before it reaches React state. */
export function parseDesktopAccountStatus(value: unknown): DesktopAccountStatusView {
  if (!isObject(value)
    || !isAccountState(value.state)
    || !isProviderState(value.provider)
    || (value.error !== undefined && !isErrorCode(value.error))
    || (value.credential !== undefined && !isCredentialState(value.credential))) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account response')
  }
  const user = value.user === undefined ? undefined : parseUser(value.user)
  if (value.user !== undefined && user === undefined) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account user in response')
  }
  const device = value.device
  if (device !== undefined
    && (typeof device !== 'string' || device.length === 0 || device.length > MAX_DEVICE_NAME_LENGTH)) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account device in response')
  }
  const userCode = value.user_code
  if (userCode !== undefined && (typeof userCode !== 'string' || !USER_CODE_PATTERN.test(userCode))) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account approval code in response')
  }
  const verificationUri = value.verification_uri === undefined
    ? undefined
    : parseApprovalUri(value.verification_uri)
  if (value.verification_uri !== undefined && verificationUri === undefined) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account approval URL in response')
  }
  if (value.state === 'signing-in' && (userCode === undefined || verificationUri === undefined)) {
    throw new Error('dsh-plugin-desktop: incomplete Desktop account sign-in response')
  }
  return Object.freeze({
    state: value.state,
    provider: value.provider,
    ...(value.credential === undefined ? {} : { credential: value.credential }),
    ...(user === undefined ? {} : { user }),
    ...(device === undefined ? {} : { device }),
    ...(userCode === undefined ? {} : { user_code: userCode }),
    ...(verificationUri === undefined ? {} : { verification_uri: verificationUri }),
    ...(value.error === undefined ? {} : { error: value.error }),
  })
}

function finiteQuota(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function parseOverviewUser(value: unknown): DesktopAccountOverviewUserView | undefined {
  if (!isObject(value)
    || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)
    || typeof value.username !== 'string' || value.username.length === 0
    || value.username.length > MAX_USERNAME_LENGTH
    || finiteQuota(value.quota) === undefined
    || finiteQuota(value.used_quota) === undefined
    || finiteQuota(value.request_count) === undefined
    || finiteQuota(value.created_at) === undefined) {
    return undefined
  }
  return Object.freeze({
    id: value.id,
    username: value.username,
    quota: value.quota as number,
    used_quota: value.used_quota as number,
    request_count: value.request_count as number,
    created_at: value.created_at as number,
    ...(typeof value.display_name === 'string' ? { display_name: value.display_name } : {}),
    ...(typeof value.email === 'string' ? { email: value.email } : {}),
    ...(typeof value.group === 'string' ? { group: value.group } : {}),
  })
}

function parseUsageItem(value: unknown): DesktopAccountUsageItemView | undefined {
  if (!isObject(value)
    || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)
    || typeof value.created_at !== 'number' || !Number.isSafeInteger(value.created_at)
    || typeof value.model_name !== 'string' || value.model_name.length === 0
    || finiteQuota(value.quota) === undefined
    || finiteQuota(value.prompt_tokens) === undefined
    || finiteQuota(value.completion_tokens) === undefined
    || finiteQuota(value.use_time) === undefined) {
    return undefined
  }
  return Object.freeze({
    id: value.id,
    created_at: value.created_at,
    model_name: value.model_name,
    quota: value.quota as number,
    prompt_tokens: value.prompt_tokens as number,
    completion_tokens: value.completion_tokens as number,
    use_time: value.use_time as number,
    is_stream: value.is_stream === true,
  })
}

/** Validate the bounded overview projection before it reaches React state. */
export function parseDesktopAccountOverview(value: unknown): DesktopAccountOverviewView {
  if (!isObject(value)
    || (value.state !== 'signed-out' && value.state !== 'signed-in')
    || (value.error !== undefined && !isErrorCode(value.error))) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account overview response')
  }
  const state = value.state
  if (state === 'signed-out' || value.error !== undefined) {
    return Object.freeze({
      state,
      ...(value.error === undefined ? {} : { error: value.error }),
    })
  }
  const user = parseOverviewUser(value.user)
  const today = finiteQuota(value.today_quota)
  const month = finiteQuota(value.month_quota)
  const serverTime = value.server_time
  if (user === undefined || today === undefined || month === undefined
    || typeof serverTime !== 'number' || !Number.isFinite(serverTime)) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account overview response')
  }
  return Object.freeze({
    state,
    user,
    today_quota: today,
    month_quota: month,
    server_time: serverTime,
  })
}

/** Validate the bounded usage page before it reaches React state. */
export function parseDesktopAccountUsage(value: unknown): DesktopAccountUsageView {
  if (!isObject(value)
    || (value.state !== 'signed-out' && value.state !== 'signed-in')
    || (value.error !== undefined && !isErrorCode(value.error))) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account usage response')
  }
  const state = value.state
  if (state === 'signed-out' || value.error !== undefined) {
    return Object.freeze({
      state,
      ...(value.error === undefined ? {} : { error: value.error }),
    })
  }
  const page = finiteQuota(value.page)
  const pageSize = finiteQuota(value.page_size)
  const total = finiteQuota(value.total)
  if (page === undefined || pageSize === undefined || total === undefined
    || page < 1 || pageSize < 1 || !Array.isArray(value.items)) {
    throw new Error('dsh-plugin-desktop: invalid Desktop account usage response')
  }
  const items: DesktopAccountUsageItemView[] = []
  for (const entry of value.items) {
    const item = parseUsageItem(entry)
    if (item === undefined) {
      throw new Error('dsh-plugin-desktop: invalid Desktop account usage record')
    }
    items.push(item)
  }
  return Object.freeze({ state, page, page_size: pageSize, total, items: Object.freeze(items) })
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: Desktop account request failed (${String(response.status)})`)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('dsh-plugin-desktop: Desktop account response was not JSON')
  }
}

function read(fetcher: FetchLike, path: string): Promise<Response> {
  return fetcher(path, {
    method: 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    headers: { 'Accept': 'application/json' },
  })
}

function post(fetcher: FetchLike, path: string): Promise<Response> {
  return fetcher(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
}

/** Construct the default same-origin API, with a fetch seam for focused tests. */
export function createDesktopAccountApi(
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
): DesktopAccountApi {
  return Object.freeze({
    async read() {
      const response = await fetcher(ACCOUNT_STATUS_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseDesktopAccountStatus(await readResponse(response))
    },
    async signIn() {
      return parseDesktopAccountStatus(await readResponse(await post(fetcher, ACCOUNT_SIGN_IN_PATH)))
    },
    async cancel() {
      return parseDesktopAccountStatus(await readResponse(await post(fetcher, ACCOUNT_CANCEL_PATH)))
    },
    async signOut() {
      return parseDesktopAccountStatus(await readResponse(await post(fetcher, ACCOUNT_SIGN_OUT_PATH)))
    },
    async retryProvider() {
      return parseDesktopAccountStatus(await readResponse(await post(fetcher, ACCOUNT_PROVIDER_RETRY_PATH)))
    },
    async overview() {
      return parseDesktopAccountOverview(await readResponse(await read(fetcher, ACCOUNT_OVERVIEW_PATH)))
    },
    async usage(query: DesktopAccountUsageQuery) {
      const search = new URLSearchParams({
        p: String(query.page),
        page_size: String(query.page_size),
      })
      return parseDesktopAccountUsage(
        await readResponse(await read(fetcher, `${ACCOUNT_USAGE_PATH}?${search.toString()}`)),
      )
    },
  })
}

export const desktopAccountPaths = Object.freeze({
  status: ACCOUNT_STATUS_PATH,
  signIn: ACCOUNT_SIGN_IN_PATH,
  cancel: ACCOUNT_CANCEL_PATH,
  signOut: ACCOUNT_SIGN_OUT_PATH,
  providerRetry: ACCOUNT_PROVIDER_RETRY_PATH,
  overview: ACCOUNT_OVERVIEW_PATH,
  usage: ACCOUNT_USAGE_PATH,
})

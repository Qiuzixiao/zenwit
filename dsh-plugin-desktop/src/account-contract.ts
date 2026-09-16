/** Private same-origin Desktop account API shared with the bundled renderer. */

/** Read the current ZenwitAI account state without touching the ceremony. */
export const DESKTOP_ACCOUNT_STATUS_PATH = '/_dsh/desktop/account/status'

/** Start a device-authorization ceremony and return its user code immediately. */
export const DESKTOP_ACCOUNT_SIGN_IN_PATH = '/_dsh/desktop/account/sign-in'

/** Cancel the in-flight device-authorization ceremony. */
export const DESKTOP_ACCOUNT_CANCEL_PATH = '/_dsh/desktop/account/cancel'

/** Clear the stored credential, the provider route, and the account metadata. */
export const DESKTOP_ACCOUNT_SIGN_OUT_PATH = '/_dsh/desktop/account/sign-out'

/** Force one provider-route reconciliation attempt for a degraded account. */
export const DESKTOP_ACCOUNT_PROVIDER_RETRY_PATH = '/_dsh/desktop/account/provider/retry'

/** Read the account owner's balance and consumption totals. */
export const DESKTOP_ACCOUNT_OVERVIEW_PATH = '/_dsh/desktop/account/overview'

/** Page the account owner's own consumption records. */
export const DESKTOP_ACCOUNT_USAGE_PATH = '/_dsh/desktop/account/usage'

/** Account states the Host reports to the renderer. */
export type DesktopAccountState = 'signed-out' | 'signing-in' | 'signed-in'

/** Stable failure tokens the renderer maps to locale-owned copy. */
export type DesktopAccountErrorCode =
  /** The gateway could not be reached or answered outside the frozen contract. */
  | 'gateway-unreachable'
  /** The gateway answered outside the frozen wire contract. */
  | 'gateway-malformed'
  /** The gateway refused the ceremony as unknown, expired, consumed, or verifier-mismatched. */
  | 'gateway-refused'
  /** The local ceremony deadline elapsed while the gateway still reported pending. */
  | 'gateway-expired'
  /** The account or its relay token could not be persisted. */
  | 'credential-unavailable'
  /** A signed-in account file outlived the relay token it describes. */
  | 'credential-missing'
  /** No servable provider route could be configured for the account. */
  | 'provider-unavailable'
  /** The gateway rejected the stored device credential as invalid, expired, or disabled. */
  | 'credential-rejected'

/** Provider-route readiness of the signed-in account. */
export type DesktopAccountProviderState =
  /** No account is signed in. */
  | 'none'
  /** The relay route is configured and serves the catalog the relay reported. */
  | 'ready'
  /** The credential is stored, but no servable route could be written yet. */
  | 'degraded'

/** Renderer-safe account facts; never contains the relay token. */
export interface DesktopAccountUserView {
  readonly id: number
  readonly username: string
  readonly display_name?: string
  readonly group?: string
  readonly quota?: number
}

/** Complete renderer-safe account state. */
export interface DesktopAccountStatusResponse {
  /** Current account state. */
  readonly state: DesktopAccountState
  /** Signed-in account facts. */
  readonly user?: DesktopAccountUserView
  /** Device name this installation authorized with. */
  readonly device?: string
  /** Approval code the user confirms in the browser while signing in. */
  readonly user_code?: string
  /** Approval page the system browser was asked to open. */
  readonly verification_uri?: string
  /** Stable failure token for the last failed operation. */
  readonly error?: DesktopAccountErrorCode
  /** Whether a usable provider route is configured for the account. */
  readonly provider: DesktopAccountProviderState
  /**
   * Validity of the stored device credential as the last owner-scoped read saw
   * it. A revoked credential is one that another installation rotated away, a
   * console revocation, or an administrative change: the account is still
   * signed in, and one re-sign-in repairs it.
   */
  readonly credential?: 'valid' | 'unknown' | 'rejected'
}

/**
 * Result of one sign-in attempt.
 *
 * A started ceremony reports `signing-in` with its user code and approval URL;
 * a gateway refusal reports the unchanged signed-out state with its stable
 * failure token, because the request itself was accepted.
 */
export type DesktopAccountSignInResponse = DesktopAccountStatusResponse

/** Fresh state returned after a cancellation. */
export type DesktopAccountCancelResponse = DesktopAccountStatusResponse

/** Fresh state returned after signing out. */
export type DesktopAccountSignOutResponse = DesktopAccountStatusResponse

/** Fresh state returned after one forced provider-route attempt. */
export type DesktopAccountProviderRetryResponse = DesktopAccountStatusResponse

/** Exact empty body accepted by the sign-in endpoint. */
export type DesktopAccountSignInRequest = Readonly<Record<string, never>>

/** Exact empty body accepted by the cancel endpoint. */
export type DesktopAccountCancelRequest = Readonly<Record<string, never>>

/** Exact empty body accepted by the sign-out endpoint. */
export type DesktopAccountSignOutRequest = Readonly<Record<string, never>>

/** Exact empty body accepted by the provider-retry endpoint. */
export type DesktopAccountProviderRetryRequest = Readonly<Record<string, never>>

/** Renderer-safe account facts an owner-scoped read may expose; never contains the relay token. */
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
 * A signed-out installation answers `state: 'signed-out'` without contacting the
 * gateway; a refused or malformed read answers the same state with its stable token.
 */
export interface DesktopAccountOverviewResponse {
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
export interface DesktopAccountUsageItem {
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
export interface DesktopAccountUsageResponse {
  readonly state: 'signed-out' | 'signed-in'
  /** One-based page index as answered by the gateway. */
  readonly page?: number
  readonly page_size?: number
  /** Total records matching the query, as answered by the gateway. */
  readonly total?: number
  readonly items?: readonly DesktopAccountUsageItem[]
  readonly error?: DesktopAccountErrorCode
}

/** Bounded page request accepted by the usage route. */
export interface DesktopAccountUsageQuery {
  /** One-based page index. */
  readonly page: number
  /** Records per page. */
  readonly page_size: number
}

/** Stable API failure shape that never contains tokens, codes, or native causes. */
export interface DesktopAccountErrorResponse {
  readonly error: string
}

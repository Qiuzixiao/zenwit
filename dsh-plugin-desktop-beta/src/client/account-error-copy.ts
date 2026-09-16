/** Locale keys shared by every account surface that renders a Host failure token. */

import type { DesktopAccountErrorCode } from './account-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

/**
 * Copy for each stable account failure token.
 *
 * The map is total so a new {@link DesktopAccountErrorCode} cannot reach a
 * surface without locale-owned text.
 */
export const ACCOUNT_ERROR_LOCALE_KEYS = {
  'gateway-unreachable': 'accountErrorUnreachable',
  'gateway-malformed': 'accountErrorMalformed',
  'gateway-refused': 'accountErrorRefused',
  'gateway-expired': 'accountErrorExpired',
  'credential-unavailable': 'accountErrorCredential',
  'credential-missing': 'accountErrorCredentialMissing',
  'credential-rejected': 'accountErrorCredentialRejected',
  'provider-unavailable': 'accountProviderDegraded',
} as const satisfies Record<DesktopAccountErrorCode, DesktopSettingsLocaleKey>

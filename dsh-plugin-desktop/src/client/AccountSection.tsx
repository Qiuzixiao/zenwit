/** ZenwitAI account section registered into the official Settings shell. */

import { useCallback, useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  createDesktopAccountApi,
  type DesktopAccountApi,
  type DesktopAccountStatusView,
} from './account-api.ts'
import { ACCOUNT_ERROR_LOCALE_KEYS } from './account-error-copy.ts'
import { DESKTOP_SETTINGS_LOCALE_NAMESPACE } from './desktop-settings.ts'

/** Registration-side business face for the ZenwitAI account section. */
export interface DesktopAccountSectionInjected {
  readonly api: DesktopAccountApi
}

/** Renderer-composed props for the official settings section entry. */
export type DesktopAccountSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopAccountSectionInjected>

type BusyOperation = 'load' | 'sign-in' | 'cancel' | 'sign-out' | 'retry-provider'

const POLL_INTERVAL_MS = 2_000

function quotaLabel(quota: number): string {
  return new Intl.NumberFormat().format(quota)
}

/** Render the ZenwitAI account page. */
export function AccountSection({ t, api }: DesktopAccountSectionProps) {
  const [view, setView] = useState<DesktopAccountStatusView>()
  const [busy, setBusy] = useState<BusyOperation | undefined>('load')
  const [loadFailed, setLoadFailed] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const next = await api.read()
        if (!active) return
        setView(next)
        setLoadFailed(false)
        if (next.state === 'signing-in') {
          timer = setTimeout(() => { void poll() }, POLL_INTERVAL_MS)
        }
      } catch {
        if (active) setLoadFailed(true)
      } finally {
        if (active) setBusy(current => current === 'load' ? undefined : current)
      }
    }
    void poll()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [api, generation])

  const run = useCallback(async (operation: BusyOperation, invoke: () => Promise<void>) => {
    setBusy(operation)
    setOperationFailed(false)
    try {
      await invoke()
    } catch {
      setOperationFailed(true)
    } finally {
      setBusy(current => current === operation ? undefined : current)
    }
  }, [])

  const restartPolling = (): void => { setGeneration(current => current + 1) }

  const signIn = (): void => {
    void run('sign-in', async () => {
      setView(await api.signIn())
      restartPolling()
    })
  }

  const cancel = (): void => {
    void run('cancel', async () => {
      setView(await api.cancel())
      restartPolling()
    })
  }

  const signOut = (): void => {
    void run('sign-out', async () => {
      setView(await api.signOut())
      restartPolling()
    })
  }

  const retryProvider = (): void => {
    void run('retry-provider', async () => {
      setView(await api.retryProvider())
    })
  }

  const retry = (): void => {
    setBusy('load')
    setLoadFailed(false)
    restartPolling()
  }

  const state = view?.state ?? 'signed-out'
  // A credential the gateway refused: the account is still signed in, and one
  // re-sign-in repairs it.
  const stale = state === 'signed-in' && view?.credential === 'rejected'
  const error = view?.error
  // A degraded provider route has its own notice on the signed-in card; the
  // alert stays for refusals and persistence failures the user must act on.
  const alertable = error !== undefined
    && !(state === 'signed-in' && error === 'provider-unavailable')
  const failure = operationFailed
    ? t('accountOperationFailed')
    : error === undefined || !alertable ? undefined : t(ACCOUNT_ERROR_LOCALE_KEYS[error])

  return (
    <div className="dshDesktopSettings">
      <header className="dshDesktopSettingsHeader">
        <h2>{t('accountTitle')}</h2>
        <p>{t('accountIntro')}</p>
      </header>

      {failure !== undefined && <p className="dshDesktopSettingsError" role="alert">{failure}</p>}

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-account-title">
        <div>
          <h3 id="dsh-desktop-account-title">{t('accountTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">
            {state !== 'signed-in'
              ? t('accountSignedOut')
              : stale ? t('accountCenterStaleBadge')
                : view?.provider === 'ready' ? t('accountSignedIn') : t('accountSignedInDegraded')}
          </p>
        </div>

        {busy === 'load' && view === undefined && <p className="dshDesktopSettingsHint">{t('accountLoading')}</p>}
        {loadFailed && view === undefined && (
          <div>
            <p className="dshDesktopSettingsError" role="alert">{t('accountUnavailable')}</p>
            <button type="button" className="dshDesktopSettingsButton" onClick={retry}>{t('accountRetry')}</button>
          </div>
        )}

        {state === 'signed-out' && (
          <button
            type="button"
            className="dshDesktopSettingsButton"
            disabled={busy !== undefined}
            onClick={signIn}
          >
            {busy === 'sign-in' ? t('accountSigningIn') : t('accountSignIn')}
          </button>
        )}

        {state === 'signing-in' && view?.user_code !== undefined && view.verification_uri !== undefined && (
          <div className="dshDesktopSettingsList">
            <p className="dshDesktopSettingsNotice" role="status">{t('accountSigningIn')}</p>
            <div className="dshDesktopSettingsUrls">
              <span className="dshDesktopSettingsChoiceTitle">{t('accountUserCode')}</span>
              <code>{view.user_code}</code>
              <a href={view.verification_uri} target="_blank" rel="noopener noreferrer">
                {t('accountOpenApproval')}
              </a>
            </div>
            <button
              type="button"
              className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
              disabled={busy !== undefined}
              onClick={cancel}
            >
              {busy === 'cancel' ? t('accountCancelling') : t('accountCancel')}
            </button>
          </div>
        )}

        {stale && (
          <div>
            <p className="dshDesktopSettingsError" role="alert">{t('accountCenterStaleBody')}</p>
            <button
              type="button"
              className="dshDesktopSettingsButton"
              disabled={busy !== undefined}
              onClick={signIn}
            >
              {busy === 'sign-in' ? t('accountSigningIn') : t('accountCenterRelogin')}
            </button>
          </div>
        )}

        {state === 'signed-in' && view?.user !== undefined && (
          <div className="dshDesktopSettingsList">
            <div className="dshDesktopSettingsChoiceCopy">
              <span className="dshDesktopSettingsChoiceTitle">
                {view.user.display_name ?? view.user.username}
              </span>
              <span className="dshDesktopSettingsChoiceBody">
                {view.user.username}
                {view.user.quota === undefined
                  ? null
                  : ` · ${t('accountQuota')} ${quotaLabel(view.user.quota)}`}
              </span>
            </div>
            {view.provider !== 'ready' && (
              <div>
                <p className="dshDesktopSettingsNotice" role="status">{t('accountProviderDegraded')}</p>
                <button
                  type="button"
                  className="dshDesktopSettingsButton"
                  disabled={busy !== undefined}
                  onClick={retryProvider}
                >
                  {busy === 'retry-provider' ? t('accountRetryingProvider') : t('accountRetryProvider')}
                </button>
              </div>
            )}
            <button
              type="button"
              className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
              disabled={busy !== undefined}
              onClick={signOut}
            >
              {busy === 'sign-out' ? t('accountSigningOut') : t('accountSignOut')}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

/** Register the ZenwitAI account page in the settings.section list slot. */
export function applyDesktopAccountSection(ctx: ClientContext): void {
  const api = createDesktopAccountApi()
  const t = ctx.locale.bind(DESKTOP_SETTINGS_LOCALE_NAMESPACE)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 90,
    label: () => t('accountNav'),
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, AccountSection))
}

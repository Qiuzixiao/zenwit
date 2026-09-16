/** ZenwitAI account center: the home-level panel and its navigation icon. */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, Check, CircleUser, Copy, LoaderCircle, LogIn, LogOut, RefreshCw, Wallet,
} from 'lucide-react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'main' keyed slot and the 'sidebar.panellist' icon seat.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DESKTOP_CONSOLE_RECHARGE_URL,
  createDesktopAccountApi,
  type DesktopAccountApi,
  type DesktopAccountOverviewView,
  type DesktopAccountStatusView,
  type DesktopAccountUsageView,
} from './account-api.ts'
import { ACCOUNT_ERROR_LOCALE_KEYS } from './account-error-copy.ts'
import { installAccountCenterStyles } from './account-center-styles.ts'
import { DESKTOP_SETTINGS_LOCALE_NAMESPACE } from './desktop-settings.ts'

/** Panel identifier shared by the keyed main entry and its navigation row. */
export const DESKTOP_ACCOUNT_PANEL_ID = 'account'

/** Navigation row order; the workbench's own surfaces sit at the front. */
const ACCOUNT_PANEL_ORDER = 30

/** Records requested per usage page. */
const USAGE_PAGE_SIZE = 20

/** Delay between status polls while the browser ceremony is pending. */
const POLL_INTERVAL_MS = 2_000

/** Internal quota equal to one yuan on this deployment (Price = 1). */
const QUOTA_PER_YUAN = 500_000

/** Registration-side business face of the account center surfaces. */
export interface DesktopAccountCenterInjected {
  readonly api: DesktopAccountApi
}

/** Renderer-composed props for the home-level account center panel. */
export type DesktopAccountCenterPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopAccountCenterInjected>

/** Renderer-composed props for the account center navigation icon. */
export type DesktopAccountCenterIconProps = PropsRuntime<'sidebar.panellist'>

type BusyOperation = 'load' | 'sign-in' | 'cancel' | 'sign-out' | 'retry-provider'

/** Format internal quota as the deployment's yuan amount. */
function yuanLabel(quota: number): string {
  return `¥${(quota / QUOTA_PER_YUAN).toFixed(2)}`
}

/** Format one integer count with the active locale's grouping. */
function countLabel(value: number): string {
  return new Intl.NumberFormat().format(value)
}

/** Format one epoch-seconds fact as a local date and time. */
function timeLabel(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleString()
}

/** Render the account center panel body. */
export function AccountCenterPanel({ t, api }: DesktopAccountCenterPanelProps) {
  const [view, setView] = useState<DesktopAccountStatusView>()
  const [busy, setBusy] = useState<BusyOperation | undefined>('load')
  const [loadFailed, setLoadFailed] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [overview, setOverview] = useState<DesktopAccountOverviewView>()
  const [overviewFailed, setOverviewFailed] = useState(false)
  const [usage, setUsage] = useState<DesktopAccountUsageView>()
  const [usageFailed, setUsageFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

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

  const state = view?.state ?? 'signed-out'

  useEffect(() => {
    if (state !== 'signed-in') {
      setOverview(undefined)
      setOverviewFailed(false)
      return
    }
    let active = true
    setOverviewFailed(false)
    void api.overview().then((next) => {
      if (!active) return
      setOverview(next)
      setOverviewFailed(next.error !== undefined)
    }).catch(() => { if (active) setOverviewFailed(true) })
    return () => { active = false }
  }, [api, state, generation])

  useEffect(() => {
    if (state !== 'signed-in') {
      setUsage(undefined)
      setUsageFailed(false)
      return
    }
    let active = true
    setUsageFailed(false)
    void api.usage({ page, page_size: USAGE_PAGE_SIZE }).then((next) => {
      if (!active) return
      setUsage(next)
      setUsageFailed(next.error !== undefined)
    }).catch(() => { if (active) setUsageFailed(true) })
    return () => { active = false }
  }, [api, state, page, generation])

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

  const copyCode = useCallback(async (value: string): Promise<void> => {
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 2_000)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }, [])

  const refresh = (): void => {
    setPage(1)
    restartPolling()
  }

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
      setPage(1)
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

  const error = view?.error
  // A degraded provider route has its own notice on the signed-in view; the
  // alert stays for refusals and persistence failures the user must act on.
  const alertable = error !== undefined
    && !(state === 'signed-in' && error === 'provider-unavailable')
  const failure = operationFailed
    ? t('accountOperationFailed')
    : error === undefined || !alertable ? undefined : t(ACCOUNT_ERROR_LOCALE_KEYS[error])

  const totalPages = usage?.total === undefined || usage.page_size === undefined
    ? 1
    : Math.max(1, Math.ceil(usage.total / usage.page_size))
  const empty = t('accountCenterEmptyValue')
  const overviewUser = overview?.user

  const provider = view?.provider ?? 'none'
  // A credential the gateway refused is durable account state: the account stays
  // signed in, the card says so, and one re-sign-in repairs it.
  const stale = state === 'signed-in' && view?.credential === 'rejected'
  const statusState = state !== 'signed-in' ? 'idle' : stale ? 'stale' : provider === 'ready' ? 'ready' : 'degraded'
  const statusLabel = state !== 'signed-in'
    ? t('accountSignedOut')
    : stale ? t('accountCenterStaleBadge')
      : provider === 'ready' ? t('accountSignedIn') : t('accountSignedInDegraded')

  return (
    <div className="dshAccountCenter">
      <header className="dshAccountCenterHead">
        <div>
          <span className="dshAccountCenterKicker">{t('accountCenterKicker')}</span>
          <h1 className="dshAccountCenterTitle">{t('accountCenterTitle')}</h1>
          <p className="dshAccountCenterIntro">{t('accountCenterIntro')}</p>
        </div>
        <span className="dshAccountCenterRule" aria-hidden="true" />
      </header>

      {failure !== undefined && (
        <p className="dshAccountAlert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{failure}</span>
        </p>
      )}

      {stale && (
        <div className="dshAccountAlert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span className="dshAccountAlertText">{t('accountCenterStaleBody')}</span>
          <button
            type="button"
            className="dshAccountButton"
            data-variant="secondary"
            disabled={busy !== undefined}
            onClick={signIn}
          >
            {busy === 'sign-in' ? t('accountSigningIn') : t('accountCenterRelogin')}
          </button>
        </div>
      )}

      {busy === 'load' && view === undefined && (
        <section className="dshAccountCard dshAccountCenterWide" aria-busy="true">
          <span className="dshAccountSkeleton" data-size="title" />
          <span className="dshAccountSkeleton" />
          <span className="dshAccountSkeleton" data-size="short" />
        </section>
      )}

      {loadFailed && view === undefined && (
        <section className="dshAccountCard dshAccountCenterWide">
          <div className="dshAccountEmpty" role="alert">
            <CircleUser size={26} strokeWidth={1.5} aria-hidden="true" />
            <strong>{t('accountUnavailable')}</strong>
            <span>{t('accountCenterIntro')}</span>
            <div className="dshAccountActions">
              <button type="button" className="dshAccountButton" onClick={retry}>{t('accountRetry')}</button>
            </div>
          </div>
        </section>
      )}

      {view !== undefined && state === 'signed-out' && (
        <section className="dshAccountCard dshAccountCenterWide">
          <div className="dshAccountEmpty">
            <CircleUser size={26} strokeWidth={1.5} aria-hidden="true" />
            <strong>{t('accountSignedOut')}</strong>
            <span>{t('accountCenterSignedOutHint')}</span>
            <div className="dshAccountActions">
              <button type="button" className="dshAccountButton" disabled={busy !== undefined} onClick={signIn}>
                {busy === 'sign-in'
                  ? <><LoaderCircle className="dshAccountSpinner" size={15} aria-hidden="true" />{t('accountSigningIn')}</>
                  : <><LogIn size={15} aria-hidden="true" />{t('accountSignIn')}</>}
              </button>
            </div>
          </div>
        </section>
      )}

      {state === 'signing-in' && view?.user_code !== undefined && view.verification_uri !== undefined && (
        <section className="dshAccountCard dshAccountCenterWide">
          <div className="dshAccountCardHead">
            <div>
              <span className="dshAccountCenterKicker">{t('accountCenterKicker')}</span>
              <h2 className="dshAccountCardTitle">{t('accountUserCode')}</h2>
            </div>
            <span className="dshAccountStatus" data-state="idle">
              <span className="dshAccountStatusDot" />
              {t('accountSigningIn')}
            </span>
          </div>
          <div className="dshAccountCode">
            <span className="dshAccountCodeValue">{view.user_code}</span>
            <button
              type="button"
              className="dshAccountButton"
              data-variant="secondary"
              onClick={() => { void copyCode(view.user_code ?? '') }}
            >
              {copied
                ? <><Check size={14} aria-hidden="true" />{t('accountCenterCopied')}</>
                : <><Copy size={14} aria-hidden="true" />{t('accountCenterCopyCode')}</>}
            </button>
          </div>
          {copyFailed && <p className="dshAccountError" role="alert">{t('accountCenterCopyFailed')}</p>}
          <div className="dshAccountActions">
            <a className="dshAccountButton" href={view.verification_uri} target="_blank" rel="noopener noreferrer">
              <ArrowUpRight size={15} aria-hidden="true" />
              {t('accountOpenApproval')}
            </a>
            <button
              type="button"
              className="dshAccountButton"
              data-variant="secondary"
              disabled={busy !== undefined}
              onClick={cancel}
            >
              {busy === 'cancel' ? t('accountCancelling') : t('accountCancel')}
            </button>
          </div>
        </section>
      )}

      {state === 'signed-in' && view?.user !== undefined && (
        <>
          <div className="dshAccountCenterColumn">
            <section className="dshAccountCard" aria-labelledby="dsh-account-center-profile">
              <div className="dshAccountCardHead">
                <h2 className="dshAccountCardTitle" id="dsh-account-center-profile">{t('accountCenterProfile')}</h2>
                <span className="dshAccountStatus" data-state={statusState}>
                  <span className="dshAccountStatusDot" />
                  {statusLabel}
                </span>
              </div>
              <dl className="dshAccountFacts">
                <div className="dshAccountFact">
                  <dt>{t('accountCenterUsername')}</dt>
                  <dd>{view.user.username}</dd>
                </div>
                <div className="dshAccountFact">
                  <dt>{t('accountCenterDisplayName')}</dt>
                  <dd>{overviewUser?.display_name ?? view.user.display_name ?? empty}</dd>
                </div>
                <div className="dshAccountFact">
                  <dt>{t('accountCenterEmail')}</dt>
                  <dd>{overviewUser?.email ?? empty}</dd>
                </div>
                <div className="dshAccountFact">
                  <dt>{t('accountCenterGroup')}</dt>
                  <dd>{overviewUser?.group ?? view.user.group ?? empty}</dd>
                </div>
                <div className="dshAccountFact">
                  <dt>{t('accountCenterCreatedAt')}</dt>
                  <dd>{overviewUser === undefined ? empty : timeLabel(overviewUser.created_at)}</dd>
                </div>
                <div className="dshAccountFact">
                  <dt>{t('accountCenterDevice')}</dt>
                  <dd>{view.device ?? empty}</dd>
                </div>
              </dl>
              {provider !== 'ready' && (
                <>
                  <p className="dshAccountNotice" role="status">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>{t('accountProviderDegraded')}</span>
                  </p>
                  <div className="dshAccountActions">
                    <button
                      type="button"
                      className="dshAccountButton"
                      data-variant="secondary"
                      disabled={busy !== undefined}
                      onClick={retryProvider}
                    >
                      {busy === 'retry-provider' ? t('accountRetryingProvider') : t('accountRetryProvider')}
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="dshAccountCard" aria-labelledby="dsh-account-center-balance">
              <div className="dshAccountCardHead">
                <h2 className="dshAccountCardTitle" id="dsh-account-center-balance">{t('accountCenterBalance')}</h2>
              </div>
              {overviewFailed && (
                <p className="dshAccountError" role="alert">
                  {stale ? t('accountCenterStaleValue') : t('accountCenterOverviewFailed')}
                </p>
              )}
              <div className="dshAccountBalanceHero">
                <span className="dshAccountBalanceValue">
                  {overviewUser === undefined ? empty : yuanLabel(overviewUser.quota)}
                </span>
              </div>
              <div className="dshAccountBalanceGrid">
                <div className="dshAccountBalanceCell">
                  <span>{t('accountCenterUsedTotal')}</span>
                  <span>{overviewUser === undefined ? empty : yuanLabel(overviewUser.used_quota)}</span>
                </div>
                <div className="dshAccountBalanceCell">
                  <span>{t('accountCenterToday')}</span>
                  <span>{overview?.today_quota === undefined ? empty : yuanLabel(overview.today_quota)}</span>
                </div>
                <div className="dshAccountBalanceCell">
                  <span>{t('accountCenterMonth')}</span>
                  <span>{overview?.month_quota === undefined ? empty : yuanLabel(overview.month_quota)}</span>
                </div>
              </div>
              <div className="dshAccountActions">
                <a
                  className="dshAccountButton"
                  href={DESKTOP_CONSOLE_RECHARGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Wallet size={15} aria-hidden="true" />
                  {t('accountCenterRecharge')}
                </a>
                <button
                  type="button"
                  className="dshAccountButton"
                  data-variant="secondary"
                  disabled={busy !== undefined}
                  onClick={refresh}
                >
                  <RefreshCw className={busy === 'load' ? 'dshAccountSpinner' : undefined} size={15} aria-hidden="true" />
                  {busy === 'load' ? t('accountCenterRefreshing') : t('accountCenterRefresh')}
                </button>
                <button
                  type="button"
                  className="dshAccountButton"
                  data-variant="quiet"
                  data-tone="danger"
                  disabled={busy !== undefined}
                  onClick={signOut}
                >
                  <LogOut size={15} aria-hidden="true" />
                  {busy === 'sign-out' ? t('accountSigningOut') : t('accountSignOut')}
                </button>
              </div>
              <p className="dshAccountHint">{t('accountCenterRechargeHint')}</p>
            </section>
          </div>

          <section className="dshAccountCard" aria-labelledby="dsh-account-center-usage">
            <div className="dshAccountCardHead">
              <div>
                <span className="dshAccountCenterKicker">{t('accountCenterUsageKicker')}</span>
                <h2 className="dshAccountCardTitle" id="dsh-account-center-usage">{t('accountCenterUsageTitle')}</h2>
              </div>
              {usage?.total !== undefined && (
                <span className="dshAccountUsageCount">{t('accountCenterUsageTotal', { value0: usage.total })}</span>
              )}
            </div>
            {usageFailed && (
              <p className="dshAccountError" role="alert">
                {stale ? t('accountCenterStaleValue') : t('accountCenterUsageFailed')}
              </p>
            )}
            {usage?.items !== undefined && usage.items.length === 0 && (
              <div className="dshAccountEmpty" data-compact="true">
                <strong>{t('accountCenterUsageEmpty')}</strong>
              </div>
            )}
            {usage?.items !== undefined && usage.items.length > 0 && (
              <>
                <div className="dshAccountUsageWrap">
                  <table className="dshAccountUsage">
                    <thead>
                      <tr>
                        <th scope="col">{t('accountCenterUsageTime')}</th>
                        <th scope="col">{t('accountCenterUsageModel')}</th>
                        <th scope="col" data-numeric="true">{t('accountCenterUsageCost')}</th>
                        <th scope="col" data-numeric="true">{t('accountCenterUsageToken')}</th>
                        <th scope="col" data-numeric="true">{t('accountCenterUsageDuration')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.items.map(item => (
                        <tr key={item.id}>
                          <td data-field="time">{timeLabel(item.created_at)}</td>
                          <td data-field="model">{item.model_name}</td>
                          <td data-field="cost" data-numeric="true">{yuanLabel(item.quota)}</td>
                          <td data-numeric="true">
                            {countLabel(item.prompt_tokens)} / {countLabel(item.completion_tokens)}
                          </td>
                          <td data-numeric="true">
                            {t('accountCenterUsageSeconds', { value0: item.use_time })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="dshAccountPager">
                  <span className="dshAccountPagerInfo">
                    {t('accountCenterUsagePage', { value0: page, value1: totalPages })}
                  </span>
                  <span className="dshAccountActions">
                    <button
                      type="button"
                      className="dshAccountButton"
                      data-variant="secondary"
                      disabled={page <= 1}
                      onClick={() => { setPage(current => Math.max(1, current - 1)) }}
                    >
                      {t('accountCenterUsagePrevious')}
                    </button>
                    <button
                      type="button"
                      className="dshAccountButton"
                      data-variant="secondary"
                      disabled={page >= totalPages}
                      onClick={() => { setPage(current => current + 1) }}
                    >
                      {t('accountCenterUsageNext')}
                    </button>
                  </span>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

/** Render the account center's global-panel icon. */
export function AccountCenterIcon({ size, active }: DesktopAccountCenterIconProps) {
  return <CircleUser size={size} strokeWidth={active ? 2 : 1.8} aria-hidden="true" />
}

/**
 * Register the account center panel and its navigation row.
 *
 * The keyed main entry and the panel-list id must stay the same value: the
 * workbench addresses the panel by the row it renders.
 * @param ctx - browser Cordis context.
 */
export function applyDesktopAccountCenter(ctx: ClientContext): void {
  const api = createDesktopAccountApi()
  const t = ctx.locale.bind(DESKTOP_SETTINGS_LOCALE_NAMESPACE)
  ctx.effect(() => installAccountCenterStyles(), 'dsh-plugin-desktop: account center styles')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: DESKTOP_ACCOUNT_PANEL_ID,
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, AccountCenterPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: DESKTOP_ACCOUNT_PANEL_ID,
    order: ACCOUNT_PANEL_ORDER,
    label: () => t('accountCenterNav'),
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
  }, AccountCenterIcon))
}

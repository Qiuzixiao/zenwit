// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AccountCenterPanel,
  type DesktopAccountCenterPanelProps,
} from '../src/client/AccountCenter.tsx'
import { DESKTOP_CONSOLE_RECHARGE_URL, type DesktopAccountApi } from '../src/client/account-api.ts'
import { zh } from '../src/client/desktop-settings-locales.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

function translate(key: keyof typeof zh, params?: Record<string, unknown>): string {
  const template = zh[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

const SIGNED_OUT: Awaited<ReturnType<DesktopAccountApi['read']>> = { state: 'signed-out', provider: 'none' }
const SIGNED_IN: Awaited<ReturnType<DesktopAccountApi['read']>> = {
  state: 'signed-in',
  provider: 'ready',
  device: 'MacBook Pro',
  user: { id: 1, username: 'zenwit', display_name: 'Zenwit User', group: 'default', quota: 1_000_000 },
}

function api(overrides: Partial<Record<keyof DesktopAccountApi, unknown>> = {}): DesktopAccountApi {
  return {
    read: vi.fn(async () => SIGNED_OUT),
    signIn: vi.fn(async () => ({ state: 'signing-in', provider: 'none', user_code: 'ABCD-2345', verification_uri: 'https://ai.zenwit.cn/device' })),
    cancel: vi.fn(async () => SIGNED_OUT),
    signOut: vi.fn(async () => SIGNED_OUT),
    retryProvider: vi.fn(async () => SIGNED_IN),
    overview: vi.fn(async () => ({ state: 'signed-in' })),
    usage: vi.fn(async () => ({ state: 'signed-in', page: 1, page_size: 20, total: 0, items: [] })),
    ...overrides,
  } as unknown as DesktopAccountApi
}

async function mount(accountApi: DesktopAccountApi): Promise<HTMLDivElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const props = { t: translate, api: accountApi } as unknown as DesktopAccountCenterPanelProps
  await act(async () => { root!.render(createElement(AccountCenterPanel, props)) })
  return container
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('account center panel', () => {
  it('offers the device sign-in when no account is stored', async () => {
    const signingIn: Awaited<ReturnType<DesktopAccountApi['read']>> = {
      state: 'signing-in',
      provider: 'none',
      user_code: 'ABCD-2345',
      verification_uri: 'https://ai.zenwit.cn/device',
    }
    let started = false
    const accountApi = api({
      read: vi.fn(async () => started ? signingIn : SIGNED_OUT),
      signIn: vi.fn(async () => { started = true; return signingIn }),
    })
    const panel = await mount(accountApi)

    const signIn = [...panel.querySelectorAll('button')]
      .find(button => button.textContent === zh.accountSignIn)
    expect(signIn).toBeDefined()

    await act(async () => { signIn!.click() })
    expect(accountApi.signIn).toHaveBeenCalledOnce()
    expect(panel.textContent).toContain(zh.accountUserCode)
  })

  it('renders yuan amounts, the owner facts, and one usage page', async () => {
    const accountApi = api({
      read: vi.fn(async () => SIGNED_IN),
      overview: vi.fn(async () => ({
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
      })),
      usage: vi.fn(async () => ({
        state: 'signed-in',
        page: 1,
        page_size: 20,
        total: 1,
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
      })),
    })
    const panel = await mount(accountApi)

    // 500000 quota is one yuan on this deployment.
    expect(panel.textContent).toContain('¥2.00')
    expect(panel.textContent).toContain('¥0.50')
    expect(panel.textContent).toContain('¥0.10')
    expect(panel.textContent).toContain('¥0.40')
    expect(panel.textContent).toContain('¥0.03')
    expect(panel.textContent).toContain('user@example.com')
    expect(panel.textContent).toContain('MacBook Pro')
    expect(panel.textContent).toContain('deepseek-v4-pro')
    expect(panel.textContent).toContain('9,774 / 94')
    expect(panel.textContent).toContain(translate('accountCenterUsageSeconds', { value0: 4 }))
    expect(panel.textContent).toContain(translate('accountCenterUsagePage', { value0: 1, value1: 1 }))

    const recharge = panel.querySelector(`a[href="${DESKTOP_CONSOLE_RECHARGE_URL}"]`)
    expect(recharge?.getAttribute('target')).toBe('_blank')
    expect(accountApi.usage).toHaveBeenCalledWith({ page: 1, page_size: 20 })
  })

  it('keeps the account signed in when an owner read fails', async () => {
    const accountApi = api({
      read: vi.fn(async () => SIGNED_IN),
      overview: vi.fn(async () => { throw new Error('offline') }),
      usage: vi.fn(async () => ({ state: 'signed-in', error: 'gateway-unreachable' })),
    })
    const panel = await mount(accountApi)

    expect(panel.textContent).toContain(zh.accountCenterOverviewFailed)
    expect(panel.textContent).toContain(zh.accountCenterUsageFailed)
    expect(panel.textContent).toContain('zenwit')
  })
})

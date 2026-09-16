// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, inject, NS } from '../src/client/index.js'
import { MarketPanel, MarketPanelIcon } from '../src/client/MarketPanel.js'
import { MarketSettingsTab } from '../src/client/MarketSettingsTab.js'
import { en, zh } from '../src/client/locales.js'

/** Slots this package registers into; every one must appear and roll back. */
const ENTRIES = ['sidebar.panellist', 'main', 'settings.plugins.tab'] as const

interface TestEntry {
  readonly component: unknown
  readonly inject?: (() => unknown) | undefined
  readonly locale?: string | undefined
  readonly options: Record<string, unknown>
}

interface Injection {
  readonly name: string
  readonly factory: () => () => void
  active?: (() => void) | undefined
}

function bench() {
  let locale = 'zh'
  const dictionaries = new Map<string, { zh: Record<string, string>; en: Record<string, string> }>()
  const declarations = new Set<string>()
  const entries = new Map<string, TestEntry[]>()
  const injections: Injection[] = []
  const effects: (() => void)[] = []

  const activate = (injection: Injection): void => {
    if (declarations.has(injection.name) && injection.active === undefined) injection.active = injection.factory()
  }
  const deactivate = (injection: Injection): void => {
    injection.active?.()
    injection.active = undefined
  }
  const slots = {
    inject(name: string, factory: () => () => void): void {
      const injection = { name, factory }
      injections.push(injection)
      activate(injection)
    },
    register(options: Record<string, unknown>, component: unknown): () => void {
      const name = String(options.name)
      const entry = {
        component,
        inject: options.inject as (() => unknown) | undefined,
        locale: options.locale as string | undefined,
        options,
      }
      const list = entries.get(name) ?? []
      list.push(entry)
      entries.set(name, list)
      return () => {
        const current = entries.get(name)
        if (current === undefined) return
        const index = current.indexOf(entry)
        if (index >= 0) current.splice(index, 1)
      }
    },
  }
  const localeService = {
    register(namespace: string, next: { zh: Record<string, string>; en: Record<string, string> }): () => void {
      dictionaries.set(namespace, next)
      return () => { dictionaries.delete(namespace) }
    },
    bind(namespace: string): (key: string) => string {
      return key => dictionaries.get(namespace)?.[locale as 'zh' | 'en'][key] ?? key
    },
    getLocale: () => ({ active: locale }),
  }
  const ctx = {
    locale: localeService,
    slots,
    effect(factory: () => void | (() => void)): void {
      const dispose = factory()
      if (dispose !== undefined) effects.push(dispose)
    },
  }

  return {
    apply: () => { apply(ctx as never) },
    declare(name: string): () => void {
      declarations.add(name)
      for (const injection of injections) activate(injection)
      return () => {
        declarations.delete(name)
        for (const injection of injections.filter(value => value.name === name)) deactivate(injection)
      }
    },
    dispose(): void {
      for (const injection of injections) deactivate(injection)
      for (const dispose of effects.reverse()) dispose()
    },
    entries: (name: string) => entries.get(name) ?? [],
    setLocale: (next: 'zh' | 'en') => { locale = next },
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { value: ['zh-CN'], configurable: true })
  Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
})

afterEach(() => {
  const own = navigator as unknown as Record<string, unknown>
  delete own.languages
  delete own.language
  vi.restoreAllMocks()
})

describe('community market browser plugin', () => {
  it('installs the unified market surface and modal size contract', () => {
    const b = bench()

    b.apply()

    const styles = document.querySelector<HTMLStyleElement>('style[data-plugin="dsh-community-market/styles"]')?.textContent ?? ''
    expect(styles).toMatch(/\.dshMarketWideModal\s*\{[^}]*width: min\(800px, calc\(100vw - 48px\)\)/su)
    expect(styles).toMatch(/\.dshMarketConfirmModal\s*\{[^}]*width: min\(600px, calc\(100vw - 48px\)\)/su)
    expect(styles).toMatch(/\.dshMarketSourceModal\s*\{[^}]*width: min\(600px, calc\(100vw - 48px\)\)/su)
    expect(styles).toMatch(/\.dshMarketStatusModal\s*\{[^}]*width: min\(480px, calc\(100vw - 48px\)\)/su)

    b.dispose()
  })

  it('registers one shared Market surface in the workbench panel and the official settings tab without fetching', () => {
    const b = bench()
    for (const name of ENTRIES) b.declare(name)
    const fetch = vi.spyOn(globalThis, 'fetch')

    b.apply()

    expect(inject).toEqual(['slots', 'locale'])
    const entry = b.entries('sidebar.panellist')
    const page = b.entries('main')
    const settings = b.entries('settings.plugins.tab')
    expect(entry).toHaveLength(1)
    expect(page).toHaveLength(1)
    expect(settings).toHaveLength(1)
    expect(entry[0]?.component).toBe(MarketPanelIcon)
    expect(page[0]?.component).toBe(MarketPanel)
    expect(settings[0]?.component).toBe(MarketSettingsTab)
    expect(entry[0]?.options).toMatchObject({ id: 'community-market', order: 10 })
    expect(page[0]?.options).toMatchObject({ key: 'community-market' })
    expect(settings[0]?.options).toMatchObject({ id: 'community-market', order: 20 })
    expect(entry[0]?.locale).toBe(NS)
    expect(settings[0]?.locale).toBe(NS)
    expect((entry[0]?.options.label as () => string)()).toBe(zh.tab)
    expect((settings[0]?.options.label as () => string)()).toBe(zh.tab)
    expect(fetch).not.toHaveBeenCalled()

    const settingsInject = settings[0]?.inject?.() as { readLocale: () => string }
    const pageInject = page[0]?.inject?.() as { readLocale: () => string }
    expect(settingsInject.readLocale()).toBe('zh')
    expect(pageInject.readLocale()).toBe('zh')
    b.setLocale('en')
    expect((entry[0]?.options.label as () => string)()).toBe(en.tab)
    expect((settings[0]?.options.label as () => string)()).toBe(en.tab)
    expect(settingsInject.readLocale()).toBe('en')

    b.dispose()
    for (const name of ENTRIES) expect(b.entries(name)).toHaveLength(0)
    expect(document.querySelector('style[data-plugin="dsh-community-market/styles"]')).toBeNull()
  })

  it('follows late declaration and declaration reload for every entry', () => {
    const b = bench()
    b.apply()
    for (const name of ENTRIES) expect(b.entries(name)).toHaveLength(0)

    const stops = ENTRIES.map(name => b.declare(name))
    for (const name of ENTRIES) expect(b.entries(name)).toHaveLength(1)
    for (const stop of stops) stop()
    for (const name of ENTRIES) expect(b.entries(name)).toHaveLength(0)

    for (const name of ENTRIES) b.declare(name)
    expect(b.entries('sidebar.panellist')[0]?.component).toBe(MarketPanelIcon)
    expect(b.entries('main')[0]?.component).toBe(MarketPanel)
    expect(b.entries('settings.plugins.tab')[0]?.component).toBe(MarketSettingsTab)

    b.dispose()
    for (const name of ENTRIES) expect(b.entries(name)).toHaveLength(0)
  })
})

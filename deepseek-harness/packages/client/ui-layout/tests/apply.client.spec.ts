// @vitest-environment jsdom

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderSlots, SlotRendererHost } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as themeApply, inject as themeInject, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply, inject, LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-layout'
import type { MainPanelId } from '../src/client/service.ts'

const owners = new Set<Fiber>()
let originalRootStyle: string | null
let originalBodyStyle: string | null
let originalDarkTheme: string | null
let originalThemeMetadata: Element[]

beforeEach(() => {
  originalRootStyle = document.documentElement.getAttribute('style')
  originalBodyStyle = document.body.getAttribute('style')
  originalDarkTheme = document.body.getAttribute('data-ds-dark-theme')
  originalThemeMetadata = [...document.head.querySelectorAll('meta[name="theme-color"]')]
  originalThemeMetadata.forEach((node) => { node.remove() })
  vi.stubGlobal('innerWidth', 1920)
})

afterEach(async () => {
  try {
    for (const owner of owners) await owner.dispose()
  } finally {
    owners.clear()
    restoreAttribute(document.documentElement, 'style', originalRootStyle)
    restoreAttribute(document.body, 'style', originalBodyStyle)
    restoreAttribute(document.body, 'data-ds-dark-theme', originalDarkTheme)
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((node) => { node.remove() })
    document.head.append(...originalThemeMetadata)
    vi.unstubAllGlobals()
  }
})

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

async function bench() {
  const root = new Context()
  let ctx: Context | undefined
  const owner = root.plugin((ownedContext: Context) => { ctx = ownedContext })
  owners.add(owner)
  await owner.await()
  if (ctx === undefined) throw new Error('the fixture owner did not activate')
  const slotsFiber = ctx.plugin(SlotRegistry)
  // Theme registers its Appearance settings row and requires the connection
  // seam for persistence; model this bench as a remote, memory-only browser.
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  // ui-theme's Appearance row binds a durable scope through these two.
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: themeInject, apply: themeApply }).await()
  await slotsFiber.await()
  const slots = ctx.get('slots') as SlotRegistry
  let host: SlotRendererHost | undefined
  slots.install({ renderRoot: (value) => { host = value; return null } })
  const rendererHost = (): SlotRendererHost => {
    slots.renderSlot('root', {})
    if (host === undefined) throw new Error('the root renderer did not receive its host')
    return host
  }
  return { ctx, slots, rendererHost }
}

describe('ui-layout client apply', () => {
  it('declares its service dependencies', () => {
    expect(inject).toEqual(['slots', 'theme'])
  })

  it('provides layout without registering a root or declaring visual seats', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(ctx.get('layout')).toBeInstanceOf(LayoutController)
    expect(slots.entries('root')).toHaveLength(0)
    for (const name of ['sidebar', 'main', 'rightbar', 'shell.overlay'] as const) {
      expect(slots.spec(name)).toBeUndefined()
    }
  })

  it('publishes panel selection independently of a root supplied later by the workbench', async () => {
    const { ctx, slots, rendererHost } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const layout = ctx.get('layout') as LayoutController
    expect(() => { layout.selectPanel('missing' as MainPanelId) }).toThrow('main panel "missing" is not registered')
    const disposeRoot = slots.register({
      name: 'root', children: { main: { kind: 'keyed', scope: 'root' } },
    }, ({ renderSlot }: PropsRenderSlots<'main'>) => renderSlot('main', {}, { entryKey: 'conversation' }))
    const host = rendererHost()
    const panelInfo = host.root.getSnapshot().hooks.panelInfo!
    expect(panelInfo.getSnapshot()).toEqual({ activePanelId: null })
    const notified = vi.fn()
    const unsubscribe = panelInfo.subscribe(notified)
    const panelId = 'panel-a' as MainPanelId
    const disposePanel = slots.register({ name: 'main', key: panelId }, () => null)
    layout.selectPanel(panelId)
    expect(panelInfo.getSnapshot()).toEqual({ activePanelId: panelId })
    expect(notified).toHaveBeenCalled()
    disposePanel()
    await vi.waitFor(() => { expect(panelInfo.getSnapshot()).toEqual({ activePanelId: null }) })
    expect(() => { layout.selectPanel(panelId) }).toThrow('main panel "panel-a" is not registered')
    const pending = layout.beginNavigation()
    await fiber.dispose()
    expect(pending.aborted).toBe(true)
    expect(ctx.get('layout')).toBeUndefined()
    expect(host.root.getSnapshot().hooks.panelInfo).toBeUndefined()
    expect(slots.entries('root')).toHaveLength(1)
    expect(slots.spec('main')).toEqual({ kind: 'keyed', scope: 'root' })
    unsubscribe()
    disposeRoot()
  })

  it('theme presenter applies the initial snapshot, follows theme/change, and unwinds on dispose', async () => {
    const { ctx } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    // Initial getter application: jsdom has no matchMedia, system resolves light.
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    const themeColorMeta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    expect(themeColorMeta).not.toBeNull()
    const theme = ctx.get('theme') as ThemeRuntime
    theme.setTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.head.querySelector('meta[name="theme-color"]')).toBe(themeColorMeta)
    await fiber.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(themeColorMeta?.isConnected).toBe(false)
    // Listener is off: further theme changes no longer reach the document.
    theme.setTheme('light')
    theme.setTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
  })
})

describe('node half', () => {
  it('node apply is an intentional no-op (loader-managed lifecycle only)', () => {
    nodeApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})

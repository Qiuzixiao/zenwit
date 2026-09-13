import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAdvancedShell } from '../src/client/advanced-shell.ts'
import { applyExtendedShell } from '../src/client/extended-shell.ts'

interface FakeStyleElement {
  id: string
  name: string
  textContent: string
  dataset: Record<string, string>
  isConnected: boolean
  content: string
  remove(): void
}

function stubDocument() {
  const byId = new Map<string, FakeStyleElement>()
  const dataset: Record<string, string | undefined> = {}
  const rootViewport = { id: 'root', dataset: {} as Record<string, string | undefined> }
  const fakeDocument = {
    getElementById: (id: string) => {
      if (id === 'root') return rootViewport
      return byId.get(id) ?? null
    },
    head: {
      appendChild(child: FakeStyleElement): void {
        byId.set(child.id, child)
      },
    },
    createElement: (_tag: string): FakeStyleElement => ({
      id: '',
      name: '',
      textContent: '',
      dataset: {},
      isConnected: true,
      content: '',
      remove() { byId.delete(this.id) },
    }),
    body: {
      dataset,
      style: { setProperty() {}, removeProperty() {} },
      setAttribute() {},
      removeAttribute() {},
    },
    documentElement: { style: { colorScheme: '', removeProperty() {}, setProperty() {} } },
  }
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(0, 0, 0)' }))
  return { byId, dataset }
}

function makeCtx() {
  return {
    reflect: { provide: vi.fn(), get: vi.fn() },
    // Cordis runs effect factories eagerly during the apply walk — mirror
    // that here so registration assertions observe real calls.
    effect: vi.fn((factory: () => unknown) => factory()),
    slots: {
      provideRoot: vi.fn((_props: unknown) => vi.fn()),
      subscribe: vi.fn((_name: string, _listener: () => void) => vi.fn()),
      entries: vi.fn(() => []),
      register: vi.fn(() => ({})),
      inject: vi.fn(),
    },
    theme: { getTheme: vi.fn(() => ({ active: { colorScheme: 'light', tokens: {} } })) },
    on: vi.fn(() => () => {}),
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('desktop chrome leaves the workbench owner intact', () => {
  it.each([
    ['advanced', applyAdvancedShell],
    ['extended', applyExtendedShell],
  ] as const)('%s never registers a root, layout service, panel hook, or theme presenter', (mode, applyShell) => {
    const { dataset, byId } = stubDocument()
    const ctx = makeCtx()
    const workbenchLayout = { owner: 'kernel' }
    ctx.reflect.get.mockReturnValue(workbenchLayout)

    applyShell(ctx as never, {
      mode, platform: 'win32', material: 'off', micaSupported: false, version: '2.0.2',
    })

    expect(ctx.reflect.get).not.toHaveBeenCalled()
    expect(ctx.reflect.provide).not.toHaveBeenCalled()
    expect(ctx.slots.register).not.toHaveBeenCalled()
    expect(ctx.slots.provideRoot).not.toHaveBeenCalled()
    expect(ctx.slots.subscribe).not.toHaveBeenCalled()
    expect(ctx.slots.inject).not.toHaveBeenCalled()
    expect(ctx.theme.getTheme).not.toHaveBeenCalled()
    expect(ctx.on).not.toHaveBeenCalled()
    expect(dataset).toMatchObject({ dshDesktopMode: mode, dshDesktopPlatform: 'win32', dshDesktopMaterial: 'off' })
    const css = [...byId.values()].map(style => style.textContent).join('\n')
    expect(css).not.toMatch(/dshDesktop(?:Sidebar|Conversation|Rightbar|ResizeHandle|UpstreamSidebar)/)
    if (mode === 'advanced') {
      expect(css).toContain('inset: var(--dsh-desktop-caption-height) 0 0')
      expect(css).toContain('-webkit-app-region: drag')
      expect(css).toContain('--dsh-desktop-caption-left: 80px')
      expect(css).toContain('--dsh-desktop-caption-right: 138px')
      expect(css).toContain('html:has([aria-modal="true"])')
    }
    for (const result of ctx.effect.mock.results) (result.value as () => void)()
    expect(dataset).toEqual({})
    expect(byId.size).toBe(0)
  })

  it.each([
    ['advanced', applyExtendedShell],
    ['extended', applyAdvancedShell],
  ] as const)('rejects a mismatched %s mode before installing effects', (mode, applyShell) => {
    const ctx = makeCtx()
    expect(() => applyShell(ctx as never, {
      mode, platform: 'win32', material: 'off', micaSupported: false, version: '2.0.2',
    })).toThrow('shell received mode')
    expect(ctx.effect).not.toHaveBeenCalled()
  })
})

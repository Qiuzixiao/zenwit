import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { parseDesktopClientEnvironment } from '../src/client/environment.ts'
import { applyFramedShell } from '../src/client/extended-shell.ts'
import { installExtendedStyles } from '../src/client/extended-styles.ts'
import { desktopWindowService, provideDesktopWindow } from '../src/client/window-service.ts'
import {
  ADVANCED_MACOS_DRAG_REGION_HEIGHT,
  ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
  DESKTOP_FRAME_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
} from '../src/window-chrome.ts'

describe('desktop client environment', () => {
  it.each(['darwin', 'win32', 'linux'])('keeps compatibility chrome out of the %s client slot tree', platform => {
    const marker = platform === 'win32' ? '&dsh-desktop-mica=0' : ''
    vi.stubGlobal('window', { location: {
      search: `?dsh-desktop-platform=${platform}&dsh-desktop-mode=compatibility&dsh-desktop-version=2.0.3&dsh-desktop-material=off${marker}`,
    } })
    const effect = vi.fn()
    const inject = vi.fn()
    const ctx = {
      effect,
      slots: { inject },
      locale: { bind: () => (key: string) => key },
      settingsScope: { bind: () => ({}) },
    } as unknown as ClientContext
    try {
      apply(ctx)
      expect(inject.mock.calls.map(([name]) => name)).toEqual(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark', 'settings.section', 'settings.action', 'settings.section', 'main', 'sidebar.panellist'])
      expect(effect.mock.calls.map(([, label]) => label)).not.toContain('desktop: independent compatibility frame styles')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not activate desktop effects for an ordinary browser URL', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const effect = vi.fn()

    try {
      expect(parseDesktopClientEnvironment('')).toBeUndefined()
      const inject = vi.fn()
      apply({ effect, slots: { inject } } as unknown as ClientContext)
      expect(inject.mock.calls.map(([name]) => name)).toEqual(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'])
      expect(effect).not.toHaveBeenCalled()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts the Electron-owned kebab query markers', () => {
    expect(parseDesktopClientEnvironment('?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.3&dsh-desktop-material=transparent'))
      .toEqual({ version: '2.0.3', mode: 'advanced', platform: 'darwin', material: 'transparent', micaSupported: false })
    expect(parseDesktopClientEnvironment('?dsh-desktop-platform=win32&dsh-desktop-mode=compatibility&dsh-desktop-version=2.0.3&dsh-desktop-material=off&dsh-desktop-mica=0'))
      .toEqual({ version: '2.0.3', mode: 'compatibility', platform: 'win32', material: 'off', micaSupported: false })
    expect(parseDesktopClientEnvironment('?dsh-desktop-mode=extended&dsh-desktop-platform=win32&dsh-desktop-version=2.0.3&dsh-desktop-material=mica&dsh-desktop-mica=1'))
      .toEqual({ version: '2.0.3', mode: 'extended', platform: 'win32', material: 'mica', micaSupported: true })
    expect(parseDesktopClientEnvironment('?dsh-desktop-mode=extended&dsh-desktop-platform=win32&dsh-desktop-version=2.0.3&dsh-desktop-material=acrylic&dsh-desktop-mica=0'))
      .toEqual({ version: '2.0.3', mode: 'extended', platform: 'win32', material: 'off', micaSupported: false })
  })

  it.each([
    ['?dsh-desktop-mode=glass&dsh-desktop-platform=darwin', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=advanced', 'dsh-desktop-platform'],
    ['?dsh-desktop-platform=darwin', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=android', 'dsh-desktop-platform'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin', 'dsh-desktop-material'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin&dsh-desktop-material=off', 'dsh-desktop-version'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=win32&dsh-desktop-version=2.0.3&dsh-desktop-material=mica&dsh-desktop-mica=0', 'incompatible'],
  ])('fails loud for malformed marker %s', (search, field) => {
    expect(() => parseDesktopClientEnvironment(search)).toThrow(field)
  })
})

describe('desktop native window', () => {
  it('reports generation-stable safe areas and drag geometry to client plugins', () => {
    expect(desktopWindowService({
      version: '2.0.3', mode: 'compatibility', platform: 'darwin', material: 'off', micaSupported: false,
    })).toEqual({
      version: '2.0.3',
      mode: 'compatibility',
      platform: 'darwin',
      material: 'off',
      micaSupported: false,
      availableMaterials: ['off', 'transparent'],
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: 0,
        leftInset: 0,
        rightInset: 0,
      },
    })
    const mac = desktopWindowService({
      version: '2.0.3', mode: 'advanced', platform: 'darwin', material: 'transparent', micaSupported: false,
    })
    expect(mac).toEqual({
      version: '2.0.3',
      mode: 'advanced',
      platform: 'darwin',
      material: 'transparent',
      micaSupported: false,
      availableMaterials: ['off', 'transparent'],
      safeAreaInsets: { top: ADVANCED_MACOS_DRAG_REGION_HEIGHT, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: ADVANCED_MACOS_DRAG_REGION_HEIGHT,
        leftInset: MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
        rightInset: 0,
      },
    })
    expect(Object.isFrozen(mac)).toBe(true)
    expect(Object.isFrozen(mac.safeAreaInsets)).toBe(true)
    expect(Object.isFrozen(mac.dragRegion)).toBe(true)
    expect(desktopWindowService({
      version: '2.0.3', mode: 'advanced', platform: 'win32', material: 'off', micaSupported: false,
    })).toEqual({
      version: '2.0.3',
      mode: 'advanced',
      platform: 'win32',
      material: 'off',
      micaSupported: false,
      availableMaterials: ['off'],
      safeAreaInsets: { top: ADVANCED_WINDOWS_TITLEBAR_HEIGHT, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
        leftInset: 0,
        rightInset: WINDOWS_CAPTION_CONTROLS_WIDTH,
      },
    })
    expect(desktopWindowService({
      version: '2.0.3', mode: 'extended', platform: 'win32', material: 'mica', micaSupported: true,
    })).toEqual({
      version: '2.0.3',
      mode: 'extended',
      platform: 'win32',
      material: 'mica',
      micaSupported: true,
      availableMaterials: ['off', 'mica'],
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: 0,
        leftInset: 0,
        rightInset: 0,
      },
    })

    let disposed = false
    const ctx = {
      reflect: {
        provide: (name: string, value: unknown) => {
          expect(name).toBe('desktopWindow')
          expect(value).toBe(mac)
          return () => { disposed = true }
        },
      },
    } as unknown as ClientContext
    const dispose = provideDesktopWindow(ctx, mac)
    expect(disposed).toBe(false)
    dispose()
    expect(disposed).toBe(true)
  })

})

describe('independent Desktop frame', () => {
  it('fills the native content viewport and preserves native titlebar controls', () => {
    let css = ''
    const remove = vi.fn()
    const style = {
      dataset: {},
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installExtendedStyles()
      expect(css).toContain(`--dsh-desktop-frame-height: 0px`)
      expect(DESKTOP_FRAME_HEIGHT).toBe(36)
      expect(css).toMatch(/#root \{[^}]*position: fixed;[^}]*right: 0;[^}]*bottom: 0;[^}]*left: 0;[^}]*padding-top: 0;[^}]*transform: translateZ\(0\);/)
      expect(css).toContain('body:is([data-dsh-desktop-mode="compatibility"], [data-dsh-desktop-mode="extended"]) #root')
      expect(css).toMatch(/\.dshDesktopFrameTitlebar \{[^}]*-webkit-app-region: drag;/)
      expect(css).toMatch(/\.dshDesktopFrameTitlebar \{[^}]*z-index: 2147483647;/)
      expect(css).toMatch(/\.dshDesktopFrameIdentity \{[^}]*left: 50%;[^}]*transform: translateX\(-50%\);/)
      expect(css).toMatch(/\.dshDesktopFrameActions \{[^}]*-webkit-app-region: no-drag;/)
      expect(css).toContain('[data-platform="darwin"] .dshDesktopFrameActions { margin-left: auto; }')
      expect(css).toContain('[data-platform="win32"] .dshDesktopFrameActions { margin-right: auto; }')
      expect(css).toMatch(/\.dshDesktopTitlebarIconButton \{[^}]*-webkit-app-region: no-drag;/)
      expect(css).toMatch(/\.dshDesktopTitlebarIconButton \{[^}]*width: 26px;[^}]*height: 26px;[^}]*border-radius: 7px;/)
      expect(css).toMatch(/\.dshDesktopTitlebarIconButton svg,[^}]*width: 14px;[^}]*height: 14px;/)
      expect(css).toContain('.dshDesktopActionMenu')
      expect(css).toContain(`padding: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH + 8}px 0 8px`)
      expect(css).toContain(`padding: 0 8px 0 ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH + 8}px`)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not expose a plugin action seat in compatibility mode', () => {
    const registrations: Array<Record<string, unknown>> = []
    const injectedSlots: string[] = []
    const disposers: Array<() => void> = []
    const dataset: Record<string, string> = {}
    const rootDataset: Record<string, string> = {}
    vi.stubGlobal('document', {
      body: { dataset },
      getElementById: (id: string) => id === 'root' ? { dataset: rootDataset } : null,
      createElement: () => ({ dataset: {}, id: '', remove: vi.fn(), textContent: '' }),
      head: { appendChild: vi.fn() },
    })
    const ctx = {
      effect: vi.fn((mount: () => void | (() => void)) => {
        const dispose = mount()
        if (typeof dispose === 'function') disposers.push(dispose)
      }),
      slots: {
        inject: vi.fn((name: string, mount: () => unknown) => {
          injectedSlots.push(name)
          return mount()
        }),
        register: vi.fn((options: Record<string, unknown>) => {
          registrations.push(options)
          return () => {}
        }),
      },
    } as unknown as ClientContext

    try {
      applyFramedShell(ctx, {
        version: '2.0.3',
        mode: 'compatibility',
        platform: 'darwin',
        material: 'transparent',
        micaSupported: false,
      })
      expect(injectedSlots).toEqual([])
      expect(registrations).toHaveLength(0)
      expect(JSON.stringify(registrations)).not.toContain('desktop.titlebar.action')
      expect(dataset).toMatchObject({
        dshDesktopMode: 'compatibility',
        dshDesktopPlatform: 'darwin',
        dshDesktopMaterial: 'transparent',
      })
      disposers.forEach(dispose => { dispose() })
      expect(dataset).toEqual({})
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

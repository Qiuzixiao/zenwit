// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

vi.mock('../src/client/WorkbenchFrame.tsx', () => ({ WorkbenchFrame: () => null }))

/** Minimal EventSource double: records the stream and lets a test drive messages. */
class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  onmessage: (() => void) | undefined
  closed = false
  constructor(readonly url: string) { FakeEventSource.instances.push(this) }
  close(): void { this.closed = true }
}

describe('standalone workbench registration', () => {
  it('owns one root and removes its slots, file service, and reference source on teardown', async () => {
    const root = new Context()
    const slotsFiber = root.plugin(SlotRegistry)
    await slotsFiber.await()
    root.provide('locale', new LocaleRuntime(root))
    const sourceDispose = vi.fn()
    root.provide('inputTriggers', { registerSource: () => sourceDispose } as never)
    root.provide('sessions', { list: createSnapshotStore({ phase: 'ready', current: 'session', byId: { session: { cwd: '/project' } } }) } as never)
    root.provide('workspaces', {} as never)
    root.provide('uiWorkspace', { navigation: createSnapshotStore(0), pendingActions: createSnapshotStore([]) } as never)
    root.provide('conversation', {} as never)
    const selectPanel = vi.fn()
    root.provide('layout', { selectPanel } as never)
    const fiber = root.plugin({ inject, apply })
    try {
      await fiber.await()
      const slots = root.get('slots')!
      expect(slots.entries('root')).toHaveLength(1)
      for (const name of ['main', 'sidebar.settings', 'sidebar.panellist', 'shell.overlay'] as const) expect(slots.spec(name)).toBeDefined()
      for (const name of ['sidebar.footer.action', 'sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow'] as const) expect(slots.spec(name)).toBeDefined()
      expect(slots.spec('rightbar')).toBeUndefined()
      root.get('workbenchFiles')!.openFile('notes.md', 3)
      expect(selectPanel).toHaveBeenCalledWith(null)
      expect(() => root.get('workbenchFiles')!.openFile('../outside.md')).toThrow('outside the active project')
      expect(root.get('documentRenderers')!.describe('/project/a.md').views).toEqual(['source'])
      await fiber.dispose()
      expect(slots.entries('root')).toHaveLength(0)
      for (const name of ['main', 'sidebar.settings', 'sidebar.panellist', 'shell.overlay'] as const) expect(slots.spec(name)).toBeUndefined()
      expect(root.get('workbenchFiles')).toBeUndefined()
      expect(root.get('documentRenderers')).toBeUndefined()
      expect(sourceDispose).toHaveBeenCalledOnce()
    } finally {
      await fiber.dispose()
      await slotsFiber.dispose()
    }
  })

  it('collapses a burst of project changes into one revision bump per window', async () => {
    vi.useFakeTimers()
    FakeEventSource.instances.length = 0
    vi.stubGlobal('EventSource', FakeEventSource)
    const root = new Context()
    const slotsFiber = root.plugin(SlotRegistry)
    await slotsFiber.await()
    root.provide('locale', new LocaleRuntime(root))
    root.provide('inputTriggers', { registerSource: () => () => {} } as never)
    root.provide('sessions', { list: createSnapshotStore({ phase: 'ready', current: 'session', byId: { session: { cwd: '/project' } } }) } as never)
    root.provide('workspaces', {} as never)
    root.provide('uiWorkspace', { navigation: createSnapshotStore(0), pendingActions: createSnapshotStore([]) } as never)
    root.provide('conversation', {} as never)
    root.provide('layout', { selectPanel: vi.fn() } as never)
    const fiber = root.plugin({ inject, apply })
    try {
      await fiber.await()
      const entry = root.get('slots')!.entries('root')[0]!
      const injected = entry.inject!() as unknown as { hooks: { fileRevision: { subscribe(fn: () => void): () => void } } }
      let bumps = 0
      const off = injected.hooks.fileRevision.subscribe(() => { bumps += 1 })
      const source = FakeEventSource.instances[0]!
      expect(source.url).toContain('/api/desktop/projects/changes?path=%2Fproject')
      for (let index = 0; index < 5; index += 1) source.onmessage!()
      expect(bumps).toBe(0)
      vi.advanceTimersByTime(249)
      expect(bumps).toBe(0)
      vi.advanceTimersByTime(1)
      expect(bumps).toBe(1)
      source.onmessage!()
      await fiber.dispose()
      vi.advanceTimersByTime(1_000)
      expect(bumps).toBe(1)
      expect(source.closed).toBe(true)
      off()
    } finally {
      await fiber.dispose()
      await slotsFiber.dispose()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

vi.mock('../src/client/WorkbenchFrame.tsx', () => ({ WorkbenchFrame: () => null }))

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
      await fiber.dispose()
      expect(slots.entries('root')).toHaveLength(0)
      for (const name of ['main', 'sidebar.settings', 'sidebar.panellist', 'shell.overlay'] as const) expect(slots.spec(name)).toBeUndefined()
      expect(root.get('workbenchFiles')).toBeUndefined()
      expect(sourceDispose).toHaveBeenCalledOnce()
    } finally {
      await fiber.dispose()
      await slotsFiber.dispose()
    }
  })
})

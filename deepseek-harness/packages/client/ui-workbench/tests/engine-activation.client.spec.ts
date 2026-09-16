// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'

vi.mock('../src/client/WorkbenchFrame.tsx', () => ({ WorkbenchFrame: () => null }))

/** One root context with the services this package declares. */
async function rootContext() {
  const root = new Context()
  const slotsFiber = root.plugin(SlotRegistry)
  await slotsFiber.await()
  root.provide('locale', new LocaleRuntime(root))
  root.provide('inputTriggers', { registerSource: () => () => undefined } as never)
  root.provide('sessions', { list: createSnapshotStore({ phase: 'ready', current: 'session', byId: { session: { cwd: '/project' } } }) } as never)
  root.provide('workspaces', {} as never)
  root.provide('uiWorkspace', { navigation: createSnapshotStore(0), pendingActions: createSnapshotStore([]) } as never)
  root.provide('conversation', {} as never)
  root.provide('layout', { selectPanel: () => undefined } as never)
  root.provide('modules', { import: async () => ({}) } as never)
  return { root, slotsFiber }
}

describe('workbench engine activation', () => {
  it('provides the engine service and routes chat file links into its editor', async () => {
    const { root, slotsFiber } = await rootContext()
    const fiber = root.plugin({ inject, apply })
    try {
      await fiber.await()
      const engine = root.get('workbenchEngine') as {
        getTabs(): readonly { id: string }[]
        registerTab(descriptor: unknown): () => void
        version: string
      } | undefined
      expect(engine).toBeDefined()
      expect(engine!.version.length).toBeGreaterThan(0)

      // The file-link path routes into the engine and must not throw;
      // the engine"s own suites cover where the tab lands.
      expect(() => root.get('workbenchFiles')!.openFile('notes.md', 3)).not.toThrow()
      // The engine"s registry face is live: a registration lands and disposes.
      const disposeTab = engine!.registerTab({ id: 'test:tab', type: 'test:tab', title: 'Test', component: () => null } as never)
      expect(engine!.getTabs().some(tab => tab.id === 'test:tab')).toBe(true)
      disposeTab()
      expect(engine!.getTabs().some(tab => tab.id === 'test:tab')).toBe(false)
    } finally {
      await fiber.dispose()
      await slotsFiber.dispose()
    }
    expect(root.get('workbenchEngine')).toBeUndefined()
  })
})

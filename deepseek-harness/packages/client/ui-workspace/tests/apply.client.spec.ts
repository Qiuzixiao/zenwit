import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SlotRendererHost } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { UiWorkspaceService } from '../src/client/navigation.ts'
import { apply as hostApply } from '../src/index.ts'

describe('ui-workspace adapter', () => {
  it('requires navigation services without requiring locale or a visual shell', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'remote', 'remote.directoryPicker', 'layout'])
    expect(hostApply).not.toThrow()
  })

  it('publishes the live Workspace source and unwinds it without owning visual seats', async () => {
    const ctx = new Context()
    const registry = ctx.plugin(SlotRegistry)
    await registry.await()
    const list = createSnapshotStore<WorkspaceSnapshot>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })
    ctx.provide('workspaces', { list } as never)
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} },
    } as never)
    ctx.provide('layout', { beginNavigation: () => new AbortController().signal } as never)
    const directoryPicker = { pick: vi.fn() }
    Object.assign(new TestRemote(ctx), { directoryPicker })
    ctx.provide('remote.directoryPicker', directoryPicker as never)
    const slots = ctx.get('slots') as SlotRegistry
    let host: SlotRendererHost | undefined
    slots.install({ renderRoot: (value) => { host = value; return null } })
    const fiber = ctx.plugin({ inject, apply })
    let removeRoot: (() => void) | undefined
    try {
      await fiber.await()
      expect(ctx.get('uiWorkspace')).toBeInstanceOf(UiWorkspaceService)
      expect(slots.entries('root')).toHaveLength(0)
      for (const name of ['sidebar.workspaces', 'conversation.hero.workspace',
        'sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow'] as const) {
        expect(slots.entries(name)).toHaveLength(0)
        expect(slots.spec(name)).toBeUndefined()
      }
      removeRoot = slots.register({ name: 'root' }, () => null)
      slots.renderSlot('root', {})
      if (host === undefined) throw new Error('the root renderer did not receive its host')
      const source = host.root.getSnapshot().hooks.workspaces!
      expect(source).toBe(list)
      const notified = vi.fn()
      const unsubscribe = source.subscribe(notified)
      list.set({ ...list.getSnapshot(), phase: 'pending', state: 'loading' })
      expect(source.getSnapshot()).toBe(list.getSnapshot())
      expect(notified).toHaveBeenCalledOnce()
      unsubscribe()
      await fiber.dispose()
      expect(ctx.get('uiWorkspace')).toBeUndefined()
      expect(host.root.getSnapshot().hooks.workspaces).toBeUndefined()
      expect(slots.entries('root')).toHaveLength(1)
    } finally {
      await fiber.dispose()
      removeRoot?.()
      await registry.dispose()
    }
  })
})

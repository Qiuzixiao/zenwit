/** Contract-only sidebar entry must leave visual ownership to the workbench. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SidebarSettingsOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as hostApply } from '../src/index.ts'

describe('ui-sidebar contracts', () => {
  it('retains the settings owner contract', () => {
    expectTypeOf<PropsRuntime<'sidebar.settings'>>().toExtend<SidebarSettingsOwnerProps>()
    expectTypeOf<SidebarSettingsOwnerProps['wide']>().toEqualTypeOf<boolean>()
    expect(hostApply).not.toThrow()
    expect(inject).toEqual([])
  })

  it('leaves workbench settings and panel seats intact across its lifecycle', async () => {
    const ctx = new Context()
    const registry = ctx.plugin(SlotRegistry)
    await registry.await()
    const root = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
      },
    }, ({ renderSlot }: PropsRenderSlots<'sidebar.settings' | 'sidebar.panellist'>) => <>
      {renderSlot('sidebar.settings', { wide: true })}
      {renderSlot('sidebar.panellist', { size: 16, active: false })}
    </>)
    const fiber = ctx.plugin({ inject, apply })
    try {
      await fiber.await()
      expect(ctx.slots.entries('root')).toHaveLength(1)
      expect(ctx.slots.entries('sidebar')).toHaveLength(0)
      expect(ctx.slots.spec('sidebar.workspaces')).toBeUndefined()
      await fiber.dispose()
      expect(ctx.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
      expect(ctx.slots.spec('sidebar.panellist')).toEqual({ kind: 'list', scope: 'root' })
      expect(ctx.slots.entries('root')).toHaveLength(1)
    } finally {
      await fiber.dispose()
      root()
      await registry.dispose()
    }
  })
})

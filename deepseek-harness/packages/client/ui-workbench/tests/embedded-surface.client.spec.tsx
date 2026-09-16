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

/** Activate the plugin and collect the engine's public face. */
async function activate() {
  const { root, slotsFiber } = await rootContext()
  const fiber = root.plugin({ inject, apply })
  await fiber.await()
  const engine = root.get('workbenchEngine')
  if (engine === undefined) throw new Error('the engine service is not provided')
  return { engine, fiber, slotsFiber }
}

/** Wait for the engine's (async) boot decision, mount and region handoff. */
async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
}

/** The region element the product shell renders for the workspace column. */
function makeRegion(): HTMLElement {
  const region = document.createElement('div')
  region.setAttribute('data-zenwit-workbench-surface', '')
  document.body.appendChild(region)
  return region
}

describe('the workbench region handoff', () => {
  it('renders inside the region the shell hands over', async () => {
    const region = makeRegion()
    const { engine, fiber, slotsFiber } = await activate()
    try {
      engine.attachRegion(region)
      await waitFor(() => region.querySelector('[data-dsh-panel-host]') !== null)
      const workbench = region.querySelector('[data-dsh-panel-host]') as HTMLElement | null
      expect(workbench).not.toBeNull()
      // It fills the region: no viewport geometry, no collapse state.
      expect(workbench!.getAttribute('style')).toBeNull()
    } finally {
      await fiber.dispose()
      await slotsFiber.dispose()
      region.remove()
    }
  })

  it('stays out of the document while the shell has no region', async () => {
    const { engine, fiber, slotsFiber } = await activate()
    try {
      await waitFor(() => document.querySelector('[data-zenwit-workbench]') !== null)
      // No region handed over: the host exists but is not in the page.
      expect(document.body.querySelector('[data-zenwit-workbench]')).toBeNull()
      const region = makeRegion()
      engine.attachRegion(region)
      await waitFor(() => region.querySelector('[data-dsh-panel-host]') !== null)
      expect(region.querySelector('[data-dsh-panel-host]')).not.toBeNull()
      // Handing the region back takes the workbench out of the page again,
      // keeping its state (the React tree stays mounted).
      engine.attachRegion(null)
      await waitFor(() => region.querySelector('[data-dsh-panel-host]') === null)
      expect(document.querySelector('[data-dsh-panel-host]')).toBeNull()
      region.remove()
    } finally {
      await fiber.dispose()
      await slotsFiber.dispose()
    }
  })
})

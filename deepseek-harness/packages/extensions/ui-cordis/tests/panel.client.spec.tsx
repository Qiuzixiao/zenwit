// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId, DynamicCordisInventoryRow,
} from '../src/client/events.ts'
import { CordisPanel, type CordisPanelProps } from '../src/client/CordisPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const PLUGIN = 'clock-1' as CordisDynamicPluginId
const PACKAGE = 'pkg-1' as CordisDynamicPackageId
const RUN = 'run-1' as CordisDynamicPluginRunId

/** One Host-running plugin whose package carries no Client half. */
const runningRow: DynamicCordisInventoryRow = {
  pluginId: PLUGIN,
  agentId: 'session' as DynamicCordisInventoryRow['agentId'],
  packages: [{ packageId: PACKAGE, name: 'Clock', purpose: 'show time', hasHostHalf: true, hasClientHalf: false }],
  currentPackageId: PACKAGE,
  activeRun: { packageId: PACKAGE, pluginRunId: RUN },
}

const approval = {
  phase: 'awaiting-approval', requestId: 'request', agentId: 'session',
  packageId: PACKAGE, mode: 'run', name: 'Clock', purpose: 'show time',
}

/** Panel props over one live state; every hook reads what the seat derives from. */
function panelProps(
  state: { wide: boolean; rows?: DynamicCordisInventoryRow[]; active?: Map<unknown, unknown> },
  approve = vi.fn().mockResolvedValue(undefined),
): CordisPanelProps {
  return {
    wide: state.wide,
    useInventory: (select: (v: unknown) => unknown) => select({ rows: state.rows ?? [], read: true }),
    useActiveRuns: (select: (v: unknown) => unknown) => select(state.active ?? new Map()),
    useRunErrors: (select: (v: unknown) => unknown) => select(new Map()),
    useLoaded: (select: (v: unknown) => unknown) => select([]),
    useRenderFailures: (select: (v: unknown) => unknown) => select(new Map()),
    useSessions: (select: (v: unknown) => unknown) => select({ current: 'session' }),
    usePanelRequest: (select: (v: unknown) => unknown) => select(0),
    onRefresh: vi.fn(), onApprove: approve,
    t: (key: keyof typeof en, params?: Record<string, unknown>) =>
      (en[key] as string).replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? `{${name}}`)),
  } as unknown as CordisPanelProps
}

it('keeps the plugin entry visible when empty and dispatches a pending approval exactly once', async () => {
  let active = new Map()
  let panelRequest = 0
  const approve = vi.fn().mockResolvedValue(undefined)
  const props = {
    ...panelProps({ wide: true }),
    useActiveRuns: (select: (v: unknown) => unknown) => select(active),
    usePanelRequest: (select: (v: unknown) => unknown) => select(panelRequest),
    onApprove: approve,
  } as CordisPanelProps
  const view = render(<CordisPanel {...props} />)
  expect(screen.getByRole('button', { name: 'Dynamic plugins' })).toBeTruthy()
  active = new Map([['media-1', { phase: 'awaiting-approval', requestId: 'request', agentId: 'session', packageId: 'pkg-2', mode: 'run', name: 'Media', purpose: 'Preview' }]])
  panelRequest++
  view.rerender(<CordisPanel {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Allow this version only' }))
  expect(approve).toHaveBeenCalledExactlyOnceWith('request', false)
})

it('collapses the running count into a corner dot in the narrow chrome seat', () => {
  const view = render(<CordisPanel {...panelProps({ wide: false, rows: [runningRow] })} />)
  const seat = screen.getByRole('button', { name: 'Dynamic plugins · 1 running, 0 awaiting approval' })
  expect(seat.querySelector('[data-state="running"]')).toBeTruthy()

  // A plugin waiting for approval outranks one that merely runs.
  view.rerender(<CordisPanel {...panelProps({ wide: false, rows: [runningRow], active: new Map([[PLUGIN, approval]]) })} />)
  const waiting = screen.getByRole('button', { name: 'Dynamic plugins · 0 running, 1 awaiting approval' })
  expect(waiting.querySelector('[data-state="approvals"]')).toBeTruthy()

  // Nothing runs and nothing waits: the seat stays a bare glyph.
  view.rerender(<CordisPanel {...panelProps({ wide: false })} />)
  const idle = screen.getByRole('button', { name: 'Dynamic plugins · 0 running, 0 awaiting approval' })
  expect(idle.querySelector('[data-state]')).toBeNull()
  expect(idle.textContent).not.toContain('running')
})

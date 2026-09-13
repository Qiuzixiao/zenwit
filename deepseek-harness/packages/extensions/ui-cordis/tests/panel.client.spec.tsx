// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CordisPanel, type CordisPanelProps } from '../src/client/CordisPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
it('keeps the plugin entry visible when empty and dispatches a pending approval exactly once', async () => {
  let active = new Map()
  let panelRequest = 0
  const approve = vi.fn().mockResolvedValue(undefined)
  const props = {
    wide: true,
    useInventory: (select: (v: unknown) => unknown) => select({ rows: [], read: true }),
    useActiveRuns: (select: (v: unknown) => unknown) => select(active),
    useRunErrors: (select: (v: unknown) => unknown) => select(new Map()),
    useLoaded: (select: (v: unknown) => unknown) => select([]),
    useRenderFailures: (select: (v: unknown) => unknown) => select(new Map()),
    useSessions: (select: (v: unknown) => unknown) => select({ current: 'session' }),
    usePanelRequest: (select: (v: unknown) => unknown) => select(panelRequest),
    onRefresh: vi.fn(), onApprove: approve,
    t: (key: keyof typeof en) => en[key],
  } as unknown as CordisPanelProps
  const view = render(<CordisPanel {...props} />)
  expect(screen.getByRole('button', { name: 'Cordis plugins' })).toBeTruthy()
  active = new Map([['media-1', { phase: 'awaiting-approval', requestId: 'request', agentId: 'session', packageId: 'pkg-2', mode: 'run', name: 'Media', purpose: 'Preview' }]])
  panelRequest++
  view.rerender(<CordisPanel {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Allow this version only' }))
  expect(approve).toHaveBeenCalledExactlyOnceWith('request', false)
})

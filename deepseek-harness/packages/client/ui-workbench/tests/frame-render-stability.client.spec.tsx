// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCallback, useEffect } from 'react'
import type { WorkspaceProps } from '../src/client/Workspace.tsx'
import { WorkbenchFrame } from '../src/client/WorkbenchFrame.tsx'
import type { WorkbenchProps } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'

/** Captured Workspace props, newest last, and how often the close request re-registered. */
const seen: WorkspaceProps[] = []
let registrations = 0
vi.mock('../src/client/Workspace.tsx', () => ({
  Workspace: (props: WorkspaceProps) => {
    seen.push(props)
    // Mirrors the real Workspace registration effect: it re-runs whenever the
    // callback identity moves, which is exactly how the render loop started.
    const requestClose = useCallback(() => {}, [props.closeProject])
    useEffect(() => {
      registrations += 1
      return props.registerCloseRequest?.(requestClose)
    }, [props.registerCloseRequest, requestClose])
    return <div>Project workspace</div>
  },
}))
afterEach(() => { seen.length = 0; registrations = 0; sessionStorage.clear() })

it('keeps the workspace close callback and its registration stable across renders', () => {
  sessionStorage.setItem('zenwit.workbench.surface', 'workspace')
  let navigation = 0
  const props = {
    t: (key: keyof typeof en) => String(en[key] ?? key), api: {},
    useSessions: (select: (v: unknown) => unknown) => select({ phase: 'ready', current: 's1', byId: { s1: { cwd: '/p' } } }),
    useWorkspaces: (select: (v: unknown) => unknown) => select({ phase: 'ready', items: [], archivedSessionIds: [] }),
    usePanelInfo: (select: (v: unknown) => unknown) => select({ activePanelId: null }),
    usePanels: (select: (v: unknown) => unknown) => select([]),
    useFileRequest: (select: (v: unknown) => unknown) => select(null),
    useFileRevision: (select: (v: unknown) => unknown) => select(0),
    useNavigation: (select: (v: unknown) => unknown) => select(navigation),
    useSessionPendingInteraction: (select: (v: unknown) => unknown) => select(new Map()),
    usePendingActions: (select: (v: unknown) => unknown) => select([]),
    renderSlot: () => <div />,
  } as unknown as WorkbenchProps
  const view = render(<WorkbenchFrame {...props} />)
  const first = seen.at(-1)?.closeProject
  const firstRegistrations = registrations
  navigation += 1
  view.rerender(<WorkbenchFrame {...props} />)
  navigation += 1
  view.rerender(<WorkbenchFrame {...props} />)
  expect(seen.at(-1)?.closeProject).toBe(first)
  expect(registrations).toBeGreaterThan(0)
  expect(registrations).toBeLessThanOrEqual(firstRegistrations)
})

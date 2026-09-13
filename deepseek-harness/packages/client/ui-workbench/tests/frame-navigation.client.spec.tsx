// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchFrame } from '../src/client/WorkbenchFrame.tsx'
import type { WorkbenchProps } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'

vi.mock('../src/client/Workspace.tsx', () => ({ Workspace: () => <div>Project workspace</div> }))
vi.mock('../src/client/HomePage.tsx', () => ({ HomePage: () => <div>Project home</div> }))
afterEach(() => { cleanup(); sessionStorage.clear() })
it('foreground navigation opens the workbench while background session changes keep home visible', () => {
  let revision = 0
  let current = 'first'
  const props = {
    t: (key: keyof typeof en) => en[key], api: {},
    useSessions: (select: (value: unknown) => unknown) => select({ phase: 'ready', current, byId: { first: { cwd: '/one' }, creator: { cwd: '/two' } } }),
    useWorkspaces: (select: (value: unknown) => unknown) => select({ phase: 'ready', items: [] }),
    usePanelInfo: (select: (value: unknown) => unknown) => select({ activePanelId: null }),
    usePanels: (select: (value: unknown) => unknown) => select([]),
    useFileRequest: (select: (value: unknown) => unknown) => select(null),
    useFileRevision: (select: (value: unknown) => unknown) => select(0),
    useNavigation: (select: (value: unknown) => unknown) => select(revision),
    useSessionPendingInteraction: (select: (value: unknown) => unknown) => select(new Map()),
    usePendingActions: (select: (value: unknown) => unknown) => select([]),
    renderSlot: (name: string) => <div data-testid={name} />,
  } as unknown as WorkbenchProps
  const view = render(<WorkbenchFrame {...props} />)
  expect(screen.getByText('Project home')).toBeTruthy()
  expect(screen.queryByRole('navigation')).toBeNull()
  current = 'creator'
  view.rerender(<WorkbenchFrame {...props} />)
  expect(screen.getByText('Project home')).toBeTruthy()
  revision++
  view.rerender(<WorkbenchFrame {...props} />)
  expect(screen.getByText('Project workspace')).toBeTruthy()
  expect(screen.getByRole('button', { name: en['legacy.012'] })).toBeTruthy()
})

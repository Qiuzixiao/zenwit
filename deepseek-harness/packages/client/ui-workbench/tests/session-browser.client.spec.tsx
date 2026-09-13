// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionBrowser } from '../src/client/SessionBrowser.tsx'
import { en } from '../src/client/locales.ts'
import type { ComponentProps } from 'react'

afterEach(cleanup)
function setup() {
  const sessions = { byId: {
    active: { id: 'active', displayTitle: 'Current notes', cwd: '/project', blank: false, updatedAt: 2, running: false },
    archived: { id: 'archived', displayTitle: 'Archived notes', cwd: '/project', blank: false, updatedAt: 3, running: false },
    elsewhere: { id: 'elsewhere', displayTitle: 'Other project', cwd: '/other', blank: false, updatedAt: 1, running: true },
  }, current: 'active' }
  return {
    mode: 'history', projectPath: '/project',
    useSessions: (select: (value: unknown) => unknown) => select(sessions),
    useWorkspaces: (select: (value: unknown) => unknown) => select({ archivedSessionIds: ['archived'] }),
    useSessionPendingInteraction: (select: (value: unknown) => unknown) => select(new Map([['elsewhere', { kind: 'approval' }]])),
    usePendingActions: (select: (value: unknown) => unknown) => select([]),
    t: (key: keyof typeof en) => en[key],
    onClose: vi.fn(), openSession: vi.fn(), renameSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined), forkSession: vi.fn().mockResolvedValue(undefined),
    searchSessions: vi.fn().mockResolvedValue({ ok: true, value: { items: [{ sessionId: 'active', snippet: 'needle in message' }], hasMore: false } }),
  } as unknown as ComponentProps<typeof SessionBrowser>
}
it('filters archived sessions, searches content across projects, and sends rename/archive to their owners', async () => {
  const props = setup()
  render(<SessionBrowser {...props} />)
  expect(screen.queryByText('Archived notes')).toBeNull()
  expect(screen.queryByText('Other project')).toBeNull()
  fireEvent.change(screen.getByLabelText('Search scope'), { target: { value: 'all' } })
  expect(screen.getByText('Other project')).toBeTruthy()
  expect(screen.getByText('Waiting for approval')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Search conversation titles and content'), { target: { value: 'needle' } })
  await screen.findByText('needle in message')
  expect(props.searchSessions).toHaveBeenCalledWith('needle', expect.any(AbortSignal))
  fireEvent.click(screen.getByLabelText('Rename'))
  fireEvent.change(screen.getByLabelText('Conversation title'), { target: { value: 'Renamed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(props.renameSession).toHaveBeenCalledWith('active', 'Renamed'))
  await waitFor(() => expect(screen.queryByLabelText('Conversation title')).toBeNull())
  fireEvent.click(screen.getByLabelText('Archive conversation'))
  await waitFor(() => expect(props.archiveSession).toHaveBeenCalledWith('active'))
})
it('shows normal and plugin approvals together but dispatches to their separate owners', () => {
  const props = setup()
  const openPlugin = vi.fn()
  props.usePendingActions = select => select([{ key: 'run-2', sessionId: 'active' as never, label: 'Media preview', open: openPlugin }])
  render(<SessionBrowser {...props} mode="pending" />)
  fireEvent.click(screen.getByText('Media preview'))
  expect(openPlugin).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('Other project'))
  expect(props.openSession).toHaveBeenCalledWith('elsewhere')
})

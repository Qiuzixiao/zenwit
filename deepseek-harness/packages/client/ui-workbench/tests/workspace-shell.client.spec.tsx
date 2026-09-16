// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Workspace, type WorkspaceProps } from '../src/client/Workspace.tsx'
import type { CopyProps } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'

/** The engine's own suites cover the tree; this suite covers the shell layout. */
vi.mock('../src/client/workbench/WorkbenchExplorer.tsx', () => ({
  ExplorerPane: (props: { projectPath: string }) => <div data-testid="engine-explorer" data-project={props.projectPath}/>,
}))

afterEach(cleanup)

/**
 * The shell measures its grid with one observer. The stub records the
 * callbacks so a test can publish a real measured width — the width-dependent
 * ceilings only misbehave once the measurement is real.
 */
const observers: ResizeObserverCallback[] = []
class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) { observers.push(callback) }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
afterEach(() => { observers.length = 0 })

/** Publish one measured grid width to the shell (what a real layout would do). */
function measureGrid(width: number): void {
  act(() => {
    for (const callback of observers) {
      callback([{ contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    }
  })
}

const t: CopyProps['t'] = (key, params) => {
  const text = key in en ? en[key as keyof typeof en] : key
  return text.replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? ''))
}

/** One shell render with framework hooks stubbed the way the renderer supplies them. */
function renderShell(options: { activePanel?: string | null } = {}) {
  const startSession = vi.fn()
  const attachRegion = vi.fn()
  const setProject = vi.fn()
  const closeProject = vi.fn().mockResolvedValue(undefined)
  const registerCloseRequest = vi.fn((_request: () => void) => () => {})
  const renderSlot = vi.fn((name: string, _owner: unknown, opts?: { entryKey?: string }) =>
    name === 'main' ? <div data-slot="main" data-entry={opts?.entryKey}/> : null)
  const props = {
    t,
    projectPath: '/projects/notes',
    engine: { store: {}, service: undefined, openFile: vi.fn(), referenceFile: vi.fn(), attachRegion, setProject },
    closeProject,
    registerCloseRequest,
    renderSlot,
    startSession,
    usePanelInfo: ((select: (state: { activePanelId: string | null }) => unknown) => select({ activePanelId: options.activePanel ?? null })) as never,
    useSessions: ((select: (state: unknown) => unknown) => select({ byId: {} })) as never,
    useWorkspaces: ((select: (state: unknown) => unknown) => select({ items: [{ workspaceId: 'ws', path: '/projects/notes', sessionIds: [] }], archivedSessionIds: [] })) as never,
    useNavigation: ((select: (value: number) => unknown) => select(0)) as never,
  } as unknown as WorkspaceProps
  return { ...render(<Workspace {...props}/>), startSession, renderSlot, attachRegion, setProject, closeProject, registerCloseRequest }
}

it('declares the explorer, the engine surface and the conversation column', () => {
  renderShell()
  const grid = screen.getByTestId('workspace-grid')
  expect(grid.querySelector('[data-zenwit-workbench-surface]')).not.toBeNull()
  expect(screen.getByTestId('workspace-explorer')).not.toBeNull()
  expect(screen.getByTestId('workspace-conversation')).not.toBeNull()
  // The explorer is the first of the five grid tracks (explorer / handle /
  // center / handle / conversation), at its default width.
  expect(grid.getAttribute('style')).toContain('grid-template-columns: 240px 14px')
  const entries = Array.from(document.querySelectorAll('[data-slot="main"]')).map(node => node.getAttribute('data-entry'))
  expect(entries).toEqual(['conversation'])
})

it('hands the engine its region and project, and takes both back on unmount', () => {
  const shell = renderShell()
  const region = screen.getByTestId('workspace-grid').querySelector('[data-zenwit-workbench-surface]')
  expect(shell.attachRegion).toHaveBeenCalledWith(region)
  // The workbench's tabs belong to the project, so the shell names it.
  expect(shell.setProject).toHaveBeenCalledWith('/projects/notes')
  shell.unmount()
  // The region goes back, but the project stays named: clearing it would
  // unmount every tab (releasing terminals, dropping unsaved drafts).
  expect(shell.attachRegion).toHaveBeenLastCalledWith(null)
  expect(shell.setProject).not.toHaveBeenCalledWith(null)
})

it('registers the close request behind the frame back control', () => {
  const shell = renderShell()
  expect(shell.registerCloseRequest).toHaveBeenCalled()
  // The frame's back control calls exactly this callback.
  const request = shell.registerCloseRequest.mock.calls.at(-1)?.[0] as (() => void) | undefined
  request?.()
  expect(shell.closeProject).toHaveBeenCalledTimes(1)
})

it('renders the engine explorer for the open project', () => {
  renderShell()
  const explorer = screen.getByTestId('engine-explorer')
  expect(explorer.getAttribute('data-project')).toBe('/projects/notes')
})

it('replaces the engine surface while a first-level panel is selected', () => {
  renderShell({ activePanel: 'community-market' })
  const panel = document.querySelector('[data-slot="main"]')
  expect(panel?.getAttribute('data-entry')).toBe('community-market')
  const surface = document.querySelector('[data-zenwit-workbench-surface]') as HTMLElement
  expect(surface.hidden).toBe(true)
})

it('collapses and restores the explorer column', () => {
  renderShell()
  fireEvent.click(screen.getByRole('button', { name: en['legacy.102'] }))
  expect(screen.getByRole('button', { name: en['legacy.100'] })).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en['legacy.100'] }))
  expect(screen.getByTestId('workspace-explorer')).not.toBeNull()
})

it('collapses the explorer by dragging its divider, and restores it by dragging back', () => {
  // jsdom has no pointer capture; the handle only needs the call to not throw.
  const capture = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = () => {}
  try {
    renderShell()
    const grid = screen.getByTestId('workspace-grid')
    expect(grid.style.gridTemplateColumns.startsWith('240px')).toBe(true)

    // Drag the explorer past its collapse edge: the column folds to the rail.
    fireEvent.pointerDown(screen.getAllByRole('separator')[0] as HTMLElement, { button: 0, clientX: 400 })
    fireEvent.pointerMove(window, { clientX: 100 })
    fireEvent.pointerUp(window, { clientX: 100 })
    expect(screen.getByTestId('workspace-grid').style.gridTemplateColumns.startsWith('44px')).toBe(true)
    expect(screen.getByRole('button', { name: en['legacy.100'] })).not.toBeNull()

    // Drag back out past the (wider) expand edge: the column comes back.
    fireEvent.pointerDown(screen.getAllByRole('separator')[0] as HTMLElement, { button: 0, clientX: 0 })
    fireEvent.pointerMove(window, { clientX: 400 })
    fireEvent.pointerUp(window, { clientX: 400 })
    expect(screen.getByTestId('workspace-grid').style.gridTemplateColumns.startsWith('44px')).toBe(false)
  } finally {
    Element.prototype.setPointerCapture = capture
  }
})

it('holds the explorer steady while the drag stays past its maximum', () => {
  // The regression: a ceiling derived from the explorer's own current width
  // shrinks as it grows, so a held drag re-clamps every move and the column
  // oscillates (the visible flicker).
  const capture = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = () => {}
  try {
    renderShell()
    measureGrid(1200)
    fireEvent.pointerDown(screen.getAllByRole('separator')[0] as HTMLElement, { button: 0, clientX: 0 })
    fireEvent.pointerMove(window, { clientX: 2000 })
    const atMaximum = screen.getByTestId('workspace-grid').style.gridTemplateColumns
    // 1200 - 28 handles - 240 center minimum - 500 conversation = 432.
    expect(atMaximum.startsWith('432px')).toBe(true)
    fireEvent.pointerMove(window, { clientX: 2000 })
    expect(screen.getByTestId('workspace-grid').style.gridTemplateColumns).toBe(atMaximum)
    fireEvent.pointerUp(window, { clientX: 2000 })
    expect(screen.getByTestId('workspace-grid').style.gridTemplateColumns).toBe(atMaximum)
  } finally {
    Element.prototype.setPointerCapture = capture
  }
})

it('collapses and restores the conversation column', () => {
  renderShell()
  const column = screen.getByTestId('workspace-conversation')
  expect(column.getAttribute('data-collapsed')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en['legacy.203'] }))
  expect(screen.getByTestId('workspace-conversation').getAttribute('data-collapsed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: en['legacy.200'] }))
  expect(screen.getByTestId('workspace-conversation').getAttribute('data-collapsed')).toBeNull()
})

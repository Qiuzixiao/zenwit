// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  bindSnapshotSelector, makeTranslate, RemoteError, sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorkbenchConversationProps } from '../src/client/skeleton/WorkbenchConversation.tsx'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { EMPTY_CONVERSATION_SNAPSHOT } from '../src/client/contract/snapshot.ts'
import type { ConversationSnapshot } from '../src/client/contract/snapshot.ts'
import { createConversationStore } from '../src/client/stores.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { zh } from '../src/client/locales.ts'
import { WorkbenchConversation } from '../src/client/skeleton/WorkbenchConversation.tsx'
import { ConversationSession, ConversationSessionHeader } from '../src/client/skeleton/ConversationSession.tsx'
import { conversationPhase } from '../src/client/contract/snapshot.ts'
import { InputBar } from '../src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import type {
  ComposerBarOwnerProps, ConversationHeaderLineageOwnerProps,
} from '../src/client/contract/slots.ts'
import type { ViewTab } from '../src/client/contract/views.ts'

// Every session-scope fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

// jsdom implements no Range geometry (Lexical's scroll-into-view measures the
// caret with one once the surface is genuinely contenteditable).
Range.prototype.getBoundingClientRect = () => ({
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
})


function fakeWiring() {
  const sink = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
  const shell = new SessionInputShell({ actx: {} as Context, defaultSink: sink, commandAttachments: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: (token: string) => `${token.trim()} attachments-unsupported` } })
  return { wiring: shell, sink, shell }
}

/** jsdom has no ResizeObserver; the root publishes its width and the composer
 * seat its height through one. Observed targets are recorded so a case can
 * fire the callback against a chosen element. */
const resizeObservers: { callback: ResizeObserverCallback; targets: Element[] }[] = []
class ResizeObserverStub {
  targets: Element[] = []
  constructor(callback: ResizeObserverCallback) {
    resizeObservers.push({ callback, targets: this.targets })
  }

  observe(target: Element): void { this.targets.push(target) }
  unobserve(): void {}
  disconnect(): void { this.targets.length = 0 }
}

/** Fires every recorded observer whose target list includes the element. */
function fireResize(el: Element): void {
  for (const entry of resizeObservers) {
    if (entry.targets.includes(el)) entry.callback([], undefined as never)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resizeObservers.length = 0
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

const t: WorkbenchConversationProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const SID = sid('s1')

type SessionSlotProps = ComponentProps<typeof ConversationSession>

const useChat: SessionSlotProps['useChat'] = () => { throw new Error('unused') }
const useTrajectory: SessionSlotProps['useTrajectory'] = () => { throw new Error('unused') }

function workspace(id = 'w1'): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title: id, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot => ({
  items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
})

function sessionSnapshotOf(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { ...sessionFixture(SID), ...overrides }
}

function mount(
  snapshot: SessionSnapshot,
  workspaceRows: WorkspaceView[] = [{ ...workspace('one'), sessionIds: [SID] }],
  options: {
    /** When true, mimic overlay:true chain siblings (hidden fallback + takeover). */
    overlayTakeover?: boolean
    /** The session list summary's `blank` flag — independent of the snapshot's. */
    summaryBlank?: boolean
    /** Drop the session's summary row entirely (a session the list has not caught up with). */
    omitSummaryRow?: boolean
    /** Classify the selected child as a subagent instead of an ordinary fork. */
    summaryOrigin?: 'subagent'
    /** Insert a first-level subagent between the root and selected child. */
    nestedSubagent?: boolean
    /** A composer block another plugin raised for this session. */
    composerBlock?: { reason: string }
    /** Mutable view ledger used by registration-order regressions. */
    viewTabs?: ViewTab[]
  } = {},
) {
  const root = sid('root')
  const parent = sid('parent')
  const rootRow = { id: root, displayTitle: 'Root', running: false, blank: false, updatedAt: 1 }
  const parentRow = {
    id: parent, displayTitle: 'Parent', parentId: root, origin: 'subagent' as const,
    running: false, blank: false, updatedAt: 2,
  }
  const childRow = {
    id: SID, displayTitle: 'Child', parentId: options.nestedSubagent === true ? parent : root,
    cwd: '/projects/one', running: false, blank: options.summaryBlank ?? false, updatedAt: 3,
    ...(options.summaryOrigin === undefined ? {} : { origin: options.summaryOrigin }),
  }
  const listed = options.omitSummaryRow !== true
  const sessions = createSnapshotStore<SessionListState>({
    ids: listed
      ? [root, ...options.nestedSubagent === true ? [parent] : [], SID]
      : [root],
    byId: {
      [root]: rootRow,
      ...listed && options.nestedSubagent === true && { [parent]: parentRow },
      ...listed && { [SID]: childRow },
    },
    current: SID,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const workspaces = createSnapshotStore<WorkspaceSnapshot>(workspaceState(workspaceRows))
  const session = createSnapshotStore<SessionSnapshot>(snapshot)
  const useSession = bindSnapshotSelector(session)
  const conversation = createSnapshotStore<ConversationSnapshot>(EMPTY_CONVERSATION_SNAPSHOT)
  const useConversation = bindSnapshotSelector(conversation)
  const useSessionPendingInteraction = bindSnapshotSelector(
    createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()),
  )
  const store = createConversationStore().create()
  store.actions.setDraft('ordinary draft')
  const { wiring, sink } = fakeWiring()
  const useInput = bindSnapshotSelector(wiring.state)
  const inputActions = wiring.actions
  const stop = vi.fn()
  const open = vi.fn()
  const slotCalls: string[] = []
  const lineageOwners: ConversationHeaderLineageOwnerProps[] = []
  const viewTabs = options.viewTabs ?? [
    { id: 'chat', label: 'Chat' },
    { id: 'trajectory', label: 'Trajectory' },
  ]
  const useConversationViews: SessionSlotProps['useConversationViews'] = selector => selector(viewTabs)
  /** Owner share handed to the two composer tool-row seats, per render. */
  const seatOwners: { key: string; owner: unknown }[] = []
  const renderSlot = ((key: string, owner: object, opts?: { only?: string; fallback?: ReactNode }) => {
    slotCalls.push(key)
    if (key === 'conversation.input.model' || key === 'conversation.input.plan') {
      seatOwners.push({ key, owner })
    }
    if (key === 'conversation.session.header.lineage') {
      lineageOwners.push(owner as ConversationHeaderLineageOwnerProps)
      return opts?.fallback ?? null
    }
    if (key === 'conversation.session.header') {
      return (
        <ConversationSessionHeader
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useSession={useSession}
          useConversation={useConversation}
          useConversationViews={useConversationViews}
          useChat={useChat}
          useTrajectory={useTrajectory}
          useSessions={props.useSessions}
          usePanelInfo={props.usePanelInfo}
          useResource={useResource}
          useSessionPendingInteraction={useSessionPendingInteraction}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          useStore={bindSnapshotSelector(store)}
          actions={store.actions}
          renderSlot={renderSlot as never}
          open={open}
          selectView={(view) => { store.actions.setView(view) }}
          t={t}
        />
      )
    }
    if (key === 'conversation.session') {
      return (
        <ConversationSession
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useSession={useSession}
          useConversation={useConversation}
          useConversationViews={useConversationViews}
          useChat={useChat}
          useTrajectory={useTrajectory}
          useSessions={props.useSessions}
          usePanelInfo={props.usePanelInfo}
          useResource={useResource}
          useSessionPendingInteraction={useSessionPendingInteraction}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          useStore={bindSnapshotSelector(store)}
          actions={store.actions}
          renderSlot={renderSlot as never}
          bindDraftMirror={write => wiring.bindMirror(write)}
          openView={(view, focus) => { store.actions.openView(view, focus) }}
        />
      )
    }
    if (key === 'conversation.composer.bar') {
      // The real entry, mounted the way the outlet composes it: standard kit
      // (shared with the root's props below) + this entry's inject + owner.
      const bar = owner as ComposerBarOwnerProps
      return (
        <InputBar
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useResource={useResource}
          useSession={useSession}
          useConversation={useConversation}
          useSessions={props.useSessions}
          usePanelInfo={props.usePanelInfo}
          useSessionPendingInteraction={useSessionPendingInteraction}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          keyboard={wiring}
          addFiles={() => null}
          useFileUploads={bindSnapshotSelector(createSnapshotStore({}))}
          retryFileUpload={undefined}
          removeAttachment={() => {}}
          resolveDraftAttachments={() => []}
          toggleCommandMenu={vi.fn()}
          useBusyEnter={bindSnapshotSelector(createSnapshotStore<'queue' | 'steer'>('queue'))}
          useNotices={bindSnapshotSelector(wiring.notices)}
          useLexicon={bindSnapshotSelector(wiring.lexicon)}
          useMenuLauncher={bindSnapshotSelector(createSnapshotStore<string | null>(null))}
          stop={stop}
          command={() => Promise.resolve(true)}
          t={t}
          renderSlot={((key: string, seatOwner: object) => {
            // The bar's own seats: recorded so a case can assert what share
            // each tool-row control received.
            seatOwners.push({ key, owner: seatOwner })
            return null
          }) as InputBarProps['renderSlot']}
          {...bar}
        />
      )
    }
    return <div data-testid={`view-${opts?.only ?? key}`} />
  }) as WorkbenchConversationProps['renderSlot']
  const renderSlotChain = ((_key, _owner, opts) => (
    options.overlayTakeover !== undefined
      ? (
        <>
          <div data-chain-overlay-fallback="conversation.composer" style={{ display: options.overlayTakeover ? 'none' : undefined }}>
            {opts?.fallback ?? null}
          </div>
          {options.overlayTakeover && <div data-testid="composer-takeover">TAKEOVER</div>}
        </>
      )
      : (opts?.fallback ?? null)
  )) as WorkbenchConversationProps['renderSlotChain']
  const props: WorkbenchConversationProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    sessionId: SID,
    SessionProvider: ({ children }) => children,
    useSession,
    useConversation,
    useSessions: bindSnapshotSelector(sessions),
    useSessionPendingInteraction,
    useResource,
    useWorkspaces: bindSnapshotSelector(workspaces),
    useProjection: (() => undefined),
    useComposerBlock: select => select(options.composerBlock),
    useInput,
    inputActions,
    renderSlot,
    renderSlotChain,
    t,
  }
  const view = render(<WorkbenchConversation {...props} />)
  return {
    view, store, wiring, sink, session, conversation, slotCalls, lineageOwners, seatOwners, open,
    rerender: () => { view.rerender(<WorkbenchConversation {...props} />) },
  }
}

describe('WorkbenchConversation resident composer', () => {
  it('does not redispatch composer child slots for an unrelated Session publication', () => {
    const b = mount(sessionSnapshotOf())
    const childKeys = new Set([
      'conversation.input.overlay',
      'conversation.input.left',
      'conversation.input.right',
      'conversation.composer.dock',
    ])
    const dispatchCount = () => b.slotCalls.filter(key => childKeys.has(key)).length
    const before = dispatchCount()

    act(() => {
      const current = b.session.getSnapshot()
      b.session.set({ ...current, hasMore: !current.hasMore })
    })

    expect(dispatchCount()).toBe(before)
  })

  it('renders the composer inert with the blocker\u2019s own reason', () => {
    const b = mount(sessionSnapshotOf(), undefined, {
      composerBlock: { reason: 'select a model first' },
    })
    const box = b.view.getByRole('textbox')
    // One disabled composer with the blocker's placeholder, never a second
    // tree: the DOM survives the block being raised and cleared.
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(box.getAttribute('data-placeholder')).toBe('select a model first')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.sink).not.toHaveBeenCalled()

    // The model seat stays live. Locking it too would leave the composer
    // asking for the one thing it prevents — every block this contract has is
    // cleared by choosing a model.
    const seat = (key: string) => b.seatOwners.filter(call => call.key === key).at(-1)?.owner
    expect(seat('conversation.input.model')).toEqual({ locked: false })
    expect(seat('conversation.input.plan')).toEqual({ locked: true })
  })

  it('keeps composer text in the machine, mirrors to the Conversation store, and submits through the sink', () => {
    const b = mount(sessionSnapshotOf())
    const box = b.view.getByRole('textbox')
    expect(b.wiring.snapshot.draft).toBe('ordinary draft')
    act(() => { b.wiring.setDraft('ordinary revised') })
    expect(b.store.store.getSnapshot().draft).toBe('ordinary revised')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.sink).toHaveBeenCalledWith('ordinary revised', [], 'queue', expect.any(AbortSignal))
    expect((b.view.getByRole('button', { name: 'Child' }) as HTMLButtonElement).disabled).toBe(true)
    expect(b.view.queryByText('Root')).toBeNull()
  })

  it('shows hierarchy only for subagents and opens their ordinary owner', () => {
    const b = mount(sessionSnapshotOf(), undefined, { summaryOrigin: 'subagent' })
    const root = b.view.getByRole('button', { name: 'Root' })
    expect((b.view.getByRole('button', { name: 'Child' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(root)
    expect(b.open).toHaveBeenCalledWith(sid('root'))
  })

  it('keeps intermediate subagent breadcrumbs at the compact title size', () => {
    const b = mount(sessionSnapshotOf(), undefined, {
      summaryOrigin: 'subagent',
      nestedSubagent: true,
    })
    expect(b.view.getByRole('button', { name: 'Root' }).className).not.toContain('crumbSubagent')
    expect(b.view.getByRole('button', { name: 'Parent' }).className).toContain('crumbSubagent')
    expect(b.view.getByRole('button', { name: 'Child' }).className).toContain('crumbSubagent')
    expect(b.lineageOwners.slice(-2).map(owner => owner.lineageSessionId)).toEqual([
      sid('parent'),
      SID,
    ])
    expect(b.lineageOwners.at(-2)?.openTitle).toEqual(expect.any(Function))
    expect(b.lineageOwners.at(-1)?.openTitle).toBeUndefined()
  })

  it('active phase: fixed header outside the scrollport; sticky composer seat inside it', () => {
    const b = mount(sessionSnapshotOf())
    const host = b.view.container.querySelector('[data-conversation-scroll]')
    const seat = b.view.container.querySelector('[data-composer-seat]')
    const header = b.view.container.querySelector('header')
    const textarea = b.view.container.querySelector<HTMLDivElement>('[data-composer-input]')
    expect(host).not.toBeNull()
    expect(seat).not.toBeNull()
    expect(header).not.toBeNull()
    // Header is column chrome above the scrollport; the seat sticks inside it.
    expect(host?.contains(header)).toBe(false)
    expect(host?.contains(seat)).toBe(true)
    expect(seat?.contains(textarea)).toBe(true)
    expect(b.slotCalls).toContain('conversation.session.header.lineage')
    expect(b.slotCalls).toContain('conversation.session.header.actions')
    expect(b.slotCalls).toContain('conversation.session.header.utilities')
    expect(b.slotCalls).toContain('conversation.session.header.corner')
  })

  it('sticky composer seat wraps the whole overlay chain, not only the fallback stack', () => {
    const b = mount(sessionSnapshotOf(), undefined, { overlayTakeover: true })
    const seat = b.view.container.querySelector('[data-composer-seat]')
    const takeover = b.view.getByTestId('composer-takeover')
    const fallback = b.view.container.querySelector('[data-chain-overlay-fallback="conversation.composer"]')
    expect(seat?.contains(takeover)).toBe(true)
    expect(seat?.contains(fallback)).toBe(true)
  })

  it('restores the same editable draft after an interaction takeover is answered', () => {
    const options = { overlayTakeover: true }
    const b = mount(sessionSnapshotOf(), undefined, options)
    const editor = b.view.container.querySelector('[data-composer-input]')
    act(() => { b.wiring.setDraft('continue after approval') })
    expect(b.view.getByTestId('composer-takeover')).toBeTruthy()
    expect(b.view.queryByRole('textbox')).toBeNull()

    options.overlayTakeover = false
    b.rerender()

    expect(b.view.queryByTestId('composer-takeover')).toBeNull()
    expect(b.view.getByRole('textbox')).toBe(editor)
    expect(b.wiring.snapshot.draft).toBe('continue after approval')
    fireEvent.keyDown(b.view.getByRole('textbox'), { key: 'Enter' })
    expect(b.sink).toHaveBeenCalledWith('continue after approval', [], 'queue', expect.any(AbortSignal))
  })

  it('keeps the agent selector in the compact header without the retired hero or workspace chooser', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    const header = b.view.container.querySelector('header')
    const agent = b.view.getByTestId('view-conversation.hero.agentPreset')
    expect(header?.contains(agent)).toBe(true)
    expect(b.view.queryByRole('button', { name: '选择工作区' })).toBeNull()
    expect(b.view.queryByText('预览版')).toBeNull()
    expect(b.view.queryByTestId('view-chat')).toBeNull()
    expect(b.slotCalls).not.toContain('conversation.hero.workspace')
    expect(b.slotCalls).not.toContain('conversation.hero.brand.mark')
    act(() => { b.wiring.setDraft('draft in empty pane') })
    expect(b.store.store.getSnapshot().draft).toBe('draft in empty pane')
  })

  it('keeps a rejected first prompt engaging instead of returning to the Hero', () => {
    const failed = sessionSnapshotOf({
      blank: true,
      promptAttempted: true,
      awaitingFirstTurn: true,
      promptError: {
        op: 'send',
        error: new RemoteError('session/agent-busy', 'busy', { reason: 'busy' }),
      },
    })

    expect(conversationPhase(failed, EMPTY_CONVERSATION_SNAPSHOT)).toBe('engaging')
    const b = mount(failed, undefined, { summaryBlank: true })
    expect(b.view.container.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('active')
    expect(b.view.queryByText('探索未至之境')).toBeNull()
  })

  it('settling phase: a summary that does not prove the session blank hides the composer while it opens', () => {
    const b = mount(sessionSnapshotOf({ blank: true, openState: 'loading' }))
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('settling')
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
  })

  it('settling phase: a session the list has no row for settles conservatively', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'loading' }),
      undefined,
      { omitSummaryRow: true },
    )
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('settling')
  })

  it('startup auto-selection: a summary-proven blank session opens straight into the empty pane', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'loading' }),
      undefined,
      { summaryBlank: true },
    )
    // The summary already proves the outcome, so the settling hide would only
    // blank the column for the history round-trip.
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('empty')
    expect(b.view.getByTestId('view-conversation.hero.agentPreset')).toBeTruthy()
    expect(b.view.getByRole('textbox')).toBeTruthy()
  })

  it('same textarea DOM node survives the empty → active flip into the sticky scrollport', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    const before = b.view.getByRole('textbox')
    act(() => { b.wiring.setDraft('kept across flip') })
    // First message landed: content exists, phase leaves blank. Composer
    // already sat in the resident scrollport while empty, so the textarea
    // node and InputHub draft both survive.
    b.session.set(sessionSnapshotOf({ blank: false }))
    b.rerender()
    const after = b.view.getByRole('textbox')
    expect(after).toBe(before)
    expect(b.wiring.snapshot.draft).toBe('kept across flip')
    expect(b.store.store.getSnapshot().draft).toBe('kept across flip')
    expect(b.view.container.querySelector('[data-conversation-scroll]')?.contains(after)).toBe(true)
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
  })

  it('keeps the Chat fallback selected by id when a view is inserted before it', () => {
    const viewTabs: ViewTab[] = [
      { id: 'chat', label: 'Chat' },
      { id: 'trajectory', label: 'Trajectory' },
    ]
    const b = mount(sessionSnapshotOf(), undefined, { viewTabs })
    // A removed dynamic view leaves its persisted id behind. The visible
    // fallback is Chat and must stay Chat when another lower-order view lands.
    act(() => { b.store.actions.setView('removed-view') })
    expect(b.view.getByTestId('view-chat')).toBeTruthy()

    viewTabs.unshift({ id: 'new-view', label: 'New view' })
    b.rerender()

    expect(b.view.getByTestId('view-chat')).toBeTruthy()
    expect(b.view.queryByTestId('view-new-view')).toBeNull()
    expect(b.view.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true')
    expect(b.view.getByRole('tab', { name: 'New view' }).getAttribute('aria-selected')).toBe('false')
  })

  it('prompt failure renders the promptError strip (ordinary failure, no transaction UI)', () => {
    const b = mount(sessionSnapshotOf({
      promptError: { op: 'send', error: { code: 'offline', message: 'Message send failed' } as never },
    }))
    expect(b.view.getByRole('alert').textContent).toContain('Message send failed (offline)')
    expect(b.view.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('keeps floating view controls clear of the growing composer', () => {
    const b = mount(sessionSnapshotOf())
    const seat = b.view.container.querySelector('[data-composer-seat]') as HTMLElement
    const scroller = b.view.container.querySelector('[data-conversation-scroll]') as HTMLElement
    Object.defineProperty(seat, 'offsetHeight', { value: 180, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true })
    act(() => { fireResize(seat) })
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('180px')
    expect(scroller.style.getPropertyValue('--dsh-conversation-viewport-height')).toBe('600px')
  })
})

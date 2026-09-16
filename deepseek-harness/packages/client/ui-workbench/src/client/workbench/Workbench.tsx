/**
 * Zenwit workbench: the workspace column's tabs, split panes and their views.
 *
 * The workbench occupies the middle column the product's workspace shell
 * declares; it does not measure the page, claim a viewport column, or squeeze
 * the conversation (that column is the shell's own grid track). Without a
 * conversation there is nothing to scope the views to, so the host renders
 * nothing until one exists.
 *
 * The whole layout lives in the per-session store, and the shell binds the
 * workbench actions to it while the tab views come from the registry.
 */
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { useCallback, useEffect, useMemo, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import type { Context } from './workbench-context.ts'
import { referenceInChat as referenceInChatShared } from './reference-in-chat.ts'
import {
  leafWithTab, moveTab, moveTabToEdge, openDiffTab, resizeSplitIn,
  setTabPin, toggleExpanded,
  type DropZone, type WorkbenchStore, type WorkbenchTab,
} from './workbench-store.ts'
import { getPinnedHomeScope } from './pinned.ts'
import { Workbench as SplitWorkbench, type WorkbenchActions } from './WorkbenchSplit.tsx'
import { TabContent, buildNewTabOptions } from './shell/TabContent.tsx'
import { useHostFeeds } from './shell/use-host-feeds.ts'
import { usePinnedTabs } from './shell/use-pinned-tabs.ts'
import type { TabDragPayload } from './WorkbenchTabs.tsx'
import { api } from './api.ts'
import css from './workbench.module.css'

/**
 * OS file drags over the workbench belong to the workbench, not to the chat:
 * DSH's composer (InputBar) listens for file drags on the DOCUMENT and
 * answers with a full-screen "drop image here" mask plus image intake on
 * drop. The workbench swallows the whole event quartet — enter/over/leave/drop
 * — so the region is a black hole to that document listener. All four must be
 * stopped: InputBar keeps an enter/leave depth counter, and a leave that
 * escapes without its matching enter unbalances the count (this was the
 * full-screen mask flickering over the workbench). The conversation column
 * keeps DSH's native overlay and intake untouched; gated on the 'Files' type
 * so in-app drags (tab reorder, split zones) propagate exactly as before.
 */
const swallowOsFileDrag = (event: ReactDragEvent): void => {
  if (!(event.dataTransfer?.types.includes('Files') ?? false)) return
  event.preventDefault()
  event.stopPropagation()
}

/** The four drag events a file drag must never carry past the workbench region. */
const osFileDragShield = {
  onDragEnter: swallowOsFileDrag,
  onDragOver: swallowOsFileDrag,
  onDragLeave: swallowOsFileDrag,
  onDrop: swallowOsFileDrag,
}

export function Workbench(props: { ctx: Context; store: WorkbenchStore }) {
  const { ctx, store } = props

  // Copy freshness: re-render the whole tree when the DSH locale switches.
  // The module-level t() reads the active locale at call time, so a root
  // re-render alone re-localizes every tab (no memo barriers below).
  const localeRevision = useSyncExternalStore(
    useMemo(() => (callback: () => void) => ctx.locale.subscribe(callback), [ctx]),
    useCallback(() => ctx.locale.getSnapshot().active, [ctx]),
  )

  // Tab-registry revision: TabContent memo cells must pick up a descriptor
  // a plugin registers/disposes after mount (the + menu / icons already read
  // the registry at render). Rare events (plugin (un)mount), so one full
  // re-render per change is fine — this is what keeps the memoized cells
  // from going stale.
  const [tabsVersion, setTabsVersion] = useState(0)
  useEffect(() => {
    const service = ctx.get('workbenchEngine')
    if (service === undefined) return
    return service.subscribe(() => setTabsVersion(version => version + 1))
  }, [ctx])

  // Current conversation (the sessions list feed) and its workbench state.
  const sessionList = useSyncExternalStore(
    useMemo(() => (callback: () => void) => ctx.sessions.list.subscribe(callback), [ctx]),
    useCallback(() => ctx.sessions.list.getSnapshot(), [ctx]),
  )
  const current = sessionList.current
  const snapshot = useSyncExternalStore(
    useCallback((callback: () => void) => store.subscribe(callback), [store]),
    useCallback(() => store.getSnapshot(), [store]),
  )
  // The store is keyed by PROJECT (the shell hands the project over); the
  // session id below only scopes the host calls each view makes. The store
  // also mirrors the displayed conversation for teardown decisions.
  useEffect(() => { store.setActiveSession(current) }, [current, store])
  const state = snapshot.state
  const sessionId = current
  const bySessionId = sessionList.byId as Record<string, SessionSummary | undefined>
  const summaryCwd = sessionId === undefined ? undefined : bySessionId[sessionId]?.cwd

  // While the session's header is still hydrating (or the session is blank),
  // the list summary may carry no cwd; ask the host once (it falls back to
  // the process cwd) so the explorer root and terminal cwd are real from
  // first paint instead of showing "no session".
  const [fetchedCwd, setFetchedCwd] = useState<string | undefined>(undefined)
  useEffect(() => {
    setFetchedCwd(undefined)
    if (sessionId === undefined || summaryCwd !== undefined) return
    let cancelled = false
    api.sessionCwd({ sessionId })
      .then(result => { if (!cancelled) setFetchedCwd(result.cwd) })
      .catch(() => { /* the explorer/git rows surface their own errors */ })
    return () => { cancelled = true }
  }, [sessionId, summaryCwd])
  const cwd = summaryCwd ?? fetchedCwd

  // The + menu options ride a memo so the workbench does not rebuild the
  // array identity across renders that did not change the store: fresh arrays
  // per render re-rendered every LeafView's + affordance whether or not
  // anything tab-related moved.
  const newTabOptions = useMemo(
    () => (state === undefined || sessionId === undefined ? [] : buildNewTabOptions(state, ctx, { sessionId, cwd })),
    // state is the whole session state — every field it wraps is fair game
    // for the descriptors' available() callbacks. (The render's own guard
    // sits below every hook; this memo must handle the no-session case
    // itself.)
    [state, ctx, sessionId, cwd],
  )

  // Host feeds (workbench/shell/use-host-feeds.ts): the agent-opens
  // WebSocket push and the subagent / background-job
  // auto-activation triggers, all keyed on the current session. The jump-back
  // ref is the one piece the render side consumes (renderTab's onSubagentJump
  // arms it).
  const { subagentJumpRef } = useHostFeeds({ ctx, store, sessionList: sessionList as unknown as Parameters<typeof useHostFeeds>[0]['sessionList'], sessionId })

  const actions: WorkbenchActions = useMemo(() => ({
    closeTab: (_paneId, tabId) => {
      // A closed terminal releases its pty immediately — including when its
      // socket is mid-reconnect, where the unmount close frame never reaches
      // the host and the process would hold the quota until the grace ends.
      // Agent terminals (tabId `agent:<uuid>`) close through a different
      // host route: the WS close frame is the primary path (sent by
      // TerminalView on unmount).
      const current = store.getSnapshot().state
      const leaf = current === undefined ? undefined : leafWithTab(current.splits, tabId)
      const tab = leaf?.tabs.find(candidate => candidate.id === tabId)
      // Route through the service: the tab-bar close is the canonical close
      // path (finds the pane itself, fires descriptor.onClose); the session
      // scope (with its cwd) rides to the callback.
      ctx.get('workbenchEngine')?.closeTab(tabId, sessionId === undefined ? undefined : { sessionId, cwd })
      if (tab?.type === 'terminal') {
        // The shell belongs to the conversation the tab was minted in (the
        // layout is keyed by project, so the tab outlives that conversation).
        {
          const owner = (tab.meta as Record<string, unknown> | undefined)?.ptySession
          const ptySession = typeof owner === 'string' && owner !== '' ? owner : sessionId
          if (ptySession !== undefined) {
            void api.ptyClose({ sessionId: ptySession, cwd }, tabId).catch(() => { /* the host may already have released it */ })
          }
        }
      }
    },
    activateTab: (_paneId, tabId) => {
      // Route through the service: same reducer (finds the pane, sets the
      // active pane) and fires descriptor.onActivate; the session scope
      // (with its cwd) rides to the callback.
      ctx.get('workbenchEngine')?.activateTab(tabId, sessionId === undefined ? undefined : { sessionId, cwd })
    },
    focusPane: (paneId) => { store.reduce(s => ({ ...s, activePane: paneId })) },
    moveTabToEdge: (payload: TabDragPayload, toPane: string, zone: DropZone) => {
      store.reduce(s => moveTabToEdge(s, payload.paneId, payload.tabId, toPane, zone))
    },
    moveTabBefore: (payload: TabDragPayload, toPane: string, beforeTabId: string) => {
      store.reduce((s) => {
        let index = -1
        const source = leafWithTab(s.splits, beforeTabId)
        if (source !== undefined && source.id === toPane) {
          index = source.tabs.findIndex(tab => tab.id === beforeTabId)
        }
        return moveTab(s, payload.paneId, payload.tabId, toPane, index)
      })
    },
    resizeSplit: (splitId, index, deltaFrac) => {
      store.reduce(s => resizeSplitIn(s, splitId, index, deltaFrac))
    },
    // Pin/unpin a terminal tab: the home cwd is snapshotted at pin time so a
    // workspace-scoped pin only resurfaces in sessions whose cwd matches.
    // Unpin passes null — the tab stays open in its home session, just
    // unmarked.
    pinTab: (tabId, scope) => {
      store.reduce(s => setTabPin(s, tabId, scope === null ? null : { scope, homeCwd: cwd }))
    },
  }), [store, sessionId, cwd, ctx])

  // Pinned virtual tabs (workbench/shell/use-pinned-tabs.ts): cross-session
  // pinned tabs inject into the workbench's first leaf, and the actions are
  // wrapped so pinned virtual ids route to the HOME session (reduceFor +
  // revision bump).
  const { augmentedTree, wrappedActions } = usePinnedTabs({ store, sessionId, cwd, snapshot, actions })

  /**
   * The explorer's @-reference button. Directories append the folder mention
   * (`@dir/`) as plain text so DSH's folder decoration and completion keep
   * working; files insert a structured chip like the native `@` picker, so
   * the whole reference stays one link instead of decorating only the
   * leading folder. Resolves the session-scope ctx and the conversation
   * input service at click time; a missing service or scope degrades to a
   * logged no-op, never a crash. Defined above the no-session early return
   * — a hook must never sit behind a conditional return (React counts hooks
   * per render).
   */
  const referenceInChat = useCallback((path: string, isDir: boolean): void => {
    if (sessionId === undefined) return
    referenceInChatShared(ctx, sessionId, cwd, path, isDir)
  }, [ctx, sessionId, cwd])

  if (state === undefined || sessionId === undefined) {
    // No conversation yet: the region stays mounted (the drag shield keeps
    // covering it) but nothing is rendered — every view needs a session scope.
    return <div className={css.surface} data-dsh-panel-host {...osFileDragShield} />
  }

  const onNewTab = (optionId: string): void => {
    const service = ctx.get('workbenchEngine')
    const descriptor = service?.getTab(optionId)
    if (service === undefined || descriptor === undefined) return
    const title = typeof descriptor.title === 'function' ? descriptor.title() : descriptor.title
    // The session scope rides along: lifecycle callbacks receive it.
    service.openTab({ type: optionId, title }, { sessionId, cwd })
  }

  /**
   * The tab icon from the tab-type registry. An editor tab WITH a file path
   * (the per-path windows of split mode — `meta.dir` marks folder windows,
   * which keep the folder glyph) shows the same file icon the tree row shows
   * (`fileIcon`, feature `fileIcons`); every other tab uses its tab-type
   * descriptor icon.
   */
  const tabIconOf = (tab: WorkbenchTab): ReactNode => {
    if (tab.type === 'editor' && tab.path !== undefined && (tab.meta as { dir?: boolean } | undefined)?.dir !== true) {
      return ctx.get('workbenchEngine')?.fileIcon(tab.path, 14) ?? null
    }
    const descriptor = ctx.get('workbenchEngine')?.getTab(tab.type)
    if (descriptor === undefined) return null
    return typeof descriptor.icon === 'function' ? descriptor.icon(14) : descriptor.icon
  }

  /**
   * The tab badge from the tab-type registry: a count (99+ capped) or a
   * short text pill. A throwing badge is swallowed (no pill) — the tab
   * strip must never break because a plugin's badge computation failed.
   */
  const tabBadgeOf = (tab: WorkbenchTab): ReactNode => {
    const descriptor = ctx.get('workbenchEngine')?.getTab(tab.type)
    if (descriptor?.badge === undefined) return null
    let value: string | number | null | undefined
    try {
      value = descriptor.badge(ctx, { sessionId, cwd }, state)
    } catch (error) {
      console.error('[zenwit-workbench] tab badge error:', error)
      return null
    }
    if (value === null || value === undefined || value === '') return null
    const text = typeof value === 'number' ? (value > 99 ? '99+' : String(value)) : String(value)
    return <span className={css.tabBadge}>{text}</span>
  }

  /**
   * Render one tab's content. `active` (from the workbench) tells whether
   * this tab is the active one in its pane and gates live views (the Subagent
   * topology pauses its polling while the page is not visible). The pane id
   * travels with the tab so diff tabs can split below their source pane.
   */
  const renderTab = (tab: WorkbenchTab, active: boolean, paneId: string) => {
    // Pinned virtual tabs: pass the home session's scope (sessionId + cwd) so
    // TerminalView's WS URL resolves to the home PTY, and effectiveTabId so
    // the descriptor component receives the ORIGINAL tab id (the virtual id
    // is only a display key). Regular tabs: effectiveTabId is undefined (no
    // override), scope is the current session's.
    const home = getPinnedHomeScope(tab)
    return (
      <TabContent
        tab={tab}
        effectiveTabId={home?.tabId}
        paneId={paneId}
        sessionId={home?.sessionId ?? sessionId}
        cwd={home?.cwd ?? cwd}
        expanded={state.expanded}
        revealed={state.revealed ?? []}
        onToggleDir={(path) => { store.reduce(s => toggleExpanded(s, path)) }}
        onReferenceFile={referenceInChat}
        ctx={ctx}
        store={store}
        visible={active}
        onSubagentJump={(childSessionId) => { subagentJumpRef.current = childSessionId }}
        onOpenDiff={(diffTab) => { store.reduce(s => openDiffTab(s, paneId, diffTab)) }}
        localeRevision={localeRevision}
        tabsVersion={tabsVersion}
      />
    )
  }

  return (
    <div className={css.surface} data-dsh-panel-host {...osFileDragShield}>
      <div className={css.panelBody}>
        <SplitWorkbench
          state={state}
          tree={augmentedTree}
          newTabOptions={newTabOptions}
          actions={wrappedActions}
          onNewTab={onNewTab}
          renderTab={renderTab}
          getTabIcon={tabIconOf}
          getTabBadge={tabBadgeOf}
        />
      </div>
    </div>
  )
}

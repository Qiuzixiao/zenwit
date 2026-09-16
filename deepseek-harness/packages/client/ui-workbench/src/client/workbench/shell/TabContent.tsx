/**
 * The tab-content cell + the + menu builder, extracted from Workbench.tsx
 * (behavior identical): one memoized cell dispatches a tab to its registry
 * descriptor's component, and buildNewTabOptions derives the + menu rows
 * from the same registry.
 */
import { createElement, memo } from 'react'
import type { Context } from '../workbench-context.ts'
import type { WorkbenchState, WorkbenchStore, WorkbenchTab } from '../workbench-store.ts'
import type { SessionScope } from '../api.ts'
import { OrphanedTab } from '../OrphanedTab.tsx'
import { RenderBoundary } from '../RenderBoundary.tsx'
import { tabContentCompare, type TabContentMemoKey } from '../tab-content-memo.ts'
import type { NewTabOption } from '../WorkbenchTabs.tsx'
import css from '../workbench.module.css'

/** Props of one tab's content cell = the memo key (tab-content-memo.ts) plus
 *  the runtime objects/callbacks the cell renders with. The memo comparator
 *  is the pure `tabContentCompare`; anything in the key decides a re-render
 *  must propagate, anything outside it must be a stable object (ctx/store)
 *  or covered by a compared field (paneId covers onOpenDiff's captured
 *  pane; sessionId/cwd cover onReferenceFile). */
interface TabContentProps extends TabContentMemoKey {
  onToggleDir: (path: string) => void
  onReferenceFile: (path: string, isDir: boolean) => void
  ctx: Context
  store: WorkbenchStore
  /** Fired before a topology node jumps to its child session (see Workbench). */
  onSubagentJump: (childSessionId: string) => void
  /** Open a diff tab from the git panel (placement handled by the store). */
  onOpenDiff: (tab: WorkbenchTab) => void
}

/** Render the content of one tab (dispatched by type). */
export const TabContent = memo(function TabContent(props: TabContentProps) {
  const { tab, effectiveTabId, sessionId, cwd, expanded, revealed, onToggleDir, onReferenceFile, ctx, store, visible, onSubagentJump, onOpenDiff } = props
  const scope = { sessionId, cwd }
  const descriptor = ctx.get('workbenchEngine')?.getTab(tab.type)
  if (descriptor === undefined) {
    return <OrphanedTab ctx={ctx} store={store} scope={scope} tab={tab} visible={visible} />
  }
  // For pinned virtual tabs, the tab descriptor's component (e.g. TerminalView)
  // must receive the ORIGINAL tab id so it connects to the home session's PTY.
  // The virtual tab's own id is a unique display key (prefixed); effectiveTabId
  // restores the real id at the component boundary.
  const componentTab = effectiveTabId !== undefined ? { ...tab, id: effectiveTabId } : tab
  return createElement(
    RenderBoundary,
    { className: css.tabBoundaryError ?? '' },
    createElement(descriptor.component as unknown as (props: Record<string, unknown>) => null, {
      ctx, store, scope, tab: componentTab, visible, expanded, revealed,
      onToggleDir, onReferenceFile, onOpenDiff, onSubagentJump,
    } as Record<string, unknown>),
  )
}, tabContentCompare)

/** The + menu options for the current state, driven by the tab registry.
 * Hidden tabs (editor/diff) never show; `available` returning false shows
 * a disabled row (e.g. terminal at capacity) instead of hiding the option.
 * Tabs the user disabled in the workbench settings are filtered out
 * entirely — re-enabling them is the settings page's job. */
export function buildNewTabOptions(state: WorkbenchState, ctx: Context, scope: SessionScope): NewTabOption[] {
  const service = ctx.get('workbenchEngine')
  if (service === undefined) return []
  return service.getTabs()
    .filter(d => !d.hidden && service.isTabEnabled(d.id))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    .map(d => ({
      id: d.id,
      label: typeof d.title === 'function' ? d.title() : d.title,
      disabled: !(d.available?.(ctx, scope, state) ?? true),
      // 14 matches the compact + menu's icon slot (compactList .itemIcon).
      icon: typeof d.icon === 'function' ? d.icon(14) : d.icon,
    }))
}

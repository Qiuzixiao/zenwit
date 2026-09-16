/**
 * The generic render error boundary for the workbench tree: a render error in
 * the wrapped subtree shows a dismissible error strip (retry re-renders the
 * children) instead of blanking the shell. Used at two scopes:
 *
 * - ROOT (index.tsx, `css.boundaryError`): last-resort containment for
 *   errors in the workbench shell itself (Workbench, drag layout, …) — a full
 *   swap keeps the page alive.
 * - PER-TAB (Workbench.tsx TabContent, `css.tabBoundaryError`): a crashing
 *   viewer/editor shows a strip inside ITS OWN pane; the workbench shell, the
 *   other tabs, and the panel itself stay alive (issue #31 — a tab crash
 *   must never take down the whole workbench).
 *
 * The className prop selects the strip's geometry: the root's full-height
 * fixed rail vs. the tab's pane-filling block.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from './locales.ts'
import css from './workbench.module.css'

/** Diagnostic prefix of the workbench's own runtime messages. */
const PRODUCT_MARK = 'zenwit-workbench'

export class RenderBoundary extends Component<{ children?: ReactNode; className?: string }, { error: string | null }> {
  override state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[zenwit-workbench] render error:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className={this.props.className}>
          <span>{`${PRODUCT_MARK}: ${this.state.error}`}</span>
          <button
            type="button"
            className={css.terminalRetry}
            onClick={() => { this.setState({ error: null }) }}
          >
            {t('terminalRetry')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Interception of the chat's produced-files row: the turn-tail chain entry
 * that replaces ui-deliverables' row when the closing turn produced files.
 * The takeover looks identical (same chip row); the chips open the file in
 * the workbench instead of the host OS. Priority -1 runs before the default-0
 * deliverables entry; when nothing was produced the selector returns null
 * and the original row renders unchanged.
 */
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from './workbench-context.ts'
import { revealPaths, type WorkbenchStore } from './workbench-store.ts'
import { t } from './locales.ts'
import { resolveWorkbenchPath, selectProducedFiles } from './produced-files.ts'
import css from './workbench.module.css'

/** Open a file in the workbench's editor (used by the intercepted row and the explorer). */
export function openWorkbenchFile(ctx: Context, _store: WorkbenchStore, sessionId: string, path: string): void {
  const byId = ctx.sessions.list.getSnapshot().byId as Record<string, SessionSummary | undefined>
  const summary = byId[sessionId]
  const absolute = resolveWorkbenchPath(summary?.cwd, path)
  const at = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'))
  const title = at === -1 ? absolute : absolute.slice(at + 1)
  // Route through the workbench service so the editor descriptor's dedupeKey
  // (per-path) applies; the id is path-derived so multiple editors coexist.
  ctx.get('workbenchEngine')?.openTab({ type: 'editor', title, path: absolute, id: `editor:${absolute}` })
}

/**
 * Reveal the produced files in the explorer column: expand their parent
 * directories and highlight the rows (the column is always on screen in the
 * workspace, so nothing has to be opened). Unknown files fall back to
 * revealing the workspace root itself.
 */
export function revealInExplorer(
  ctx: Context,
  store: WorkbenchStore,
  sessionId: string,
  files: readonly string[],
): void {
  const byId = ctx.sessions.list.getSnapshot().byId as Record<string, SessionSummary | undefined>
  const summary = byId[sessionId]
  const cwd = summary?.cwd
  // Deliverables report paths as-is (often relative to the session cwd), but
  // the explorer tree and revealPaths work on absolute paths — resolve every
  // target so the ancestors expand and the row actually matches.
  const targets = files.length > 0
    ? files.map(path => resolveWorkbenchPath(cwd, path))
    : cwd === undefined ? [] : [cwd]
  store.reduce(state => revealPaths(state, cwd, targets))
}

/** The intercepted produced-files row (visual twin of the deliverables chips). */
export function WorkbenchProducedFiles(props: {
  matched: readonly string[]
  openInWorkbench: (path: string) => void
  /** Reveal the produced files in the explorer ("Show in folder" twin). */
  onShowInFolder: (files: readonly string[]) => void
}) {
  const { matched, openInWorkbench, onShowInFolder } = props
  const shown = matched.slice(0, 6)
  const hidden = matched.length - shown.length
  return (
    <div className={css.producedRow}>
      <span className={css.producedLabel}>{t('produced')}</span>
      {shown.map(path => {
        const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
        const name = at === -1 ? path : path.slice(at + 1)
        return (
          <button
            key={path}
            type="button"
            className={css.producedChip}
            title={path}
            onClick={() => { openInWorkbench(path) }}
          >
            <IconCodeOutline16 size={12} />
            <span>{name}</span>
          </button>
        )
      })}
      {hidden > 0 && <span className={css.producedMore}>+{hidden}</span>}
      {hidden > 0 && (
        <button
          type="button"
          className={css.producedMore}
          style={{ cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
          onClick={() => { onShowInFolder(matched) }}
        >
          {t('showInFolder')}
        </button>
      )}
    </div>
  )
}

/**
 * Register the turn-tail interception (returns the disposer).
 *
 * The slot is a CHILD slot the host's ui-conversation declares in its
 * `conversation.chat.node` children table (kind: chain, scope: session).
 * Registering it directly races the declaration — the ui-slots core's
 * load-time validation throws "not declared (a parent entry's children
 * table must declare it)" when the parent entry is not on the ledger yet.
 * slots.inject waits for the declaration: the callback runs synchronously
 * when the slot is already declared, otherwise it runs inside the declaring
 * register() call once the declaration commits; declaration collapse
 * disposes the entry and a later declaration re-registers it. This mirrors
 * @deepseek-ai/dsh-client-ui-deliverables' registration of the same slot.
 */
export function registerTurnTailInterception(ctx: Context, store: WorkbenchStore): () => void {
  return ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    // Decline the takeover while the editor tab type is disabled in the side
    // card settings: the produced-files row falls back to the default
    // deliverables behavior instead of offering chips that cannot open.
    select: (owner) => {
      if (store.getPrefs().tabsEnabled['editor'] === false) return null
      return selectProducedFiles(owner)
    },
    priority: -1,
    registrant: 'zenwit-workbench',
    inject: (sessionId: string) => ({
      openInWorkbench: (path: string) => { openWorkbenchFile(ctx, store, sessionId, path) },
      onShowInFolder: (files: readonly string[]) => { revealInExplorer(ctx, store, sessionId, files) },
    }),
  }, WorkbenchProducedFiles))
}

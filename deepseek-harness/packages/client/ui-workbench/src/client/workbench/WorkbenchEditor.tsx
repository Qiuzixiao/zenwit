/**
 * The editor tab host: the single FILES WINDOW. It resolves a file's
 * previewer through the workbench registry (`matchFileViewer`), fetches bytes
 * per the matched viewer's fetch strategy, and renders its component — or
 * the shared download pane when nothing can render the file. A tab without
 * a path (the seeded "Files" home) renders an empty-state hint instead of
 * the viewer loading flow; that path-less window IS the file explorer.
 *
 * The chrome depends on the `editorExplorer` mode (read reactively so
 * toggling it re-renders without a reload):
 * - merged (in-place): tree click / path-input Enter switch the CURRENT
 *   tab in place (updateTab rewrites path/title; the tab keeps its id and
 *   meta, so treeOpen/treeWidth survive the switch);
 * - split: they open through `openWorkbenchFile` (a per-path dedupe tab),
 *   and a PATH-LESS window is the standalone explorer — it renders ONLY
 *   the tree panel (search + FileTree, full-window), no editor chrome.
 *   Editor tabs (with a path) keep the full chrome in both modes.
 * The tree's context menu offers the explicit escapes in both modes: open
 * in a new tab (per-path dedupe) or to the side (a fresh tab in a fresh
 * rightward split of the current pane).
 *
 * The strategy dispatch is pure (planFirstMatch / planFsReadOutcome in
 * editor-load.ts); this component only wires it to the host APIs.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { createElement } from 'react'
import clsx from 'clsx'
import { IconCheckOutline16, IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from './workbench-context.ts'
import { api, isOutsideWorkspaceMessage, mediaUrl, type SessionScope } from './api.ts'
import { BinaryDownload } from './binary-download.tsx'
import { FenceErrorNotice } from './FenceErrorNotice.tsx'
import { planFirstMatch, planFsReadOutcome, type EditorLoadAction } from './editor-load.ts'
import { openWorkbenchFile } from './intercept.tsx'
import { t } from './locales.ts'
import { relativeTo } from './paths.ts'
import { resolveWorkbenchPath } from './produced-files.ts'
import type { EditorToolbarControls, EditorToolbarState, FileViewerDescriptor } from './service.ts'
import type { WorkbenchStore, WorkbenchTab } from './workbench-store.ts'
import css from './workbench.module.css'

type EditorLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; viewer: FileViewerDescriptor; content?: string | undefined; truncated?: boolean | undefined; mediaUrl?: string | undefined; customData?: unknown }
  | { status: 'binary' }

/** The tab's persisted meta object (a malformed meta reads as empty). */
function metaOf(tab: WorkbenchTab): Record<string, unknown> {
  return tab.meta !== null && typeof tab.meta === 'object' && !Array.isArray(tab.meta)
    ? tab.meta as Record<string, unknown>
    : {}
}

export function EditorHost(props: {
  ctx: Context
  store: WorkbenchStore
  scope: SessionScope
  tab: WorkbenchTab
}) {
  const { ctx, store, scope, tab } = props
  const path = tab.path ?? ''
  const title = tab.title
  // A folder window: the model's `workbench_open` (or any caller) opens a
  // directory as an editor tab carrying `meta.dir: true` with the directory
  // as its path. It renders the file tree rooted at that folder instead of
  // the viewer loading flow (a directory is not a file).
  const isDir = metaOf(tab).dir === true
  const [load, setLoad] = useState<EditorLoad>({ status: 'loading' })
  // Manual refresh (issue #167): bumping the sequence re-runs the load effect
  // with the same path/scope — the only reload entry besides open/close.
  const [reloadSeq, setReloadSeq] = useState(0)

  // Manual refresh (issue #167 + PR #228): a dirty draft is dropped by the
  // reload (the editor instance remounts), so confirm before discarding it.
  const refreshFile = (): void => {
    if (toolbar?.dirty === true) {
      const confirmed = typeof window.confirm === 'function'
        ? window.confirm(t('refreshUnsavedConfirm'))
        : false
      if (!confirmed) return
    }
    setReloadSeq(sequence => sequence + 1)
  }

  // A path-less tab shows the empty-state hint; a folder tab (the model's
  // workbench_open of a directory) points at the explorer column instead of
  // rendering a second tree here.
  const showEmpty = path === '' || isDir

  /**
   * Open a file from the path input above: a per-path dedupe tab through
   * openWorkbenchFile (the same path the explorer column opens with).
   */
  const openFile = (absolute: string): void => {
    openWorkbenchFile(ctx, store, scope.sessionId, absolute)
  }

  // The viewer's toolbar, hoisted into THIS header: the text editor reports
  // its state and registers its commands (both null/absent for viewers
  // without a toolbar — image, pdf, binary download).
  const [toolbar, setToolbar] = useState<EditorToolbarState | null>(null)
  const controlsRef = useRef<EditorToolbarControls | null>(null)
  const onToolbarState = useCallback((next: EditorToolbarState) => {
    setToolbar(prev => prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
  }, [])
  const onToolbarControls = useCallback((controls: EditorToolbarControls | null) => {
    controlsRef.current = controls
  }, [])

  useEffect(() => {
    // A (re)load or a path-less tab clears any hoisted toolbar state — the
    // fresh viewer re-registers its own.
    setToolbar(null)
    // The seeded home tab (no path) never loads a viewer — the empty-state
    // hint renders until the user picks a file. A folder tab never loads a
    // viewer either — its tree is rooted at the folder.
    if (showEmpty || isDir) return
    let cancelled = false
    // Aborts the matched viewer's `load` when the editor tears down (tab
    // closed, path changed, session switched) or re-matches the viewer.
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    const mediaUrlOf = (): string => mediaUrl(scope, path)
    const apply = (action: EditorLoadAction): void => {
      if (cancelled) return
      switch (action.kind) {
        case 'binary':
          setLoad({ status: 'binary' })
          return
        case 'render':
          setLoad({
            status: 'ready',
            viewer: action.viewer,
            content: action.content,
            truncated: action.truncated,
            mediaUrl: action.mediaUrl,
            customData: action.customData,
          })
          return
        case 'customLoad':
          void action.viewer.load?.(path, scope, controller.signal).then((data) => {
            if (cancelled) return
            setLoad({ status: 'ready', viewer: action.viewer, customData: data })
          }).catch((error: unknown) => {
            if (cancelled) return
            setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          })
          return
        case 'fetchFsRead':
          api.fsRead(scope, path).then((result) => {
            if (cancelled) return
            // Binary reads carry the head bytes for the detect re-match.
            const outcome = planFsReadOutcome(action.viewer, {
              binary: result.kind === 'binary',
              content: result.kind === 'text' ? result.content : '',
              truncated: result.truncated,
              head: result.kind === 'binary' ? result.head : undefined,
            }, (head) => ctx.get('workbenchEngine')?.matchFileViewer(path, head), mediaUrlOf)
            apply(outcome)
          }).catch((error: unknown) => {
            if (cancelled) return
            setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          })
          return
      }
    }
    apply(planFirstMatch(ctx.get('workbenchEngine')?.matchFileViewer(path), mediaUrlOf))
    return () => { cancelled = true; controller.abort() }
    // The deps are deliberately granular: the scope object's identity churns,
    // only its sessionId / cwd fields gate the (re)fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.sessionId, scope.cwd, path, ctx, showEmpty, isDir, reloadSeq])

  // Save-then-refresh in preview mode (issue #167 part C): the edge into
  // 'saved' (never a lingering 'saved' state) triggers exactly one reload, so
  // a preview-mode Ctrl+S shows the fresh content immediately. Edit mode is
  // left alone — reloading would remount the editor and drop the caret.
  const prevSaveState = useRef<EditorToolbarState['saveState'] | undefined>(undefined)
  useEffect(() => {
    const current = toolbar?.saveState
    if (prevSaveState.current !== 'saved' && current === 'saved' && toolbar?.mode === 'preview') {
      setReloadSeq(sequence => sequence + 1)
    }
    prevSaveState.current = current
  }, [toolbar?.saveState, toolbar?.mode])

  const saveLabel = toolbar === null ? ''
    : toolbar.saveState === 'saving' ? t('loading')
      : toolbar.saveState === 'saved' ? t('saved')
        : toolbar.saveState === 'failed' ? t('saveFailed') : ''

  return (
    <div className={css.editor}>
      <div className={css.editorHeader}>
        <EditorPathInput key={path} path={path} cwd={scope.cwd} onOpen={openFile} />
        {toolbar?.modes === true && (
          <div className={css.editorModeToggle}>
            <button
              type="button"
              className={clsx(css.editorModeButton, toolbar.mode === 'preview' && css.editorModeActive)}
              onClick={() => {
                // Issue #167 part B: returning from edit to preview reloads so
                // the preview renders the just-saved content. A dirty draft
                // (or a failed save) suppresses the reload — the draft only
                // lives in the editor instance and a remount would drop it.
                if (toolbar.mode === 'edit' && toolbar.dirty !== true && toolbar.saveState !== 'failed') {
                  setReloadSeq(sequence => sequence + 1)
                }
                controlsRef.current?.setMode('preview')
              }}
            >
              {t('preview')}
            </button>
            <button
              type="button"
              className={clsx(css.editorModeButton, toolbar.mode === 'edit' && css.editorModeActive)}
              onClick={() => { controlsRef.current?.setMode('edit') }}
            >
              {t('edit')}
            </button>
          </div>
        )}
        {toolbar?.dirty === true && <span className={css.dirtyDot} title={t('unsaved')} />}
        {toolbar?.editable === true && (
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('save')}
            title={t('saveShortcut')}
            onClick={() => { controlsRef.current?.save() }}
          >
            <IconCheckOutline16 size={14} />
          </button>
        )}
        {saveLabel !== '' && (
          <span className={clsx(css.editorStatus, toolbar?.saveState === 'failed' && css.editorStatusError)}>{saveLabel}</span>
        )}
        {toolbar !== null && (
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('refresh')}
            title={t('refresh')}
            onClick={refreshFile}
          >
            <IconRefreshOutline14 size={14} />
          </button>
        )}
      </div>
      <div className={css.editorBody}>
        <div className={css.editorMain}>
          {showEmpty && <div className={css.editorPlaceholder}>{t('editorEmptyHint')}</div>}
          {!showEmpty && load.status === 'loading' && <div className={css.editorPlaceholder}>{t('loading')}</div>}
          {!showEmpty && load.status === 'error' && (isOutsideWorkspaceMessage(load.message)
            ? <FenceErrorNotice store={store} onDisabled={() => { setReloadSeq(sequence => sequence + 1) }} />
            : <div className={css.editorError}>{load.message}</div>)}
          {!showEmpty && load.status === 'binary' && <BinaryDownload scope={scope} path={path} />}
          {!showEmpty && load.status === 'ready' && createElement(load.viewer.component as unknown as ComponentType<Record<string, unknown>>, {
            ctx, store, scope, path, title,
            viewerId: load.viewer.id,
            content: load.content,
            truncated: load.truncated,
            mediaUrl: load.mediaUrl,
            customData: load.customData,
            // The viewer's toolbar always hoists into this host's header.
            toolbar: 'host',
            onToolbarState,
            onToolbarControls,
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The header's path input: shows the current file relative to the session
 * cwd (absolute when outside it). Enter resolves the typed path (relative
 * input joins onto the cwd — the same resolution `openWorkbenchFile` uses)
 * and opens it through the parent's mode-aware open (in-place switch or a
 * per-path dedupe tab); Escape/blur restores the current value. The parent
 * keys it by `path` so an in-place switch remounts and reseeds the draft.
 */
function EditorPathInput(props: { path: string; cwd: string | undefined; onOpen: (path: string) => void }) {
  const { path, cwd, onOpen } = props
  const display = path === '' ? '' : relativeTo(cwd ?? '', path)
  const [value, setValue] = useState(display)

  const commit = (): void => {
    const input = value.trim()
    if (input === '' || input === display) {
      setValue(display)
      return
    }
    onOpen(resolveWorkbenchPath(cwd, input))
    // Split mode: the open lands in a NEW/deduped editor tab — THIS tab's
    // path stays, so the input falls back to its own display value. (Merged
    // mode remounts this input on the new path; the reset is harmless.)
    setValue(display)
  }

  return (
    <input
      className={css.editorPathInput}
      value={value}
      placeholder={t('editorPathPlaceholder')}
      title={path}
      spellCheck={false}
      onChange={(event) => { setValue(event.target.value) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          setValue(display)
        }
      }}
      onBlur={() => { setValue(display) }}
    />
  )
}

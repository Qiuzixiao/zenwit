/**
 * The workspace's left column: the engine's explorer beside the workspace
 * column.
 *
 * The product keeps the three columns it always had (files / workspace /
 * conversation). The engine's own pane layout is a dock, so the explorer is
 * published as a standalone component the shell renders into its left pane:
 * the same ported tree panel, driven by the same store, opening files into
 * the workspace column's tabs through the injected engine handle.
 *
 * The pane is project-scoped: it lists `projectPath` whether or not a
 * conversation session exists yet, and keeps its own expansion state until the
 * store has a project (the store is a no-op without one). The row menu's
 * "open with" targets ride the same editor plugin settings the settings page
 * edits, so that configuration stays live.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { api } from './api.ts'
import { openWithSshActive, openWithUrl, parseOpenWithConfig, resolveOpenWithTargets } from './open-with.ts'
import { updatePluginSettings } from './plugin-settings.ts'
import type { WorkbenchEngineService } from './service.ts'
import { toggleExpanded, type WorkbenchStore } from './workbench-store.ts'
import { TreePanel } from './WorkbenchTreePanel.tsx'

/** Stable empty blob for the plugin-settings read (a fresh `?? {}` would
 *  change identity every snapshot and loop useSyncExternalStore). */
const EMPTY_PLUGIN_BLOB: Record<string, unknown> = {}

export function ExplorerPane(props: {
  store: WorkbenchStore
  /** The project directory this pane lists. */
  projectPath: string
  /** The conversation session id, or '' before one exists. */
  sessionId: string
  service?: WorkbenchEngineService | undefined
  onOpenFile: (path: string) => void
  onReferenceFile: (path: string, isDir: boolean) => void
}) {
  const { store, projectPath, sessionId, service, onOpenFile, onReferenceFile } = props
  const snapshot = useSyncExternalStore(
    useCallback((callback: () => void) => store.subscribe(callback), [store]),
    useCallback(() => store.getSnapshot(), [store]),
  )
  const state = snapshot.state

  // The row menu's "open with" configuration (pluginSettings['editor']): a
  // blob subscription, so a pin click or a settings-page edit re-renders the
  // menu immediately.
  const editorBlob = useSyncExternalStore(
    useCallback((callback: () => void) => store.subscribe(callback), [store]),
    useCallback(() => store.getSnapshot().prefs.pluginSettings['editor'] ?? EMPTY_PLUGIN_BLOB, [store]),
  )
  const openWithConfig = useMemo(() => parseOpenWithConfig(editorBlob.openWith), [editorBlob])
  const openWithTargets = useMemo(() => resolveOpenWithTargets(openWithConfig), [openWithConfig])

  /** Reveal a path in the OS file manager, or hand a target's URL to it. */
  const openWith = useCallback((targetId: string, absolute: string): void => {
    const target = openWithTargets.find(item => item.id === targetId)
    if (target === undefined) return
    if (target.kind === 'reveal') {
      void api.openExternal({ action: 'reveal', path: absolute }).catch(
        (error: unknown) => { console.error('open external failed', error) },
      )
      return
    }
    const url = openWithUrl(target, absolute, openWithConfig)
    if (url === undefined) return
    void api.openExternal({ action: 'url', url }).catch(
      (error: unknown) => { console.error('open external failed', error) },
    )
  }, [openWithConfig, openWithTargets])

  /** Toggle one target's pinned state (serialized in plugin-settings.ts). */
  const toggleOpenWithPin = useCallback((targetId: string): void => {
    updatePluginSettings(store, 'editor', (blob) => {
      const config = parseOpenWithConfig(blob.openWith)
      const pinned = config.pinned.includes(targetId)
        ? config.pinned.filter(id => id !== targetId)
        : [...config.pinned, targetId]
      return { ...blob, openWith: { ...config, pinned } }
    })
  }, [store])

  // Expansion lives in the store once a project is set; before that the pane
  // owns it, so the tree still opens and closes without a project.
  const [localExpanded, setLocalExpanded] = useState<readonly string[]>([])
  const expanded = state?.expanded ?? localExpanded
  const revealed = state?.revealed ?? []
  const toggle = useCallback((path: string) => {
    if (store.getSnapshot().state === undefined) {
      setLocalExpanded(current => current.includes(path)
        ? current.filter(item => item !== path)
        : [...current, path])
      return
    }
    store.reduce(current => toggleExpanded(current, path))
  }, [store])
  return (
    <TreePanel
      full
      store={store}
      sessionId={sessionId}
      cwd={projectPath}
      expanded={[...expanded]}
      revealed={[...revealed]}
      onToggle={toggle}
      onOpenFile={onOpenFile}
      onReferenceFile={onReferenceFile}
      openWithTargets={openWithTargets}
      openWithPinned={openWithConfig.pinned}
      openWithSsh={openWithSshActive(openWithConfig)}
      onOpenWith={openWith}
      onToggleOpenWithPin={toggleOpenWithPin}
      service={service}
    />
  )
}

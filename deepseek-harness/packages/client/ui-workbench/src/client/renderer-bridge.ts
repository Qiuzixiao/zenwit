/**
 * Adapter from the public document-renderer registry to the workbench
 * engine's viewer registry.
 *
 * Plugins contribute preview views through `ctx.documentRenderers` (the
 * package's published contract). The engine matches files by extension, so
 * every accepted renderer that declares extensions is registered as one of
 * its viewers: the engine's reader fetches the file text and the adapter
 * hands it to the plugin's view through the same props the previous
 * workbench passed. A renderer that declares only media types has no
 * extension to match on and stays unbridged until the engine grows sniffing.
 */
import { createElement, useEffect, useState, type ComponentType } from 'react'
import type { CopyProps } from './contract.ts'
import type { DocumentRenderers, PreviewViewProps } from './document-renderers.ts'
import { mediaUrl } from './workbench/api.ts'
import type { FileViewerProps } from './workbench/service.ts'

/** The engine viewer-registration face this adapter needs. */
export interface EngineViewerRegistry {
  registerFileViewer(descriptor: {
    id: string
    title: string
    exts: readonly string[]
    priority?: number
    fetchStrategy: 'fsRead'
    component: (props: FileViewerProps) => React.ReactNode
  }): () => void
}

/** Leading dot and case removed: the engine matches lowercase bare extensions. */
function bareExtension(extension: string): string {
  return extension.replace(/^\./u, '').toLowerCase()
}

/** Resolve a document-relative reference against the document's directory. */
function resolveRelative(documentPath: string, relative: string): string {
  if (relative.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(relative)) return relative
  const separator = documentPath.includes('\\') && !documentPath.includes('/') ? '\\' : '/'
  const cut = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'))
  const directory = cut === -1 ? '' : documentPath.slice(0, cut + 1)
  return directory + relative.split('/').join(separator)
}

/** Renders one bridged plugin view: loads the module, then feeds it the file. */
function BridgedView(props: {
  registry: DocumentRenderers
  t: CopyProps['t']
  viewer: FileViewerProps
}) {
  const { registry, t, viewer } = props
  const [View, setView] = useState<ComponentType<PreviewViewProps> | null>(null)
  useEffect(() => {
    let live = true
    registry.load(viewer.viewerId).then(
      (module) => { if (live) setView(() => module.View) },
      () => { /* the registry keeps the failure for the settings inventory */ },
    )
    return () => { live = false }
  }, [registry, viewer.viewerId])
  if (View === null) return null
  const descriptor = registry.describe(viewer.path)
  const scope = viewer.scope
  return createElement(View, {
    path: viewer.path,
    mediaType: descriptor.mediaType,
    source: viewer.content ?? '',
    revision: 0,
    t,
    resolve: (relative: string): string => mediaUrl(scope, resolveRelative(viewer.path, relative)),
  })
}

/**
 * Mirror every accepted document renderer into the engine's viewer registry
 * and keep the two in step while registrations come and go.
 * @param registry - the public document-renderer registry.
 * @param engine - the engine's viewer registration face.
 * @param t - the workbench copy seat handed to bridged views.
 * @returns a disposer removing every bridged viewer.
 */
export function bridgeDocumentRenderers(
  registry: DocumentRenderers,
  engine: EngineViewerRegistry,
  t: CopyProps['t'],
): () => void {
  const bridged = new Map<string, () => void>()
  const sync = (): void => {
    const live = new Set<string>()
    for (const declaration of registry.declarations()) {
      if (declaration.match.extensions === undefined || declaration.match.extensions.length === 0) continue
      live.add(declaration.id)
      if (bridged.has(declaration.id)) continue
      bridged.set(declaration.id, engine.registerFileViewer({
        id: declaration.id,
        title: declaration.id,
        exts: declaration.match.extensions.map(bareExtension),
        ...(declaration.priority === undefined ? {} : { priority: declaration.priority }),
        fetchStrategy: 'fsRead',
        component: (viewer: FileViewerProps) => createElement(BridgedView, { registry, t, viewer }),
      }))
    }
    for (const [id, dispose] of [...bridged]) {
      if (live.has(id)) continue
      dispose()
      bridged.delete(id)
    }
  }
  const off = registry.subscribe(sync)
  sync()
  return (): void => {
    off()
    for (const dispose of bridged.values()) dispose()
    bridged.clear()
  }
}

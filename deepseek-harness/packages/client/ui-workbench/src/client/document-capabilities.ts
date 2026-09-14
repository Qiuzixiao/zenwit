/** Workbench capability layer over the renderer registry: offered views and the built-in editor. */
import type { DocumentDescriptor, DocumentViewId, RendererFallbackReason } from './document-descriptor.ts'
import type { DocumentRenderers } from './document-renderers.ts'

/** The built-in editor the Workbench renders when no renderer supplies the preview view. */
export type WorkbenchEditor = 'markdown' | 'text'

/** One document as the Workbench presents it. */
export interface WorkbenchDocument {
  /** The registry's authoritative descriptor. */
  readonly descriptor: DocumentDescriptor
  /** Ordered offered views, including the built-in markdown preview when it applies. */
  readonly views: readonly DocumentViewId[]
  /** Built-in editor for text storage; undefined for binary storage. */
  readonly editor: WorkbenchEditor | undefined
  /** Whether a preview view is offered. */
  readonly hasPreview: boolean
  /** Whether preview and source can be switched, which is what enables the toolbar toggle. */
  readonly canSwitchViews: boolean
  /** Why no renderer backs the preview view, when the descriptor has none. */
  readonly fallback: RendererFallbackReason | undefined
}

/**
 * Derive how the Workbench presents one file: the registry descriptor plus the
 * built-in editor view. Markdown's visual editor is a Workbench editor, not a
 * renderer, so it is added here when no renderer supplies the preview view.
 * @param renderers - the document renderer registry.
 * @param path - the file path.
 * @param size - known byte size, or `undefined` when unknown.
 * @returns the descriptor, offered views, editor and toggle capability.
 */
export function describeWorkbenchDocument(renderers: DocumentRenderers, path: string, size?: number): WorkbenchDocument {
  const resolution = renderers.resolve(path, size)
  const descriptor = resolution.descriptor
  const markdownEditor = descriptor.renderer === null
    && descriptor.storage === 'text'
    && descriptor.mediaType === 'text/markdown'
  const withEditor: readonly DocumentViewId[] = ['preview', ...descriptor.views]
  const views = markdownEditor ? withEditor : descriptor.views
  const editor: WorkbenchEditor | undefined = descriptor.storage === 'binary'
    ? undefined
    : markdownEditor ? 'markdown' : 'text'
  return {
    descriptor,
    views,
    editor,
    hasPreview: views.includes('preview'),
    canSwitchViews: views.includes('preview') && views.includes('source'),
    fallback: resolution.fallback,
  }
}

/**
 * Pick the view to render for a document.
 * @param views - offered views in canonical order.
 * @param visualMode - the document's persisted preview preference.
 * @returns the selected view id, or `undefined` when the document offers no view.
 */
export function selectedView(views: readonly DocumentViewId[], visualMode: boolean): DocumentViewId | undefined {
  if (views.includes('source')) return visualMode && views.includes('preview') ? 'preview' : 'source'
  return views[0]
}

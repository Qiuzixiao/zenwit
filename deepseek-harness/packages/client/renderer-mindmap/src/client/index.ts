/**
 * Mindmap renderer plugin, browser half: contributes a `.mm` preview to the
 * Workbench registry. The package is independent of the kernel: it declares its
 * contract version as data and reaches the registry through `ctx.documentRenderers`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { DocumentRenderers } from '@deepseek-ai/dsh-client-ui-workbench/preview'
import { MindmapView } from './MindmapView.tsx'

/** Renderer identity: reverse-domain and stable across releases. */
const MINDMAP_RENDERER_ID = 'community/mindmap'

/** Contract version this plugin declares; the registry soft-rejects a mismatch. */
const MINDMAP_CONTRACT = 1

/** Declared byte budget for a mindmap draft. */
const MINDMAP_MAX_BYTES = 4 * 1024 * 1024

/** Required service: the Workbench document renderer registry. */
export const inject = ['documentRenderers']

/**
 * Client plugin body: register the mindmap preview for `.mm` documents.
 * @param ctx - client root context, carrying the declared `documentRenderers` service.
 */
export function apply(ctx: Context): void {
  const registry: DocumentRenderers = ctx.documentRenderers
  ctx.effect(() => registry.register({
    id: MINDMAP_RENDERER_ID,
    contract: MINDMAP_CONTRACT,
    match: { extensions: ['.mm'] },
    views: ['preview'],
    maxBytes: MINDMAP_MAX_BYTES,
    load: async () => ({ View: MindmapView }),
  }), 'renderer-mindmap: renderer')
}

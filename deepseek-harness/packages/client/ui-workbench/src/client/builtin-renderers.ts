/** Kernel built-in read-only renderers. The Workbench renders these itself; they carry no loader. */
import { DOCUMENT_RENDERER_CONTRACT } from './document-descriptor.ts'
import type { RendererDeclaration, RendererId } from './document-descriptor.ts'
import type { DocumentRenderers } from './document-renderers.ts'

/** Renderer ids of the kernel's read-only previews. */
export const BUILTIN_RENDERER_IDS = {
  html: 'builtin/html',
  svg: 'builtin/svg',
  image: 'builtin/image',
  pdf: 'builtin/pdf',
  video: 'builtin/video',
  audio: 'builtin/audio',
} as const

const BUILTIN_ID_SET: ReadonlySet<string> = new Set(Object.values(BUILTIN_RENDERER_IDS))

/**
 * Whether a renderer id names a kernel built-in the Workbench renders itself.
 * @param id - the descriptor's selected renderer id.
 * @returns whether the id is a built-in read-only preview.
 */
export function isBuiltinRendererId(id: RendererId): boolean {
  return BUILTIN_ID_SET.has(id)
}

/**
 * The built-in read-only declarations. `image/*` is intentionally a wildcard:
 * an exact media-type match outranks it, so a future format-specific built-in
 * can be added without touching this row.
 */
export const BUILTIN_RENDERER_DECLARATIONS: readonly RendererDeclaration[] = [
  { id: BUILTIN_RENDERER_IDS.html, contract: DOCUMENT_RENDERER_CONTRACT, match: { mediaTypes: ['text/html'] }, views: ['preview'] },
  { id: BUILTIN_RENDERER_IDS.svg, contract: DOCUMENT_RENDERER_CONTRACT, match: { mediaTypes: ['image/svg+xml'] }, views: ['preview'] },
  { id: BUILTIN_RENDERER_IDS.pdf, contract: DOCUMENT_RENDERER_CONTRACT, match: { mediaTypes: ['application/pdf'] }, views: ['preview'] },
  { id: BUILTIN_RENDERER_IDS.image, contract: DOCUMENT_RENDERER_CONTRACT, match: { mediaTypes: ['image/*'] }, views: ['preview'] },
  { id: BUILTIN_RENDERER_IDS.video, contract: DOCUMENT_RENDERER_CONTRACT, match: { mediaTypes: ['video/*'] }, views: ['preview'] },
  { id: BUILTIN_RENDERER_IDS.audio, contract: DOCUMENT_RENDERER_CONTRACT, match: { mediaTypes: ['audio/*'] }, views: ['preview'] },
]

/**
 * Register every built-in read-only renderer.
 * @param renderers - the Workbench registry to populate.
 * @returns one disposer removing every built-in registered here.
 */
export function registerBuiltinRenderers(renderers: DocumentRenderers): () => void {
  const disposers = BUILTIN_RENDERER_DECLARATIONS.map(declaration => renderers.registerBuiltin(declaration))
  return (): void => { for (const dispose of disposers) dispose() }
}

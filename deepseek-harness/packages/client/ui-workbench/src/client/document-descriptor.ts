/** Pure document-capability derivation: one descriptor for the file tree, tabs, editor header and save guard. */
import { extensionForPath, isTextMediaType, mediaTypeForPath } from '@deepseek-ai/dsh-util-media-type'

/** Contract version this build implements; a contribution must declare it exactly. */
export const DOCUMENT_RENDERER_CONTRACT = 1

/** How a document is stored: editable UTF-8 text, or bytes that must never be decoded as text. */
export type StorageClass = 'text' | 'binary'

/** View ids a document can expose; declaration merging adds ids the way the slot maps do. */
export interface DocumentViewMap { source: true; preview: true }
/** One known view id; declaration merge of {@link DocumentViewMap} extends the union. */
export type DocumentViewId = keyof DocumentViewMap & string

/** Canonical view order; the first derived view is the default. */
const VIEW_ORDER: readonly DocumentViewId[] = ['preview', 'source']
const KNOWN_VIEWS: ReadonlySet<string> = new Set(VIEW_ORDER)

/** Opaque renderer identity: reverse-domain, globally unique, immutable after publication. */
export type RendererId = string

/** Declarative match data: pure values only, so "who claims .mm" is answerable without loading plugin code. */
export interface RendererMatch {
  readonly extensions?: readonly string[]
  readonly mediaTypes?: readonly string[]
}

/** The data half of a renderer contribution, separable from the lazy `load()` the service adds. */
export interface RendererDeclaration {
  readonly id: RendererId
  readonly contract: number
  readonly match: RendererMatch
  readonly views: readonly DocumentViewId[]
  readonly priority?: number
  readonly maxBytes?: number
}

/** The single authoritative description of a file's presentation; derived, never constructed by a plugin. */
export interface DocumentDescriptor {
  readonly path: string
  readonly mediaType: string
  readonly storage: StorageClass
  readonly views: readonly DocumentViewId[]
  readonly renderer: RendererId | null
  readonly size: number | undefined
}

/** Why a descriptor carries no renderer. */
export type RendererFallbackReason =
  | { readonly kind: 'none' }
  | { readonly kind: 'load-failed'; readonly id: RendererId }
  | { readonly kind: 'over-limit'; readonly id: RendererId; readonly maxBytes: number }

/** A descriptor plus the fallback reason present only when it has no renderer. */
export interface DocumentResolution {
  readonly descriptor: DocumentDescriptor
  readonly fallback?: RendererFallbackReason
}

/** Accepted declarations plus the built-in id set and renderer ids whose module load failed. */
export interface RendererRegistryState {
  readonly declarations: readonly RendererDeclaration[]
  readonly builtinIds: ReadonlySet<RendererId>
  readonly failedIds: ReadonlySet<RendererId>
}

/** Why a declaration was soft-rejected; the reason is shown in the renderer inventory. */
export type RegistrationRejection =
  | { readonly kind: 'contract'; readonly declared: number; readonly required: number }
  | { readonly kind: 'duplicate-id'; readonly id: RendererId }
  | { readonly kind: 'invalid'; readonly field: 'id' | 'match' | 'priority' | 'maxBytes' | 'load' }

/** Specificity of an exact media-type match, the strongest rank in the total order. */
export const EXACT_MEDIA_TYPE_SPECIFICITY = 3
/** Specificity of a filename-extension match, ranking below an exact media type. */
export const EXTENSION_SPECIFICITY = 2
/** Specificity of a wildcard media-type match such as `image/*`, the weakest rank. */
export const WILDCARD_MEDIA_TYPE_SPECIFICITY = 1

/**
 * Resolve the storage class a media type implies.
 * @param mediaType - the declared or detected MIME type, or `undefined` when unknown.
 * @returns `binary` for a known non-text type, `text` otherwise; unknown defaults to text.
 */
export function storageClassFor(mediaType: string | undefined): StorageClass {
  return mediaType === undefined || isTextMediaType(mediaType) ? 'text' : 'binary'
}

/**
 * The MIME type a descriptor reports when nothing declared one.
 * @param storage - the resolved storage class.
 * @returns `text/plain` for text storage, `application/octet-stream` otherwise.
 */
export function defaultMediaTypeFor(storage: StorageClass): string {
  return storage === 'text' ? 'text/plain' : 'application/octet-stream'
}

/** Whether a wildcard pattern such as `image/*` covers a concrete media type. */
function wildcardMatches(pattern: string, mediaType: string): boolean {
  const slash = pattern.indexOf('/')
  if (slash === -1 || pattern.slice(slash + 1) !== '*') return false
  const typeSlash = mediaType.indexOf('/')
  if (typeSlash === -1) return false
  return pattern.slice(0, slash) === mediaType.slice(0, typeSlash)
}

/**
 * Rank how specifically a declaration matches one file, or report no match.
 * @param match - the declaration's pure match data.
 * @param path - the file path; its final extension is compared without a leading dot.
 * @param mediaType - the file's declared MIME type, or `undefined` when unknown.
 * @returns 3 for an exact media type, 2 for an extension, 1 for a wildcard media type, or `undefined` when nothing matches.
 */
export function matchSpecificity(match: RendererMatch, path: string, mediaType: string | undefined): number | undefined {
  if (mediaType !== undefined && match.mediaTypes?.includes(mediaType)) return EXACT_MEDIA_TYPE_SPECIFICITY
  const extension = extensionForPath(path)
  if (extension !== undefined && match.extensions?.some(candidate => candidate.replace(/^\./u, '').toLowerCase() === extension)) {
    return EXTENSION_SPECIFICITY
  }
  if (mediaType !== undefined && match.mediaTypes?.some(pattern => wildcardMatches(pattern, mediaType))) {
    return WILDCARD_MEDIA_TYPE_SPECIFICITY
  }
  return undefined
}

interface ScoredCandidate {
  readonly declaration: RendererDeclaration
  readonly specificity: number
  readonly priority: number
  readonly builtin: boolean
}

/** The four-segment total order: priority desc, specificity desc, builtin first, id asc. */
function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  return b.priority - a.priority
    || b.specificity - a.specificity
    || Number(b.builtin) - Number(a.builtin)
    || (a.declaration.id < b.declaration.id ? -1 : a.declaration.id > b.declaration.id ? 1 : 0)
}

/**
 * Select the declaration that wins the total order for one file.
 * @param path - the file path.
 * @param mediaType - the file's declared MIME type, or `undefined` when unknown.
 * @param declarations - the accepted declarations to consider.
 * @param builtinIds - ids treated as kernel built-ins, which win an otherwise exact tie.
 * @returns the winning declaration, or `undefined` when none matches.
 */
export function selectRenderer(
  path: string,
  mediaType: string | undefined,
  declarations: readonly RendererDeclaration[],
  builtinIds: ReadonlySet<RendererId>,
): RendererDeclaration | undefined {
  let winner: ScoredCandidate | undefined
  for (const declaration of declarations) {
    const specificity = matchSpecificity(declaration.match, path, mediaType)
    if (specificity === undefined) continue
    const candidate: ScoredCandidate = {
      declaration,
      specificity,
      priority: declaration.priority ?? 0,
      builtin: builtinIds.has(declaration.id),
    }
    if (winner === undefined || compareCandidates(candidate, winner) < 0) winner = candidate
  }
  return winner?.declaration
}

/**
 * Derive the ordered views a document exposes: renderer views first, then source for text storage.
 * @param storage - the resolved storage class.
 * @param rendererViews - the selected renderer's declared views; ids this build does not know are dropped, not rejected.
 * @returns known view ids in canonical order.
 */
export function deriveViews(storage: StorageClass, rendererViews: readonly string[]): readonly DocumentViewId[] {
  const available = new Set<string>(rendererViews.filter(view => KNOWN_VIEWS.has(view)))
  if (storage === 'text') available.add('source')
  return VIEW_ORDER.filter(view => available.has(view))
}

function descriptorOf(
  path: string,
  mediaType: string,
  storage: StorageClass,
  renderer: RendererId | null,
  rendererViews: readonly string[],
  size: number | undefined,
): DocumentDescriptor {
  return { path, mediaType, storage, views: deriveViews(storage, rendererViews), renderer, size }
}

/**
 * Derive the authoritative descriptor for one file.
 * @param path - the file path.
 * @param state - accepted declarations, built-in ids, and ids whose `load()` failed.
 * @param size - known byte size, or `undefined` when unknown.
 * @returns the descriptor plus the fallback reason when no renderer is usable.
 */
export function describeDocument(path: string, state: RendererRegistryState, size?: number): DocumentResolution {
  const mediaType = mediaTypeForPath(path)
  const storage = storageClassFor(mediaType)
  const resolvedMediaType = mediaType ?? defaultMediaTypeFor(storage)
  const declaration = selectRenderer(path, mediaType, state.declarations, state.builtinIds)
  if (declaration === undefined) {
    return { descriptor: descriptorOf(path, resolvedMediaType, storage, null, [], size), fallback: { kind: 'none' } }
  }
  if (state.failedIds.has(declaration.id)) {
    return { descriptor: descriptorOf(path, resolvedMediaType, storage, null, [], size), fallback: { kind: 'load-failed', id: declaration.id } }
  }
  if (size !== undefined && declaration.maxBytes !== undefined && size > declaration.maxBytes) {
    return {
      descriptor: descriptorOf(path, resolvedMediaType, storage, null, [], size),
      fallback: { kind: 'over-limit', id: declaration.id, maxBytes: declaration.maxBytes },
    }
  }
  return { descriptor: descriptorOf(path, resolvedMediaType, storage, declaration.id, declaration.views, size) }
}

/**
 * Validate one declaration against the supported contract and the already-accepted ids.
 * @param declaration - the candidate declaration.
 * @param acceptedIds - ids already registered.
 * @param contractVersion - the contract version this build implements.
 * @returns the rejection, or `undefined` when the declaration is acceptable.
 */
export function validateDeclaration(
  declaration: RendererDeclaration,
  acceptedIds: ReadonlySet<RendererId>,
  contractVersion: number,
): RegistrationRejection | undefined {
  if (declaration.id.trim().length === 0) return { kind: 'invalid', field: 'id' }
  if (!Number.isInteger(declaration.contract) || declaration.contract !== contractVersion) {
    return { kind: 'contract', declared: declaration.contract, required: contractVersion }
  }
  if (acceptedIds.has(declaration.id)) return { kind: 'duplicate-id', id: declaration.id }
  if ((declaration.match.extensions?.length ?? 0) === 0 && (declaration.match.mediaTypes?.length ?? 0) === 0) {
    return { kind: 'invalid', field: 'match' }
  }
  if (declaration.priority !== undefined && !Number.isFinite(declaration.priority)) return { kind: 'invalid', field: 'priority' }
  if (declaration.maxBytes !== undefined && (!Number.isFinite(declaration.maxBytes) || declaration.maxBytes <= 0)) {
    return { kind: 'invalid', field: 'maxBytes' }
  }
  return undefined
}

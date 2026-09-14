/**
 * Pure FreeMind `.mm` parsing: bounded, DOCTYPE-rejecting, and independent of
 * React so every security rule has a table-driven unit test.
 * @module @deepseek-ai/dsh-client-renderer-mindmap/mindmap
 */

/** One parsed mindmap node: whitelisted attributes plus flattened text. */
export interface MindmapNode {
  /** Display text: flattened `richcontent` text when present, otherwise `TEXT`. */
  readonly text: string
  readonly position: string | undefined
  readonly style: string | undefined
  readonly folded: boolean
  readonly children: readonly MindmapNode[]
}

/** Hard bounds on parse cost and rendered size. */
export interface MindmapLimits {
  readonly maxNodes: number
  readonly maxDepth: number
  readonly maxCharacters: number
}

/** Defaults matching the renderer contribution's declared 4 MiB budget. */
export const MINDMAP_LIMITS: MindmapLimits = Object.freeze({ maxNodes: 5000, maxDepth: 64, maxCharacters: 4 * 1024 * 1024 })

/** Why a document is not a renderable mindmap. */
export type MindmapFailure = 'empty' | 'doctype' | 'too-large' | 'malformed' | 'shape' | 'nodes' | 'depth'

/** Parse outcome: the root node, or the reason the document was refused. */
export type MindmapParseResult =
  | { readonly ok: true; readonly root: MindmapNode }
  | { readonly ok: false; readonly reason: MindmapFailure }

/** Attribute names copied to the tree; every other attribute is ignored, never spread. */
const WHITELIST: ReadonlySet<string> = new Set(['TEXT', 'POSITION', 'STYLE', 'FOLDED'])

/** Read one element's whitelisted attributes, uppercased. */
function readAttributes(element: Element): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toUpperCase()
    if (WHITELIST.has(name)) attributes[name] = attribute.value
  }
  return attributes
}

/**
 * Read one node and its descendants.
 * @param element - the `node` element.
 * @param depth - zero-based depth of this node.
 * @param state - mutable node counter.
 * @param limits - hard bounds.
 * @returns the node, or the exceeded bound's failure name.
 */
function readNode(element: Element, depth: number, state: { count: number }, limits: MindmapLimits): MindmapNode | 'nodes' | 'depth' {
  state.count += 1
  if (state.count > limits.maxNodes) return 'nodes'
  if (depth > limits.maxDepth) return 'depth'
  const attributes = readAttributes(element)
  const rich = [...element.children].find(child => child.tagName.toLowerCase() === 'richcontent')
  const richText = rich?.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
  const children: MindmapNode[] = []
  for (const child of [...element.children]) {
    if (child.tagName.toLowerCase() !== 'node') continue
    const parsed = readNode(child, depth + 1, state, limits)
    if (typeof parsed === 'string') return parsed
    children.push(parsed)
  }
  return {
    text: richText.length > 0 ? richText : attributes.TEXT ?? '',
    position: attributes.POSITION,
    style: attributes.STYLE,
    folded: attributes.FOLDED?.toLowerCase() === 'true',
    children,
  }
}

/**
 * Parse a FreeMind document into a bounded node tree.
 * @param xml - the complete document text.
 * @param limits - hard node, depth and character bounds.
 * @returns the root node, or the refusal reason.
 */
export function parseMindmap(xml: string, limits: MindmapLimits = MINDMAP_LIMITS): MindmapParseResult {
  const trimmed = xml.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (/<!\s*DOCTYPE/iu.test(trimmed)) return { ok: false, reason: 'doctype' }
  if (trimmed.length > limits.maxCharacters) return { ok: false, reason: 'too-large' }
  const parsed = new DOMParser().parseFromString(trimmed, 'application/xml')
  if (parsed.querySelector('parsererror') !== null) return { ok: false, reason: 'malformed' }
  const map = parsed.documentElement
  if (map.tagName.toLowerCase() !== 'map') return { ok: false, reason: 'shape' }
  const root = [...map.children].find(child => child.tagName.toLowerCase() === 'node')
  if (root === undefined) return { ok: false, reason: 'shape' }
  const read = readNode(root, 0, { count: 0 }, limits)
  return typeof read === 'string' ? { ok: false, reason: read } : { ok: true, root: read }
}

/** Filesystem paths and persistent document-tab metadata, separate from shell rendering. */
export const DOCUMENT_TABS_STORAGE_PREFIX = 'zenwit.document-tabs.'

/** One real tree node: a directory or file under the project root. */
export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  /** Word count for .md files, byte size for others, '' for directories. */
  detail: string
  children?: TreeNode[]
}

/** The active project's file tree and its root directory. */
export interface StructureResponse {
  path: string
  tree: TreeNode[]
  root: string
  /** True when the host entry budget cut the tree short; absent on hosts that do not bound scans. */
  truncated?: boolean
}

/** One open editor tab: disk content, the live draft, and its save or conflict state. */
export interface OpenDocument {
  path: string
  name: string
  /** Text encoding the file is stored in; echoed back on save so it is preserved. */
  encoding: string
  content: string
  draft: string
  dirty: boolean
  saving: boolean
  saveStatus: string | null
  visualMode: boolean
  externalUpdate?: { content: string } | undefined
  conflict?: { content: string | null } | undefined
  syncError?: string | undefined
}

/** Tab metadata persisted per project so reopened tabs survive a reload. */
export interface PersistedDocumentTabs {
  activePath: string | null
  documents: Array<Pick<OpenDocument, 'path' | 'name' | 'visualMode'>>
}

/**
 * Join a file-manager node name onto its parent with the parent's separator.
 * @param parent - parent directory path.
 * @param name - child name.
 * @returns the joined path.
 */
export function nodePath(parent: string, name: string): string {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return parent.replace(/[/\\]$/u, '') + separator + name
}

/**
 * Take the final segment of a POSIX or Windows path.
 * @param path - the path to split.
 * @returns the final segment, or an empty string when none exists.
 */
export function nodeBasename(path: string): string {
  return path.split(/[/\\]/u).pop() ?? ''
}

/**
 * Return the path suffix below a parent, or null when the path is not a descendant.
 * @param path - candidate absolute path.
 * @param parent - ancestor directory.
 * @returns the suffix including its leading separator, or null.
 */
export function descendantSuffix(path: string, parent: string): string | null {
  if (path === parent) return ''
  return path.startsWith(parent + '/') || path.startsWith(parent + '\\')
    ? path.slice(parent.length)
    : null
}

/**
 * Accept only a file lexically below the active project root.
 * @param path - candidate absolute path.
 * @param projectPath - active project directory.
 * @returns whether the path stays inside the project without a `..` segment.
 */
export function isProjectFilePath(path: string, projectPath: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedProject = projectPath.replace(/[\\/]+$/u, '').replaceAll('\\', '/')
  if (normalizedPath === normalizedProject || !normalizedPath.startsWith(normalizedProject + '/')) return false
  return normalizedPath.slice(normalizedProject.length + 1).split('/').every(segment => segment !== '..')
}

/**
 * Read the persisted tab metadata for one project.
 * @param projectPath - active project directory.
 * @returns valid persisted tabs, or null when absent or malformed.
 */
export function readPersistedTabs(projectPath: string): PersistedDocumentTabs | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DOCUMENT_TABS_STORAGE_PREFIX + projectPath) ?? 'null') as Partial<PersistedDocumentTabs> | null
    if (parsed === null || !Array.isArray(parsed.documents)) return null
    const documents = parsed.documents.filter((item): item is PersistedDocumentTabs['documents'][number] =>
      typeof item?.path === 'string' && isProjectFilePath(item.path, projectPath) && typeof item.name === 'string' && typeof item.visualMode === 'boolean')
    const activePath = typeof parsed.activePath === 'string' && documents.some(item => item.path === parsed.activePath) ? parsed.activePath : documents[0]?.path ?? null
    return { activePath, documents }
  } catch {
    return null
  }
}

/**
 * Flatten a project tree to its file nodes in traversal order.
 * @param nodes - tree nodes to walk.
 * @returns every descendant file node.
 */
export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap(node => node.kind === 'file' ? [node] : flattenFiles(node.children ?? []))
}

/**
 * Keep tree nodes whose path matches, preserving matching ancestors.
 * @param nodes - tree nodes to filter.
 * @param query - case-insensitive path substring; empty keeps everything.
 * @returns the filtered tree.
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes
  const needle = query.trim().toLocaleLowerCase()
  return nodes.flatMap(node => {
    const children = filterTree(node.children ?? [], query)
    if (node.path.toLocaleLowerCase().includes(needle)) return [node]
    return children.length > 0 ? [{ ...node, children }] : []
  })
}

/**
 * Normalize a chat file target, rejecting remote URLs and traversal outside the project.
 * @param url - path or local file URL.
 * @param projectPath - current project directory.
 * @returns absolute path beneath the current project.
 */
export function resolveFilePath(url: string, projectPath: string | undefined): string {
  if (!projectPath) throw new Error('No active project')
  let path = url
  if (url.startsWith('file:')) {
    const parsed = new URL(url)
    if (parsed.hostname && parsed.hostname !== 'localhost') throw new Error('Remote file URLs are not supported')
    path = decodeURIComponent(parsed.pathname)
    if (/^\/[A-Za-z]:\//u.test(path)) path = path.slice(1)
  } else if (/^[a-z][a-z0-9+.-]*:/iu.test(url) && !/^[A-Za-z]:[\\/]/u.test(url)) {
    throw new Error('Only local files can be opened in the editor')
  }
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(path)) path = nodePath(projectPath, path)
  if (!isProjectFilePath(path, projectPath)) throw new Error('File is outside the active project')
  return path
}

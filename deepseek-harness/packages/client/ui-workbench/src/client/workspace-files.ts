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

export interface StructureResponse {
  path: string
  tree: TreeNode[]
  root: string
}

export interface OpenDocument {
  path: string
  name: string
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

export interface PersistedDocumentTabs {
  activePath: string | null
  documents: Array<Pick<OpenDocument, 'path' | 'name' | 'visualMode'>>
}

export function nodePath(parent: string, name: string): string {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return parent.replace(/[/\\]$/u, '') + separator + name
}

export function nodeBasename(path: string): string {
  return path.split(/[/\\]/u).pop() ?? ''
}

export function descendantSuffix(path: string, parent: string): string | null {
  if (path === parent) return ''
  return path.startsWith(parent + '/') || path.startsWith(parent + '\\')
    ? path.slice(parent.length)
    : null
}

/** Accept only a file lexically below the active project root. */
export function isProjectFilePath(path: string, projectPath: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedProject = projectPath.replace(/[\\/]+$/u, '').replaceAll('\\', '/')
  if (normalizedPath === normalizedProject || !normalizedPath.startsWith(normalizedProject + '/')) return false
  return normalizedPath.slice(normalizedProject.length + 1).split('/').every(segment => segment !== '..')
}

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

export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap(node => node.kind === 'file' ? [node] : flattenFiles(node.children ?? []))
}

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

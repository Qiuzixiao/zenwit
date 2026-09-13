/** Strict loopback HTTP handlers for the Zenwit project library API. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, type Dirent,
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { streamProjectFileEvents } from './project-file-events.js'
import { DocumentRecoveryStore } from './document-recovery.js'
import { normalizeProjectTags, readProjectTags, type ProjectSummary } from './types.js'
import { BodyTooLargeError, isJsonRequest, isSameOriginLoopbackRequest, readJson } from './http-security.js'

import { ProjectRegistry } from './registry.js'

export interface WorkspaceOptions {
  /** Private application data, independent of the kernel and desktop. */
  homeDir?: string
  projectsDir?: string
  /** Trusted configured origin; never derive this from request headers. */
  expectedOrigin: string
  nativeAction?: (action: 'reveal' | 'terminal', path: string) => void | Promise<void>
}

export const PROJECT_API_PATHS = ['', '/adopt', '/forget', '/delete', '/structure', '/resources', '/node', '/import', '/changes', '/file', '/reveal', '/terminal'].map(suffix => '/api/desktop/projects' + suffix)

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  /** Word count for .md files, byte size for others, '' for directories. */
  detail: string
  children?: TreeNode[]
}

export interface ProjectResource {
  name: string
  path: string
  kind: 'file'
  detail: string
}

export function createWorkspaceBackend(options: WorkspaceOptions) {
  const homeDir = resolve(options.homeDir ?? process.env.ZENWIT_HOME ?? join(homedir(), '.zenwit'))
  const projectsDir = resolve(options.projectsDir ?? process.env.ZENWIT_PROJECTS_DIR ?? join(homedir(), 'Zenwit', 'projects'))
  if (homeDir === projectsDir || homeDir.startsWith(projectsDir + sep) || projectsDir.startsWith(homeDir + sep)) {
    throw new Error('application home and projects directory must be separate')
  }
  // Validate configured roots even before the first project is created.
  canonicalPath(homeDir)
  canonicalPath(projectsDir)
  const registry = new ProjectRegistry(join(homeDir, 'workspace', 'projects.json'))
  const subscriptions = new Set<() => void>()
  let disposed = false

  const PROJECT_METADATA_DIR = '.zenwit-project'
  const MAX_PROJECT_BODY_BYTES = 2 * 1024 * 1024
  const MAX_PROJECT_IMPORT_BYTES = 100 * 1024 * 1024
  const INVALID_BODY = Symbol('invalid project body')

  function projectSlug(name: string): string {
    const slug = name.trim()
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-')
      .replace(/\s+/gu, '-')
      .replace(/-+/gu, '-')
      .replace(/^[.-]+|[.-]+$/gu, '')
      .slice(0, 80)
    return slug.length > 0 ? slug : 'project'
  }

  function readSummary(dir: string): ProjectSummary | undefined {
    if (registry.get(dir) === undefined) return undefined
    let agentId: string | undefined
    let tags: string[] = []
    try {
      const metadata = readMetadata(dir) as { agentId?: unknown, tags?: unknown }
      if (typeof metadata.agentId === 'string' && metadata.agentId.trim() !== '') agentId = metadata.agentId.trim()
      tags = readProjectTags(metadata.tags)
    } catch {
      // Metadata is optional for existing folders.
    }
    const base = { name: basename(dir), path: dir, tags, canDelete: dirname(dir) === canonicalPath(projectsDir) && readMetadata(dir).external !== true, ...(agentId === undefined ? {} : { agentId }) }
    try {
      const stat = statSync(canonicalPath(dir))
      return { ...base, updatedAt: stat.mtimeMs, available: stat.isDirectory() }
    } catch {
      return { ...base, updatedAt: 0, available: false }
    }
  }

  function readMetadata(projectRoot: string): Record<string, unknown> {
    return registry.get(projectRoot) ?? {}
  }

  function writeProjectMetadata(projectRoot: string, metadata: Record<string, unknown>): void {
    registry.set(projectRoot, metadata)
  }

  function finishJson(res: ServerResponse, status: number, value: unknown): void {
    res.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    })
    res.end(JSON.stringify(value))
  }

  function authorize(req: IncomingMessage, res: ServerResponse, expectedOrigin: string, mutating: boolean): boolean {
    if (isSameOriginLoopbackRequest(req, expectedOrigin, mutating)) return true
    finishJson(res, 403, { error: 'forbidden' })
    return false
  }

  async function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | typeof INVALID_BODY> {
    if (!isJsonRequest(req)) {
      finishJson(res, 415, { error: 'content type must be application/json' })
      return INVALID_BODY
    }
    try {
      const value = await readJson(req, MAX_PROJECT_BODY_BYTES)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('JSON object required')
      return value
    } catch (error) {
      const tooLarge = error instanceof BodyTooLargeError
      finishJson(res, tooLarge ? 413 : 400, { error: tooLarge ? 'request body is too large' : 'invalid JSON body' })
      return INVALID_BODY
    }
  }

  /** GET /api/desktop/projects — list generic projects under the library root. */
  async function handleProjectLibraryListRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, false)) return
    const root = projectsDir
    const projects = registry.paths()
      .map(path => readSummary(path))
      .filter((summary): summary is ProjectSummary => summary !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return finishJson(res, 200, { root, projects })
  }

  /** Explicit user adoption grants access; forgetting never touches project contents. */
  async function handleProjectRegistration(req: IncomingMessage, res: ServerResponse, origin: string, forget: boolean): Promise<void> {
    if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, origin, true)) return
    const body = await readBody(req, res)
    if (body === INVALID_BODY) return
    const path = body && typeof body === 'object' ? (body as Record<string, unknown>).path : undefined
    if (typeof path !== 'string' || !isAbsolute(path) || hasTraversalSegment(path)) return finishJson(res, 400, { error: 'absolute project path is required' })
    const target = canonicalPath(path)
    if (forget) {
      registry.delete(target)
      return finishJson(res, 200, { ok: true })
    }
    const home = canonicalPath(homeDir)
    const library = canonicalPath(projectsDir)
    if (target === dirname(target) || target === home || target.startsWith(home + sep) || home.startsWith(target + sep)
      || target === library || library.startsWith(target + sep)) return finishJson(res, 403, { error: 'private application data and library roots cannot be projects' })
    if (!existsSync(target) || !statSync(target).isDirectory()) return finishJson(res, 404, { error: 'project directory does not exist' })
    if (registry.get(target) === undefined) registry.set(target, { tags: [], external: true })
    return finishJson(res, 200, { project: readSummary(target) })
  }

  /** POST /api/desktop/projects — create a new generic project directory. */
  async function handleProjectLibraryCreateRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, true)) return
    const body = await readBody(req, res)
    if (body === INVALID_BODY) return
    const rawName = typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).name
      : undefined
    const rawAgentId = typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).agentId
      : undefined
    const rawTags = typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).tags
      : undefined
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (name.length === 0) return finishJson(res, 400, { error: 'project name must not be empty' })
    let tags: string[]
    try { tags = normalizeProjectTags(rawTags ?? []) } catch (error) {
      return finishJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    const parent = projectsDir
    let projectRoot = ''
    try {
      mkdirSync(parent, { recursive: true })
      const slug = projectSlug(name)
      projectRoot = join(parent, slug)
      for (let index = 1; index < 1000; index += 1) {
        if (!existsSync(projectRoot)) break
        projectRoot = join(parent, slug + '-' + String(index + 1))
      }
      if (!validNodeName(basename(projectRoot))) return finishJson(res, 400, { error: 'invalid project name' })
      mkdirSync(projectRoot)
      const agentId = typeof rawAgentId === 'string' && rawAgentId.trim() !== '' ? rawAgentId.trim() : undefined
      try { writeProjectMetadata(projectRoot, { ...(agentId ? { agentId } : {}), tags }) }
      catch (error) { rmSync(projectRoot, { recursive: true }); throw error }
    } catch (error) {
      return finishJson(res, error instanceof PathError ? 403 : 500, { error: error instanceof Error ? error.message : String(error) })
    }
    const project = readSummary(projectRoot)
    if (project === undefined) return finishJson(res, 500, { error: 'created project could not be summarized' })
    return finishJson(res, 200, { project })
  }

  /** PATCH /api/desktop/projects — replace one project's user-owned tags. */
  async function handleProjectTagsUpdateRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'PATCH') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, true)) return
    const body = await readBody(req, res)
    if (body === INVALID_BODY) return
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    if (typeof record.path !== 'string' || record.path.trim().length === 0) {
      return finishJson(res, 400, { error: 'project path is required' })
    }
    let tags: string[]
    try { tags = normalizeProjectTags(record.tags) } catch (error) {
      return finishJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    const target = canonicalPath(record.path.trim())
    if (!isRegisteredProject(target)) return finishJson(res, 404, { error: 'project does not exist' })
    try {
      writeProjectMetadata(target, { ...readMetadata(target), tags })
    } catch (error) {
      return finishJson(res, error instanceof PathError ? 403 : 500, { error: error instanceof Error ? error.message : String(error) })
    }
    const project = readSummary(target)
    if (project === undefined) return finishJson(res, 500, { error: 'updated project could not be summarized' })
    return finishJson(res, 200, { project })
  }

  /** POST /api/desktop/projects/delete — permanently remove one project directory. */
  async function handleProjectLibraryDeleteRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, true)) return
    const body = await readBody(req, res)
    if (body === INVALID_BODY) return
    const rawPath = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).path : undefined
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) return finishJson(res, 400, { error: 'project path is required' })
    const root = canonicalPath(projectsDir)
    const target = canonicalPath(rawPath.trim())
    if (target === root || dirname(target) !== root || !isInsideLibrary(target)) {
      return finishJson(res, 403, { error: 'path must be a registered project directly under the project library' })
    }
    if (!isRegisteredProject(target)) return finishJson(res, 404, { error: 'project does not exist' })
    if (readMetadata(target).external === true) return finishJson(res, 403, { error: 'external projects can only be removed from the library' })
    try {
      rmSync(target, { recursive: true, force: false })
      registry.delete(target)
    } catch (error) {
      return finishJson(res, error instanceof PathError ? 403 : 500, { error: error instanceof Error ? error.message : String(error) })
    }
    return finishJson(res, 200, { ok: true, path: target })
  }


  /** Route dispatch: GET lists, POST creates. */
  async function handleProjectLibraryRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method === 'GET') return handleProjectLibraryListRequest(req, res, expectedOrigin)
    if (req.method === 'PATCH') return handleProjectTagsUpdateRequest(req, res, expectedOrigin)
    if (req.method === 'POST') {
      const url = new URL(req.url ?? '', 'http://localhost')
      if (url.searchParams.get('action') === 'delete') return handleProjectLibraryDeleteRequest(req, res, expectedOrigin)
      return handleProjectLibraryCreateRequest(req, res, expectedOrigin)
    }
    return finishJson(res, 405, { error: 'method not allowed' })
  }

  /** Rough word count (CJK chars + Latin words) for a markdown file. */
  function wordCount(file: string): number {
    try {
      const text = readFileSync(file, 'utf8')
      const cjk = text.match(/[一-鿿]/g)?.length ?? 0
      const latin = text.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length
      return cjk + latin
    } catch {
      return 0
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function fileDetail(file: string): string {
    try {
      return extname(file) === '.md' ? wordCount(file) + ' 字' : formatBytes(statSync(file).size)
    } catch {
      return ''
    }
  }

  /** Recursively scan user-facing project content (skips private state and generated manifest files). */
  function scanDir(dir: string, depth = 0): TreeNode[] {
    if (depth > 8) return []
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.isSymbolicLink() && (e.isFile() || e.isDirectory()) && e.name !== '.DS_Store'
          && !e.name.startsWith('.'))
    } catch {
      return []
    }
    const dirs = entries.filter(e => e.isDirectory())
    const files = entries.filter(e => !e.isDirectory())
    const ordered = [...dirs, ...files].sort((a, b) => a.name.localeCompare(b.name))
    return ordered.map(e => {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        return { name: e.name, path: full, kind: 'dir' as const, detail: '', children: scanDir(full, depth + 1) }
      }
      return {
        name: extname(e.name) === '.md' ? e.name.replace(/\.md$/, '') : e.name,
        path: full,
        kind: 'file' as const,
        detail: fileDetail(full),
      }
    })
  }

  /** Flatten user-editable text files for the @ resource picker. */
  function scanResources(dir: string, root: string, depth = 0): ProjectResource[] {
    if (depth > 8) return []
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.isSymbolicLink() && (e.isFile() || e.isDirectory()) && e.name !== '.DS_Store' && !e.name.startsWith('.'))
    } catch {
      return []
    }
    const result: ProjectResource[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        result.push(...scanResources(full, root, depth + 1))
        continue
      }
      if (!/\.(?:md|markdown|txt|json|yaml|yml)$/iu.test(entry.name)) continue
      const relativePath = relative(root, full).split(sep).join('/')
      result.push({ name: relativePath, path: full, kind: 'file', detail: fileDetail(full) })
    }
    return result
  }

  /** Reject symlinks (including dangling links) in every component. */
  function canonicalPath(p: string): string {
    if (!isAbsolute(p) || (sep !== '\\' && p.includes('\\')) || p.includes('\0') || hasTraversalSegment(p)) throw new PathError('invalid absolute path')
    const target = resolve(p)
    let current = target
    while (true) {
      try { if (lstatSync(current).isSymbolicLink()) throw new PathError('symbolic links are not supported') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return target
  }

  function isRegisteredProject(dir: string): boolean {
    const canonical = canonicalPath(dir)
    return registry.get(canonical) !== undefined && existsSync(canonical) && statSync(canonical).isDirectory()
  }

  /** True when a path descends from a project's private metadata directory. */
  function isInsideStateDir(project: string, target: string): boolean {
    return relative(project, canonicalPath(target)).split(sep).includes(PROJECT_METADATA_DIR)
  }

  function validNodeName(value: unknown): value is string {
    if (typeof value !== 'string') return false
    const stem = value.split('.', 1)[0]?.toUpperCase()
    return value.trim() !== ''
      && value === value.trim()
      && value !== '.' && value !== '..'
      && !/[<>:"/\\|?*\0\u0000-\u001f]/u.test(value)
      && !/[. ]$/u.test(value)
      && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem ?? '')
      && value !== PROJECT_METADATA_DIR
  }

  function hasTraversalSegment(value: string): boolean {
    return value.split(/[\\/]+/u).some(segment => segment === '.' || segment === '..')
  }

  /** Resolve the enclosing project for a file, or undefined outside the library. */
  function enclosingProjectRoot(filePath: string): string | undefined {
    const canonical = canonicalPath(filePath)
    let dir = dirname(canonical)
    while (true) {
      if (isRegisteredProject(dir)) return dir
      if (dirname(dir) === dir) return undefined
      dir = dirname(dir)
    }
  }

  function projectForNodePath(filePath: string): string | undefined {
    const target = canonicalPath(filePath)
    if (isProjectPath(target)) return target
    return enclosingProjectRoot(target)
  }

  /** Validate an existing project file or directory for native desktop actions. */
  function isSafeProjectPath(filePath: string): boolean {
    try {
      const target = canonicalPath(filePath)
      const project = projectForNodePath(target)
      return project !== undefined && existsSync(target) && !isInsideStateDir(project, target)
    } catch (error) {
      if (error instanceof PathError) return false
      throw error
    }
  }

  function nodeError(res: ServerResponse, status: number, message: string): void {
    finishJson(res, status, { error: message })
  }

  /** POST/PATCH/DELETE /api/desktop/projects/node — daily file operations. */
  async function handleProjectNodeRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method ?? '')) return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, true)) return
    const body = await readBody(req, res)
    if (body === INVALID_BODY) return
    const value = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    const rawPath = value.path
    if (typeof rawPath !== 'string' || rawPath.trim() === '') return nodeError(res, 400, 'path is required')
    const path = rawPath.trim()
    if (hasTraversalSegment(path)) return nodeError(res, 400, 'path traversal is not allowed')

    if (req.method === 'POST') {
      const kind = value.kind
      if (kind !== 'file' && kind !== 'directory') return nodeError(res, 400, 'kind must be file or directory')
      const parent = canonicalPath(dirname(path))
      const project = projectForNodePath(parent)
      if (project === undefined || isInsideStateDir(project, parent)) return nodeError(res, 403, 'path outside project')
      if (!validNodeName(basename(path))) return nodeError(res, 400, 'invalid node name')
      const target = join(parent, basename(path))
      if (existsSync(target)) return nodeError(res, 409, 'a node with that name already exists')
      try {
        if (kind === 'directory') mkdirSync(target)
        else writeFileSync(target, '', { flag: 'wx' })
        return finishJson(res, 200, { ok: true, path: target, node: { name: basename(target), path: target, kind } })
      } catch (error) { return nodeError(res, 500, error instanceof Error ? error.message : String(error)) }
    }

    const project = projectForNodePath(path)
    const target = canonicalPath(path)
    if (project === undefined || target === project || isInsideStateDir(project, target)) return nodeError(res, 403, 'cannot modify this path')
    if (!existsSync(target)) return nodeError(res, 404, 'node not found')

    if (req.method === 'PATCH') {
      if (!validNodeName(value.newName)) return nodeError(res, 400, 'invalid node name')
      const next = join(dirname(target), value.newName)
      if (existsSync(next)) return nodeError(res, 409, 'a node with that name already exists')
      try {
        const kind = statSync(target).isDirectory() ? 'directory' : 'file'
        renameSync(target, next)
        return finishJson(res, 200, { ok: true, path: next, node: { name: basename(next), path: next, kind } })
      }
      catch (error) { return nodeError(res, 500, error instanceof Error ? error.message : String(error)) }
    }

    if (req.method === 'DELETE') {
      try { rmSync(target, { recursive: true, force: false }); return finishJson(res, 200, { ok: true, path: target }) }
      catch (error) { return nodeError(res, 500, error instanceof Error ? error.message : String(error)) }
    }
    return finishJson(res, 405, { error: 'method not allowed' })
  }

  /** POST /api/desktop/projects/import — persist one operator-selected file in a project directory. */
  async function handleProjectImportRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, true)) return
    const url = new URL(req.url ?? '', 'http://localhost')
    const projectPath = url.searchParams.get('projectPath')?.trim() ?? ''
    const destinationPath = url.searchParams.get('destinationPath')?.trim() ?? ''
    const name = url.searchParams.get('name')?.normalize('NFC') ?? ''
    if (projectPath === '' || destinationPath === '' || name === '') {
      return finishJson(res, 400, { error: 'projectPath, destinationPath, and name are required' })
    }
    if (!isProjectPath(projectPath)) return finishJson(res, 403, { error: 'path outside project library' })
    const project = canonicalPath(projectPath)
    const destination = canonicalPath(destinationPath)
    if (destination !== project && !destination.startsWith(project + sep)) {
      return finishJson(res, 403, { error: 'destination outside project' })
    }
    let destinationIsDirectory = false
    try { destinationIsDirectory = statSync(destination).isDirectory() } catch { /* handled below */ }
    if (isInsideStateDir(project, destination) || !destinationIsDirectory) {
      return finishJson(res, 400, { error: 'destination directory is invalid' })
    }
    if (!validNodeName(name)) return finishJson(res, 400, { error: 'invalid file name' })
    const target = join(destination, name)
    if (existsSync(target)) {
      return finishJson(res, 409, { error: 'a node with that name already exists' })
    }
    const declaredLength = req.headers['content-length']
    if (declaredLength !== undefined && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_PROJECT_IMPORT_BYTES)) {
      return finishJson(res, 413, { error: 'file is larger than 100 MiB' })
    }
    try {
      let size = 0
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        size += buffer.byteLength
        if (size > MAX_PROJECT_IMPORT_BYTES) return finishJson(res, 413, { error: 'file is larger than 100 MiB' })
        chunks.push(buffer)
      }
      // Uploads yield while streaming: revalidate after the last chunk.
      if (!isProjectPath(project) || !canonicalPath(target).startsWith(project + sep)) return finishJson(res, 403, { error: 'destination outside project' })
      writeFileSync(target, Buffer.concat(chunks), { flag: 'wx' })
      return finishJson(res, 200, { ok: true, path: target, node: { name, path: target, kind: 'file' } })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return finishJson(res, 409, { error: 'a node with that name already exists' })
      }
      return finishJson(res, error instanceof PathError ? 403 : 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * GET /api/desktop/projects/structure?path=<projectDir> — recursively map the
   * project's real file tree onto the structure surface.
   */
  async function handleProjectLibraryStructureRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, false)) return
    const url = new URL(req.url ?? '', 'http://localhost')
    const projectPath = url.searchParams.get('path')
    if (projectPath === null || projectPath.length === 0) {
      return finishJson(res, 400, { error: 'path query is required' })
    }
    if (!isProjectPath(projectPath)) {
      return finishJson(res, 403, { error: 'path outside project library' })
    }
    const metadata = (() => {
      try { return readMetadata(projectPath) as { agentId?: unknown } } catch { return {} }
    })()
    const tree = scanDir(projectPath)
    return finishJson(res, 200, { path: projectPath, tree, root: basename(projectPath), ...(typeof metadata.agentId === 'string' ? { agentId: metadata.agentId } : {}) })
  }

  /** GET /api/desktop/projects/resources?path=<projectDir> — files for @ references. */
  async function handleProjectLibraryResourcesRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, false)) return
    const url = new URL(req.url ?? '', 'http://localhost')
    const projectPath = url.searchParams.get('path')
    if (projectPath === null || projectPath.length === 0) return finishJson(res, 400, { error: 'path query is required' })
    if (!isProjectPath(projectPath)) return finishJson(res, 403, { error: 'path outside project library' })
    return finishJson(res, 200, { resources: scanResources(projectPath, projectPath) })
  }

  /** Subscribe to filesystem changes for one authenticated project workspace. */
  function handleProjectChangesRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): void {
    if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, false)) return
    const path = new URL(req.url ?? '', 'http://localhost').searchParams.get('path')
    if (!path || !isProjectPath(path)) return finishJson(res, 403, { error: 'path outside project library' })
    try {
      const stop = streamProjectFileEvents(canonicalPath(path), res)
      const dispose = () => { stop(); res.end(); subscriptions.delete(dispose) }
      subscriptions.add(dispose)
      res.once('close', () => subscriptions.delete(dispose))
    }
    catch { finishJson(res, 503, { error: 'file notifications unavailable' }) }
  }

  /**
   * GET /api/desktop/projects/file?path=<absFile> — read a project file.
   * POST /api/desktop/projects/file — write a project file (atomic-ish).
   */
  async function handleProjectFileRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
    if (!authorize(req, res, expectedOrigin, req.method === 'POST')) return
    const url = new URL(req.url ?? '', 'http://localhost')
    const body = req.method === 'POST' ? await readBody(req, res) : {}
    if (body === INVALID_BODY) return
    const b = body as Record<string, unknown>
    const filePath = req.method === 'GET' ? url.searchParams.get('path') : b.path
    if (typeof filePath !== 'string' || filePath.length === 0) return finishJson(res, 400, { error: 'path is required' })
    const project = enclosingProjectRoot(filePath)
    if (project === undefined) return finishJson(res, 403, { error: 'path outside a project' })
    let target = canonicalPath(filePath)
    if (isInsideStateDir(project, target)) return finishJson(res, 403, { error: 'cannot access project metadata' })
    if (req.method === 'GET' && url.searchParams.get('raw') === '1') {
      const related = url.searchParams.get('relative')
      if (related !== null) {
        if (related === '' || /^(?:[a-z][a-z\d+.-]*:|[/\\])/iu.test(related) || related.includes('\\') || related.includes('\0')) {
          return finishJson(res, 400, { error: 'relative file path required' })
        }
        target = canonicalPath(resolve(dirname(target), related))
        if (!target.startsWith(project + sep) || isInsideStateDir(project, target)) {
          return finishJson(res, 403, { error: 'related file outside project' })
        }
      }
      if (!existsSync(target)) return finishJson(res, 404, { error: 'file not found' })
      const info = statSync(target)
      if (!info.isFile()) return finishJson(res, 400, { error: 'path must be a regular file' })
      if (info.size > MAX_PROJECT_IMPORT_BYTES) return finishJson(res, 413, { error: 'file is larger than 100 MiB' })
      const bytes = readFileSync(target)
      if (bytes.length > MAX_PROJECT_IMPORT_BYTES) return finishJson(res, 413, { error: 'file is larger than 100 MiB' })
      // Never execute project HTML/SVG with the application's origin.
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" })
      res.end(bytes)
      return
    }
    const store = new DocumentRecoveryStore(join(homeDir, 'workspace', 'document-recovery'))
    try {
      const exists = existsSync(target)
      if (exists && !statSync(target).isFile()) return finishJson(res, 400, { error: 'path must be a regular file' })
      let disk: string | null = null
      if (exists) {
        const bytes = readFileSync(target)
        try { disk = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
        catch { return finishJson(res, 415, { error: 'file is not UTF-8 text; use binary preview' }) }
        if (bytes.includes(0) || /\.(?:pdf|png|jpe?g|gif|webp|bmp|ico)$/iu.test(target)) {
          return finishJson(res, 415, { error: 'binary files cannot be edited as text' })
        }
      }
      res.setHeader('Cache-Control', 'no-store')
      if (req.method === 'GET' && url.searchParams.get('sync') === '1') {
        return finishJson(res, exists ? 200 : 404, { content: disk })
      }
      const record = store.read(project, target)
      if (req.method === 'GET') {
        if (disk !== null && record.versions.at(-1)?.content !== disk) {
          store.checkpoint(record, disk)
          store.update(project, record)
        }
        return finishJson(res, exists ? 200 : 404, { content: disk, recovery: record.draft ?? null, versions: record.versions })
      }
      if (b.action === 'discard-draft') {
        if (b.expectedDraft === undefined || record.draft?.content === b.expectedDraft) delete record.draft
        store.update(project, record)
        return finishJson(res, 200, { ok: true })
      }
      if (typeof b.content !== 'string') return finishJson(res, 400, { error: 'content must be a string' })
      if (b.action === 'draft') {
        if (typeof b.baseline !== 'string') return finishJson(res, 400, { error: 'baseline is required' })
        if (disk === b.content) delete record.draft
        else record.draft = { content: b.content, baseline: b.baseline, time: Date.now() }
        store.update(project, record)
        return finishJson(res, 200, { ok: true })
      }
      if (b.action === 'checkpoint') {
        store.checkpoint(record, b.content)
        store.update(project, record)
        return finishJson(res, 200, { ok: true, versions: record.versions })
      }
      if (b.action !== undefined) return finishJson(res, 400, { error: 'unknown file action' })
      if (!(typeof b.expectedContent === 'string' || b.expectedContent === null)) return finishJson(res, 428, { error: 'expectedContent is required' })
      if (disk !== b.expectedContent) return finishJson(res, 409, { error: 'file changed externally', content: disk })
      const parent = dirname(target)
      if (!existsSync(parent)) return finishJson(res, 400, { error: 'parent directory does not exist' })
      if (disk !== null) store.checkpoint(record, disk)
      store.checkpoint(record, b.content)
      // Preserve a recoverable copy before touching the project file.
      store.update(project, record)
      {
        const tmp = join(parent, '.' + basename(target) + '.' + randomBytes(6).toString('hex') + '.tmp')
        try {
          writeFileSync(tmp, b.content, { flag: 'wx', mode: 0o600 })
          // Detect writers that changed the file while the recovery copy was being written.
          canonicalPath(target)
          const current = existsSync(target) ? readFileSync(target, 'utf8') : null
          if (current !== disk) return finishJson(res, 409, { error: 'file changed externally', content: current })
          if (disk === null) {
            try { linkSync(tmp, target) }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'EEXIST') return finishJson(res, 409, { error: 'file changed externally', content: readFileSync(target, 'utf8') })
              throw error
            }
          } else renameSync(tmp, target)
        } finally { rmSync(tmp, { force: true }) }
      }
      // A newer draft may already be queued; clear only the content actually saved.
      const latestRecord = store.read(project, target)
      if (latestRecord.draft?.content === b.content) {
        delete latestRecord.draft
        store.update(project, latestRecord)
      }
      return finishJson(res, 200, { ok: true })
    } catch (error) {
      return finishJson(res, error instanceof PathError ? 403 : 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  function isInsideLibrary(filePath: string): boolean {
    const root = canonicalPath(projectsDir)
    const target = canonicalPath(filePath)
    return target.startsWith(root + sep)
  }

  function isProjectPath(projectPath: string): boolean {
    return isRegisteredProject(projectPath)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (disposed) return finishJson(res, 503, { error: 'workspace backend disposed' })
      canonicalPath(join(homeDir, 'workspace', 'projects.json'))
      canonicalPath(join(homeDir, 'workspace', 'document-recovery'))
      const path = new URL(req.url ?? '', options.expectedOrigin).pathname
      const origin = options.expectedOrigin
      switch (path) {
        case '/api/desktop/projects': return await handleProjectLibraryRequest(req, res, origin)
        case '/api/desktop/projects/adopt': return await handleProjectRegistration(req, res, origin, false)
        case '/api/desktop/projects/forget': return await handleProjectRegistration(req, res, origin, true)
        case '/api/desktop/projects/delete': return await handleProjectLibraryDeleteRequest(req, res, origin)
        case '/api/desktop/projects/structure': return await handleProjectLibraryStructureRequest(req, res, origin)
        case '/api/desktop/projects/resources': return await handleProjectLibraryResourcesRequest(req, res, origin)
        case '/api/desktop/projects/node': return await handleProjectNodeRequest(req, res, origin)
        case '/api/desktop/projects/import': return await handleProjectImportRequest(req, res, origin)
        case '/api/desktop/projects/file': return await handleProjectFileRequest(req, res, origin)
        case '/api/desktop/projects/changes': return handleProjectChangesRequest(req, res, origin)
        case '/api/desktop/projects/reveal':
        case '/api/desktop/projects/terminal': {
          if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res, origin, true)) return
          const body = await readBody(req, res)
          if (body === INVALID_BODY) return
          const target = (body as Record<string, unknown>).path
          if (typeof target !== 'string') return finishJson(res, 400, { error: 'path is required' })
          if (!isSafeProjectPath(target)) return finishJson(res, 403, { error: 'path outside project' })
          if (!options.nativeAction) return finishJson(res, 501, { error: 'native action unavailable' })
          await options.nativeAction(path.endsWith('/reveal') ? 'reveal' : 'terminal', canonicalPath(target))
          return finishJson(res, 200, { ok: true })
        }
        default: return finishJson(res, 404, { error: 'not found' })
      }
    } catch (error) {
      if (res.headersSent) { res.end(); return }
      finishJson(res, error instanceof PathError ? 403 : error instanceof PathError ? 403 : 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { handle, isSafeProjectPath, projectsDir: projectsDir, homeDir,
    dispose() { disposed = true; for (const stop of subscriptions) stop(); subscriptions.clear() },
  }
}

class PathError extends Error {}

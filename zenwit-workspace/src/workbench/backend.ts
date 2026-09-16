/**
 * Zenwit workbench host API.
 *
 * One POST endpoint carries every named method (`fs.tree`, `fs.read`,
 * `git.status`, …) inside a JSON envelope, plus one streaming endpoint for
 * uploads. The transport rules stay the ones this package already uses for the
 * project API: same-origin loopback requests only, bounded JSON bodies,
 * `{ ok, value }` / `{ ok, error }` envelopes.
 *
 * Every method is scoped to one registered project directory: the caller
 * names the project, the backend refuses anything that is not a registered
 * project, and the engine's own containment rules then refuse whatever would
 * leave it.
 */
import { open, stat, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { BodyTooLargeError, isJsonRequest, isSameOriginLoopbackRequest, readJson } from '../http-security.js'
import { listDirectory, messageOf, parentOf, requireAbsolute, rootLabel } from './tree.js'
import { resolveWorkspacePath, resolveWorkspaceWritePath } from './containment.js'
import { resolveSessionPath } from './session-path.js'
import { renameWorkspaceEntry, removeWorkspaceEntry, writeWorkspaceUpload } from './operations.js'
import { searchFiles } from './search.js'
import * as git from './git.js'
import { WorkbenchError, requireString } from './wire.js'
import { PREVIEW_HTML_PREFIX, PREVIEW_MEDIA_PATH, serveHtml, serveMedia } from './preview.js'
import { shellDepsStatus } from './shell-route.js'
import { createPrefsStore, type PrefsStore } from './prefs-store.js'
import type { ShellRegistry } from './shell.js'
import { isTrustedApiRequest } from './trust.js'

/** The endpoints the workbench host registers as exact routes. */
export const WORKBENCH_API_PATHS = ['/api/desktop/workbench', '/api/desktop/workbench/upload', PREVIEW_MEDIA_PATH] as const

/** One API method dispatch table entry. */
type WorkbenchMethod = (payload: unknown) => Promise<unknown> | unknown

export interface WorkbenchOptions {
  /** Trusted configured origin; never derived from request headers. */
  expectedOrigin: string
  /** Whether a directory is a registered project (the library is authoritative). */
  isProjectPath(path: string): boolean
  /** Absolute path of the workbench preference document; defaults beside the home directory. */
  settingsFile?: string
  /** Host-native reveal/open used by the "open with" menu. */
  nativeAction?: (action: 'reveal' | 'terminal', path: string) => void | Promise<void>
  /** Hands one URL to the system browser. */
  openUrl?: (url: string) => void | Promise<void>
  /**
   * Host-supplied methods that need services this package does not own (the
   * session log, jobs, subagents). They join the dispatch table; the project
   * scope and trust rules above still apply to the request carrying them.
   */
  extra?: Record<string, (payload: unknown) => Promise<unknown> | unknown>
  /** Row bound of one directory level. */
  listLimit?: number
  /** Byte cap of one text read. */
  readLimit?: number
  /** Byte cap of one upload. */
  uploadLimit?: number
  /** Byte cap of one previewed file (media viewer and HTML preview). */
  mediaLimit?: number
  /** The PTY registry the `terminal.deps` probe reports on. */
  shells?: ShellRegistry
}

/** Default row bound of one directory level. */
const DEFAULT_LIST_LIMIT = 1000
/** Default byte cap of one text read. */
const DEFAULT_READ_LIMIT = 2 * 1024 * 1024
/** Default byte cap of one upload. */
const DEFAULT_UPLOAD_LIMIT = 512 * 1024 * 1024
/** Default byte cap of one previewed file. */
const DEFAULT_MEDIA_LIMIT = 64 * 1024 * 1024

/** Stand-in for a backend created without a PTY registry (tests, stripped hosts). */
const missingShells: ShellRegistry = {
  open: async () => { throw new Error('no PTY registry') },
  get: () => undefined,
  close: () => undefined,
  available: async () => ({ available: false, detail: 'no PTY registry in this host' }),
  shellInfo: () => ({ shell: '', name: '' }),
  dispose: () => undefined,
}

/** Bound on the browser probe's header round trip. */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Engine features whose Host half is not ported yet. They answer with a 501
 * and a product-worded sentence instead of the transport's "unknown method"
 * 404, so the view explains why it is empty instead of showing a developer
 * string. Keeping this list in step with the contract guard's `KNOWN_GAPS`
 * (which fails when the two drift) is what "not ported yet" means here.
 */
const NOT_PORTED_METHODS: ReadonlyMap<string, string> = new Map()

/** Parse the CSP `frame-ancestors` source list, when the directive exists. */
function parseFrameAncestors(policy: string | null): string[] | undefined {
  if (policy === null) return undefined
  for (const directive of policy.split(';')) {
    const tokens = directive.trim().split(/\s+/u)
    if (tokens[0]?.toLowerCase() === 'frame-ancestors') return tokens.slice(1)
  }
  return undefined
}
/** How many leading bytes a binary read returns for client-side detection. */
const READ_HEAD_LIMIT = 4096

function finishJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Text read of a file with the size cap; binary detection via NUL probe. */
async function readText(path: string, readLimit: number): Promise<{
  content: string
  truncated: boolean
  binary: boolean
  size: number
  head?: string
}> {
  const info = await stat(path).catch((error: unknown) => {
    throw new WorkbenchError('fs-error', `cannot read "${path}": ${messageOf(error)}`, 400)
  })
  if (info.isDirectory()) {
    throw new WorkbenchError('fs-error', `"${path}" is a directory`, 400)
  }
  const size = info.size
  const truncated = size > readLimit
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new WorkbenchError('fs-error', `cannot read "${path}": ${messageOf(error)}`, 400)
  })
  try {
    const buffer = Buffer.alloc(Math.min(size, readLimit))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const slice = buffer.subarray(0, bytesRead)
    const binary = slice.includes(0)
    const head = binary ? slice.subarray(0, Math.min(slice.length, READ_HEAD_LIMIT)).toString('base64') : undefined
    return { content: binary ? '' : slice.toString('utf8'), truncated, binary, size, ...(head === undefined ? {} : { head }) }
  } finally {
    await handle.close()
  }
}

/**
 * Create the workbench host backend.
 * @param options - trusted origin, project predicate and the read/list budgets.
 * @returns the request handler plus a disposer.
 */
export function createWorkbenchBackend(options: WorkbenchOptions): {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
  dispose(): void
} {
  const listLimit = options.listLimit ?? DEFAULT_LIST_LIMIT
  const readLimit = options.readLimit ?? DEFAULT_READ_LIMIT
  const uploadLimit = options.uploadLimit ?? DEFAULT_UPLOAD_LIMIT
  const mediaLimit = options.mediaLimit ?? DEFAULT_MEDIA_LIMIT
  let prefsStore: PrefsStore | undefined
  const prefs = (): PrefsStore => {
    if (prefsStore === undefined) {
      if (options.settingsFile === undefined) {
        throw new WorkbenchError('not-found', 'the settings store is unavailable in this host', 501)
      }
      prefsStore = createPrefsStore(options.settingsFile)
    }
    return prefsStore
  }
  const previewDeps = { isProjectPath: options.isProjectPath, mediaLimit }
  let disposed = false

  const authorize = (req: IncomingMessage, res: ServerResponse, write: boolean): boolean => {
    if (!isSameOriginLoopbackRequest(req, options.expectedOrigin, write)) {
      finishJson(res, 403, { error: 'forbidden' })
      return false
    }
    return true
  }

  /** Resolve the project named by the payload and refuse anything unregistered. */
  const projectOf = (payload: unknown): string => {
    const project = requireAbsolute(requireString(payload, 'project'))
    if (!options.isProjectPath(project)) {
      throw new WorkbenchError('forbidden', `"${project}" is not a registered project`, 403)
    }
    return project
  }

  /** Resolve an optional git checkout selector against the project root. */
  const selectedRepoOf = (payload: unknown): string | undefined => {
    const record = payload as { repoRoot?: unknown }
    if (record.repoRoot === undefined) return undefined
    return requireAbsolute(requireString(payload, 'repoRoot'))
  }

  /**
   * Resolve a path a git command reported: `git status` prints paths relative to
   * the repository top level, which may sit above the project directory.
   */
  const resolveGitPath = async (project: string, raw: string, selected?: string): Promise<string> => {
    if (isAbsolute(raw)) return requireAbsolute(resolveSessionPath(project, raw))
    const projectPath = requireAbsolute(join(project, raw))
    if (await stat(projectPath).then(() => true).catch(() => false)) return projectPath
    const root = await git.repoRoot(project, selected).catch(() => project)
    return requireAbsolute(join(root, raw))
  }

  /** The git-facing project root: a requested linked checkout, else the project itself. */
  const gitRootOf = async (project: string, payload: unknown): Promise<string> => {
    const record = payload as { worktree?: unknown }
    const requested = typeof record.worktree === 'string' && record.worktree !== '' ? record.worktree : undefined
    return git.resolveWorktree(project, requested)
  }

  const methods: Record<string, WorkbenchMethod> = {
    // The terminal view asks for the effective shell to title its tabs.
    'shell.get': () => (options.shells ?? missingShells).shellInfo(),
    // A terminal tab closing while its socket is down still ends its shell.
    'pty.close': (payload) => {
      const record = payload as { sessionId?: unknown; tab?: unknown }
      const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
      const tab = typeof record.tab === 'string' ? record.tab : ''
      if (sessionId === '' || tab === '') throw new WorkbenchError('bad-request', 'sessionId and tab are required', 400)
      ;(options.shells ?? missingShells).close(`${sessionId}:${tab}`)
      return { ok: true }
    },
    // The engine's own preferences (side-card settings) live beside the
    // project library; the revision guard refuses stale writers.
    'settings.get': async () => await prefs().get(),
    'settings.update': async (payload) => {
      const record = payload as { patch?: unknown; expectedRevision?: unknown }
      if (record.patch === null || typeof record.patch !== 'object') {
        throw new WorkbenchError('bad-request', 'patch must be an object', 400)
      }
      const expected = typeof record.expectedRevision === 'number' ? record.expectedRevision : undefined
      return await prefs().update(record.patch as Record<string, unknown>, expected)
    },
    // The embedded browser asks the host what the target's headers say, so a
    // site that refuses framing is reported instead of rendering blank.
    'browser.probe': async (payload) => {
      const raw = requireString(payload, 'url')
      let target: URL
      try {
        target = new URL(raw)
      } catch {
        throw new WorkbenchError('bad-request', 'url must be absolute', 400)
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new WorkbenchError('bad-request', 'url must be http(s)', 400)
      }
      try {
        const response = await fetch(target, {
          method: 'GET',
          redirect: 'follow',
          headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        const xFrameOptions = response.headers.get('x-frame-options')
        const frameAncestors = parseFrameAncestors(response.headers.get('content-security-policy'))
        await response.body?.cancel().catch(() => undefined)
        return {
          reachable: true,
          url: response.url,
          status: response.status,
          ...(xFrameOptions === null ? {} : { xFrameOptions }),
          ...(frameAncestors === undefined ? {} : { frameAncestors }),
        }
      } catch {
        return { reachable: false }
      }
    },
    // The tree's "open with" menu: reveal a path in the OS file manager, or
    // hand a URL to the system browser. Both belong to the host process.
    'open.external': async (payload) => {
      const record = payload as { action?: unknown }
      if (record.action === 'reveal') {
        const path = requireAbsolute(requireString(payload, 'path'))
        if (options.nativeAction === undefined) {
          throw new WorkbenchError('not-found', 'native open is unavailable on this host', 501)
        }
        await options.nativeAction('reveal', path)
        return { started: true }
      }
      if (record.action === 'url') {
        const url = requireString(payload, 'url')
        if (options.openUrl === undefined) {
          throw new WorkbenchError('not-found', 'opening a URL is unavailable on this host', 501)
        }
        await options.openUrl(url)
        return { started: true }
      }
      throw new WorkbenchError('bad-request', 'action must be "reveal" or "url"', 400)
    },
    // The terminal view fetches this when the socket closed with the
    // dependency marker: the answer is the repair hint, never a raw error.
    'terminal.deps': async () => shellDepsStatus({
      registry: options.shells ?? missingShells,
      repair: {
        command: 'reinstall the desktop app',
        profile: null,
        note: 'the terminal needs the native PTY addon that ships with the app',
      },
    }),
    'session.cwd': (payload) => {
      const project = projectOf(payload)
      const sessionId = (payload as { sessionId?: unknown }).sessionId
      return {
        sessionId: typeof sessionId === 'string' ? sessionId : '',
        cwd: project,
        root: rootLabel(project),
        parent: parentOf(project) ?? null,
      }
    },
    'fs.tree': async (payload) => {
      const project = projectOf(payload)
      const record = payload as { path?: unknown }
      const target = record.path === undefined ? project : await resolveWorkspacePath(project, requireString(payload, 'path'))
      return listDirectory(target, listLimit)
    },
    'fs.search': async (payload) => {
      const project = projectOf(payload)
      return searchFiles(project, requireString(payload, 'query'))
    },
    'fs.read': async (payload) => {
      const project = projectOf(payload)
      const selected = selectedRepoOf(payload)
      const path = await resolveWorkspacePath(project, await resolveGitPath(project, requireString(payload, 'path'), selected))
      const { content, truncated, binary, size, head } = await readText(path, readLimit)
      if (binary) return { kind: 'binary', size, truncated, head }
      return { kind: 'text', content, truncated }
    },
    'fs.write': async (payload) => {
      const project = projectOf(payload)
      const path = await resolveWorkspaceWritePath(project, requireString(payload, 'path'))
      const content = requireString(payload, 'content')
      const tmp = `${path}.zenwit-wb-tmp-${process.pid}`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {})
        throw new WorkbenchError('fs-error', `cannot write "${path}": ${messageOf(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.rename': async (payload) => {
      const project = projectOf(payload)
      return renameWorkspaceEntry({ cwd: project, path: requireString(payload, 'path'), name: requireString(payload, 'name') })
    },
    'fs.remove': async (payload) => {
      const project = projectOf(payload)
      return removeWorkspaceEntry({ cwd: project, path: requireString(payload, 'path') })
    },
    'git.worktrees': async (payload) => {
      const project = projectOf(payload)
      const selected = selectedRepoOf(payload)
      const base = selected !== undefined ? await git.repoRoot(project, selected).catch(() => project) : project
      return git.worktrees(base)
    },
    'git.status': async (payload) => {
      const project = projectOf(payload)
      return git.status(await gitRootOf(project, payload), selectedRepoOf(payload))
    },
    'git.diff': async (payload) => {
      const project = projectOf(payload)
      const record = payload as { path?: unknown; staged?: unknown }
      const repoRoot = selectedRepoOf(payload)
      const cwd = await gitRootOf(project, payload)
      const path = record.path === undefined ? undefined : await resolveGitPath(project, requireString(payload, 'path'), repoRoot)
      return { diff: await git.diff(cwd, path, record.staged === true, repoRoot) }
    },
    'git.stage': async (payload) => {
      const project = projectOf(payload)
      const record = payload as { path?: unknown }
      const path = record.path === undefined ? undefined : requireString(payload, 'path')
      await git.stage(await gitRootOf(project, payload), path, selectedRepoOf(payload))
      return { ok: true }
    },
    'git.unstage': async (payload) => {
      const project = projectOf(payload)
      const record = payload as { path?: unknown }
      const path = record.path === undefined ? undefined : requireString(payload, 'path')
      await git.unstage(await gitRootOf(project, payload), path, selectedRepoOf(payload))
      return { ok: true }
    },
    'git.commit': async (payload) => {
      const project = projectOf(payload)
      await git.commit(await gitRootOf(project, payload), requireString(payload, 'message'), selectedRepoOf(payload))
      return { ok: true }
    },
    'git.branch': async (payload) => {
      const project = projectOf(payload)
      return git.branches(await gitRootOf(project, payload), selectedRepoOf(payload))
    },
    'git.checkout': async (payload) => {
      const project = projectOf(payload)
      await git.checkout(await gitRootOf(project, payload), requireString(payload, 'branch'), selectedRepoOf(payload))
      return { ok: true }
    },
    'git.log': async (payload) => {
      const project = projectOf(payload)
      const record = payload as { count?: unknown; skip?: unknown }
      const count = typeof record.count === 'number' ? record.count : 30
      const skip = typeof record.skip === 'number' ? record.skip : 0
      return git.log(await gitRootOf(project, payload), count, skip, selectedRepoOf(payload))
    },
    'git.show': async (payload) => {
      const project = projectOf(payload)
      const rev = requireString(payload, 'rev')
      const path = requireString(payload, 'path')
      return { content: await git.show(await gitRootOf(project, payload), rev, path, selectedRepoOf(payload)) }
    },
    'git.commit-diff': async (payload) => {
      const project = projectOf(payload)
      return { diff: await git.commitDiff(await gitRootOf(project, payload), requireString(payload, 'hash'), selectedRepoOf(payload)) }
    },
    'git.discard': async (payload) => {
      const project = projectOf(payload)
      await git.discard(await gitRootOf(project, payload), requireString(payload, 'path'), selectedRepoOf(payload))
      return { ok: true }
    },
    'git.revert': async (payload) => {
      const project = projectOf(payload)
      await git.revert(await gitRootOf(project, payload), requireString(payload, 'hash'), selectedRepoOf(payload))
      return { ok: true }
    },
    'git.cherry-pick': async (payload) => {
      const project = projectOf(payload)
      await git.cherryPick(await gitRootOf(project, payload), requireString(payload, 'hash'), selectedRepoOf(payload))
      return { ok: true }
    },
  }

  /** Streaming upload: bytes arrive on the request itself. */
  const handleUpload = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const project = requireAbsolute(url.searchParams.get('project') ?? '')
    if (!options.isProjectPath(project)) throw new WorkbenchError('forbidden', 'project is not registered', 403)
    const dir = requireAbsolute(url.searchParams.get('dir') ?? project)
    const relativePath = url.searchParams.get('path') ?? ''
    const declared = Number(url.searchParams.get('size') ?? '0')
    const limit = Number.isFinite(declared) && declared > 0 ? Math.min(declared, uploadLimit) : uploadLimit
    const written = await writeWorkspaceUpload({
      cwd: project,
      dir,
      relativePath,
      chunks: req as unknown as AsyncIterable<string | Uint8Array>,
      limit,
    })
    finishJson(res, 200, { ok: true, value: written })
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (disposed) return finishJson(res, 503, { error: 'workbench backend disposed' })
      const url = new URL(req.url ?? '', options.expectedOrigin)
      // Preview routes: subresource loads (an <img> or the previewed page's own
      // relative assets) carry no Origin and may carry no Referer, so they run
      // behind the Host-header trust fence instead of the same-origin marker
      // check the JSON methods use.
      if (url.pathname === PREVIEW_MEDIA_PATH || url.pathname.startsWith(PREVIEW_HTML_PREFIX)) {
        if (!isTrustedApiRequest(req, [])) return finishJson(res, 403, { error: 'forbidden' })
        if (url.pathname === PREVIEW_MEDIA_PATH) return await serveMedia(req, res, url, previewDeps)
        return await serveHtml(req, res, url, previewDeps)
      }
      if (url.pathname === '/api/desktop/workbench/upload') {
        if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
        if (!authorize(req, res, true)) return
        return await handleUpload(req, res, url)
      }
      if (url.pathname !== '/api/desktop/workbench') return finishJson(res, 404, { error: 'not found' })
      if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
      if (!isJsonRequest(req)) return finishJson(res, 415, { error: 'application/json required' })
      if (!authorize(req, res, true)) return
      const payload = await readJson(req)
      const method = requireString(payload, 'method')
      const call = methods[method] ?? options.extra?.[method]
      if (call === undefined) {
        const notPorted = NOT_PORTED_METHODS.get(method)
        if (notPorted !== undefined) throw new WorkbenchError('not-ported', notPorted, 501)
        throw new WorkbenchError('not-found', `unknown workbench method "${method}"`, 404)
      }
      const value = await call(payload)
      finishJson(res, 200, { ok: true, value })
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      if (error instanceof BodyTooLargeError) return finishJson(res, 413, { ok: false, error: { code: 'too-large', message: 'request body too large' } })
      if (error instanceof WorkbenchError) {
        return finishJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
      }
      return finishJson(res, 500, { ok: false, error: { code: 'internal', message: messageOf(error) } })
    }
  }

  return { handle, dispose() { disposed = true } }
}

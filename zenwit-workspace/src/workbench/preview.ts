/**
 * Preview routes of the workbench host API: raw file bytes for the media
 * viewers, and the sandboxed HTML route for the page preview.
 *
 * Both are project-scoped like every other workbench operation: the caller
 * names a registered project, the engine's containment guard re-checks the
 * resolved target, and only a regular file inside a bounded size is served.
 *
 * The HTML URL carries the project and the file path as encoded path
 * segments rather than query parameters, because the previewed page resolves
 * its own relative assets (`./style.css`, `img/x.png`) against the document
 * URL and the URL algorithm drops a query on that resolution. The encoder
 * lives in the client half (`workbench/html-route.ts`); {@link decodeHtmlUrl}
 * here is the host-side counterpart and must keep the same vocabulary:
 *
 *   /api/desktop/workbench/html/<project>/<absolute-path segments>
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolveWorkspacePath } from './containment.js'
import { messageOf, requireAbsolute } from './tree.js'
import { WorkbenchError } from './wire.js'

/** Route prefix of the sandboxed HTML preview (mirrors the client encoder). */
export const PREVIEW_HTML_PREFIX = '/api/desktop/workbench/html/'

/** Route of the raw media/download endpoint. */
export const PREVIEW_MEDIA_PATH = '/api/desktop/workbench/file'

/** Content types the media route serves by extension. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  // Assets a previewed page resolves back into this route: the responses set
  // X-Content-Type-Options: nosniff, so a stylesheet or module served as
  // octet-stream would be refused by the browser.
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

/**
 * Content type of one file, binary-safe for unknown extensions.
 * @param path - the file path.
 * @returns the media type.
 */
export function mediaTypeForPath(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** One decoded preview reference. */
export interface PreviewRef {
  /** Absolute project directory the request is scoped to. */
  project: string
  /** Absolute file path inside that project. */
  path: string
}

/**
 * Decode the path-encoded HTML URL.
 * @param pathname - the request pathname.
 * @returns the reference, or an error status and message.
 */
export function decodeHtmlUrl(pathname: string): { ok: true; ref: PreviewRef } | { ok: false; status: 400 | 404; message: string } {
  if (!pathname.startsWith(PREVIEW_HTML_PREFIX)) return { ok: false, status: 404, message: 'not found' }
  const rest = pathname.slice(PREVIEW_HTML_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return { ok: false, status: 400, message: 'project and path are required' }
  let project: string
  let decodedPath: string
  try {
    project = decodeURIComponent(rest.slice(0, slash))
    // An empty first segment after the project is the UNC marker: the encoder
    // emits '//server/share/...' as '/<project>//server/share/...'.
    const unc = rest.slice(slash + 1).startsWith('/')
    const segments = rest.slice(slash + (unc ? 2 : 1)).split('/').filter(segment => segment !== '')
    decodedPath = (unc ? '//' : '/') + segments.map(segment => decodeURIComponent(segment)).join('/')
  } catch {
    return { ok: false, status: 400, message: 'malformed escape in the preview URL' }
  }
  if (project === '' || decodedPath === '/') return { ok: false, status: 400, message: 'project and path are required' }
  return { ok: true, ref: { project, path: decodedPath } }
}

/** Write one JSON error the way the method API does. */
function fail(res: ServerResponse, error: unknown): void {
  const status = error instanceof WorkbenchError ? error.status : 500
  const code = error instanceof WorkbenchError ? error.code : 'internal'
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: { code, message: messageOf(error) } }))
}

/** Dependencies the preview routes read. */
export interface PreviewDeps {
  /** Whether a directory is a registered project. */
  isProjectPath(path: string): boolean
  /** Byte cap of one previewed file. */
  mediaLimit: number
}

/** Resolve one project-scoped preview target, or throw a workbench error. */
async function resolveTarget(project: string | null, path: string, deps: PreviewDeps): Promise<string> {
  if (project === null || project === '' || path === '') {
    throw new WorkbenchError('bad-request', 'project and path are required', 400)
  }
  const absoluteProject = requireAbsolute(project)
  if (!deps.isProjectPath(absoluteProject)) {
    throw new WorkbenchError('forbidden', `"${absoluteProject}" is not a registered project`, 403)
  }
  const resolved = await resolveWorkspacePath(absoluteProject, path)
  const info = await stat(resolved)
  if (!info.isFile() || info.size > deps.mediaLimit) {
    throw new WorkbenchError('fs-error', 'not a file or too large', 400)
  }
  return resolved
}

/**
 * Serve one file's raw bytes: the media viewer's image/PDF source, or a
 * download when `download=1`.
 * @param req - the request.
 * @param res - the response.
 * @param url - the parsed request URL.
 * @param deps - project predicate and size cap.
 */
export async function serveMedia(req: IncomingMessage, res: ServerResponse, url: URL, deps: PreviewDeps): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    const path = await resolveTarget(url.searchParams.get('project'), url.searchParams.get('path') ?? '', deps)
    const headers: Record<string, string> = {
      'content-type': mediaTypeForPath(path),
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    }
    if (url.searchParams.get('download') === '1') {
      headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`
    }
    res.writeHead(200, headers)
    res.end(await readFile(path))
  } catch (error) {
    fail(res, error)
  }
}

/**
 * Serve one file for the sandboxed HTML preview. Every response carries the
 * CSP sandbox directive, so even a top-level load stays in an opaque origin.
 * @param req - the request.
 * @param res - the response.
 * @param url - the parsed request URL.
 * @param deps - project predicate and size cap.
 */
export async function serveHtml(req: IncomingMessage, res: ServerResponse, url: URL, deps: PreviewDeps): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    const decoded = decodeHtmlUrl(url.pathname)
    if (!decoded.ok) throw new WorkbenchError('bad-request', decoded.message, decoded.status)
    const path = await resolveTarget(decoded.ref.project, decoded.ref.path, deps)
    const type = mediaTypeForPath(path)
    res.writeHead(200, {
      'content-type': type === 'text/html' ? 'text/html; charset=utf-8' : type,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'",
    })
    res.end(await readFile(path))
  } catch (error) {
    fail(res, error)
  }
}

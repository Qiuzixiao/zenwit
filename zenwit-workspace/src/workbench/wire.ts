/**
 * Wire helpers for the /workbench JSON API: bounded body reading, response
 * writing, and the shared error envelope. Every API method returns
 * `{ok: true, value}` on success and `{ok: false, error: {code, message}}`
 * (HTTP 4xx/5xx matching the code) on failure.
 */
import type { WorkbenchHttpRequest, WorkbenchHttpResponse } from './types.js'

/** Machine-readable error codes of the workbench API. */
export type WorkbenchErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'forbidden'
  | 'method-error'
  | 'too-large'
  | 'fs-error'
  | 'git-error'
  | 'pty-error'
  | 'pty-deps-missing'
  | 'shell-not-found'
  | 'job-error'
  | 'sidechat-error'
  | 'subagents-unavailable'
  | 'settings-rejected'
  | 'settings-conflict'
  /** The feature is recognized but its Host half is not built in this deployment. */
  | 'not-ported'
  | 'internal'

/** One API failure with its wire code and HTTP status. */
export class WorkbenchError extends Error {
  constructor(
    readonly code: WorkbenchErrorCode,
    message: string,
    readonly status = 400,
    /** Optional structured context (e.g. `{ shell }` for shell-not-found). */
    readonly meta?: Record<string, string>,
  ) {
    super(message)
  }
}

/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20

/** Success envelope of one API method. */
export interface WorkbenchOk<T> { ok: true; value: T }

/** Failure envelope of one API method. */
export interface WorkbenchErr { ok: false; error: { code: WorkbenchErrorCode; message: string } }

/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export async function readJsonBody(req: WorkbenchHttpRequest): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    // The structural request yields string | Uint8Array; Buffer.from accepts
    // both (and the real runtime chunks are node Buffers anyway).
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new WorkbenchError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new WorkbenchError('bad-request', 'request body is not valid JSON')
  }
}

/** Write a JSON response with the given status. */
export function writeJson(res: WorkbenchHttpResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Write the success envelope. */
export function writeOk(res: WorkbenchHttpResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope for any thrown value (unknown → internal 500). */
export function writeError(res: WorkbenchHttpResponse, error: unknown): void {
  if (error instanceof WorkbenchError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/** Narrow an unknown payload value to a string, else throw bad-request. */
export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value === '') {
    throw new WorkbenchError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}

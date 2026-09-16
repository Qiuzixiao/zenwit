/**
 * Structural faces the workbench host routes are written against.
 *
 * Routes never see node's concrete `IncomingMessage` / `ServerResponse`
 * types: the desktop host passes structurally compatible objects, and the
 * narrow shapes here keep the declaration graph free of node globals.
 */

/** The request face route handlers read (structural subset of node's IncomingMessage). */
export interface WorkbenchHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** The response face route handlers write to (structural subset of node's ServerResponse). */
export interface WorkbenchHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

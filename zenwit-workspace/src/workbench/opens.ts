/**
 * Delivery registry for model-driven opens ("open this file on the user's
 * screen").
 *
 * One request is a `{ sessionId, kind, target, title }` record. A request is
 * delivered to every view currently attached to its session and removed from
 * the queue on send: a reconnect must never replay an open the client already
 * applied (a replayed URL open would mint a duplicate tab), so undelivered
 * requests wait for the next attach and delivered ones are gone.
 */
/** What the model asked to open. */
export type OpenKind = 'file' | 'folder' | 'url'

/** One open request as the browser receives it. */
export interface OpenRequest {
  /** Opaque id (host-generated; the client uses it for debugging only). */
  id: string
  /** The session whose view should open it. */
  sessionId: string
  kind: OpenKind
  /** Absolute local path (file/folder) or an http(s) URL. */
  target: string
  /** Tab title to use; the client falls back to the file name or host. */
  title: string
}

/** One attached view's sender. */
export type OpenSender = (request: OpenRequest) => void

/** The registry's face. */
export interface OpenRegistry {
  /**
   * Queue one open and deliver it when a view is attached.
   * @param request - the request without its id.
   * @returns the request id and whether a connected view received it now.
   */
  enqueue(request: Omit<OpenRequest, 'id'>): { id: string; delivered: boolean }
  /**
   * Attach one view for a session (queued requests are replayed).
   * @param sessionId - the session whose views receive requests.
   * @param send - the sender for that view.
   * @returns the detacher.
   */
  attach(sessionId: string, send: OpenSender): () => void
  /** Number of queued (undelivered) requests for one session. */
  pending(sessionId: string): number
  /** Drop every queued request. */
  drain(): void
  /** Drop the queue and every subscriber. */
  dispose(): void
}

/** Options of one registry. */
export interface OpenRegistryOptions {
  /** Id generator; defaults to a random id. */
  mintId?(): string
}

/**
 * Create one delivery registry.
 * @param options - id generator override.
 * @returns the registry.
 */
export function createOpenRegistry(options: OpenRegistryOptions = {}): OpenRegistry {
  const pending = new Map<string, OpenRequest[]>()
  const views = new Map<string, Set<OpenSender>>()
  let sequence = 0
  const mintId = options.mintId ?? ((): string => `open-${++sequence}`)

  const attach = (sessionId: string, send: OpenSender): (() => void) => {
    let set = views.get(sessionId)
    if (set === undefined) {
      set = new Set()
      views.set(sessionId, set)
    }
    set.add(send)
    const queued = pending.get(sessionId)
    if (queued !== undefined && queued.length > 0) {
      pending.delete(sessionId)
      for (const request of queued) send(request)
    }
    return () => {
      const current = views.get(sessionId)
      current?.delete(send)
      if (current !== undefined && current.size === 0) views.delete(sessionId)
    }
  }

  return {
    enqueue(request) {
      const full: OpenRequest = { id: mintId(), ...request }
      const set = views.get(request.sessionId)
      if (set !== undefined && set.size > 0) {
        for (const send of set) send(full)
        return { id: full.id, delivered: true }
      }
      const queued = pending.get(request.sessionId) ?? []
      queued.push(full)
      pending.set(request.sessionId, queued)
      return { id: full.id, delivered: false }
    },
    attach,
    pending: (sessionId) => pending.get(sessionId)?.length ?? 0,
    drain() { pending.clear() },
    dispose() {
      pending.clear()
      views.clear()
    },
  }
}

/**
 * The "this session's file operations" lens: the tool calls and results the
 * workbench folds into its per-file changes view.
 *
 * The client runtime exposes no event-log face, so the browser polls this
 * method with a cursor and receives only the rows past it. The window is
 * capped host-side: a long session must not hand the browser a log the size of
 * its own history.
 */
/** One session event as the workbench forwards it (structurally typed). */
export interface WorkbenchSessionEvent {
  seq: number
  type: string
  [key: string]: unknown
}

/** What the client receives. */
export interface ChangesOpsResult {
  events: readonly WorkbenchSessionEvent[]
  lastSeq: number
}

/** Row cap of one response. */
export const CHANGES_EVENTS_CAP = 4_000

/**
 * Create the `changes.ops` method.
 * @param readEvents - reads one session's events, or undefined when unknown.
 * @returns the method.
 */
export function createChangesOpsMethod(
  readEvents: (sessionId: string) => readonly WorkbenchSessionEvent[] | undefined,
): (payload: unknown) => ChangesOpsResult {
  return (payload: unknown): ChangesOpsResult => {
    const record = payload as { sessionId?: unknown; afterSeq?: unknown }
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
    if (sessionId === '') throw new Error('sessionId is required')
    const raw = record.afterSeq
    if (raw !== undefined && (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0)) {
      throw new Error('afterSeq must be a non-negative integer')
    }
    // An absent cursor means "from the very first event": a log that opens on
    // a tool event carries seq 0, so the floor is -1 rather than 0.
    const afterSeq = raw ?? -1
    const events = readEvents(sessionId) ?? []
    const filtered = events.filter(
      event => (event.type === 'tool/call' || event.type === 'tool/result') && event.seq > afterSeq,
    )
    const window = filtered.length > CHANGES_EVENTS_CAP ? filtered.slice(filtered.length - CHANGES_EVENTS_CAP) : filtered
    return { events: window, lastSeq: window.at(-1)?.seq ?? Math.max(afterSeq, 0) }
  }
}

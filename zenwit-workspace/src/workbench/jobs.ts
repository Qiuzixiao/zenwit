/**
 * The task page's background-job methods.
 *
 * `jobs.output` replays what the MODEL has already read of one job, folded
 * out of the owner session's event log: the pane mirrors the model's own
 * reads instead of consuming its `job_output` cursor (reading the cursor
 * would steal the model's next delta). `jobs.kill` asks the mounted job
 * registry to cancel; a deployment without one reports that instead of
 * pretending the job stopped.
 */
import { boundTranscript } from './shell.js'
import type { WorkbenchSessionEvent } from './changes.js'

/** What one `jobs.output` call returns. */
export interface JobOutputResult {
  /** The text the model has read, oldest first. */
  text: string
  /** True when the text was capped at the output limit. */
  truncated: boolean
  /** Whether the model has read this job at least once. */
  read: boolean
}

/** One compact `job_output` trace (a call or its paired result). */
interface JobTrace {
  seq: number
  kind: 'call' | 'result'
  callId: string
  jobId?: string
  text?: string
  isError?: boolean
}

/** Plain text of a finalized tool result (the `tool-result` blocks' text). */
export function resultText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown, content?: unknown }
    if (candidate.type !== 'tool-result' || !Array.isArray(candidate.content)) continue
    for (const item of candidate.content) {
      if (item === null || typeof item !== 'object') continue
      const textItem = item as { type?: unknown, text?: unknown }
      if (textItem.type === 'text' && typeof textItem.text === 'string') parts.push(textItem.text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/** Whether a tool result carries the error flag. */
export function resultIsError(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some((block) => {
    if (block === null || typeof block !== 'object') return false
    const candidate = block as { type?: unknown, isError?: unknown }
    return candidate.type === 'tool-result' && candidate.isError === true
  })
}

/** Whether a `job_output` result carries no new output (noise for the pane). */
export function isNoNewOutput(text: string): boolean {
  return text.startsWith('(no new output)')
}

/** Extract the `job_output` trace of one session event, if it is one. */
function traceOf(event: WorkbenchSessionEvent): JobTrace | undefined {
  const data = (event.data ?? {}) as {
    name?: unknown
    callId?: unknown
    arguments?: unknown
    message?: { content?: unknown, source?: { callId?: unknown } }
  }
  if (event.type === 'tool/call') {
    if (data.name !== 'job_output' || typeof data.callId !== 'string') return undefined
    let jobId: string | undefined
    try {
      const args = JSON.parse(typeof data.arguments === 'string' ? data.arguments : '') as { job_id?: unknown }
      if (typeof args.job_id === 'string') jobId = args.job_id
    } catch {
      // Malformed model arguments: not a job_output call.
    }
    if (jobId === undefined) return undefined
    return { seq: event.seq, kind: 'call', callId: data.callId, jobId }
  }
  if (event.type === 'tool/result') {
    const callId = data.message?.source?.callId
    if (typeof callId !== 'string') return undefined
    const content = data.message?.content
    const text = resultText(content)
    return {
      seq: event.seq,
      kind: 'result',
      callId,
      ...(text === undefined ? {} : { text }),
      isError: resultIsError(content),
    }
  }
  return undefined
}

/** Dependencies of the output method. */
export interface JobsOutputDeps {
  /** Read one session's events, or undefined when unknown. */
  readEvents(sessionId: string): readonly WorkbenchSessionEvent[] | undefined
  /** Byte cap of one replay. */
  outputLimit: number
}

/**
 * Create the `jobs.output` method.
 * @param deps - event reader and cap.
 * @returns the method.
 */
export function createJobsOutputMethod(deps: JobsOutputDeps): (payload: unknown) => JobOutputResult {
  return (payload: unknown): JobOutputResult => {
    const record = payload as { sessionId?: unknown, id?: unknown }
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
    const id = typeof record.id === 'string' ? record.id : ''
    if (sessionId === '' || id === '') throw new Error('sessionId and id are required')
    const traces: JobTrace[] = []
    for (const event of deps.readEvents(sessionId) ?? []) {
      const trace = traceOf(event)
      if (trace !== undefined) traces.push(trace)
    }
    const jobOf = new Map<string, string>()
    const parts: string[] = []
    let read = false
    for (const trace of traces.sort((left, right) => left.seq - right.seq)) {
      if (trace.kind === 'call') {
        if (trace.jobId !== undefined) jobOf.set(trace.callId, trace.jobId)
        continue
      }
      if (jobOf.get(trace.callId) !== id) continue
      read = true
      if (trace.isError !== true && trace.text !== undefined && !isNoNewOutput(trace.text)) parts.push(trace.text)
    }
    const joined = parts.join('\n')
    const bytes = Buffer.byteLength(joined, 'utf8')
    if (bytes <= deps.outputLimit) return { text: joined, truncated: false, read }
    return { text: boundTranscript(joined, deps.outputLimit), truncated: true, read }
  }
}

/** Dependencies of the kill method. */
export interface JobsKillDeps {
  /** Ask the job registry to cancel; throws when it is not mounted. */
  kill(id: string, sessionId: string, reason: string): 'requested' | 'already-finished'
}

/**
 * Create the `jobs.kill` method.
 * @param deps - the registry call.
 * @returns the method.
 */
export function createJobsKillMethod(
  deps: JobsKillDeps,
): (payload: unknown) => { ok: true, outcome: 'requested' | 'already-finished' } {
  return (payload: unknown) => {
    const record = payload as { sessionId?: unknown, id?: unknown, reason?: unknown }
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
    const id = typeof record.id === 'string' ? record.id : ''
    if (sessionId === '' || id === '') throw new Error('sessionId and id are required')
    const reason = typeof record.reason === 'string' && record.reason !== '' ? record.reason : 'user requested'
    return { ok: true, outcome: deps.kill(id, sessionId, reason) }
  }
}

/**
 * Side-conversation host logic: what a side thread inherits, how its
 * boundary is delivered, and how its own log is told apart from the seed.
 *
 * A side thread is a child session seeded with a COPY of the parent's log up
 * to the moment the thread opened. The seed may not end inside an open turn
 * (providers reject a dangling assistant tool call), so the inheritance is
 * closed honestly: a turn whose tool call is still executing is cut before
 * the turn and represented by a structured snapshot in the boundary prompt
 * instead of by events.
 *
 * Pure functions: the host supplies the events, so every rule here is
 * unit-testable without a session store.
 */
import type { WorkbenchSessionEvent } from './changes.js'

/** Thread-title prefix; also the row filter that finds side threads. */
export const SIDE_THREAD_MARK = 'Side: '

/** Label of a freshly created thread no prompt has reached yet. */
export const SIDE_THREAD_DEFAULT_NAME = 'Side: New thread'

/** Maximum code points kept in a durable thread label. */
export const LABEL_MAX_CHARS = 48

/** Opening line of the boundary message (the transcript drops rows starting with it). */
export const SIDE_BOUNDARY_PREFIX = 'Side conversation boundary'

/** Identity stamped on injected context messages, so the transcript recognizes them. */
export const SIDE_INJECTION_PLUGIN = 'zenwit-workbench'

/**
 * The boundary prompt delivered as the thread's first injected message: the
 * inherited seed is reference context only, never active instruction.
 * Model-facing contract — change only with intent; tests pin the sentences.
 */
export const SIDE_BOUNDARY_PROMPT = `Side conversation boundary.

Everything before this boundary is inherited history from the parent session: its completed turns, its pending question, and — if the parent was mid-turn — its in-progress output frozen at the moment this side conversation started. It is reference context only. It is not your current task.

Do not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.

Mode: this is a continuable side conversation. Your answers stay in this side thread and are viewed in the side panel; they are never delivered into the parent session.`

/** One seed event: the parent event with its full envelope preserved. */
export interface SeedEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  surfaceOp?: unknown
  sourceEventSeqs?: unknown
  ignorable?: true
}

/** The child seed plus the snapshot the boundary prompt carries instead. */
export interface SidechatInheritance {
  /** Contiguous from seq 0; ends outside any open turn. */
  seed: SeedEvent[]
  /** Structured snapshot of an open turn that could not be included; null otherwise. */
  snapshot: string | null
}

/** One in-flight model delta (published outside the log on 0.1.5+). */
export interface SidechatLiveChunk {
  turn: number
  chunk: Record<string, unknown>
}

/** Runtime state + agent identity of one thread. */
export interface SidechatThreadInfo {
  live: boolean
  status?: 'idle' | 'running'
  provider?: string
  model?: string
  preset?: string
}

/** The data record of one event. */
function dataOf(event: WorkbenchSessionEvent): Record<string, unknown> {
  return (event.data ?? {}) as Record<string, unknown>
}

/** Copy parent events verbatim (their live seq === array index contract). */
function copyEvents(events: readonly WorkbenchSessionEvent[]): SeedEvent[] {
  return events.map((event) => {
    const source = event as WorkbenchSessionEvent & {
      surfaceOp?: unknown
      sourceEventSeqs?: unknown
      ignorable?: true
    }
    return {
      type: source.type,
      seq: source.seq,
      time: typeof source.time === 'number' ? source.time : 0,
      data: dataOf(source),
      ...(source.surfaceOp === undefined ? {} : { surfaceOp: source.surfaceOp }),
      ...(source.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: source.sourceEventSeqs }),
      ...(source.ignorable === undefined ? {} : { ignorable: source.ignorable }),
    }
  })
}

/** Index of the last `turn/start` or `turn/end`, or -1. */
function lastTurnBoundary(events: readonly WorkbenchSessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = events[index]?.type
    if (type === 'turn/start' || type === 'turn/end') return index
  }
  return -1
}

/** Numeric field of an event's data (turn / step numbers). */
function numberAt(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
}

/** The step number still open at the log tail inside the given turn. */
function openStepInTurn(events: readonly WorkbenchSessionEvent[], turnStart: number): number | undefined {
  let open: number | undefined
  for (let index = turnStart + 1; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'step/start') open = numberAt(dataOf(event), 'step')
    else if (event.type === 'step/end') open = undefined
  }
  return open
}

/**
 * Whether the open turn ending the log has a tool call without its paired
 * result: such a turn cannot be closed honestly and needs the snapshot path.
 * @param events - the parent log.
 * @param turnStart - index of the open turn's `turn/start`.
 * @returns whether a call is still pending.
 */
export function hasDanglingToolCall(events: readonly WorkbenchSessionEvent[], turnStart: number): boolean {
  const pending = new Set<string>()
  for (let index = turnStart + 1; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    const data = dataOf(event)
    if (event.type === 'step/end') {
      pending.clear()
      continue
    }
    if (event.type === 'tool/call') {
      const callId = data.callId
      if (typeof callId === 'string') pending.add(callId)
      continue
    }
    if (event.type === 'tool/result') {
      const source = data.message as { source?: { callId?: unknown } } | undefined
      const callId = source?.source?.callId
      if (typeof callId === 'string') pending.delete(callId)
    }
  }
  return pending.size > 0
}

/** Plain text of one tool result (the text blocks inside its `tool-result` block). */
function toolResultText(data: Record<string, unknown>): string {
  const message = data.message as { content?: unknown } | undefined
  const content = message?.content
  if (!Array.isArray(content)) return ''
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
  return parts.join('\n')
}

/** Cap of one tool result's text inside a snapshot (prompt budget). */
const SNAPSHOT_RESULT_CAP = 2_000
/** Cap of the whole snapshot (prompt budget). */
const SNAPSHOT_TOTAL_CAP = 8_000

/** Assistant content blocks reduced to the text the snapshot shows. */
function messageTexts(message: unknown): { text: string, reasoning: string } {
  const content = (message as { content?: unknown } | undefined)?.content
  let text = ''
  let reasoning = ''
  if (!Array.isArray(content)) return { text, reasoning }
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown, text?: unknown }
    if (typeof candidate.text !== 'string' || candidate.text === '') continue
    if (candidate.type === 'text') text += candidate.text
    else if (candidate.type === 'reasoning') reasoning += candidate.text
  }
  return { text, reasoning }
}

/** Expand one attempt's compact stream records into text/reasoning. */
function streamTexts(stream: unknown): { text: string, reasoning: string } {
  let text = ''
  let reasoning = ''
  if (!Array.isArray(stream)) return { text, reasoning }
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    const entry = record as { type?: unknown, texts?: unknown, chunk?: unknown }
    if (entry.type === 'text-chunks' || entry.type === 'reasoning-chunks') {
      if (!Array.isArray(entry.texts)) continue
      const joined = entry.texts.filter((part): part is string => typeof part === 'string').join('')
      if (entry.type === 'text-chunks') text += joined
      else reasoning += joined
      continue
    }
    if (entry.type === 'chunk') {
      const chunk = entry.chunk as { type?: unknown, text?: unknown } | undefined
      if (chunk === null || typeof chunk !== 'object' || typeof chunk.text !== 'string') continue
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'reasoning-delta') reasoning += chunk.text
    }
  }
  return { text, reasoning }
}

/** One live delta's contribution to the snapshot. */
function liveTexts(chunk: Record<string, unknown>): { text: string, reasoning: string } {
  if (typeof chunk.text !== 'string' || chunk.text === '') return { text: '', reasoning: '' }
  if (chunk.type === 'text-delta') return { text: chunk.text, reasoning: '' }
  if (chunk.type === 'reasoning-delta') return { text: '', reasoning: chunk.text }
  return { text: '', reasoning: '' }
}

/**
 * Structured text snapshot of the parent's OPEN turn: assistant/reasoning
 * output so far plus tool activity (executed tools with result text, the
 * still-executing one marked).
 * @param events - the parent log.
 * @param live - the parent's in-flight deltas, in index order.
 * @returns the snapshot body, or null when there is nothing to show.
 */
export function buildOpenTurnSnapshot(
  events: readonly WorkbenchSessionEvent[],
  live: readonly SidechatLiveChunk[] = [],
): string | null {
  const boundary = lastTurnBoundary(events)
  if (boundary < 0 || events[boundary]?.type !== 'turn/start') return null
  const openTurn = numberAt(dataOf(events[boundary]!), 'turn')
  let text = ''
  let reasoning = ''
  const tools: string[] = []
  const pendingCalls = new Map<string, { name: string, args: string }>()
  for (let index = boundary + 1; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    const data = dataOf(event)
    if (event.type === 'step/end') {
      pendingCalls.clear()
      continue
    }
    if (event.type === 'assistant/message') {
      const settled = messageTexts(data.message)
      text += settled.text
      reasoning += settled.reasoning
      continue
    }
    if (event.type === 'assistant/attempt') {
      const attempt = streamTexts(data.stream)
      text += attempt.text
      reasoning += attempt.reasoning
      continue
    }
    if (event.type === 'tool/call') {
      const callId = data.callId
      if (typeof callId === 'string') {
        pendingCalls.set(callId, {
          name: typeof data.name === 'string' ? data.name : 'tool',
          args: typeof data.arguments === 'string' ? data.arguments : '',
        })
      }
      continue
    }
    if (event.type === 'tool/result') {
      const source = data.message as { source?: { callId?: unknown } } | undefined
      const callId = typeof source?.source?.callId === 'string' ? source.source.callId : undefined
      const call = callId === undefined ? undefined : pendingCalls.get(callId)
      if (callId !== undefined) pendingCalls.delete(callId)
      const result = toolResultText(data).slice(0, SNAPSHOT_RESULT_CAP)
      const failed = data.error !== undefined
      const line = [
        `- \`${call?.name ?? 'tool'}\`${failed ? ' (failed)' : ''}`
          + (call !== undefined && call.args !== '' ? ` — arguments: \`${call.args}\`` : ''),
        ...(result === '' ? [] : [`  Result: ${result}`]),
      ].join('\n')
      tools.push(line)
    }
  }
  for (const [, call] of pendingCalls) {
    tools.push(`- \`${call.name}\` (executing) — arguments: \`${call.args}\``)
  }
  // The in-flight step's deltas never reached the log.
  for (const delta of live) {
    if (delta.turn !== openTurn) continue
    const contribution = liveTexts(delta.chunk)
    text += contribution.text
    reasoning += contribution.reasoning
  }
  const sections: string[] = []
  if (text.trim() !== '') sections.push(`Assistant output so far:\n\n${text}`)
  if (reasoning.trim() !== '') sections.push(`Reasoning so far:\n\n${reasoning}`)
  if (tools.length > 0) sections.push(`Tool activity:\n${tools.join('\n')}`)
  if (sections.length === 0) return null
  const body = sections.join('\n\n')
  return body.length > SNAPSHOT_TOTAL_CAP
    ? `Parent session in-progress turn (reference only):\n\n${body.slice(0, SNAPSHOT_TOTAL_CAP)}…`
    : `Parent session in-progress turn (reference only):\n\n${body}`
}

/**
 * Build one thread's inheritance from the parent log: everything up to the
 * click moment, honestly closed when it ends inside an open turn.
 * @param events - the parent's log (live or persisted).
 * @param live - the parent's in-flight deltas (snapshot fallback only).
 * @returns the child seed and, when needed, the snapshot body.
 */
export function buildSidechatInheritance(
  events: readonly WorkbenchSessionEvent[],
  live: readonly SidechatLiveChunk[] = [],
): SidechatInheritance {
  if (events.length === 0) return { seed: [], snapshot: null }
  const boundary = lastTurnBoundary(events)
  if (boundary < 0 || events[boundary]?.type === 'turn/end') {
    // Ends outside any turn: the whole log is a valid, balanced seed.
    return { seed: copyEvents(events), snapshot: null }
  }
  if (hasDanglingToolCall(events, boundary)) {
    // Cannot close honestly: cut before the open turn and describe it.
    return { seed: copyEvents(events.slice(0, boundary)), snapshot: buildOpenTurnSnapshot(events, live) }
  }
  const seed = copyEvents(events)
  const last = events[events.length - 1]
  const turn = numberAt(dataOf(events[boundary]!), 'turn')
  const now = typeof last?.time === 'number' ? last.time : 0
  const openStep = openStepInTurn(events, boundary)
  if (openStep !== undefined) seed.push({ type: 'step/end', seq: seed.length, time: now, data: { turn, step: openStep } })
  seed.push({ type: 'turn/end', seq: seed.length, time: now, data: { turn, reason: { kind: 'interrupted' } } })
  return { seed, snapshot: null }
}

/** Leading text of a user message's content (block array or bare string). */
function messageLeadText(data: Record<string, unknown>): string {
  const content = data.content
  const first = Array.isArray(content) ? content[0] : content
  if (typeof first === 'string') return first
  if (typeof first === 'object' && first !== null && 'text' in first) return String((first as { text: unknown }).text)
  return ''
}

/**
 * Whether a logged user message is an injected context row (the boundary
 * prompt plus the parked snapshot) rather than a real user message.
 * @param data - the message event's data.
 * @returns whether the transcript should render it as an injection row.
 */
export function isContextInjectionMessage(data: Record<string, unknown>): boolean {
  const source = data.source as { kind?: unknown } | null | undefined
  if (source?.kind !== undefined && source.kind !== 'user') return true
  return messageLeadText(data).startsWith(SIDE_BOUNDARY_PREFIX)
}

/** Whether the thread log already carries the boundary (the first prompt landed). */
export function boundaryDelivered(events: readonly WorkbenchSessionEvent[]): boolean {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (messageLeadText(dataOf(event)).startsWith(SIDE_BOUNDARY_PREFIX)) return true
  }
  return false
}

/**
 * Turn a question into a durable thread label.
 * @param question - the operator's question (may be empty).
 * @returns the label, prefixed and truncated to the label budget.
 */
export function sideLabel(question: string): string {
  const flat = question.replace(/\s+/gu, ' ').trim()
  const max = Math.max(1, LABEL_MAX_CHARS - SIDE_THREAD_MARK.length)
  const body = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  return `${SIDE_THREAD_MARK}${body}`
}

/** The thread's OWN events: everything after the last fork-seed marker. */
export function threadOwnLogEvents(events: readonly WorkbenchSessionEvent[]): readonly WorkbenchSessionEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'session/end-seed') return events.slice(index + 1)
  }
  return events
}

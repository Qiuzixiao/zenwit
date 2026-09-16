/**
 * Fold a session event log into the compact live line the workbench shows on
 * a running subagent card: the latest assistant text and the latest tool call.
 *
 * Pure functions with no kernel dependency, so the folding is unit-testable
 * without a session store; the host supplies the events.
 */
import type { WorkbenchSessionEvent } from './changes.js'

/** The live status of one subagent card (both fields optional). */
export interface LastActivity {
  /** The latest assembled assistant text output. */
  text?: string
  /** The latest tool call. */
  tool?: { name: string; args: string }
}

/**
 * Extract the concatenated plain text of a content-block list.
 * @param content - the raw `content` field of a message event.
 * @returns the joined text, or undefined when the message carries no text.
 */
export function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/**
 * Fold a session event log into the last text output and last tool call.
 *
 * The scan runs BACKWARD from the newest event and stops once both fields are
 * found, so a long history costs only the recent tail. Lifecycle and raw
 * stream rows are ignored: the card shows what the subagent is doing, not its
 * plumbing.
 * @param events - the session's append-only log (oldest → newest).
 * @param maxMessages - message-boundary window; older activity is not surfaced.
 * @returns the last text and/or tool call, or an empty object.
 */
export function lastActivity(
  events: readonly WorkbenchSessionEvent[],
  maxMessages = Number.POSITIVE_INFINITY,
): LastActivity {
  let text: string | undefined
  let tool: { name: string; args: string } | undefined
  let messagesSeen = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (text !== undefined && tool !== undefined) break
    const event = events[index]
    if (event === undefined) continue
    const { type } = event
    const data = (event.data ?? {}) as { message?: { content?: unknown }, name?: unknown, arguments?: unknown }
    if (type === 'user/message' || type === 'assistant/message') {
      messagesSeen += 1
      if (messagesSeen > maxMessages) break
    } else if (messagesSeen >= maxMessages) {
      continue
    }
    if (text === undefined && type === 'assistant/message') {
      const extracted = contentText(data.message?.content)
      if (extracted !== undefined) text = extracted
    } else if (tool === undefined && type === 'tool/call') {
      tool = {
        name: typeof data.name === 'string' ? data.name : 'tool',
        args: typeof data.arguments === 'string' ? data.arguments : '',
      }
    }
  }
  return {
    ...(text === undefined ? {} : { text }),
    ...(tool === undefined ? {} : { tool }),
  }
}

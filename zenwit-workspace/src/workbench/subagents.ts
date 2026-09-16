/**
 * The live-preview method of the workbench's task page (`subagents.live`).
 *
 * One request refreshes the whole subagent tree instead of one call per
 * child: the host enumerates the descendants ONCE and folds each running
 * child's recent activity into a compact map. A deployment without a subagent
 * service, or one whose catalog read fails, reports that rather than an empty
 * tree.
 */
import type { WorkbenchSessionEvent } from './changes.js'
import { lastActivity, type LastActivity } from './subagent-activity.js'

/** One descendant row as the subagent catalog reports it. */
export interface SubagentEntry {
  id: string
  kind: string
  activity?: string
  label?: string
}

/** The dependencies the live method reads. */
export interface SubagentsLiveDeps {
  /** Enumerate one root's descendants (throws when the service is absent). */
  listDescendants(rootSessionId: string): Promise<readonly SubagentEntry[]>
  /** Read one session's events, or undefined when unknown. */
  readEvents(sessionId: string): readonly WorkbenchSessionEvent[] | undefined
}

/** Recent-message window folded per child. */
export const LIVE_WINDOW_MESSAGES = 12

/**
 * The thread-label prefix of side-chat sessions: they ride the subagent
 * origin but are workbench tabs, never topology, so the live map skips them.
 * (Mirror of the client's thread-label prefix.)
 */
export const SIDE_THREAD_MARK = 'Side: '

/**
 * Create the `subagents.live` method.
 * @param deps - catalog and event readers.
 * @returns the method.
 */
export function createSubagentsLiveMethod(
  deps: SubagentsLiveDeps,
): (payload: unknown) => Promise<{ live: Record<string, LastActivity> }> {
  return async (payload: unknown): Promise<{ live: Record<string, LastActivity> }> => {
    const record = payload as { rootSessionId?: unknown }
    const rootSessionId = typeof record.rootSessionId === 'string' ? record.rootSessionId : ''
    if (rootSessionId === '') throw new Error('rootSessionId is required')
    const descendants = await deps.listDescendants(rootSessionId)
    const live: Record<string, LastActivity> = {}
    for (const entry of descendants) {
      // The same gate the page draws cards on: running children only, and
      // side-chat threads are tabs rather than topology.
      if (entry.kind !== 'child' || entry.activity !== 'running') continue
      if (entry.label?.startsWith(SIDE_THREAD_MARK) === true) continue
      try {
        const activity = lastActivity(deps.readEvents(entry.id) ?? [], LIVE_WINDOW_MESSAGES)
        if (activity.text !== undefined || activity.tool !== undefined) live[entry.id] = activity
      } catch {
        // One child's log is unreadable: skip that child, keep the batch.
      }
    }
    return { live }
  }
}

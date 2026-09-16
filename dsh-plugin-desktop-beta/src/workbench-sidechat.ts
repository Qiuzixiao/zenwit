/**
 * Side-conversation methods of the workbench engine.
 *
 * A side thread is a child agent session seeded with a copy of the parent's
 * log up to the moment the thread opened (see `zenwit-workspace`'s
 * `sidechat` module for the inheritance rules). The thread lives beside the
 * parent conversation: its answers are never delivered into the parent.
 *
 * The methods are host-supplied because they need the agent registry, the
 * session log and the title service — services this product's engine package
 * deliberately does not import. They join the workbench dispatch table
 * through `extra`.
 *
 * Known degradation: the in-flight model deltas of DSH 0.1.5 are
 * process-local, so `sidechat.events` returns no live rows; a thread's text
 * appears once the step settles into the log.
 */
import { randomUUID } from 'node:crypto'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { SessionLogOffset, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import {
  SIDE_BOUNDARY_PROMPT,
  SIDE_INJECTION_PLUGIN,
  SIDE_THREAD_DEFAULT_NAME,
  boundaryDelivered,
  buildSidechatInheritance,
  sideLabel,
  threadOwnLogEvents,
  type SeedEvent,
  type WorkbenchSessionEvent,
  type WorkspaceHostContext,
} from 'zenwit-workspace'

/** Bound on one thread creation. */
const CREATE_TIMEOUT_MS = 30_000
/** Row cap of one events response. */
const EVENTS_CAP = 2_000

/** The agent registry face these methods read. */
interface AgentsService {
  get(id: SessionId): Agent | undefined
  create(options: CreateAgentOptions): Promise<{ agent: Agent, dispose(): Promise<void> }>
  resume(options: ResumeAgentOptions): Promise<{ agent: Agent, dispose(): Promise<void> }>
}

/** The title service face (label pinning). */
interface TitleService {
  rename(session: Agent['session'], title: string): void
}

/** One method of the workbench dispatch table. */
type Method = (payload: unknown) => Promise<unknown>

/** Read one required string field of a request payload. */
function stringOf(payload: unknown, key: string): string {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string' || value === '') throw new Error(`${key} is required`)
  return value
}

/** One content block list carrying plain text. */
function textPrompt(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

/**
 * Build the side-conversation methods.
 * @param ctx - the desktop host context (agent registry, sessions, titles).
 * @returns the methods, ready for the workbench dispatch table.
 */
export function createSidechatMethods(ctx: WorkspaceHostContext): Record<string, Method> {
  const disposers = new Map<string, () => Promise<void>>()
  const pendingSnapshots = new Map<string, string>()

  const agents = (): AgentsService | undefined => ctx.get?.('agents') as AgentsService | undefined
  const liveAgent = (childId: string): Agent | undefined => agents()?.get(childId as SessionId)
  const titles = (): TitleService | undefined => ctx.get?.('sessionTitle') as TitleService | undefined

  const pinTitle = (agent: Agent, label: string): void => {
    try {
      titles()?.rename(agent.session, label)
    } catch {
      // Keep the auto-generated title; the thread stays usable.
    }
  }

  /** Deliver the thread's first contact: boundary as injected context, then the question. */
  const firstContact = (agent: Agent, injectionText: string, question: string): void => {
    agent.inject(createUserMessage({
      content: textPrompt(injectionText),
      source: { kind: 'plugin', plugin: SIDE_INJECTION_PLUGIN },
    }))
    agent.followup(createUserMessage({ content: textPrompt(question), source: { kind: 'user' } }))
  }

  /** One thread's event log: the live session first, then the persisted one is not ported. */
  const eventsOf = (childId: string): readonly WorkbenchSessionEvent[] =>
    (ctx.sessions?.get(childId as SessionId)?.snapshotEvents() ?? []) as unknown as readonly WorkbenchSessionEvent[]

  return {
    'sidechat.start': async (payload) => {
      const sessionId = stringOf(payload, 'sessionId')
      const rawQuestion = (payload as { question?: unknown }).question
      const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : ''
      const parent = liveAgent(sessionId)
      if (parent === undefined) throw new Error(`parent session "${sessionId}" is not running`)
      const parentEvents = parent.session.snapshotEvents() as unknown as readonly WorkbenchSessionEvent[]
      const inheritance = buildSidechatInheritance(parentEvents)
      const label = question === '' ? SIDE_THREAD_DEFAULT_NAME : sideLabel(question)
      const childId = `sidechat-${randomUUID()}` as SessionId
      // Catalog citizenship: the durable descriptor keeps the thread a healthy
      // row in the host's subagent list; the task page filters the label out.
      const descriptor = snapshotSubagentDescriptor({
        mode: 'continuable',
        provider: 'sidechat',
        label,
        ...(parent.options.provider === undefined ? {} : { agentProvider: parent.options.provider }),
        ...(parent.options.model === undefined ? {} : { agentModel: parent.options.model }),
      })
      const seed: SeedEvent[] = [
        ...inheritance.seed,
        { type: 'subagent/descriptor', seq: inheritance.seed.length, time: Date.now(), data: descriptor as unknown as Record<string, unknown> },
      ]
      const registry = agents()
      if (registry?.create === undefined) throw new Error('the agents service is unavailable')
      const header = parent.session.header
      const handle = await registry.create({
        sessionId: childId,
        parentAgent: parent,
        meta: {
          ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
          parentSession: parent.session.id,
          isSeeded: true,
          origin: 'subagent',
          delegationDepth: (header.delegationDepth ?? 0) + 1,
          ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
        },
        seed: seed as unknown as readonly SessionEvent[],
        inheritedEventCount: SessionLogOffset(seed.length),
        agentOptions: { ...parent.options },
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      })
      disposers.set(childId, () => handle.dispose())
      if (question === '') {
        // Immediate create: the composer owns the first message.
        if (inheritance.snapshot !== null) pendingSnapshots.set(childId, inheritance.snapshot)
        pinTitle(handle.agent, SIDE_THREAD_DEFAULT_NAME)
      } else {
        const parts = [SIDE_BOUNDARY_PROMPT]
        if (inheritance.snapshot !== null) parts.push(inheritance.snapshot)
        firstContact(handle.agent, parts.join('\n\n'), question)
        pinTitle(handle.agent, sideLabel(question))
      }
      return { childId }
    },

    'sidechat.prompt': async (payload) => {
      const childId = stringOf(payload, 'childId')
      const text = stringOf(payload, 'text').trim()
      if (text === '') throw new Error('text is required')
      let agent = liveAgent(childId)
      if (agent === undefined) {
        const registry = agents()
        if (registry?.resume === undefined) throw new Error('the agents service is unavailable')
        const handle = await registry.resume({ resumeSessionId: childId as SessionId })
        disposers.set(childId, () => handle.dispose())
        agent = handle.agent
      }
      if (boundaryDelivered(eventsOf(childId))) {
        agent.followup(createUserMessage({ content: textPrompt(text), source: { kind: 'user' } }))
      } else {
        const parts = [SIDE_BOUNDARY_PROMPT]
        const snapshot = pendingSnapshots.get(childId)
        pendingSnapshots.delete(childId)
        if (snapshot !== undefined) parts.push(snapshot)
        firstContact(agent, parts.join('\n\n'), text)
        pinTitle(agent, sideLabel(text))
      }
      return { accepted: true }
    },

    'sidechat.cancel': async (payload) => {
      liveAgent(stringOf(payload, 'childId'))?.cancel({ kind: 'user' }, { keepInbox: true })
      return { accepted: true }
    },

    'sidechat.dispose': async (payload) => {
      const childId = stringOf(payload, 'childId')
      pendingSnapshots.delete(childId)
      const dispose = disposers.get(childId)
      if (dispose !== undefined) {
        disposers.delete(childId)
        try {
          await dispose()
        } catch {
          // The agent may already be gone (restart); the session persists.
        }
      }
      return { accepted: true }
    },

    'sidechat.info': async (payload) => {
      const childId = stringOf(payload, 'childId')
      const agent = liveAgent(childId)
      if (agent === undefined) return { live: false }
      const preset = agent.session.header.agentPreset
      return {
        live: true,
        status: agent.status,
        ...(agent.options.provider === undefined ? {} : { provider: agent.options.provider }),
        ...(agent.options.model === undefined ? {} : { model: agent.options.model }),
        ...(preset === undefined ? {} : { preset }),
      }
    },

    'sidechat.events': async (payload) => {
      const childId = stringOf(payload, 'childId')
      const rawAfter = (payload as { afterSeq?: unknown }).afterSeq
      if (rawAfter !== undefined && (typeof rawAfter !== 'number' || !Number.isSafeInteger(rawAfter) || rawAfter < 0)) {
        throw new Error('afterSeq must be a non-negative integer')
      }
      const own = threadOwnLogEvents(eventsOf(childId))
      const fresh = rawAfter === undefined ? own : own.filter(event => event.seq > rawAfter)
      return {
        events: fresh.length > EVENTS_CAP ? fresh.slice(fresh.length - EVENTS_CAP) : fresh,
        // The in-flight deltas are process-local on this kernel generation and
        // are not read here; settled text arrives through the log.
        live: [],
      }
    },
  }
}

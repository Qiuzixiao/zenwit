import { describe, expect, it } from 'vitest'
import {
  SIDE_BOUNDARY_PREFIX,
  SIDE_BOUNDARY_PROMPT,
  SIDE_INJECTION_PLUGIN,
  SIDE_THREAD_DEFAULT_NAME,
  sideLabel,
  type WorkspaceHostContext,
} from 'zenwit-workspace'
import { createSidechatMethods } from '../src/workbench-sidechat.ts'

/** One session-log row, in the shape the engine's helpers read. */
interface LogEvent {
  seq: number
  time: number
  type: string
  data: Record<string, unknown>
}

/** A parent log that ends outside any turn: the whole log is a valid seed. */
function balancedLog(): LogEvent[] {
  return [
    { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'hello' }] } },
    { seq: 2, time: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hi' }] } } },
    { seq: 3, time: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

/** A parent log whose last turn is still open with a call that never returned. */
function openTurnLog(): LogEvent[] {
  return [
    ...balancedLog(),
    { seq: 4, time: 5, type: 'turn/start', data: { turn: 2 } },
    { seq: 5, time: 6, type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } },
  ]
}

/** One thread row carrying the boundary, as the delivered first prompt leaves it. */
function deliveredBoundary(seq = 0): LogEvent {
  return {
    seq,
    time: 1,
    type: 'user/message',
    data: { content: [{ type: 'text', text: `${SIDE_BOUNDARY_PREFIX}${'\n'}context` }], source: { kind: 'user' } },
  }
}

interface HarnessInput {
  parentLog?: LogEvent[]
  childLog?: LogEvent[]
  /** Whether the child id resolves to a live agent. */
  liveChild?: boolean
  /** Whether the parent id resolves to a live agent. */
  liveParent?: boolean
}

/** Wire the methods to fakes that record every kernel call they make. */
function harness(input: HarnessInput = {}) {
  const injected: Array<Record<string, unknown>> = []
  const followups: Array<Record<string, unknown>> = []
  const cancelled: unknown[] = []
  const renamed: string[] = []
  const created: Array<Record<string, unknown>> = []
  const resumed: Array<Record<string, unknown>> = []
  const disposed: string[] = []
  const childLog = input.childLog ?? []
  const parentLog = input.parentLog ?? balancedLog()

  const child = {
    session: {
      id: 'sidechat-child',
      header: { cwd: '/tmp/project', delegationDepth: 1 },
      snapshotEvents: () => childLog,
    },
    options: { provider: 'deepseek', model: 'deepseek-chat' },
    status: 'running',
    inject: (message: Record<string, unknown>) => { injected.push(message) },
    followup: (message: Record<string, unknown>) => { followups.push(message) },
    cancel: (reason: unknown) => { cancelled.push(reason) },
  }
  const parent = {
    session: {
      id: 'parent',
      header: { cwd: '/tmp/project', delegationDepth: 0, agentPreset: 'coder' },
      snapshotEvents: () => parentLog,
    },
    options: { provider: 'deepseek', model: 'deepseek-chat' },
    status: 'running',
    inject: () => undefined,
    followup: () => undefined,
    cancel: () => undefined,
  }
  const agents = {
    get: (id: string) => {
      if (id === 'parent') return input.liveParent === false ? undefined : parent
      return input.liveChild === true ? child : undefined
    },
    create: async (options: Record<string, unknown>) => {
      created.push(options)
      return { agent: child, dispose: async () => { disposed.push('child') } }
    },
    resume: async (options: Record<string, unknown>) => {
      resumed.push(options)
      return { agent: child, dispose: async () => { disposed.push('child') } }
    },
  }
  const titles = { rename: (_session: unknown, title: string) => { renamed.push(title) } }
  const ctx = {
    get: (name: string) => (name === 'agents' ? agents : name === 'sessionTitle' ? titles : undefined),
    sessions: { get: (id: string) => ({ snapshotEvents: () => (id === 'sidechat-child' ? childLog : []) }) },
  }
  const methods = createSidechatMethods(ctx as unknown as WorkspaceHostContext)
  const call = async (name: string, payload: unknown): Promise<unknown> => {
    const method = methods[name]
    if (method === undefined) throw new Error(`${name} is not part of the table`)
    return await method(payload)
  }
  return { call, injected, followups, cancelled, renamed, created, resumed, disposed }
}

/** The text of one outgoing message's first content block. */
function firstText(message: Record<string, unknown> | undefined): string {
  const content = message?.content as Array<{ text?: string }> | undefined
  return content?.[0]?.text ?? ''
}

describe('side conversations: thread creation', () => {
  it('seeds a new thread from the parent log and asks the first question', async () => {
    const fakes = harness()
    const result = await fakes.call('sidechat.start', { sessionId: 'parent', question: 'why is the build slow?' }) as { childId: string }

    expect(result.childId).toMatch(/^sidechat-/u)
    const request = fakes.created[0]
    expect(request?.sessionId).toBe(result.childId)
    expect(request?.inheritedEventCount).toBe((request?.seed as unknown[]).length)
    const seed = request?.seed as LogEvent[]
    // The parent's four rows, then this thread's own descriptor.
    expect(seed.slice(0, 4).map(event => event.type)).toEqual(['turn/start', 'user/message', 'assistant/message', 'turn/end'])
    expect(seed.at(-1)?.type).toBe('subagent/descriptor')
    expect(seed.at(-1)?.seq).toBe(seed.length - 1)
    expect((seed.at(-1)?.data as { label?: string }).label).toBe(sideLabel('why is the build slow?'))
    const meta = request?.meta as Record<string, unknown>
    expect(meta).toMatchObject({ cwd: '/tmp/project', parentSession: 'parent', isSeeded: true, origin: 'subagent', delegationDepth: 1, agentPreset: 'coder' })
    // The boundary is injected context; the question is the real user turn.
    expect(firstText(fakes.injected[0])).toBe(SIDE_BOUNDARY_PROMPT)
    expect((fakes.injected[0]?.source as { plugin?: string }).plugin).toBe(SIDE_INJECTION_PLUGIN)
    expect(firstText(fakes.followups[0])).toBe('why is the build slow?')
    expect((fakes.followups[0]?.source as { kind?: string }).kind).toBe('user')
    expect(fakes.renamed).toEqual([sideLabel('why is the build slow?')])
  })

  it('parks the open-turn snapshot when the parent is mid-turn', async () => {
    const fakes = harness({ parentLog: openTurnLog() })
    await fakes.call('sidechat.start', { sessionId: 'parent', question: 'what is happening?' })

    const text = firstText(fakes.injected[0])
    expect(text.startsWith(SIDE_BOUNDARY_PROMPT)).toBe(true)
    // The incomplete turn is described, not fabricated into seed events.
    expect(text).toContain('Parent session in-progress turn (reference only):')
    expect(text).toContain('bash')
    const seedTypes = (fakes.created[0]?.seed as LogEvent[]).map(event => event.type)
    expect(seedTypes).toEqual(['turn/start', 'user/message', 'assistant/message', 'turn/end', 'subagent/descriptor'])
  })

  it('opens an empty thread without a first message', async () => {
    const fakes = harness()
    const result = await fakes.call('sidechat.start', { sessionId: 'parent', question: '   ' }) as { childId: string }

    expect(result.childId).toMatch(/^sidechat-/u)
    expect(fakes.injected).toEqual([])
    expect(fakes.followups).toEqual([])
    expect(fakes.renamed).toEqual([SIDE_THREAD_DEFAULT_NAME])
  })

  it('refuses to open a thread on a session that is not running', async () => {
    const fakes = harness({ liveParent: false })
    await expect(fakes.call('sidechat.start', { sessionId: 'parent', question: 'hi' })).rejects.toThrow(/is not running/u)
    expect(fakes.created).toEqual([])
  })

  it('requires a session id', async () => {
    const fakes = harness()
    await expect(fakes.call('sidechat.start', { question: 'hi' })).rejects.toThrow(/sessionId is required/u)
  })
})

describe('side conversations: prompts', () => {
  it('delivers the boundary with the parked snapshot on the first prompt', async () => {
    const fakes = harness({ parentLog: openTurnLog() })
    const started = await fakes.call('sidechat.start', { sessionId: 'parent', question: '' }) as { childId: string }
    await fakes.call('sidechat.prompt', { childId: started.childId, text: 'and now?' })

    const text = firstText(fakes.injected[0])
    expect(text.startsWith(SIDE_BOUNDARY_PROMPT)).toBe(true)
    expect(text).toContain('Parent session in-progress turn (reference only):')
    expect(firstText(fakes.followups[0])).toBe('and now?')
    expect(fakes.renamed.at(-1)).toBe(sideLabel('and now?'))
  })

  it('sends a plain follow-up once the boundary is already in the log', async () => {
    const fakes = harness({ liveChild: true, childLog: [deliveredBoundary()] })
    await fakes.call('sidechat.prompt', { childId: 'sidechat-child', text: 'more detail' })

    expect(fakes.injected).toEqual([])
    expect(fakes.followups).toHaveLength(1)
    expect(firstText(fakes.followups[0])).toBe('more detail')
    // No title rewrite: the thread keeps the label it opened with.
    expect(fakes.renamed).toEqual([])
  })

  it('resumes a thread whose process is gone', async () => {
    const fakes = harness({ liveChild: false })
    await fakes.call('sidechat.prompt', { childId: 'sidechat-child', text: 'still there?' })

    expect(fakes.resumed).toEqual([{ resumeSessionId: 'sidechat-child' }])
    // The resumed log carries no boundary, so the first contact is re-delivered.
    expect(firstText(fakes.injected[0])).toBe(SIDE_BOUNDARY_PROMPT)
    expect(firstText(fakes.followups[0])).toBe('still there?')
  })

  it('rejects empty text', async () => {
    const fakes = harness({ liveChild: true })
    await expect(fakes.call('sidechat.prompt', { childId: 'sidechat-child', text: '   ' })).rejects.toThrow(/text is required/u)
    expect(fakes.followups).toEqual([])
  })
})

describe('side conversations: control and inspection', () => {
  it('cancels the thread by name', async () => {
    const fakes = harness({ liveChild: true })
    await fakes.call('sidechat.cancel', { childId: 'sidechat-child' })
    expect(fakes.cancelled).toHaveLength(1)
  })

  it('disposes the thread and tolerates a second dispose', async () => {
    const fakes = harness()
    const started = await fakes.call('sidechat.start', { sessionId: 'parent', question: 'x' }) as { childId: string }
    await fakes.call('sidechat.dispose', { childId: started.childId })
    await fakes.call('sidechat.dispose', { childId: started.childId })
    expect(fakes.disposed).toEqual(['child'])
  })

  it('reports liveness and routing for a live thread only', async () => {
    const live = harness({ liveChild: true })
    await expect(live.call('sidechat.info', { childId: 'sidechat-child' })).resolves.toMatchObject({
      live: true,
      status: 'running',
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    const gone = harness({ liveChild: false })
    await expect(gone.call('sidechat.info', { childId: 'sidechat-child' })).resolves.toEqual({ live: false })
  })

  it('returns the thread own rows after the cursor and no live deltas', async () => {
    const childLog = [
      ...balancedLog(),
      { seq: 4, time: 5, type: 'session/end-seed', data: {} },
      { seq: 5, time: 6, type: 'user/message', data: { content: [{ type: 'text', text: 'second' }] } },
      { seq: 6, time: 7, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'answer' }] } } },
    ]
    const fakes = harness({ childLog })
    await expect(fakes.call('sidechat.events', { childId: 'sidechat-child' })).resolves.toEqual({
      events: childLog.slice(5),
      live: [],
    })
    await expect(fakes.call('sidechat.events', { childId: 'sidechat-child', afterSeq: 5 })).resolves.toEqual({
      events: childLog.slice(6),
      live: [],
    })
  })

  it('rejects a cursor that is not a non-negative integer', async () => {
    const fakes = harness()
    await expect(fakes.call('sidechat.events', { childId: 'sidechat-child', afterSeq: -1 })).rejects.toThrow(/afterSeq/u)
    await expect(fakes.call('sidechat.events', { childId: 'sidechat-child', afterSeq: 1.5 })).rejects.toThrow(/afterSeq/u)
  })
})

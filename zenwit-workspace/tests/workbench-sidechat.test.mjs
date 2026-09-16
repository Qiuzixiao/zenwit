import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SIDE_BOUNDARY_PREFIX,
  SIDE_BOUNDARY_PROMPT,
  SIDE_THREAD_MARK,
  boundaryDelivered,
  buildOpenTurnSnapshot,
  buildSidechatInheritance,
  hasDanglingToolCall,
  isContextInjectionMessage,
  sideLabel,
  threadOwnLogEvents,
} from '../lib/workbench/sidechat.js'

/** A parent log that ends outside any turn. */
function balancedLog() {
  return [
    { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'hello' }] } },
    { seq: 2, time: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hi' }] } } },
    { seq: 3, time: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

test('a log that ends outside a turn is seeded whole', () => {
  const result = buildSidechatInheritance(balancedLog())
  assert.equal(result.snapshot, null)
  assert.equal(result.seed.length, 4)
  assert.equal(result.seed[1].data.content[0].text, 'hello')
  assert.deepEqual(buildSidechatInheritance([]), { seed: [], snapshot: null })
})

test('an open turn without pending tools is closed before the seed', () => {
  const events = [
    ...balancedLog(),
    { seq: 4, time: 5, type: 'turn/start', data: { turn: 2 } },
    { seq: 5, time: 6, type: 'step/start', data: { turn: 2, step: 1 } },
    { seq: 6, time: 7, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'working' }] } } },
  ]
  const result = buildSidechatInheritance(events)
  assert.equal(result.snapshot, null)
  // The open step and turn are closed synthetically, so the seed is balanced.
  assert.deepEqual(result.seed.slice(-2).map(event => event.type), ['step/end', 'turn/end'])
  assert.equal(result.seed.at(-1).data.turn, 2)
  assert.equal(result.seed.at(-1).seq, result.seed.length - 1)
})

test('an open turn with a dangling tool call falls back to a snapshot', () => {
  const events = [
    ...balancedLog(),
    { seq: 4, time: 5, type: 'turn/start', data: { turn: 2 } },
    { seq: 5, time: 6, type: 'step/start', data: { turn: 2, step: 1 } },
    { seq: 6, time: 7, type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } },
    { seq: 7, time: 8, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'running it' }] } } },
  ]
  assert.equal(hasDanglingToolCall(events, 4), true)
  const result = buildSidechatInheritance(events)
  // The incomplete turn is cut, not fabricated into events.
  assert.equal(result.seed.length, 4)
  assert.match(result.snapshot ?? '', /executing/u)
  assert.match(result.snapshot ?? '', /bash/u)
  assert.match(result.snapshot ?? '', /running it/u)
})

test('the snapshot folds settled tools, their results and live deltas', () => {
  const events = [
    { seq: 0, time: 1, type: 'turn/start', data: { turn: 3 } },
    { seq: 1, time: 2, type: 'tool/call', data: { callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
    { seq: 2, time: 3, type: 'tool/result', data: { message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'file body' }] }] } } },
    { seq: 3, time: 4, type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: '{"command":"sleep 1"}' } },
  ]
  const snapshot = buildOpenTurnSnapshot(events, [{ turn: 3, chunk: { type: 'text-delta', text: 'still thinking' } }])
  assert.match(snapshot ?? '', /read/u)
  assert.match(snapshot ?? '', /file body/u)
  assert.match(snapshot ?? '', /bash.*executing|executing.*bash/su)
  assert.match(snapshot ?? '', /still thinking/u)
  // Nothing to show: an empty open turn produces no snapshot.
  assert.equal(buildOpenTurnSnapshot(events.slice(0, 1)), null)
})

test('the boundary, injection rows and labels are recognized structurally', () => {
  assert.equal(sideLabel('  what   is this?  '), SIDE_THREAD_MARK + 'what is this?')
  assert.equal(sideLabel('x'.repeat(200)).length, 48)
  assert.equal(boundaryDelivered([{ seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: SIDE_BOUNDARY_PREFIX + '\n…' }] } }]), true)
  assert.equal(boundaryDelivered(balancedLog()), false)
  assert.equal(isContextInjectionMessage({ content: [{ type: 'text', text: SIDE_BOUNDARY_PREFIX }] }), true)
  assert.equal(isContextInjectionMessage({ content: 'hello', source: { kind: 'user' } }), false)
  assert.equal(isContextInjectionMessage({ content: 'snapshot', source: { kind: 'plugin' } }), true)
  assert.match(SIDE_BOUNDARY_PROMPT, /never delivered into the parent session\.$/u)
})

test('a thread log is told apart from its inherited seed', () => {
  const events = [
    { seq: 0, type: 'user/message', data: { content: 'inherited' } },
    { seq: 1, type: 'session/end-seed', data: {} },
    { seq: 2, type: 'user/message', data: { content: 'own' } },
  ]
  assert.deepEqual(threadOwnLogEvents(events).map(event => event.seq), [2])
  assert.equal(threadOwnLogEvents(balancedLog()).length, 4)
})

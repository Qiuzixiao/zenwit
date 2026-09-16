import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANGES_EVENTS_CAP, createChangesOpsMethod } from '../lib/workbench/changes.js'

/** Events for one session, keyed by id. */
function eventsOf(byId) {
  return sessionId => byId[sessionId]
}

test('the changes lens returns tool rows past the cursor', () => {
  const method = createChangesOpsMethod(eventsOf({
    s1: [
      { seq: 0, type: 'tool/call', name: 'read' },
      { seq: 1, type: 'assistant/chunk' },
      { seq: 2, type: 'tool/result', name: 'read' },
      { seq: 3, type: 'tool/call', name: 'write' },
    ],
  }))
  // No cursor: the floor is -1, so a log that opens on a tool event still
  // contributes its seq-0 row.
  assert.deepEqual(method({ sessionId: 's1' }), {
    events: [
      { seq: 0, type: 'tool/call', name: 'read' },
      { seq: 2, type: 'tool/result', name: 'read' },
      { seq: 3, type: 'tool/call', name: 'write' },
    ],
    lastSeq: 3,
  })
  assert.deepEqual(method({ sessionId: 's1', afterSeq: 2 }).events.map(event => event.seq), [3])
  assert.equal(method({ sessionId: 's1', afterSeq: 9 }).lastSeq, 9)
})

test('the changes lens answers an unknown session with an empty window', () => {
  const method = createChangesOpsMethod(eventsOf({}))
  assert.deepEqual(method({ sessionId: 'missing' }), { events: [], lastSeq: 0 })
  assert.deepEqual(method({ sessionId: 'missing', afterSeq: 4 }), { events: [], lastSeq: 4 })
})

test('the changes lens caps the window and refuses bad cursors', () => {
  const many = Array.from({ length: CHANGES_EVENTS_CAP + 25 }, (_value, index) => ({ seq: index, type: 'tool/call' }))
  const method = createChangesOpsMethod(eventsOf({ s1: many }))
  const result = method({ sessionId: 's1' })
  assert.equal(result.events.length, CHANGES_EVENTS_CAP)
  assert.equal(result.lastSeq, CHANGES_EVENTS_CAP + 24)

  assert.throws(() => method({}), /sessionId/)
  assert.throws(() => method({ sessionId: 's1', afterSeq: -2 }), /afterSeq/)
  assert.throws(() => method({ sessionId: 's1', afterSeq: 1.5 }), /afterSeq/)
})

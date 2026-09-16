import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createJobsKillMethod, createJobsOutputMethod, isNoNewOutput, resultIsError, resultText } from '../lib/workbench/jobs.js'

/** One tool result event carrying plain text. */
function result(seq, callId, text, isError = false) {
  return {
    seq,
    type: 'tool/result',
    data: { message: { source: { callId }, content: isError ? [{ type: 'tool-result', isError: true }] : [{ type: 'tool-result', content: [{ type: 'text', text }] }] } },
  }
}

/** One job_output tool call. */
function call(seq, callId, jobId) {
  return { seq, type: 'tool/call', data: { name: 'job_output', callId, arguments: JSON.stringify({ job_id: jobId }) } }
}

test('the job output replays the model reads of one job, oldest first', () => {
  const method = createJobsOutputMethod({
    readEvents: () => [
      call(0, 'c1', 'job-a'),
      result(1, 'c1', 'first chunk'),
      call(2, 'c2', 'job-b'),
      result(3, 'c2', 'other job'),
      call(4, 'c3', 'job-a'),
      result(5, 'c3', '(no new output)'),
      call(6, 'c4', 'job-a'),
      result(7, 'c4', 'second chunk'),
    ],
    outputLimit: 1024,
  })
  assert.deepEqual(method({ sessionId: 's', id: 'job-a' }), {
    text: 'first chunk\nsecond chunk',
    truncated: false,
    read: true,
  })
  // A job the model never read is honestly unread and empty.
  assert.deepEqual(method({ sessionId: 's', id: 'job-c' }), { text: '', truncated: false, read: false })
  assert.throws(() => method({ sessionId: 's' }), /id/)
})

test('an error result counts as a read without contributing text', () => {
  const method = createJobsOutputMethod({
    readEvents: () => [call(0, 'c1', 'job-a'), result(1, 'c1', '', true)],
    outputLimit: 1024,
  })
  assert.deepEqual(method({ sessionId: 's', id: 'job-a' }), { text: '', truncated: false, read: true })
})

test('the job output honours its byte cap', () => {
  const method = createJobsOutputMethod({
    readEvents: () => [call(0, 'c1', 'job-a'), result(1, 'c1', 'x'.repeat(64))],
    outputLimit: 16,
  })
  const capped = method({ sessionId: 's', id: 'job-a' })
  assert.equal(capped.truncated, true)
  assert.ok(Buffer.byteLength(capped.text, 'utf8') <= 16)
})

test('job result helpers read the durable block shape', () => {
  assert.equal(resultText([{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }] }]), 'ok')
  assert.equal(resultText([{ type: 'text', text: 'not a result block' }]), undefined)
  assert.equal(resultIsError([{ type: 'tool-result', isError: true }]), true)
  assert.equal(resultIsError([{ type: 'tool-result' }]), false)
  assert.equal(isNoNewOutput('(no new output)'), true)
  assert.equal(isNoNewOutput('real output'), false)
})

test('job kill reports the registry outcome', () => {
  const seen = []
  const method = createJobsKillMethod({
    kill: (id, sessionId, reason) => {
      seen.push([id, sessionId, reason])
      return id === 'live' ? 'requested' : 'already-finished'
    },
  })
  assert.deepEqual(method({ sessionId: 's', id: 'live' }), { ok: true, outcome: 'requested' })
  assert.deepEqual(seen[0], ['live', 's', 'user requested'])
  assert.deepEqual(method({ sessionId: 's', id: 'done', reason: 'changed my mind' }), { ok: true, outcome: 'already-finished' })
  assert.throws(() => method({ id: 'live' }), /sessionId/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contentText, lastActivity } from '../lib/workbench/subagent-activity.js'
import { createSubagentsLiveMethod, LIVE_WINDOW_MESSAGES } from '../lib/workbench/subagents.js'

test('lastActivity folds the newest text and tool call', () => {
  const events = [
    { seq: 0, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'first' }] } } },
    { seq: 1, type: 'tool/call', data: { name: 'read', arguments: '{"path":"a"}' } },
    { seq: 2, type: 'session/title', data: {} },
    { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'latest' }] } } },
    { seq: 4, type: 'tool/call', data: { name: 'edit', arguments: '{"path":"b"}' } },
  ]
  assert.deepEqual(lastActivity(events), { text: 'latest', tool: { name: 'edit', args: '{"path":"b"}' } })
  assert.equal(lastActivity([]).text, undefined)
  // A log whose newest row is a tool call still reports text from earlier.
  assert.deepEqual(lastActivity(events.slice(0, 2)), { text: 'first', tool: { name: 'read', args: '{"path":"a"}' } })
})

test('lastActivity honours the message window', () => {
  const events = []
  for (let index = 0; index < LIVE_WINDOW_MESSAGES + 3; index += 1) {
    events.push({ seq: index * 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'm' + index }] } } })
    events.push({ seq: index * 2 + 1, type: 'tool/call', data: { name: 'read', arguments: '{}' } })
  }
  const bounded = lastActivity(events, LIVE_WINDOW_MESSAGES)
  assert.equal(bounded.text, 'm' + (LIVE_WINDOW_MESSAGES + 2))
  assert.equal(bounded.tool.name, 'read')
})

test('contentText joins text blocks and ignores everything else', () => {
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(contentText([{ type: 'image' }]), undefined)
  assert.equal(contentText('not a list'), undefined)
})

test('the live map folds only running child sessions', async () => {
  const events = {
    running: [{ seq: 0, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'working' }] } } }],
    quiet: [],
    side: [{ seq: 0, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'thread' }] } } }],
  }
  const method = createSubagentsLiveMethod({
    listDescendants: async () => [
      { id: 'running', kind: 'child', activity: 'running' },
      { id: 'quiet', kind: 'child', activity: 'running' },
      { id: 'done', kind: 'child', activity: 'idle' },
      { id: 'side', kind: 'child', activity: 'running', label: 'Side: question' },
      { id: 'self', kind: 'root', activity: 'running' },
    ],
    readEvents: (sessionId) => events[sessionId],
  })
  assert.deepEqual(await method({ rootSessionId: 'root' }), { live: { running: { text: 'working' } } })
  await assert.rejects(() => method({}), /rootSessionId/)
})

test('a missing subagent catalog fails loudly', async () => {
  const method = createSubagentsLiveMethod({
    listDescendants: async () => { throw new Error('subagent service unavailable') },
    readEvents: () => undefined,
  })
  await assert.rejects(() => method({ rootSessionId: 'root' }), /unavailable/)
})

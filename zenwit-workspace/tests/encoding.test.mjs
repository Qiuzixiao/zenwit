import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectEncoding, encodeText, isSupportedEncoding } from '../lib/encoding.js'

test('detects text encodings from a byte table', () => {
  const cases = [
    ['empty', [], { encoding: 'utf-8', confidence: 'certain' }],
    ['ascii', [0x68, 0x65, 0x6C, 0x6C, 0x6F], { encoding: 'utf-8', confidence: 'certain' }],
    ['utf-8 bom', [0xEF, 0xBB, 0xBF, 0x68, 0x69], { encoding: 'utf-8', confidence: 'certain' }],
    ['utf-8 cjk', [0xE4, 0xBD, 0xA0, 0xE5, 0xA5, 0xBD], { encoding: 'utf-8', confidence: 'certain' }],
    ['utf-16le bom', [0xFF, 0xFE, 0x68, 0x00], { encoding: 'utf-16le', confidence: 'certain' }],
    ['utf-16be bom', [0xFE, 0xFF, 0x00, 0x68], { encoding: 'utf-16be', confidence: 'certain' }],
    ['utf-16le no bom', [0x68, 0x00, 0x69, 0x00], { encoding: 'utf-16le', confidence: 'likely' }],
    ['utf-16be no bom', [0x00, 0x68, 0x00, 0x69], { encoding: 'utf-16be', confidence: 'likely' }],
    ['gb18030', [0xC4, 0xE3, 0xBA, 0xC3], { encoding: 'gb18030', confidence: 'fallback' }],
    ['windows-1252', [0x80, 0x81], { encoding: 'windows-1252', confidence: 'fallback' }],
    ['binary', [0x00, 0x00, 0x41, 0x7F, 0x00, 0xE2, 0x99, 0x00, 0x00, 0x9D, 0x00, 0x81], undefined],
  ]
  for (const [name, bytes, expected] of cases) {
    assert.deepEqual(detectEncoding(Uint8Array.from(bytes)), expected, name)
  }
})

test('encodes text back to the original encoding', () => {
  assert.deepEqual([...encodeText('你', 'gb18030')], [0xC4, 0xE3])
  assert.deepEqual([...encodeText('你', 'utf-8')], [0xE4, 0xBD, 0xA0])
  assert.deepEqual([...encodeText('你', 'utf-16be')], [0x4F, 0x60])
  assert.equal(isSupportedEncoding('gb18030'), true)
  assert.equal(isSupportedEncoding('utf-16le'), true)
  assert.equal(isSupportedEncoding('bogus'), false)
  assert.equal(isSupportedEncoding(7), false)
})

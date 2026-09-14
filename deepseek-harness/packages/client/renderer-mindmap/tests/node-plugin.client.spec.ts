// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('mindmap node half', () => {
  it('registers nothing on the host', () => {
    expect(apply()).toBeUndefined()
  })
})

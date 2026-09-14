// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentRenderers, RendererContribution } from '@deepseek-ai/dsh-client-ui-workbench/preview'
import { apply, inject } from '../src/client/index.ts'

describe('mindmap renderer plugin', () => {
  it('registers a .mm preview and removes it on teardown', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_contribution: RendererContribution) => dispose)
    const root = new Context()
    root.provide('documentRenderers', { register } as unknown as DocumentRenderers)
    const fiber = root.plugin({ inject, apply })
    try {
      await fiber.await()
      expect(register).toHaveBeenCalledTimes(1)
      const contribution = register.mock.calls[0]?.[0]
      if (contribution === undefined) throw new Error('renderer contribution was not registered')
      expect(contribution).toMatchObject({
        id: 'community/mindmap',
        contract: 1,
        match: { extensions: ['.mm'] },
        views: ['preview'],
        maxBytes: 4 * 1024 * 1024,
      })
      const module = await contribution.load()
      expect(typeof module.View).toBe('function')
      await fiber.dispose()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      await fiber.dispose()
    }
  })
})

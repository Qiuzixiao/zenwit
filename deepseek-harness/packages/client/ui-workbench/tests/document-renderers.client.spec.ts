import { describe, expect, it, vi } from 'vitest'
import { createDocumentRenderers } from '../src/client/document-renderers.ts'
import type { RendererContribution, RendererModule } from '../src/client/document-renderers.ts'

const View = (): null => null
const rendererModule: RendererModule = { View }

function contribution(overrides: Partial<RendererContribution> = {}): RendererContribution {
  return {
    id: 'example/mindmap',
    contract: 1,
    match: { extensions: ['.mm'] },
    views: ['preview'],
    load: async () => rendererModule,
    ...overrides,
  }
}

describe('document renderer registry', () => {
  it('registers, describes and disposes a contribution idempotently', () => {
    const registry = createDocumentRenderers()
    const dispose = registry.register(contribution())
    expect(registry.describe('/p/a.mm').renderer).toBe('example/mindmap')
    expect(registry.describe('/p/a.mm').views).toEqual(['preview', 'source'])
    expect(registry.revision).toBe(1)
    dispose()
    expect(registry.describe('/p/a.mm').renderer).toBeNull()
    expect(registry.revision).toBe(2)
    dispose()
    expect(registry.revision).toBe(2)
  })

  it('notifies subscribers, then stops after unsubscribe', () => {
    const registry = createDocumentRenderers()
    const listener = vi.fn()
    const off = registry.subscribe(listener)
    const dispose = registry.register(contribution())
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    dispose()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('soft-rejects a wrong contract, a duplicate id and a missing loader', () => {
    const registry = createDocumentRenderers()
    const dispose = registry.register(contribution())
    const rejectedContract = registry.register(contribution({ id: 'other/contract', contract: 2 }))
    const rejectedDuplicate = registry.register(contribution())
    const noLoader = { id: 'other/y', contract: 1, match: { extensions: ['.y'] }, views: ['preview'] } as unknown as RendererContribution
    const rejectedLoader = registry.register(noLoader)

    expect(registry.describe('/p/a.mm').renderer).toBe('example/mindmap')
    expect(registry.inventory()).toEqual({
      entries: [{ id: 'example/mindmap', builtin: false, status: 'active' }],
      rejected: [
        { id: 'other/contract', rejection: { kind: 'contract', declared: 2, required: 1 } },
        { id: 'example/mindmap', rejection: { kind: 'duplicate-id', id: 'example/mindmap' } },
        { id: 'other/y', rejection: { kind: 'invalid', field: 'load' } },
      ],
    })
    for (const disposeRejected of [rejectedContract, rejectedDuplicate, rejectedLoader]) disposeRejected()
    expect(registry.describe('/p/a.mm').renderer).toBe('example/mindmap')
    dispose()
  })

  it('registers a loader-less built-in and refuses a malformed one', async () => {
    const registry = createDocumentRenderers()
    const disposeBuiltin = registry.registerBuiltin({ id: 'builtin/image', contract: 1, match: { mediaTypes: ['image/png'] }, views: ['preview'] })
    const rejectedBuiltin = registry.registerBuiltin({ id: 'builtin/broken', contract: 9, match: { mediaTypes: ['image/png'] }, views: ['preview'] })
    expect(registry.describe('/p/a.png').renderer).toBe('builtin/image')
    expect(registry.inventory()).toEqual({
      entries: [{ id: 'builtin/image', builtin: true, status: 'active' }],
      rejected: [{ id: 'builtin/broken', rejection: { kind: 'contract', declared: 9, required: 1 } }],
    })
    await expect(registry.load('builtin/image')).rejects.toThrow('document renderer builtin/image has no loader')
    disposeBuiltin()
    rejectedBuiltin()
    expect(registry.describe('/p/a.png').renderer).toBeNull()
  })

  it('prefers a built-in on a tie and lets a plugin take over after disposal', () => {
    const registry = createDocumentRenderers()
    const disposeBuiltin = registry.registerBuiltin({ id: 'builtin/image', contract: 1, match: { mediaTypes: ['image/png'] }, views: ['preview'] })
    const disposePlugin = registry.register(contribution({ id: 'example/png', match: { mediaTypes: ['image/png'] } }))
    expect(registry.describe('/p/a.png').renderer).toBe('builtin/image')
    disposeBuiltin()
    expect(registry.describe('/p/a.png').renderer).toBe('example/png')
    expect(registry.inventory().entries).toEqual([{ id: 'example/png', builtin: false, status: 'active' }])
    disposePlugin()
  })

  it('caches a successful load and rejects an unknown renderer', async () => {
    const registry = createDocumentRenderers()
    const loader = vi.fn(async (): Promise<RendererModule> => rendererModule)
    registry.register(contribution({ load: loader }))
    expect(await registry.load('example/mindmap')).toBe(rendererModule)
    expect(await registry.load('example/mindmap')).toBe(rendererModule)
    expect(loader).toHaveBeenCalledTimes(1)
    await expect(registry.load('missing/id')).rejects.toThrow('unknown document renderer: missing/id')
  })

  it('degrades on load failure, does not retry while failed, and re-arms on retry', async () => {
    const registry = createDocumentRenderers()
    const loader = vi.fn<() => Promise<RendererModule>>()
    loader.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(rendererModule)
    registry.register(contribution({ load: loader }))

    await expect(registry.load('example/mindmap')).rejects.toThrow('boom')
    const failed = registry.resolve('/p/a.mm')
    expect(failed.descriptor.renderer).toBeNull()
    expect(failed.fallback).toEqual({ kind: 'load-failed', id: 'example/mindmap' })
    expect(registry.inventory().entries[0]?.status).toBe('load-failed')
    expect(registry.describe('/p/a.mm').renderer).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)

    registry.retry('example/mindmap')
    expect(registry.describe('/p/a.mm').renderer).toBe('example/mindmap')
    expect(await registry.load('example/mindmap')).toBe(rendererModule)
    expect(registry.inventory().entries[0]?.status).toBe('active')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('records one failure for a renderer that fails repeatedly and recovers a load without retry', async () => {
    const registry = createDocumentRenderers()
    const loader = vi.fn<() => Promise<RendererModule>>()
    loader.mockRejectedValueOnce(new Error('one')).mockRejectedValueOnce(new Error('two')).mockResolvedValueOnce(rendererModule)
    registry.register(contribution({ load: loader }))
    await expect(registry.load('example/mindmap')).rejects.toThrow('one')
    const afterFirst = registry.revision
    await expect(registry.load('example/mindmap')).rejects.toThrow('two')
    expect(registry.revision).toBe(afterFirst)
    await registry.load('example/mindmap')
    expect(registry.revision).toBe(afterFirst + 1)
    expect(registry.inventory().entries[0]?.status).toBe('active')
  })

  it('does not notify when retry re-arms a healthy renderer', () => {
    const registry = createDocumentRenderers()
    registry.register(contribution())
    const before = registry.revision
    registry.retry('example/mindmap')
    expect(registry.revision).toBe(before)
  })

  it('re-arms on retry after a recovered load without a second notification', async () => {
    const registry = createDocumentRenderers()
    const loader = vi.fn<() => Promise<RendererModule>>()
    loader.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(rendererModule)
    registry.register(contribution({ load: loader }))
    await expect(registry.load('example/mindmap')).rejects.toThrow('boom')
    const revisionAfterFailure = registry.revision
    await registry.load('example/mindmap')
    expect(registry.revision).toBe(revisionAfterFailure + 1)
  })
})

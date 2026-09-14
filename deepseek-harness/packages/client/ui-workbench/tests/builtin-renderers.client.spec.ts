import { describe, expect, it } from 'vitest'
import { createDocumentRenderers } from '../src/client/document-renderers.ts'
import {
  BUILTIN_RENDERER_DECLARATIONS, BUILTIN_RENDERER_IDS, isBuiltinRendererId, registerBuiltinRenderers,
} from '../src/client/builtin-renderers.ts'

describe('builtin renderers', () => {
  it('registers every built-in and selects it through the registry', () => {
    const registry = createDocumentRenderers()
    const dispose = registerBuiltinRenderers(registry)
    expect(registry.describe('/p/a.html').renderer).toBe('builtin/html')
    expect(registry.describe('/p/a.svg').renderer).toBe('builtin/svg')
    expect(registry.describe('/p/a.png').renderer).toBe('builtin/image')
    expect(registry.describe('/p/a.pdf').renderer).toBe('builtin/pdf')
    expect(registry.describe('/p/a.mp4').renderer).toBe('builtin/video')
    expect(registry.describe('/p/a.mp3').renderer).toBe('builtin/audio')
    expect(registry.describe('/p/a.png').views).toEqual(['preview'])
    expect(registry.describe('/p/a.html').views).toEqual(['preview', 'source'])
    expect(registry.inventory().entries).toHaveLength(BUILTIN_RENDERER_DECLARATIONS.length)
    expect(registry.inventory().entries.every(entry => entry.builtin)).toBe(true)
    dispose()
    expect(registry.describe('/p/a.png').renderer).toBeNull()
  })

  it('recognizes built-in ids only', () => {
    expect(isBuiltinRendererId(BUILTIN_RENDERER_IDS.image)).toBe(true)
    expect(isBuiltinRendererId('example/mindmap')).toBe(false)
  })
})

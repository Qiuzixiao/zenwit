import { describe, expect, it } from 'vitest'
import {
  describeDocument, deriveViews, DOCUMENT_RENDERER_CONTRACT, EXTENSION_SPECIFICITY, EXACT_MEDIA_TYPE_SPECIFICITY,
  defaultMediaTypeFor, matchSpecificity, selectRenderer, storageClassFor, validateDeclaration,
  WILDCARD_MEDIA_TYPE_SPECIFICITY,
} from '../src/client/document-descriptor.ts'
import type { RendererDeclaration, RendererRegistryState } from '../src/client/document-descriptor.ts'

const EMIT = 4 * 1024 * 1024

const mm: RendererDeclaration = { id: 'example/mindmap', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'] }
const builtinImage: RendererDeclaration = { id: 'builtin/image', contract: 1, match: { mediaTypes: ['image/png'] }, views: ['preview'] }
const builtinWildcard: RendererDeclaration = { id: 'builtin/image-wild', contract: 1, match: { mediaTypes: ['image/*'] }, views: ['preview'] }

function state(declarations: readonly RendererDeclaration[], builtinIds: string[] = [], failedIds: string[] = []): RendererRegistryState {
  return { declarations, builtinIds: new Set(builtinIds), failedIds: new Set(failedIds) }
}

describe('storage class and media type defaults', () => {
  it('classifies unknown, text and binary types', () => {
    expect(storageClassFor(undefined)).toBe('text')
    expect(storageClassFor('text/plain')).toBe('text')
    expect(storageClassFor('application/json')).toBe('text')
    expect(storageClassFor('image/png')).toBe('binary')
    expect(storageClassFor('video/mp4')).toBe('binary')
  })

  it('names the fallback media type per storage class', () => {
    expect(defaultMediaTypeFor('text')).toBe('text/plain')
    expect(defaultMediaTypeFor('binary')).toBe('application/octet-stream')
  })
})

describe('match specificity', () => {
  it('ranks exact media type above extension above wildcard', () => {
    expect(matchSpecificity({ mediaTypes: ['image/png'] }, 'a.png', 'image/png')).toBe(EXACT_MEDIA_TYPE_SPECIFICITY)
    expect(matchSpecificity({ extensions: ['.mm'] }, 'a.mm', undefined)).toBe(EXTENSION_SPECIFICITY)
    expect(matchSpecificity({ extensions: ['mm'] }, 'a.mm', undefined)).toBe(EXTENSION_SPECIFICITY)
    expect(matchSpecificity({ extensions: ['.MM'] }, 'a.MM', undefined)).toBe(EXTENSION_SPECIFICITY)
    expect(matchSpecificity({ mediaTypes: ['image/*'] }, 'a.png', 'image/png')).toBe(WILDCARD_MEDIA_TYPE_SPECIFICITY)
  })

  it('reports no match when nothing applies', () => {
    expect(matchSpecificity({ extensions: ['.mm'] }, 'a.md', 'text/markdown')).toBeUndefined()
    expect(matchSpecificity({ mediaTypes: ['image/png'] }, 'a.unknown', undefined)).toBeUndefined()
    expect(matchSpecificity({ mediaTypes: ['image/*'] }, 'a.unknown', undefined)).toBeUndefined()
    expect(matchSpecificity({ mediaTypes: ['image'] }, 'a.png', 'image/png')).toBeUndefined()
    expect(matchSpecificity({ mediaTypes: ['image/*'] }, 'a.png', 'png')).toBeUndefined()
    expect(matchSpecificity({ extensions: [] }, 'noextension', undefined)).toBeUndefined()
    expect(matchSpecificity({ mediaTypes: ['image/jpeg'] }, 'a.png', 'image/png')).toBeUndefined()
  })
})

describe('renderer total order', () => {
  it('breaks priority before specificity', () => {
    const override: RendererDeclaration = { id: 'plugin/override', contract: 1, match: { mediaTypes: ['image/*'] }, views: ['preview'], priority: 1 }
    expect(selectRenderer('a.png', 'image/png', [builtinImage, override], new Set(['builtin/image']))?.id).toBe('plugin/override')
  })

  it('breaks specificity before builtin status', () => {
    expect(selectRenderer('a.png', 'image/png', [builtinWildcard, builtinImage], new Set(['builtin/image', 'builtin/image-wild']))?.id).toBe('builtin/image')
  })

  it('prefers the builtin on an otherwise exact tie', () => {
    const plugin: RendererDeclaration = { id: 'plugin/png', contract: 1, match: { mediaTypes: ['image/png'] }, views: ['preview'] }
    expect(selectRenderer('a.png', 'image/png', [plugin, builtinImage], new Set(['builtin/image']))?.id).toBe('builtin/image')
  })

  it('breaks a full tie by id ascending', () => {
    const first: RendererDeclaration = { id: 'a/one', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'] }
    const second: RendererDeclaration = { id: 'z/two', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'] }
    expect(selectRenderer('a.mm', undefined, [second, first], new Set())?.id).toBe('a/one')
    expect(selectRenderer('a.mm', undefined, [first, second], new Set())?.id).toBe('a/one')
  })

  it('returns undefined when nothing matches', () => {
    expect(selectRenderer('a.md', 'text/markdown', [mm], new Set())).toBeUndefined()
  })

  it('keeps the first of two declarations that are fully equal', () => {
    expect(selectRenderer('a.mm', undefined, [mm, mm], new Set())?.id).toBe('example/mindmap')
  })
})

describe('views derivation', () => {
  it('derives the four storage/renderer combinations', () => {
    expect(deriveViews('text', ['preview'])).toEqual(['preview', 'source'])
    expect(deriveViews('binary', ['preview'])).toEqual(['preview'])
    expect(deriveViews('text', [])).toEqual(['source'])
    expect(deriveViews('binary', [])).toEqual([])
  })

  it('drops view ids this build does not know', () => {
    expect(deriveViews('binary', ['preview', 'timeline'])).toEqual(['preview'])
    expect(deriveViews('text', ['timeline'])).toEqual(['source'])
  })
})

describe('descriptor derivation', () => {
  it('uses a matching renderer with the declared views first', () => {
    const { descriptor, fallback } = describeDocument('/p/a.mm', state([mm], [], []), 128)
    expect(fallback).toBeUndefined()
    expect(descriptor).toEqual({ path: '/p/a.mm', mediaType: 'text/plain', storage: 'text', views: ['preview', 'source'], renderer: 'example/mindmap', size: 128 })
  })

  it('falls back to source for text and to no view for binary', () => {
    expect(describeDocument('/p/a.txt', state([]), undefined).descriptor.views).toEqual(['source'])
    expect(describeDocument('/p/a.txt', state([]), undefined).fallback).toEqual({ kind: 'none' })
    expect(describeDocument('/p/a.mp4', state([]), undefined).descriptor.views).toEqual([])
    expect(describeDocument('/p/a.mp4', state([]), undefined).descriptor.mediaType).toBe('video/mp4')
    expect(describeDocument('/p/a.unknown', state([]), undefined).descriptor.mediaType).toBe('text/plain')
    expect(describeDocument('/p/a.unknown', state([]), undefined).descriptor.storage).toBe('text')
  })

  it('degrades to no renderer when load failed', () => {
    const { descriptor, fallback } = describeDocument('/p/a.mm', state([mm], [], ['example/mindmap']), 128)
    expect(descriptor.renderer).toBeNull()
    expect(descriptor.views).toEqual(['source'])
    expect(fallback).toEqual({ kind: 'load-failed', id: 'example/mindmap' })
  })

  it('degrades to no renderer when the size exceeds the limit', () => {
    const limited: RendererDeclaration = { ...mm, maxBytes: EMIT }
    const { descriptor, fallback } = describeDocument('/p/a.mm', state([limited]), EMIT + 1)
    expect(descriptor.renderer).toBeNull()
    expect(fallback).toEqual({ kind: 'over-limit', id: 'example/mindmap', maxBytes: EMIT })
  })

  it('does not veto on an unknown size and accepts a size at the limit', () => {
    const limited: RendererDeclaration = { ...mm, maxBytes: EMIT }
    expect(describeDocument('/p/a.mm', state([limited]), undefined).descriptor.renderer).toBe('example/mindmap')
    expect(describeDocument('/p/a.mm', state([limited]), EMIT).descriptor.renderer).toBe('example/mindmap')
  })
})

describe('declaration validation', () => {
  const accepted = new Set<string>()

  it('accepts a well-formed declaration and the current contract', () => {
    expect(validateDeclaration(mm, accepted, DOCUMENT_RENDERER_CONTRACT)).toBeUndefined()
  })

  it('rejects a blank id, a wrong contract and a duplicate id', () => {
    expect(validateDeclaration({ ...mm, id: '  ' }, accepted, 1)).toEqual({ kind: 'invalid', field: 'id' })
    expect(validateDeclaration({ ...mm, contract: 2 }, accepted, 1)).toEqual({ kind: 'contract', declared: 2, required: 1 })
    expect(validateDeclaration({ ...mm, contract: 1.5 }, accepted, 1)).toEqual({ kind: 'contract', declared: 1.5, required: 1 })
    expect(validateDeclaration(mm, new Set(['example/mindmap']), 1)).toEqual({ kind: 'duplicate-id', id: 'example/mindmap' })
  })

  it('rejects a declaration that matches nothing or carries invalid bounds', () => {
    expect(validateDeclaration({ ...mm, match: {} }, accepted, 1)).toEqual({ kind: 'invalid', field: 'match' })
    expect(validateDeclaration({ ...mm, priority: Number.NaN }, accepted, 1)).toEqual({ kind: 'invalid', field: 'priority' })
    expect(validateDeclaration({ ...mm, maxBytes: 0 }, accepted, 1)).toEqual({ kind: 'invalid', field: 'maxBytes' })
    expect(validateDeclaration({ ...mm, maxBytes: Number.POSITIVE_INFINITY }, accepted, 1)).toEqual({ kind: 'invalid', field: 'maxBytes' })
  })
})

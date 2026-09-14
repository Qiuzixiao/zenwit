import { describe, expect, it } from 'vitest'
import { createDocumentRenderers, type RendererContribution, type RendererModule } from '../src/client/document-renderers.ts'
import { registerBuiltinRenderers } from '../src/client/builtin-renderers.ts'
import { describeWorkbenchDocument, selectedView } from '../src/client/document-capabilities.ts'

const rendererModule: RendererModule = { View: () => null }

function registryWithBuiltins() {
  const registry = createDocumentRenderers()
  registerBuiltinRenderers(registry)
  return registry
}

describe('workbench document capabilities', () => {
  it('provides the built-in markdown editor view when no renderer claims the file', () => {
    const document = describeWorkbenchDocument(registryWithBuiltins(), '/p/notes.md')
    expect(document.views).toEqual(['preview', 'source'])
    expect(document.editor).toBe('markdown')
    expect(document.hasPreview).toBe(true)
    expect(document.canSwitchViews).toBe(true)
  })

  it('routes html and svg through their built-in previews with source switching', () => {
    for (const path of ['/p/index.html', '/p/logo.svg']) {
      const document = describeWorkbenchDocument(registryWithBuiltins(), path)
      expect(document.views).toEqual(['preview', 'source'])
      expect(document.editor).toBe('text')
      expect(document.canSwitchViews).toBe(true)
    }
  })

  it('offers only preview for binary images and pdf', () => {
    for (const path of ['/p/photo.png', '/p/scan.pdf']) {
      const document = describeWorkbenchDocument(registryWithBuiltins(), path)
      expect(document.views).toEqual(['preview'])
      expect(document.editor).toBeUndefined()
      expect(document.canSwitchViews).toBe(false)
    }
  })

  it('offers source for plain text and a streaming preview for media', () => {
    const text = describeWorkbenchDocument(registryWithBuiltins(), '/p/notes.txt')
    expect(text.views).toEqual(['source'])
    expect(text.editor).toBe('text')
    expect(text.hasPreview).toBe(false)
    const video = describeWorkbenchDocument(registryWithBuiltins(), '/p/clip.mp4')
    expect(video.views).toEqual(['preview'])
    expect(video.editor).toBeUndefined()
    expect(video.descriptor.storage).toBe('binary')
    expect(video.descriptor.renderer).toBe('builtin/video')
  })

  it('lets a plugin renderer supply the preview and replaces the built-in markdown editor', () => {
    const registry = registryWithBuiltins()
    const contribution: RendererContribution = {
      id: 'example/mindmap', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: async () => rendererModule,
    }
    const markdownContribution: RendererContribution = {
      id: 'example/markdown', contract: 1, match: { mediaTypes: ['text/markdown'] }, views: ['preview'], load: async () => rendererModule,
    }
    registry.register(contribution)
    registry.register(markdownContribution)
    const mm = describeWorkbenchDocument(registry, '/p/plan.mm')
    expect(mm.descriptor.renderer).toBe('example/mindmap')
    expect(mm.views).toEqual(['preview', 'source'])
    expect(mm.editor).toBe('text')
    const markdown = describeWorkbenchDocument(registry, '/p/notes.md')
    expect(markdown.descriptor.renderer).toBe('example/markdown')
    expect(markdown.editor).toBe('text')
  })

  it('restores the built-in markdown editor when a plugin renderer has failed', async () => {
    const registry = registryWithBuiltins()
    registry.register({ id: 'example/markdown', contract: 1, match: { mediaTypes: ['text/markdown'] }, views: ['preview'], load: () => Promise.reject(new Error('boom')) })
    await expect(registry.load('example/markdown')).rejects.toThrow('boom')
    const document = describeWorkbenchDocument(registry, '/p/notes.md')
    expect(document.descriptor.renderer).toBeNull()
    expect(document.editor).toBe('markdown')
    expect(document.hasPreview).toBe(true)
  })

  it('reports the fallback reason for a failed renderer and none for an unmatched file', async () => {
    const registry = registryWithBuiltins()
    registry.register({ id: 'example/mm', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: () => Promise.reject(new Error('boom')) })
    await expect(registry.load('example/mm')).rejects.toThrow('boom')
    expect(describeWorkbenchDocument(registry, '/p/a.mm').fallback).toEqual({ kind: 'load-failed', id: 'example/mm' })
    expect(describeWorkbenchDocument(registry, '/p/notes.txt').fallback).toEqual({ kind: 'none' })
  })

  it('selects the rendered view from the offered views and the persisted preference', () => {
    expect(selectedView(['preview', 'source'], true)).toBe('preview')
    expect(selectedView(['preview', 'source'], false)).toBe('source')
    expect(selectedView(['preview'], false)).toBe('preview')
    expect(selectedView(['source'], true)).toBe('source')
    expect(selectedView([], true)).toBeUndefined()
  })

  it('keeps a legacy image extension like avif on the text path', () => {
    const document = describeWorkbenchDocument(registryWithBuiltins(), '/p/photo.avif')
    expect(document.descriptor.storage).toBe('text')
    expect(document.views).toEqual(['source'])
  })
})

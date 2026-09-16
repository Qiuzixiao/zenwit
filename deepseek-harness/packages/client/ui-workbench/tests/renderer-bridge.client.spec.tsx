// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createDocumentRenderers } from '../src/client/document-renderers.ts'
import { DOCUMENT_RENDERER_CONTRACT } from '../src/client/document-descriptor.ts'
import { bridgeDocumentRenderers, type EngineViewerRegistry } from '../src/client/renderer-bridge.ts'
import type { FileViewerProps } from '../src/client/workbench/service.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The copy seat the bridge hands to bridged views. */
const t = ((key: string) => (key in en ? en[key as keyof typeof en] : key)) as never

/** Captures engine viewer registrations. */
function engineRegistry() {
  const descriptors = new Map<string, { exts: readonly string[]; component: (props: FileViewerProps) => unknown }>()
  const engine: EngineViewerRegistry = {
    registerFileViewer(descriptor) {
      descriptors.set(descriptor.id, descriptor)
      return () => { descriptors.delete(descriptor.id) }
    },
  }
  return { engine, descriptors }
}

/** The viewer props the engine passes to a bridged viewer. */
function viewerProps(path: string, content: string): FileViewerProps {
  return {
    path,
    title: 'a.mm',
    viewerId: 'plugin:mm',
    content,
    scope: { sessionId: 'session', cwd: '/project' },
  } as unknown as FileViewerProps
}

it('mirrors an extension-matched renderer into the engine and feeds it the file', async () => {
  const registry = createDocumentRenderers()
  const { engine, descriptors } = engineRegistry()
  const dispose = bridgeDocumentRenderers(registry, engine, t)
  registry.register({
    id: 'plugin:mm', contract: DOCUMENT_RENDERER_CONTRACT, match: { extensions: ['.mm'] }, views: ['preview'],
    load: async () => ({
      View: (props: { source: string; mediaType: string; resolve: (relative: string) => string }) => (
        <div>{props.mediaType}|{props.source}|{props.resolve('img/pic.png')}</div>
      ),
    }),
  })

  const descriptor = descriptors.get('plugin:mm')
  expect(descriptor?.exts).toEqual(['mm'])
  render(<div>{descriptor!.component(viewerProps('/project/docs/a.mm', 'mind map source')) as never}</div>)
  await waitFor(() => expect(screen.getByText(/mind map source/u)).toBeTruthy())
  const text = screen.getByText(/mind map source/u).textContent ?? ''
  expect(text).toContain('text/plain')
  expect(text).toContain('/api/desktop/workbench/file?')
  expect(text).toContain('img%2Fpic.png')
  dispose()
  expect(descriptors.size).toBe(0)
})

it('leaves media-type-only renderers unbridged', () => {
  const registry = createDocumentRenderers()
  const { engine, descriptors } = engineRegistry()
  const dispose = bridgeDocumentRenderers(registry, engine, t)
  registry.register({
    id: 'plugin:any-image', contract: DOCUMENT_RENDERER_CONTRACT, match: { mediaTypes: ['image/tiff'] }, views: ['preview'],
    load: vi.fn(),
  })
  expect(descriptors.size).toBe(0)
  dispose()
})

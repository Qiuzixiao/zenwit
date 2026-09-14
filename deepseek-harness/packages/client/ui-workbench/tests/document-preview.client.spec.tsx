// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentPreview } from '../src/client/preview/DocumentPreview.tsx'
import { createDocumentRenderers } from '../src/client/document-renderers.ts'
import { registerBuiltinRenderers } from '../src/client/builtin-renderers.ts'
import type { PreviewViewProps, RendererModule } from '../src/client/document-renderers.ts'
import type { CopyProps } from '../src/client/contract.ts'

vi.mock('../src/client/preview/PdfPreview.tsx', () => ({
  PdfPreview: ({ data }: { data: Uint8Array }) => <div data-testid="pdf" data-bytes={data.byteLength} />,
}))

const t = ((key: string) => key) as unknown as CopyProps['t']

function builtinRegistry() {
  const registry = createDocumentRenderers()
  registerBuiltinRenderers(registry)
  return registry
}

const bytesResponse = (values: number[]): Response => new Response(Uint8Array.from(values), { status: 200 })

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('document preview plugin host', () => {
  it('loads and renders the plugin view selected by the descriptor', async () => {
    const registry = createDocumentRenderers()
    const loader = vi.fn(async (): Promise<RendererModule> => ({
      View: ({ path }: { path: string }) => <div data-testid="plugin-view">{path}</div>,
    }))
    registry.register({ id: 'example/mindmap', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: loader })
    const descriptor = registry.describe('/p/a.mm')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.mm" source="<map/>" revision={0} request={fetch} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('plugin-view')).toBeTruthy() })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('loads a plugin module at most once across re-renders', async () => {
    const registry = createDocumentRenderers()
    const loader = vi.fn(async (): Promise<RendererModule> => ({ View: () => <div data-testid="plugin-view" /> }))
    registry.register({ id: 'example/mindmap', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: loader })
    const descriptor = registry.describe('/p/a.mm')
    const view = render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.mm" source="<map/>" revision={0} request={fetch} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('plugin-view')).toBeTruthy() })
    view.rerender(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.mm" source="<map2/>" revision={1} request={fetch} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('plugin-view')).toBeTruthy() })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('keeps the loading status when a plugin loader rejects', async () => {
    const registry = createDocumentRenderers()
    const loader = vi.fn(() => Promise.reject(new Error('boom')))
    registry.register({ id: 'example/mm', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: loader })
    const descriptor = registry.describe('/p/a.mm')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.mm" source="" revision={0} request={fetch} t={t} />)
    await waitFor(() => { expect(loader).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('status').textContent).toBe('loading')
  })

  it('ignores a plugin module that resolves after unmount', async () => {
    const registry = createDocumentRenderers()
    let resolveLoad: ((module: RendererModule) => void) | undefined
    const loader = vi.fn(() => new Promise<RendererModule>(resolve => { resolveLoad = resolve }))
    registry.register({ id: 'example/mm', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: loader })
    const descriptor = registry.describe('/p/a.mm')
    const view = render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.mm" source="" revision={0} request={fetch} t={t} />)
    await waitFor(() => { expect(loader).toHaveBeenCalledTimes(1) })
    view.unmount()
    resolveLoad?.({ View: () => null })
    await new Promise(resolve => { setTimeout(resolve, 0) })
  })

  it('ignores a plugin rejection after unmount', async () => {
    const registry = createDocumentRenderers()
    let rejectLoad: ((error: Error) => void) | undefined
    const loader = vi.fn(() => new Promise<RendererModule>((_resolve, reject) => { rejectLoad = reject }))
    registry.register({ id: 'example/mm', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: loader })
    const descriptor = registry.describe('/p/a.mm')
    const view = render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.mm" source="" revision={0} request={fetch} t={t} />)
    await waitFor(() => { expect(loader).toHaveBeenCalledTimes(1) })
    view.unmount()
    rejectLoad?.(new Error('late'))
    await new Promise(resolve => { setTimeout(resolve, 0) })
  })

  it('passes a document-relative asset resolver to plugin views', async () => {
    const registry = createDocumentRenderers()
    let captured: PreviewViewProps | undefined
    registry.register({ id: 'example/mm', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: async () => ({ View: (props: PreviewViewProps) => { captured = props; return <div data-testid="plugin-view" /> } }) })
    const descriptor = registry.describe('/p/a.mm')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.mm" source="<map/>" revision={0} request={fetch} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('plugin-view')).toBeTruthy() })
    expect(captured?.resolve('pic.png')).toBe('/api/desktop/projects/file?path=%2Fp%2Fa.mm&raw=1&relative=pic.png')
  })

  it('shows the unavailable notice when no renderer is selected', () => {
    const registry = createDocumentRenderers()
    const descriptor = registry.describe('/p/a.bin')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/a.bin" source="" revision={0} request={fetch} t={t} />)
    expect(screen.getByRole('alert').textContent).toBe('previewUnavailable')
  })
})

describe('document preview built-in families', () => {
  it('renders a built-in image preview from Host bytes and refreshes on demand', async () => {
    const request = vi.fn(async () => bytesResponse([1, 2, 3]))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/photo.png')
    const view = render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/photo.png" source="" revision={0} request={request} t={t} />)
    expect(await screen.findByRole('img')).toBeTruthy()
    expect(URL.createObjectURL).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'refreshPreview' }))
    await waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('degrades to the failed notice when the image cannot be decoded', async () => {
    const request = vi.fn(async () => bytesResponse([1]))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/photo.png')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/photo.png" source="" revision={0} request={request} t={t} />)
    fireEvent.error(await screen.findByRole('img'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('previewFailed') })
  })

  it('renders a built-in SVG preview from the draft source', async () => {
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/logo.svg')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/logo.svg" source="<svg/>" revision={0} request={fetch} t={t} />)
    expect(await screen.findByRole('img')).toBeTruthy()
  })

  it('packs relative HTML assets through the Host, with and without a query suffix', async () => {
    const request = vi.fn(async () => bytesResponse([1]))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/index.html')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/index.html" source={'<img src="pic.png"><img src="other.gif?v=1">'} revision={0} request={request} t={t} />)
    expect(await screen.findByTitle('htmlPreview')).toBeTruthy()
    await waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
  })

  it('reports a non-ok Host response', async () => {
    const request = vi.fn(async () => new Response('nope', { status: 500 }))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/photo.png')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/photo.png" source="" revision={0} request={request} t={t} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('previewFailed') })
  })

  it('renders the lazy PDF preview for a pdf descriptor', async () => {
    const request = vi.fn(async () => bytesResponse([1, 2, 3]))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/scan.pdf')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/scan.pdf" source="" revision={0} request={request} t={t} />)
    expect(await screen.findByTestId('pdf')).toBeTruthy()
  })

  it('renders a streaming video element without reading bytes', () => {
    const request = vi.fn(async () => bytesResponse([1]))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/clip.mp4')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/clip.mp4" source="" revision={0} request={request} t={t} />)
    const video = screen.getByLabelText('/p/clip.mp4')
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toBe('/api/desktop/projects/file?path=%2Fp%2Fclip.mp4&stream=1')
    expect(request).not.toHaveBeenCalled()
  })

  it('renders a streaming audio element without reading bytes', () => {
    const request = vi.fn(async () => bytesResponse([1]))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/song.mp3')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/song.mp3" source="" revision={0} request={request} t={t} />)
    const audio = screen.getByLabelText('/p/song.mp3')
    expect(audio.tagName).toBe('AUDIO')
    expect(audio.getAttribute('src')).toBe('/api/desktop/projects/file?path=%2Fp%2Fsong.mp3&stream=1')
    expect(request).not.toHaveBeenCalled()
  })

  it('reports a built-in read failure', async () => {
    const request = vi.fn(async () => { throw new Error('offline') })
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/photo.png')
    render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/photo.png" source="" revision={0} request={request} t={t} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('previewFailed') })
  })

  it('ignores a read that fails after unmount', async () => {
    const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const registry = builtinRegistry()
    const descriptor = registry.describe('/p/photo.png')
    const view = render(<DocumentPreview descriptor={descriptor} renderers={registry} path="/p/photo.png" source="" revision={0} request={request as typeof fetch} t={t} />)
    view.unmount()
    await new Promise(resolve => { setTimeout(resolve, 0) })
  })
})

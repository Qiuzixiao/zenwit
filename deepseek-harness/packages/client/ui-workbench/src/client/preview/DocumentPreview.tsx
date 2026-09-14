/** Read bytes through the project Host and render built-in or plugin previews. */
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { imageMimeForPath } from '@deepseek-ai/dsh-util-media-type'
import type { CopyProps } from '../contract.ts'
import type { DocumentDescriptor, RendererId } from '../document-descriptor.ts'
import type { DocumentRenderers, PreviewViewProps, RendererModule } from '../document-renderers.ts'
import { BUILTIN_RENDERER_IDS } from '../builtin-renderers.ts'
import { packHtml } from './html/pack.ts'
import { createHtmlDocument } from './html/bootstrap.ts'
import css from './preview.module.css'

const PdfPreview = lazy(() => import('./PdfPreview.tsx').then(module => ({ default: module.PdfPreview })))

/**
 * Build the sandbox-asset URL for a document, optionally relative to it.
 * @param path - absolute project path of the document.
 * @param relative - optional reference relative to the document's directory.
 * @returns the same-origin Host URL.
 */
function assetUrl(path: string, relative?: string): string {
  const query = new URLSearchParams({ path, raw: '1', ...(relative === undefined ? {} : { relative }) })
  return '/api/desktop/projects/file?' + query.toString()
}

/** The built-in read-only families this component implements. */
function builtinFamily(renderer: RendererId | null): 'html' | 'svg' | 'image' | 'pdf' | 'video' | 'audio' | undefined {
  if (renderer === BUILTIN_RENDERER_IDS.html) return 'html'
  if (renderer === BUILTIN_RENDERER_IDS.svg) return 'svg'
  if (renderer === BUILTIN_RENDERER_IDS.image) return 'image'
  if (renderer === BUILTIN_RENDERER_IDS.pdf) return 'pdf'
  if (renderer === BUILTIN_RENDERER_IDS.video) return 'video'
  if (renderer === BUILTIN_RENDERER_IDS.audio) return 'audio'
  return undefined
}

/**
 * Render the preview selected by the descriptor: a built-in family drawn here,
 * or a plugin view loaded once through the registry.
 * @param props - the descriptor, registry, draft source and change revision.
 * @returns the preview, a loading status, or a notice when nothing can draw it.
 */
export function DocumentPreview({ descriptor, renderers, path, source, revision, request, t }: {
  descriptor: DocumentDescriptor; renderers: DocumentRenderers
  path: string; source: string; revision: number; request: typeof fetch
} & CopyProps) {
  const [state, setState] = useState<{ url?: string; data?: Uint8Array<ArrayBuffer>; failed?: boolean }>({})
  const [attempt, setAttempt] = useState(0)
  const [plugin, setPlugin] = useState<RendererModule | null>(null)
  const renderer = descriptor.renderer
  const family = builtinFamily(renderer)
  const streamed = family === 'video' || family === 'audio'

  useEffect(() => {
    if (family !== undefined || renderer === null) return
    let cancelled = false
    setPlugin(null)
    void renderers.load(renderer).then(
      module => { if (!cancelled) setPlugin(module) },
      () => { if (!cancelled) setPlugin(null) },
    )
    return () => { cancelled = true }
  }, [family, renderer, renderers])

  useEffect(() => {
    if (family === undefined || streamed) return
    const controller = new AbortController()
    let url: string | undefined
    setState({})
    const read = async (relative?: string) => {
      const response = await request(assetUrl(path, relative), { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`preview ${response.status}`)
      return { data: new Uint8Array(await response.arrayBuffer()) }
    }
    void (async () => {
      if (family === 'html') {
        const bundle = await packHtml(new TextEncoder().encode(source), async reference => {
          const suffix = reference.search(/[?#]/u)
          return read(decodeURIComponent(suffix === -1 ? reference : reference.slice(0, suffix)))
        }, controller.signal)
        controller.signal.throwIfAborted()
        url = URL.createObjectURL(new Blob([createHtmlDocument(bundle)], { type: 'text/html' }))
        setState({ url })
      } else {
        const data = family === 'svg' ? new TextEncoder().encode(source) : (await read()).data
        controller.signal.throwIfAborted()
        if (family === 'pdf') setState({ data })
        else {
          url = URL.createObjectURL(new Blob([data], { type: imageMimeForPath(path) }))
          setState({ url })
        }
      }
    })().catch(() => { if (!controller.signal.aborted) setState({ failed: true }) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [path, source, revision, request, family, attempt])

  if (streamed) {
    // The lazy content channel streams bytes with real MIME and Range support.
    const streamUrl = '/api/desktop/projects/file?' + new URLSearchParams({ path, stream: '1' }).toString()
    return <div className={css.preview} data-document-preview={family}>
      <div className={css.toolbar}><span>{t('preview')}</span></div>
      {family === 'video'
        ? <video className={css.media} controls src={streamUrl} aria-label={path} />
        : <audio className={css.media} controls src={streamUrl} aria-label={path} />}
    </div>
  }

  if (family === undefined) {
    if (renderer === null) {
      return <div className={css.preview} data-document-preview="unsupported"><p role="alert">{t('previewUnavailable')}</p></div>
    }
    const PluginView: ComponentType<PreviewViewProps> | null = plugin === null ? null : plugin.View
    return <div className={css.preview} data-document-preview="plugin">
      <div className={css.toolbar}><span>{t('preview')}</span></div>
      {PluginView === null ? <p role="status">{t('loading')}</p> :
        <PluginView path={path} mediaType={descriptor.mediaType} source={source} revision={revision} t={t} resolve={relative => assetUrl(path, relative)} />}
    </div>
  }

  return <div className={css.preview} data-document-preview={family}>
    <div className={css.toolbar}><span>{t('preview')}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>{t('refreshPreview')}</button></div>
    {state.failed ? <p role="alert">{t('previewFailed')}</p> : state.data ?
      <Suspense fallback={<p role="status">{t('loading')}</p>}><PdfPreview data={state.data} t={t} /></Suspense> : state.url ?
        family === 'html' ? <iframe src={state.url} sandbox="allow-scripts" title={t('htmlPreview')} /> :
          <div className={css.image}><img src={state.url} alt={path.split(/[\\/]/u).at(-1)} onError={() => setState({ failed: true })} /></div> :
        <p role="status">{t('loading')}</p>}
  </div>
}

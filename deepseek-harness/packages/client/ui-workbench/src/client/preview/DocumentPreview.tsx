/** Read bytes through the project Host; active content runs only in an opaque sandbox. */
import { lazy, Suspense, useEffect, useState } from 'react'
import type { CopyProps } from '../contract.ts'
import { documentKind, imageMime } from '../document-types.ts'
import { packHtml } from './html/pack.ts'
import { createHtmlDocument } from './html/bootstrap.ts'
import css from './preview.module.css'

const PdfPreview = lazy(() => import('./PdfPreview.tsx').then(module => ({ default: module.PdfPreview })))

/** @param props - document path, unsaved source and change revision. @returns the file's preview. */
export function DocumentPreview({ path, source, revision, request, t }: {
  path: string; source: string; revision: number; request: typeof fetch
} & CopyProps) {
  const [state, setState] = useState<{ url?: string; data?: Uint8Array<ArrayBuffer>; failed?: boolean }>({})
  const [attempt, setAttempt] = useState(0)
  const kind = documentKind(path)
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    setState({})
    const read = async (relative?: string) => {
      const query = new URLSearchParams({ path, raw: '1', ...(relative === undefined ? {} : { relative }) })
      const response = await request('/api/desktop/projects/file?' + query, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`preview ${response.status}`)
      return { data: new Uint8Array(await response.arrayBuffer()) }
    }
    void (async () => {
      if (kind === 'html') {
        const bundle = await packHtml(new TextEncoder().encode(source), async reference => {
          const suffix = reference.search(/[?#]/u)
          return read(decodeURIComponent(suffix === -1 ? reference : reference.slice(0, suffix)))
        }, controller.signal)
        controller.signal.throwIfAborted()
        url = URL.createObjectURL(new Blob([createHtmlDocument(bundle)], { type: 'text/html' }))
        setState({ url })
      } else {
        const data = kind === 'svg' ? new TextEncoder().encode(source) : (await read()).data
        controller.signal.throwIfAborted()
        if (kind === 'pdf') setState({ data })
        else {
          url = URL.createObjectURL(new Blob([data], { type: imageMime(path) }))
          setState({ url })
        }
      }
    })().catch(() => { if (!controller.signal.aborted) setState({ failed: true }) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [path, source, revision, request, kind, attempt])
  return <div className={css.preview} data-document-preview={kind}>
    <div className={css.toolbar}><span>{t('preview')}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>{t('refreshPreview')}</button></div>
    {state.failed ? <p role="alert">{t('previewFailed')}</p> : state.data ?
      <Suspense fallback={<p role="status">{t('loading')}</p>}><PdfPreview data={state.data} t={t} /></Suspense> : state.url ?
        kind === 'html' ? <iframe src={state.url} sandbox="allow-scripts" title={t('htmlPreview')} /> :
          <div className={css.image}><img src={state.url} alt={path.split(/[\\/]/u).at(-1)} onError={() => setState({ failed: true })} /></div> :
        <p role="status">{t('loading')}</p>}
  </div>
}

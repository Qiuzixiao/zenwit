/** PDF pages own canvas rendering; the mounted reader owns the worker lifetime. */
import { useEffect, useRef, useState } from 'react'
import type { CopyProps } from '../contract.ts'
import { openPdf } from './pdf/runtime.ts'
import { renderPdfPage, type PdfDocument } from './pdf/document.ts'
import css from './preview.module.css'

/** @param props - complete PDF bytes and workbench copy. @returns a scrolling PDF reader. */
export function PdfPreview({ data, t }: { data: Uint8Array<ArrayBuffer> } & CopyProps) {
  const [document, setDocument] = useState<PdfDocument>()
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setDocument(undefined)
    setError(false)
    const session = openPdf(data, controller.signal, () => setError(true))
    void session.document.then(value => { if (!controller.signal.aborted) setDocument(value) }, () => { if (!controller.signal.aborted) setError(true) })
    return () => { controller.abort(); void session.dispose() }
  }, [data])
  if (error) return <p role="alert">{t('previewFailed')}</p>
  if (!document) return <p role="status">{t('loading')}</p>
  return <div className={css.pdf} data-pdf-preview>{Array.from({ length: document.numPages }, (_, i) =>
    <PdfPage key={i} document={document} page={i + 1} t={t} />)}</div>
}

function PdfPage({ document, page, t }: { document: PdfDocument; page: number } & CopyProps) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(page === 1)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '100% 0px' })
    observer.observe(host.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    void renderPdfPage(document, page, canvas.current!, controller.signal, window.devicePixelRatio).then(
      () => { if (!controller.signal.aborted) setStatus('ready') },
      () => { if (!controller.signal.aborted) setStatus('failed') },
    )
    return () => controller.abort()
  }, [document, page, visible])
  return <div ref={host} className={css.pdfPage} data-pdf-page={page}>
    {status !== 'ready' && <p role={status === 'failed' ? 'alert' : 'status'}>{t(status === 'failed' ? 'previewFailed' : 'loading')}</p>}
    <canvas ref={canvas} hidden={status !== 'ready'} role="img" aria-label={t('pdfPage', { page })} />
  </div>
}

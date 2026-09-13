/** File presentation capabilities shared by tabs, previews and source editors. */
export type DocumentKind = 'markdown' | 'html' | 'svg' | 'image' | 'pdf' | 'text'

/** @param path - local filename. @returns the built-in document presentation. */
export function documentKind(path: string): DocumentKind {
  const extension = path.split('.').at(-1)?.toLowerCase()
  if (['md', 'markdown', 'mdown'].includes(extension ?? '')) return 'markdown'
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'svg') return 'svg'
  if (extension === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(extension ?? '')) return 'image'
  return 'text'
}

/** @param path - local filename. @returns whether only binary preview is available. */
export function isBinaryDocument(path: string): boolean {
  const kind = documentKind(path)
  return kind === 'image' || kind === 'pdf'
}

/** @param path - local filename. @returns whether preview and source can be switched. */
export function hasDocumentPreview(path: string): boolean {
  return ['markdown', 'html', 'svg'].includes(documentKind(path))
}

/** @param path - local filename. @returns image MIME type for a Blob preview. */
export function imageMime(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon' } as Record<string, string>)[extension] ?? `image/${extension}`
}

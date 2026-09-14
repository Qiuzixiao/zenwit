/**
 * Browser-safe and Node-safe media-type knowledge shared by the Workbench
 * preview registry and Host file services: one filename-extension table, one
 * unambiguous byte-signature detector, and an explicit probe that reports
 * agreement between the two sources.
 * @module @deepseek-ai/dsh-util-media-type
 */

/** Canonical MIME type declared by each known filename extension, keyed without its dot. */
export const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  // Documents
  pdf: 'application/pdf',
  // Web and structured text
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  json: 'application/json',
  jsonc: 'application/json',
  jsonl: 'application/x-ndjson',
  ndjson: 'application/x-ndjson',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdown: 'text/markdown',
  xml: 'application/xml',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  // Video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/opus',
})

/**
 * Resolve the media type a filename declares through its final extension.
 * @param path - a POSIX or Windows path, with or without directories.
 * @returns the declared MIME type, or `undefined` when the extension is absent, empty, or not in the table.
 */
export function extensionForPath(path: string): string | undefined {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return undefined
  return name.slice(dot + 1).toLowerCase()
}

/**
 * Resolve the media type a filename declares through its final extension.
 * @param path - a POSIX or Windows path, with or without directories.
 * @returns the declared MIME type, or `undefined` when the extension is absent, empty, or not in the table.
 */
export function mediaTypeForPath(path: string): string | undefined {
  const extension = extensionForPath(path)
  return extension === undefined ? undefined : MEDIA_TYPE_BY_EXTENSION[extension]
}

function matchesBytes(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (data.byteLength < offset + expected.length) return false
  return expected.every((byte, index) => data[offset + index] === byte)
}

function matchesAscii(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const
const WEBM_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3] as const

/**
 * Identify a media type from the leading bytes of a file. Only signatures with
 * one unambiguous type are recognized; short buffers simply match nothing.
 * @param data - the file's leading bytes, typically its first few kilobytes.
 * @returns the detected MIME type, or `undefined` for unrecognized bytes.
 */
export function sniffMediaType(data: Uint8Array): string | undefined {
  if (matchesBytes(data, 0, PNG_SIGNATURE)) return 'image/png'
  if (matchesBytes(data, 0, JPEG_SIGNATURE)) return 'image/jpeg'
  if (matchesAscii(data, 0, 'GIF87a') || matchesAscii(data, 0, 'GIF89a')) return 'image/gif'
  if (matchesAscii(data, 0, 'RIFF') && matchesAscii(data, 8, 'WEBP')) return 'image/webp'
  if (matchesAscii(data, 0, 'RIFF') && matchesAscii(data, 8, 'WAVE')) return 'audio/wav'
  if (matchesAscii(data, 0, '%PDF-')) return 'application/pdf'
  if (matchesBytes(data, 0, WEBM_SIGNATURE)) return 'video/webm'
  if (matchesAscii(data, 4, 'ftyp')) return 'video/mp4'
  return undefined
}

/**
 * Resolve the image MIME type for a path, guaranteeing a usable Blob type.
 * @param path - the file path.
 * @returns the declared media type, or `application/octet-stream` when the extension is unknown.
 */
export function imageMimeForPath(path: string): string {
  return mediaTypeForPath(path) ?? 'application/octet-stream'
}

const TEXT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'application/xml',
  'application/xhtml+xml',
  'application/json',
  'application/x-ndjson',
  'application/yaml',
  'application/toml',
])

/**
 * Whether a known media type is text that can be read and edited as UTF-8.
 * @param mediaType - a resolved MIME type.
 * @returns whether the type is textual. An unknown type is the caller's policy, not this package's.
 */
export function isTextMediaType(mediaType: string): boolean {
  if (mediaType.startsWith('text/')) return true
  if (TEXT_MEDIA_TYPES.has(mediaType)) return true
  return mediaType.endsWith('+json') || mediaType.endsWith('+xml')
}

/** What a filename and its leading bytes each claim about one file's media type. */
export interface MediaTypeProbe {
  /** Media type declared by the final extension, or `undefined` when absent or unknown. */
  readonly declared: string | undefined
  /** Media type detected from the leading bytes, or `undefined` when unrecognized or unsupplied. */
  readonly detected: string | undefined
  /** The authoritative type: detected bytes when available, otherwise the declared extension. */
  readonly mediaType: string | undefined
  /** Whether a known declared type and a known detected type disagree. */
  readonly mismatch: boolean
}

/**
 * Resolve a file's media type from its name and, when available, its leading bytes.
 * @param path - the file's POSIX or Windows path.
 * @param data - optional leading bytes; omit when only the extension is known.
 * @returns the declared, detected, and resolved types plus whether two known sources disagree.
 */
export function probeMediaType(path: string, data?: Uint8Array): MediaTypeProbe {
  const declared = mediaTypeForPath(path)
  const detected = data === undefined ? undefined : sniffMediaType(data)
  return {
    declared,
    detected,
    mediaType: detected ?? declared,
    mismatch: declared !== undefined && detected !== undefined && declared !== detected,
  }
}

/**
 * Text-encoding detection and re-encoding for the project text path. The Host
 * used to accept strict UTF-8 only, so a GBK CSV or a UTF-16 note returned 415;
 * this module lets the same file open as text and save back in its own encoding.
 * @module zenwit-workspace/encoding
 */
import iconv from 'iconv-lite'

/** One detected text encoding plus how firmly it was established. */
export interface EncodingDetection {
  /** A `TextDecoder` label, e.g. `utf-8`, `gb18030`, `windows-1252`. */
  readonly encoding: string
  /** `certain` for a BOM or strict UTF-8, `likely` for a UTF-16 NUL pattern, `fallback` for a legacy guess. */
  readonly confidence: 'certain' | 'likely' | 'fallback'
}

interface Bom {
  readonly bytes: readonly number[]
  readonly encoding: string
}

const BOMS: readonly Bom[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
]

/** Legacy single- or multi-byte encodings tried after UTF-8, most likely first. */
const LEGACY_CANDIDATES: readonly string[] = ['gb18030', 'big5', 'shift_jis']

/** Encodings a save request may name; anything else is treated as UTF-8. */
const SUPPORTED_ENCODINGS: ReadonlySet<string> = new Set([
  'utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'gbk', 'big5', 'shift_jis', 'windows-1252',
])

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

function decodesStrictly(encoding: string, bytes: Uint8Array): boolean {
  try {
    new TextDecoder(encoding, { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a NUL-byte distribution marks UTF-16 text without a BOM.
 * @param bytes - the complete file bytes.
 * @returns the UTF-16 label, or undefined when the pattern does not fit.
 */
function detectUtf16WithoutBom(bytes: Uint8Array): string | undefined {
  if (bytes.length < 4) return undefined
  const pairs = Math.floor(bytes.length / 2)
  let even = 0
  let odd = 0
  for (let index = 0; index < pairs * 2; index += 2) {
    if (bytes[index] === 0) even += 1
    if (bytes[index + 1] === 0) odd += 1
  }
  if (odd >= pairs * 0.6 && even <= pairs * 0.1) return 'utf-16le'
  if (even >= pairs * 0.6 && odd <= pairs * 0.1) return 'utf-16be'
  return undefined
}

/** Whether NUL density says the bytes are binary rather than text. */
function looksBinary(bytes: Uint8Array): boolean {
  let nul = 0
  for (const byte of bytes) if (byte === 0) nul += 1
  return nul > 0 && nul * 100 > bytes.length * 2
}

/**
 * Detect the text encoding of a file from its bytes.
 * @param bytes - the complete file bytes.
 * @returns the detected encoding, or `undefined` when the bytes look binary.
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection | undefined {
  if (bytes.length === 0) return { encoding: 'utf-8', confidence: 'certain' }
  for (const bom of BOMS) {
    if (startsWith(bytes, bom.bytes)) return { encoding: bom.encoding, confidence: 'certain' }
  }
  // UTF-16LE ASCII bytes are also valid UTF-8, so the NUL pattern must win first.
  const utf16 = detectUtf16WithoutBom(bytes)
  if (utf16 !== undefined) return { encoding: utf16, confidence: 'likely' }
  if (looksBinary(bytes)) return undefined
  if (decodesStrictly('utf-8', bytes)) return { encoding: 'utf-8', confidence: 'certain' }
  for (const candidate of LEGACY_CANDIDATES) {
    if (decodesStrictly(candidate, bytes)) return { encoding: candidate, confidence: 'fallback' }
  }
  return { encoding: 'windows-1252', confidence: 'fallback' }
}

/**
 * Whether a save request names an encoding this Host can encode.
 * @param value - the raw request field.
 * @returns whether the value is a supported label.
 */
export function isSupportedEncoding(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_ENCODINGS.has(value)
}

/**
 * Encode decoded text back to the file's encoding.
 * @param content - the decoded text.
 * @param encoding - a supported encoding label.
 * @returns the bytes to write.
 */
export function encodeText(content: string, encoding: string): Buffer {
  if (encoding === 'utf-8') return Buffer.from(content, 'utf8')
  if (encoding === 'utf-16le') return Buffer.from(content, 'utf16le')
  return iconv.encode(content, encoding)
}

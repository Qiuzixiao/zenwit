import { describe, expect, it } from 'vitest'
import {
  extensionForPath, imageMimeForPath, isTextMediaType, mediaTypeForPath, MEDIA_TYPE_BY_EXTENSION, probeMediaType, sniffMediaType,
} from '@deepseek-ai/dsh-util-media-type'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const ascii = (text: string): Uint8Array => Uint8Array.from(text, character => character.charCodeAt(0))

describe('media-type extension table', () => {
  it('resolves known extensions case-insensitively, ignoring the directory', () => {
    expect(mediaTypeForPath('/p/a/photo.PNG')).toBe('image/png')
    expect(mediaTypeForPath('C:\\p\\clip.MP4')).toBe('video/mp4')
    expect(mediaTypeForPath('notes.md')).toBe('text/markdown')
    expect(mediaTypeForPath('.eslintrc.json')).toBe('application/json')
    expect(mediaTypeForPath('archive.tar.gz')).toBeUndefined()
  })

  it('returns undefined when there is no usable extension', () => {
    expect(mediaTypeForPath('README')).toBeUndefined()
    expect(mediaTypeForPath('/p/.gitignore')).toBeUndefined()
    expect(mediaTypeForPath('trailing.')).toBeUndefined()
    expect(mediaTypeForPath('')).toBeUndefined()
  })

  it('exposes the final extension independently of the type table', () => {
    expect(extensionForPath('archive.tar.GZ')).toBe('gz')
    expect(extensionForPath('C:\\p\\notes.MD')).toBe('md')
    expect(extensionForPath('README')).toBeUndefined()
    expect(extensionForPath('.gitignore')).toBeUndefined()
    expect(extensionForPath('trailing.')).toBeUndefined()
  })

  it('guarantees a usable blob media type for image paths', () => {
    expect(imageMimeForPath('photo.PNG')).toBe('image/png')
    expect(imageMimeForPath('unknown.bin')).toBe('application/octet-stream')
  })

  it('exposes a frozen table', () => {
    expect(Object.isFrozen(MEDIA_TYPE_BY_EXTENSION)).toBe(true)
  })
})

describe('media-type byte signatures', () => {
  it('recognizes the strong signatures', () => {
    expect(sniffMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffMediaType(ascii('GIF87a......'))).toBe('image/gif')
    expect(sniffMediaType(ascii('GIF89a......'))).toBe('image/gif')
    expect(sniffMediaType(ascii('RIFF????WEBPVP8 '))).toBe('image/webp')
    expect(sniffMediaType(ascii('RIFF????WAVEfmt '))).toBe('audio/wav')
    expect(sniffMediaType(ascii('%PDF-1.7'))).toBe('application/pdf')
    expect(sniffMediaType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video/webm')
    expect(sniffMediaType(ascii('....ftypisom'))).toBe('video/mp4')
  })

  it('returns undefined for unknown, short, or near-miss data', () => {
    expect(sniffMediaType(ascii('hello'))).toBeUndefined()
    expect(sniffMediaType(ascii('GIF'))).toBeUndefined()
    expect(sniffMediaType(bytes(0x89, 0x50))).toBeUndefined()
    expect(sniffMediaType(ascii('GIF88a'))).toBeUndefined()
    expect(sniffMediaType(ascii('RIFX....WEBP'))).toBeUndefined()
    expect(sniffMediaType(ascii('RIFF'))).toBeUndefined()
    expect(sniffMediaType(new Uint8Array(0))).toBeUndefined()
  })
})

describe('media-type probe', () => {
  it('uses the declared type when only the name is known', () => {
    expect(probeMediaType('a.png')).toEqual({ declared: 'image/png', detected: undefined, mediaType: 'image/png', mismatch: false })
    expect(probeMediaType('a.unknown')).toEqual({ declared: undefined, detected: undefined, mediaType: undefined, mismatch: false })
  })

  it('prefers detected bytes and reports disagreement', () => {
    expect(probeMediaType('a.png', bytes(0xff, 0xd8, 0xff))).toEqual({ declared: 'image/png', detected: 'image/jpeg', mediaType: 'image/jpeg', mismatch: true })
    expect(probeMediaType('a.png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ declared: 'image/png', detected: 'image/png', mediaType: 'image/png', mismatch: false })
  })

  it('detects an unrecognized-name file from its bytes', () => {
    expect(probeMediaType('noextension', bytes(0xff, 0xd8, 0xff)).mediaType).toBe('image/jpeg')
  })
})

describe('media-type text classification', () => {
  it('classifies text, structured text, and binary types', () => {
    expect(isTextMediaType('text/plain')).toBe(true)
    expect(isTextMediaType('text/markdown')).toBe(true)
    expect(isTextMediaType('image/svg+xml')).toBe(true)
    expect(isTextMediaType('application/xml')).toBe(true)
    expect(isTextMediaType('application/json')).toBe(true)
    expect(isTextMediaType('application/x-ndjson')).toBe(true)
    expect(isTextMediaType('application/vnd.api+json')).toBe(true)
    expect(isTextMediaType('application/atom+xml')).toBe(true)
    expect(isTextMediaType('image/png')).toBe(false)
    expect(isTextMediaType('video/mp4')).toBe(false)
    expect(isTextMediaType('application/octet-stream')).toBe(false)
  })
})

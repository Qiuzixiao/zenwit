// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MINDMAP_LIMITS, parseMindmap } from '../src/client/mindmap.ts'

const map = (inner: string): string => `<map version="1.0.1">${inner}</map>`

describe('mindmap parser', () => {
  it('parses nodes, whitelisted attributes and flattened richcontent', () => {
    const result = parseMindmap(map('<node TEXT="Root" FOLDED="true" POSITION="right" STYLE="cloud" onclick="evil()"><node TEXT="Child"/><node TEXT="Rich"><richcontent TYPE="NODE"><html><body><p>Hello <b>world</b></p></body></html></richcontent></node></node>'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root.text).toBe('Root')
    expect(result.root.folded).toBe(true)
    expect(result.root.position).toBe('right')
    expect(result.root.style).toBe('cloud')
    expect(result.root.children[0]?.text).toBe('Child')
    expect(result.root.children[1]?.text).toBe('Hello world')
  })

  it('falls back to TEXT when richcontent is blank', () => {
    const result = parseMindmap(map('<node TEXT="Plain"><richcontent TYPE="NODE">   </richcontent></node>'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root.text).toBe('Plain')
    expect(result.root.folded).toBe(false)
    const blank = parseMindmap(map('<node><node/></node>'))
    expect(blank.ok).toBe(true)
    if (!blank.ok) return
    expect(blank.root.text).toBe('')
    expect(blank.root.children[0]?.text).toBe('')
  })

  it('refuses an empty, doctype, malformed or wrong-shape document', () => {
    expect(parseMindmap('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(parseMindmap('<!DOCTYPE map [<!ENTITY x "y">]>' + map('<node TEXT="a"/>'))).toEqual({ ok: false, reason: 'doctype' })
    expect(parseMindmap('<map><node TEXT="a">')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseMindmap('<notmap><node TEXT="a"/></notmap>')).toEqual({ ok: false, reason: 'shape' })
    expect(parseMindmap('<map/>')).toEqual({ ok: false, reason: 'shape' })
  })

  it('bounds size, node count and depth', () => {
    expect(parseMindmap('<map><node TEXT="a"/></map>', { maxNodes: 5000, maxDepth: 64, maxCharacters: 5 })).toEqual({ ok: false, reason: 'too-large' })
    expect(parseMindmap(map('<node TEXT="a"><node TEXT="b"/></node>'), { maxNodes: 1, maxDepth: 64, maxCharacters: 1000 })).toEqual({ ok: false, reason: 'nodes' })
    expect(parseMindmap(map('<node TEXT="a"><node TEXT="b"><node TEXT="c"/></node></node>'), { maxNodes: 10, maxDepth: 1, maxCharacters: 1000 })).toEqual({ ok: false, reason: 'depth' })
    expect(MINDMAP_LIMITS.maxNodes).toBe(5000)
  })
})

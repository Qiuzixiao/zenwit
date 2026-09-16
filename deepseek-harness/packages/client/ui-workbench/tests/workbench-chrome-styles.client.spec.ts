// @vitest-environment node
/**
 * Static guards for the product shell's chrome stylesheet.
 *
 * The settings seat (`sidebar.settings`) renders INSIDE the workspace chrome
 * bars, and the settings panel it opens is a DOM descendant of them. Any
 * chrome rule written as a DESCENDANT selector therefore reaches into the
 * kernel's settings UI, and both failure modes have shipped:
 *
 *  1. `.workbenchTools button` (0,1,1) outranked every single-class control
 *     style (0,1,0): primary buttons lost their fill and border, nav rows their
 *     40px metric, the appearance cubes their column layout.
 *  2. `:where(.workbenchTools) button` fixed the ranking but still SET
 *     properties the kernel's own rules never declare — `white-space: nowrap`
 *     and `align-items: center` leaked onto every settings button and flattened
 *     the Agent-preset cards into one centered, unwrapped, overflowing line.
 *
 * A child combinator cannot match the panel at all, which is the invariant
 * these tests enforce (with `:where()` kept so a future class rule still wins).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../src/client/', import.meta.url)
const css = readFileSync(new URL('workbench.module.css', root), 'utf8')
const frame = readFileSync(new URL('WorkbenchFrame.tsx', root), 'utf8')
const topBar = readFileSync(new URL('WorkbenchTopBar.tsx', root), 'utf8')

/** Containers that sit above the settings seat in the rendered DOM. */
const SEAT_ANCESTORS = ['.workbenchTools', '.globalActions', '.globalSeat', '.navSettings', '.navTools', '.homeNav']

/** A bare element type reached as a DESCENDANT (not `>`, not attribute-qualified). */
const DESCENDANT_ELEMENT = /[\s+~](button|input|select|textarea|label)(?![\w-])(?![\[.:#])/u

/** Every rule selector in the sheet, comments stripped, `@media` bodies included. */
function selectors(text: string): string[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//gu, ' ')
  const found: string[] = []
  let index = 0
  while (index < clean.length) {
    const open = clean.indexOf('{', index)
    if (open === -1) break
    const selector = clean.slice(index, open)
    let depth = 1
    let cursor = open + 1
    while (cursor < clean.length && depth > 0) {
      if (clean[cursor] === '{') depth += 1
      else if (clean[cursor] === '}') depth -= 1
      cursor += 1
    }
    if (selector.trimStart().startsWith('@')) found.push(...selectors(clean.slice(open + 1, cursor - 1)))
    else found.push(...selector.split(',').map(part => part.trim()).filter(part => part.length > 0))
    index = cursor
  }
  return found
}

/** Whether one selector reaches a bare element only as a direct child of `container`. */
function childScoped(selector: string, container: string): boolean {
  // Tolerates the :where( … ) wrapper around the container.
  return new RegExp(container.replace(/\./gu, '\\.') + '\\)?\\s*>', 'u').test(selector)
}

describe('workbench chrome stylesheet', () => {
  it('mounts the settings seat inside the chrome bars this guard covers', () => {
    // If the seat moves out of the chrome, shrink SEAT_ANCESTORS — the guard
    // must not silently stop covering it.
    expect(frame).toContain('css.workbenchTools')
    expect(frame).toContain("renderSlot('sidebar.settings'")
    expect(topBar).toContain("renderSlot('sidebar.settings'")
  })

  it('never reaches into the settings panel from a chrome container', () => {
    const offenders = selectors(css).filter((selector) => {
      const container = SEAT_ANCESTORS.find(name => selector.includes(name))
      if (container === undefined) return false
      if (!DESCENDANT_ELEMENT.test(selector)) return false
      return !childScoped(selector, container)
    })
    expect(offenders).toEqual([])
  })

  it('keeps the chrome control rules child-scoped and :where()-wrapped', () => {
    // Positive assertions: the guard above must not pass by deleting the rules
    // that style the chrome's own bare buttons.
    expect(css).toContain(':where(.workbenchTools) > button {')
    expect(css).toContain(':where(.workbenchTools) > button[aria-pressed="true"] {')
    expect(css).toContain(':where(.globalActions) > button {')
  })
})

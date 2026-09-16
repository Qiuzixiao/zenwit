// @vitest-environment node
/**
 * Static guards for the workbench's own stylesheet.
 *
 * These two rules are invisible to every DOM assertion but decide whether the
 * middle column works at all: a `pointer-events: none` left over from the old
 * click-transparent overlay makes the whole column inert (no tab clicks, no
 * scrolling), and a host element that does not fill the region leaves the inner
 * scrollers without a definite height. Both shipped once; these tests read the
 * stylesheet directly so the next edit cannot reintroduce them.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/workbench/workbench.module.css', import.meta.url), 'utf8')

/** The declarations of one selector block, or '' when the selector is absent. */
function blockOf(source: string, selector: RegExp): string {
  return selector.exec(source)?.[1] ?? ''
}

describe('workbench surface stylesheet', () => {
  it('does not make the workbench surface click-transparent', () => {
    const host = blockOf(css, /\[data-zenwit-workbench\]\)?\s*\{([^}]*)\}/u)
    const surface = blockOf(css, /\.surface\s*\{([^}]*)\}/u)
    // A missing block must fail loudly, not pass vacuously.
    expect(host).toContain('inset: 0')
    expect(host).not.toContain('pointer-events')
    expect(surface).not.toContain('pointer-events: none')
  })

  it('fills the region the shell hands over', () => {
    const host = blockOf(css, /\[data-zenwit-workbench\]\)?\s*\{([^}]*)\}/u)
    expect(host).toContain('position: absolute')
    expect(host).toContain('inset: 0')
  })
})

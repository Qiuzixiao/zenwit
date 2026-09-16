// @vitest-environment node
/**
 * Style-class coverage guard.
 *
 * CSS Modules are typed as a loose record, so a class the stylesheet no longer
 * defines still compiles and renders unstyled. That is how a stylesheet edit
 * once removed the markdown outline's rules without any test noticing. This
 * guard reads every CSS module in the package and every `<binding>.<name>`
 * usage in the sources that import it, and fails on a name the stylesheet does
 * not define.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const sourceRoot = join(packageRoot, 'src/client')

/** Every source file under one directory tree. */
function sources(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...sources(path))
    else if (/\.tsx?$/u.test(entry)) found.push(path)
  }
  return found
}

/** The class names a stylesheet defines. */
function classNames(text: string): Set<string> {
  return new Set([...text.matchAll(/\.([A-Za-z_][\w-]*)/gu)].map(match => match[1] as string))
}

describe('CSS module coverage', () => {
  it('defines every class the sources reference', () => {
    const missing: string[] = []
    for (const file of sources(sourceRoot)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/import\s+(\w+)\s+from\s+'([^']*\.module\.css)'/gu)) {
        const binding = match[1] as string
        const stylesheet = resolve(dirname(file), match[2] as string)
        const defined = classNames(readFileSync(stylesheet, 'utf8'))
        for (const usage of text.matchAll(new RegExp('\\b' + binding + '\\.([A-Za-z_][\\w-]*)', 'gu'))) {
          const name = usage[1] as string
          if (!defined.has(name)) missing.push(`${file.slice(packageRoot.length + 1)}: ${binding}.${name}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('leaves no class in the workbench settings sheet unreferenced', () => {
    // Scoped to this one sheet on purpose: a repo-wide reverse check would flag
    // classes other packages reach through bracket access or :global(). The
    // settings page carried twenty dead classes (an "add plugin" catalog card
    // set and a custom-CSS textarea) that survived several rewrites.
    const sheet = join(sourceRoot, 'workbench/WorkbenchSettingsSection.module.css')
    const defined = classNames(readFileSync(sheet, 'utf8'))
    const text = [...sources(sourceRoot), ...sources(join(packageRoot, 'tests'))]
      .map(file => readFileSync(file, 'utf8'))
      .join('\n')
    const unreferenced = [...defined].filter(name => !new RegExp('\\b' + name + '\\b', 'u').test(text))
    expect(unreferenced).toEqual([])
  })
})

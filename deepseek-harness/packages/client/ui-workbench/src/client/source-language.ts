/** CodeMirror language selection, including the original DSH file suffix aliases. */
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

const aliases: Record<string, string> = {
  mts: 'TypeScript', cts: 'TypeScript', mjs: 'JavaScript', cjs: 'JavaScript',
  jsonc: 'JSON', jsonl: 'JSON', ndjson: 'JSON', pyw: 'Python', pyi: 'Python',
  rake: 'Ruby', gemspec: 'Ruby', bash: 'Shell', zsh: 'Shell',
  hh: 'C++', hxx: 'C++', kts: 'Kotlin', xsd: 'XML', xsl: 'XML', xslt: 'XML',
  svg: 'XML', xhtml: 'HTML', mdx: 'Markdown',
}

/**
 * Select the lazy CodeMirror grammar for a file path.
 * @param path - file path, including its extension.
 * @returns a lazy grammar, or `undefined` when no language matches.
 */
export function sourceLanguage(path: string): LanguageDescription | undefined {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const alias = aliases[dot === -1 ? '' : name.slice(dot + 1).toLowerCase()]
  return (alias === undefined ? undefined : LanguageDescription.matchLanguageName(languages, alias, false))
    ?? LanguageDescription.matchFilename(languages, name) ?? undefined
}

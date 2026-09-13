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

/** @param path - file path, including its extension. @returns a lazy grammar, if known. */
export function sourceLanguage(path: string): LanguageDescription | undefined {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? path
  const alias = aliases[name.split('.').at(-1)?.toLowerCase() ?? '']
  return (alias ? LanguageDescription.matchLanguageName(languages, alias, false) : undefined)
    ?? LanguageDescription.matchFilename(languages, name) ?? undefined
}

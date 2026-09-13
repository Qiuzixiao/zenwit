import { describe, expect, it } from 'vitest'
import { documentKind, isBinaryDocument, hasDocumentPreview } from '../src/client/document-types.ts'
import { sourceLanguage } from '../src/client/source-language.ts'

describe('document capabilities', () => {
  it('recognizes Markdown aliases, editable previews and binary-only readers', () => {
    for (const path of ['notes.md', 'notes.markdown', 'notes.MDOWN']) expect(documentKind(path)).toBe('markdown')
    for (const path of ['index.html', 'index.htm', 'logo.svg']) {
      expect(hasDocumentPreview(path)).toBe(true)
      expect(isBinaryDocument(path)).toBe(false)
    }
    for (const path of ['image.PNG', 'scan.pdf', 'animation.gif']) expect(isBinaryDocument(path)).toBe(true)
  })
  it('loads grammars for the original code and configuration suffixes', async () => {
    for (const extension of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'sh', 'bash', 'zsh', 'json', 'jsonc', 'jsonl', 'ndjson', 'py', 'pyw', 'pyi', 'rb', 'rake', 'gemspec', 'go', 'rs', 'java', 'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'cs', 'kt', 'kts', 'swift', 'php', 'yaml', 'yml', 'toml', 'ini', 'md', 'markdown', 'mdx', 'html', 'htm', 'xhtml', 'css', 'scss', 'less', 'sql', 'xml', 'xsd', 'xsl', 'xslt', 'lua', 'svg']) {
      const grammar = sourceLanguage('file.' + extension)
      expect(grammar, extension).toBeDefined()
      expect(await grammar!.load(), extension).toBeTruthy()
    }
    expect(sourceLanguage('file.unknown')).toBeUndefined()
  })
})

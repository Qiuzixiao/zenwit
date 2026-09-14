import { describe, expect, it } from 'vitest'
import { sourceLanguage } from '../src/client/source-language.ts'

describe('source language selection', () => {
  it('loads grammars for the original code and configuration suffixes', async () => {
    for (const extension of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'sh', 'bash', 'zsh', 'json', 'jsonc', 'jsonl', 'ndjson', 'py', 'pyw', 'pyi', 'rb', 'rake', 'gemspec', 'go', 'rs', 'java', 'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'cs', 'kt', 'kts', 'swift', 'php', 'yaml', 'yml', 'toml', 'ini', 'md', 'markdown', 'mdx', 'html', 'htm', 'xhtml', 'css', 'scss', 'less', 'sql', 'xml', 'xsd', 'xsl', 'xslt', 'lua', 'svg']) {
      const grammar = sourceLanguage('file.' + extension)
      expect(grammar, extension).toBeDefined()
      expect(await grammar!.load(), extension).toBeTruthy()
    }
    expect(sourceLanguage('file.unknown')).toBeUndefined()
    expect(sourceLanguage('file')).toBeUndefined()
    expect(sourceLanguage('C:\\dir\\notes.ts')).toBeDefined()
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectApi } from '../src/client/project-api.ts'
import { resolveFilePath, readPersistedTabs, DOCUMENT_TABS_STORAGE_PREFIX, filterTree } from '../src/client/workspace-files.ts'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('workbench local files', () => {
  it('resolves local links on POSIX and Windows without admitting another project', () => {
    expect(resolveFilePath('notes.md', '/projects/demo')).toBe('/projects/demo/notes.md')
    expect(resolveFilePath('file:///projects/demo/a%20b.md', '/projects/demo')).toBe('/projects/demo/a b.md')
    expect(resolveFilePath('file:///C:/work/demo/a.md', 'C:\\work\\demo')).toBe('C:/work/demo/a.md')
    for (const path of ['../secret', '/projects/demo-other/file', 'https://example.com/a', 'file://server/share/file']) {
      expect(() => resolveFilePath(path, '/projects/demo')).toThrow()
    }
  })
  it('restores only document tabs belonging to the project', () => {
    localStorage.setItem(DOCUMENT_TABS_STORAGE_PREFIX + '/project', JSON.stringify({
      activePath: '/outside/secret', documents: [
        { path: '/outside/secret', name: 'secret', visualMode: false },
        { path: '/project/notes.md', name: 'notes.md', visualMode: true },
      ],
    }))
    expect(readPersistedTabs('/project')).toEqual({ activePath: '/project/notes.md', documents: [{ path: '/project/notes.md', name: 'notes.md', visualMode: true }] })
  })
  it('keeps matching descendants with their parent folders in file search', () => {
    const leaf = { name: 'notes.md', path: '/project/docs/notes.md', kind: 'file' as const, detail: '' }
    expect(filterTree([{ name: 'docs', path: '/project/docs', kind: 'dir', detail: '', children: [leaf] }], 'notes')).toEqual([
      { name: 'docs', path: '/project/docs', kind: 'dir', detail: '', children: [leaf] },
    ])
  })
  it('surfaces API errors instead of showing a fake empty project library', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Project root unavailable' }), { status: 503 })))
    await expect(projectApi.list()).rejects.toThrow('Project root unavailable')
  })
})

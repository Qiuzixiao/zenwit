// @vitest-environment jsdom
import { useEffect, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../src/client/Workspace.tsx'
import type { WorkspaceProps } from '../src/client/Workspace.tsx'
import { en } from '../src/client/locales.ts'
import { createDocumentRenderers } from '../src/client/document-renderers.ts'
import { registerBuiltinRenderers } from '../src/client/builtin-renderers.ts'
import { filterTree, flattenFiles } from '../src/client/workspace-files.ts'

// Exercise document persistence independently of editor-library browser geometry.
vi.mock('../src/client/Editor.tsx', () => {
  const Editor = ({ initialDoc, onChange }: { initialDoc: string; onChange(text: string): void }) =>
    <textarea aria-label="Test editor" defaultValue={initialDoc} onChange={event => onChange(event.target.value)} />
  return { Editor, VisualEditor: Editor }
})
vi.mock('../src/client/preview/DocumentPreview.tsx', () => ({
  DocumentPreview: ({ path, source }: { path: string; source: string }) => <div data-testid="preview" data-path={path}>{source}</div>,
}))
// Call-count wrapper: the real traversal, observable per render.
vi.mock('../src/client/workspace-files.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/client/workspace-files.ts')>()
  return { ...actual, flattenFiles: vi.fn(actual.flattenFiles), filterTree: vi.fn(actual.filterTree) }
})
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mount(request: typeof fetch, fileRequest: WorkspaceProps['fileRequest'] = { path: '/project/notes.md', line: undefined, sequence: 1 }, providedRenderers?: ReturnType<typeof createDocumentRenderers>) {
  const documentRenderers = providedRenderers ?? createDocumentRenderers()
  if (providedRenderers === undefined) registerBuiltinRenderers(documentRenderers)
  const props = {
    projectPath: '/project', request, documentRenderers, fileRevision: 0, fileRequest,
    useSessions: (select: (state: unknown) => unknown) => select({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
    useWorkspaces: (select: (state: unknown) => unknown) => select({ items: [], archivedSessionIds: [], phase: 'ready' }),
    useNavigation: (select: (state: number) => unknown) => select(0),
    useDocumentRendererRevision: (select: (state: number) => unknown) => {
      const [, setRevision] = useState(0)
      useEffect(() => documentRenderers.subscribe(() => setRevision(value => value + 1)), [documentRenderers])
      return select(documentRenderers.revision)
    },
    guardNavigation: () => () => {},
    usePanelInfo: (select: (state: unknown) => unknown) => select({ activePanelId: null }),
    renderSlot: (name: string) => <div data-slot={name} />,
    t: (key: keyof typeof en, params?: Record<string, unknown>) => en[key].replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? '')),
    closeProject: vi.fn(), openSession: vi.fn(), startSession: vi.fn(), addSelectionToConversation: vi.fn(),
  } as unknown as WorkspaceProps
  return render(<Workspace {...props} />)
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const structure = { path: '/project', root: '/project', tree: [{ path: '/project/notes.md', name: 'notes.md', kind: 'file', detail: '' }] }

describe('workbench document lifecycle', () => {
  it('opens a newly created file immediately in the editor', async () => {
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('/structure?')) return reply(structure)
      if (String(input).endsWith('/node') && init?.method === 'POST') return reply({ path: '/project/new.md' })
      return reply({ content: '' })
    })
    mount(request, null)
    await screen.findByRole('button', { name: 'New file' })
    fireEvent.click(screen.getByRole('button', { name: 'New file' }))
    fireEvent.change(screen.getByPlaceholderText('Example: notes.md'), { target: { value: 'new.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByLabelText('Test editor')
    expect(request.mock.calls.some(([input]) => String(input).includes('/file?path=%2Fproject%2Fnew.md'))).toBe(true)
  })
  it('restores a persisted draft without autosaving it over a conflict', async () => {
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes('/structure?')) return reply(structure)
      if (init?.method === 'POST') return reply({ ok: true })
      return url.includes('sync=1') ? reply({ content: 'disk' }) : reply({ content: 'disk', recovery: { content: 'recovered edits', baseline: 'disk' } })
    })
    mount(request)
    expect((await screen.findByLabelText('Test editor') as HTMLTextAreaElement).value).toBe('recovered edits')
    expect(await screen.findByText('The file changed on disk. Local edits are retained and autosave is paused.')).toBeTruthy()
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(request.mock.calls.some(([input]) => String(input) === '/api/desktop/projects/file?path=%2Fproject%2Fnotes.md')).toBe(true)
  })
  it('keeps edits typed during a save dirty and bases the next save on the committed text', async () => {
    let disk = 'baseline'
    let commit: (() => void) | undefined
    const saves: Array<{ content: string; expectedContent: string }> = []
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('/structure?')) return reply(structure)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        if (body.action) return reply({ ok: true })
        saves.push(body)
        if (saves.length === 1) await new Promise<void>(resolve => { commit = () => { disk = body.content; resolve() } })
        else disk = body.content
        return reply({ ok: true })
      }
      return reply({ content: disk })
    })
    mount(request)
    const editor = await screen.findByLabelText('Test editor')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Autosave' }))
    fireEvent.change(editor, { target: { value: 'first edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save *' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    fireEvent.change(editor, { target: { value: 'second edit' } })
    commit?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save *' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Save *' }))
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(saves.map(({ content, expectedContent }) => ({ content, expectedContent }))).toEqual([
      { content: 'first edit', expectedContent: 'baseline' },
      { content: 'second edit', expectedContent: 'first edit' },
    ])
  })
  it('echoes the detected file encoding back on save', async () => {
    const encodings: unknown[] = []
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('/structure?')) return reply(structure)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action?: string; encoding?: unknown }
        if (body.action) return reply({ ok: true })
        encodings.push(body.encoding)
        return reply({ ok: true })
      }
      return reply({ content: '你好', encoding: 'gb18030' })
    })
    mount(request)
    const editor = await screen.findByLabelText('Test editor')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Autosave' }))
    fireEvent.change(editor, { target: { value: '改' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save *' }))
    await waitFor(() => { expect(encodings).toEqual(['gb18030']) })
  })
  it('shows external save conflicts and preserves the current local buffer', async () => {
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('/structure?')) return reply(structure)
      if (init?.method === 'POST') return reply({ content: 'external version' }, 409)
      return reply({ content: 'baseline' })
    })
    mount(request)
    const editor = await screen.findByLabelText('Test editor') as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('checkbox', { name: 'Autosave' }))
    fireEvent.change(editor, { target: { value: 'local edits' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save *' }))
    expect(await screen.findByText('The file changed on disk. Local edits are retained and autosave is paused.')).toBeTruthy()
    expect(editor.value).toBe('local edits')
  })
})


it('opens binary documents without text reads or save controls', async () => {
  const request = vi.fn<typeof fetch>(async () => reply(structure))
  mount(request, { path: '/project/image.png', line: undefined, sequence: 1 })
  expect((await screen.findByTestId('preview')).getAttribute('data-path')).toBe('/project/image.png')
  expect(screen.queryByRole('checkbox', { name: 'Autosave' })).toBeNull()
  expect(screen.queryByLabelText('Test editor')).toBeNull()
  expect(request.mock.calls.some(([input]) => String(input).includes('/file?'))).toBe(false)
})

it('previews unsaved HTML source without submitting a save', async () => {
  const request = vi.fn<typeof fetch>(async input => String(input).includes('/structure?') ? reply(structure) : reply({ content: '<h1>Original</h1>' }))
  mount(request, { path: '/project/index.html', line: undefined, sequence: 1 })
  await screen.findByTestId('preview')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Autosave' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit source' }))
  fireEvent.change(await screen.findByLabelText('Test editor'), { target: { value: '<h1>Unsaved</h1>' } })
  fireEvent.click(screen.getByRole('button', { name: 'Switch to preview' }))
  expect((await screen.findByTestId('preview')).textContent).toBe('<h1>Unsaved</h1>')
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST' && !JSON.parse(String(init.body)).action)).toBe(false)
})

it('restores binary tabs without reading them through the text endpoint', async () => {
  const { DOCUMENT_TABS_STORAGE_PREFIX } = await import('../src/client/workspace-files.ts')
  localStorage.setItem(DOCUMENT_TABS_STORAGE_PREFIX + '/project', JSON.stringify({ activePath: '/project/scan.pdf', documents: [{ path: '/project/scan.pdf', name: 'scan.pdf', visualMode: true }] }))
  const request = vi.fn<typeof fetch>(async () => reply(structure))
  mount(request, null)
  expect((await screen.findByTestId('preview')).getAttribute('data-path')).toBe('/project/scan.pdf')
  expect(request.mock.calls.some(([input]) => String(input).includes('/file?'))).toBe(false)
})

it('shows a retry notice and keeps source available when a plugin renderer failed', async () => {
  const registry = createDocumentRenderers()
  registerBuiltinRenderers(registry)
  const loader = vi.fn(() => Promise.reject(new Error('boom')))
  registry.register({ id: 'example/mm', contract: 1, match: { extensions: ['.mm'] }, views: ['preview'], load: loader })
  await expect(registry.load('example/mm')).rejects.toThrow('boom')
  const request = vi.fn<typeof fetch>(async input => String(input).includes('/structure?') ? reply(structure) : reply({ content: '<map/>' }))
  mount(request, { path: '/project/plan.mm', line: undefined, sequence: 1 }, registry)
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.previewFailed) })
  expect(await screen.findByLabelText('Test editor')).toBeTruthy()
  expect(loader).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: en.switchPreview }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  expect(screen.getByRole('button', { name: en.switchPreview }).hasAttribute('disabled')).toBe(false)
  expect(screen.getByLabelText('Test editor')).toBeTruthy()
})

it('offers download and reveal when a binary document has no renderer', async () => {
  const registry = createDocumentRenderers()
  const request = vi.fn<typeof fetch>(async input => {
    if (String(input).includes('/structure?')) return reply(structure)
    return reply({ ok: true })
  })
  mount(request, { path: '/project/clip.mp4', line: undefined, sequence: 1 }, registry)
  const download = await screen.findByRole('link', { name: en.download })
  expect(download.getAttribute('href')).toBe('/api/desktop/projects/file?path=%2Fproject%2Fclip.mp4&raw=1')
  expect(download.getAttribute('download')).toBe('clip.mp4')
  fireEvent.click(screen.getByRole('button', { name: en.revealInSystem }))
  await waitFor(() => { expect(request.mock.calls.some(([input]) => String(input).includes('/reveal'))).toBe(true) })
})

it('says so when the host truncated the file tree', async () => {
  const request = vi.fn<typeof fetch>(async input =>
    String(input).includes('/structure?') ? reply({ ...structure, truncated: true }) : reply({ content: '' }))
  mount(request)
  await screen.findByText(en.structureTruncated)
})

it('walks the file tree once per tree, not once per render', async () => {
  const request = vi.fn<typeof fetch>(async input =>
    String(input).includes('/structure?') ? reply(structure) : reply({ content: '' }))
  mount(request)
  await screen.findByText(structure.root)
  const flatten = vi.mocked(flattenFiles)
  await waitFor(() => { expect(flatten.mock.calls.length).toBeGreaterThan(0) })
  const afterLoad = flatten.mock.calls.length
  fireEvent.change(screen.getByPlaceholderText(en['legacy.109']), { target: { value: 'notes' } })
  await waitFor(() => { expect(screen.getByPlaceholderText(en['legacy.109'])).toHaveProperty('value', 'notes') })
  expect(flatten.mock.calls.length).toBe(afterLoad)
})

it('drops a superseded structure response without parsing it', async () => {
  let release: (() => void) | undefined
  const inFlight = new Promise<void>(resolve => { release = resolve })
  const staleJson = vi.fn(async () => structure)
  const cancel = vi.fn(async () => undefined)
  let structureCalls = 0
  const request = vi.fn<typeof fetch>(async input => {
    if (String(input).includes('/structure?')) {
      structureCalls += 1
      if (structureCalls === 1) {
        await inFlight
        return { ok: true, body: { cancel }, json: staleJson } as unknown as Response
      }
      return reply(structure)
    }
    return reply({ content: '' })
  })
  mount(request)
  // Mount loads the tree from both the project-path and revision effects, so the second scan supersedes the first.
  await waitFor(() => { expect(structureCalls).toBe(2) })
  release?.()
  await waitFor(() => { expect(cancel).toHaveBeenCalled() })
  expect(staleJson).not.toHaveBeenCalled()
})

/** A project whose file list dwarfs any window: 40 directories x 125 files. */
function largeProject() {
  const dirs = []
  for (let d = 0; d < 40; d += 1) {
    const children = []
    for (let f = 0; f < 125; f += 1) children.push({ name: 'file' + String(f) + '.md', path: '/project/dir' + String(d) + '/file' + String(f) + '.md', kind: 'file' as const, detail: '1 B' })
    dirs.push({ name: 'dir' + String(d), path: '/project/dir' + String(d), kind: 'dir' as const, detail: '125', children })
  }
  return { path: '/project', root: 'project', tree: dirs }
}

it('bounds the rendered tree when a query matches a whole large project', async () => {
  const request = vi.fn<typeof fetch>(async input =>
    String(input).includes('/structure?') ? reply(largeProject()) : reply({ content: '' }))
  mount(request, null)
  await waitFor(() => { expect(screen.queryAllByRole('treeitem').length).toBeGreaterThan(0) })
  fireEvent.change(screen.getByPlaceholderText(en['legacy.109']), { target: { value: 'file' } })
  await screen.findByText(en.treeTruncated.replace('{value0}', '400'))
  expect(screen.queryAllByRole('treeitem').length).toBeLessThanOrEqual(400)
})

it('bounds the rendered quick-open results', async () => {
  const request = vi.fn<typeof fetch>(async input =>
    String(input).includes('/structure?') ? reply(largeProject()) : reply({ content: '' }))
  mount(request, null)
  await waitFor(() => { expect(screen.queryAllByRole('treeitem').length).toBeGreaterThan(0) })
  fireEvent.keyDown(window, { key: 'p', metaKey: true })
  await screen.findByRole('dialog')
  await screen.findByText(en.quickOpenLimit.replace('{value0}', '100').replace('{value1}', '5000'))
  expect(document.querySelectorAll('[data-quick-result]').length).toBeLessThanOrEqual(100)
})

it('derives the filtered tree once per query, not once per render', async () => {
  const request = vi.fn<typeof fetch>(async input =>
    String(input).includes('/structure?') ? reply(structure) : reply({ content: '' }))
  mount(request, null)
  await waitFor(() => { expect(screen.queryAllByRole('treeitem').length).toBeGreaterThan(0) })
  const filter = vi.mocked(filterTree)
  const before = filter.mock.calls.length
  fireEvent.change(screen.getByPlaceholderText(en['legacy.109']), { target: { value: 'notes' } })
  await waitFor(() => { expect(screen.getByPlaceholderText(en['legacy.109'])).toHaveProperty('value', 'notes') })
  expect(filter.mock.calls.length).toBe(before + 1)
})

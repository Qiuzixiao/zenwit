// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { HomePage } from '../src/client/HomePage.tsx'
import type { CopyProps, WorkbenchProps } from '../src/client/contract.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** Home surface slot stub for cases that assert no slot content. */
const noSlots = (() => null) as unknown as WorkbenchProps['renderSlot']

it.each([{ language: 'Chinese', copy: zh }, { language: 'English', copy: en }])(
  'names the create dialog and input in $language and creates once on Enter',
  async ({ copy }) => {
    const project = { name: 'My project', path: '/projects/my-project', tags: [], updatedAt: 0 }
    const create = vi.fn().mockResolvedValue(project)
    const openProject = vi.fn().mockResolvedValue(undefined)
    const t: CopyProps['t'] = (key, params) => {
      const text = key in copy ? copy[key as keyof typeof copy] : key
      return text.replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? ''))
    }
    render(<HomePage t={t} list={async () => []} create={create} updateProjectTags={vi.fn()}
      deleteProject={vi.fn()} forgetProject={vi.fn()} openProject={openProject} openLibrary={vi.fn()} openFolder={vi.fn()}
      goHome={vi.fn()} panels={[]} activePanel={null} selectPanel={vi.fn()} renderSlot={noSlots} />)
    await screen.findByText(copy['legacy.022'])
    fireEvent.click(screen.getByRole('button', { name: copy['legacy.014'] }))
    const dialog = screen.getByRole('dialog', { name: copy['legacy.026'] })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const input = within(dialog).getByRole('textbox', { name: copy['legacy.043'] })
    expect(input).toBe(document.activeElement)
    fireEvent.change(input, { target: { value: project.name } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(openProject).toHaveBeenCalledWith(project.path))
    expect(create).toHaveBeenCalledExactlyOnceWith(project.name, [])
  },
)

it('navigates to a registered panel, hosts it in the home body, and keeps the chrome seats', async () => {
  const selectPanel = vi.fn()
  const renderSlot = vi.fn((name: string, _owner: unknown, opts?: { entryKey?: string; only?: string }) => {
    if (name === 'main') return <div>panel:{opts?.entryKey}</div>
    if (name === 'sidebar.settings') return <div>settings seat</div>
    if (name === 'sidebar.footer.action') return <div>plugin actions seat</div>
    return <span>icon:{opts?.only}</span>
  }) as unknown as WorkbenchProps['renderSlot']
  const panels = [{ id: 'account' as unknown as MainPanelId, label: 'Account center' }]
  const base = {
    t: ((key: string) => key) as CopyProps['t'],
    list: async () => [],
    create: vi.fn(), updateProjectTags: vi.fn(), deleteProject: vi.fn(), forgetProject: vi.fn(),
    openProject: vi.fn(), openLibrary: vi.fn(), openFolder: vi.fn(), goHome: vi.fn(), selectPanel, renderSlot,
  }
  const view = render(<HomePage {...base} panels={panels} activePanel={null} />)
  await screen.findByText('legacy.022')
  expect(screen.getByText('settings seat')).toBeTruthy()
  expect(screen.getByText('plugin actions seat')).toBeTruthy()
  const entry = screen.getByRole('button', { name: /Account center/u })
  expect(entry.getAttribute('aria-current')).toBeNull()
  fireEvent.click(entry)
  expect(selectPanel).toHaveBeenCalledWith('account')
  view.rerender(<HomePage {...base} panels={panels} activePanel={'account' as unknown as MainPanelId} />)
  expect(screen.getByText('panel:account')).toBeTruthy()
  expect(screen.queryByText('legacy.015')).toBeNull()
  expect(screen.getByRole('button', { name: /Account center/u }).getAttribute('aria-current')).toBe('page')
})

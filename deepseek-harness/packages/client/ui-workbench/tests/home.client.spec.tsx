// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HomePage } from '../src/client/HomePage.tsx'
import type { CopyProps } from '../src/client/contract.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

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
      deleteProject={vi.fn()} forgetProject={vi.fn()} openProject={openProject} openLibrary={vi.fn()} openFolder={vi.fn()} />)
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

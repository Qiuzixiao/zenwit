// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectLibraryPage } from '../src/client/ProjectLibraryPage.tsx'
import type { CopyProps, WorkbenchProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** Library surface slot stub: no registrant renders anything. */
const noSlots = (() => null) as unknown as WorkbenchProps['renderSlot']

/** Chinese dictionary lookup with the workbench parameter syntax. */
function copy(): CopyProps['t'] {
  return (key, params) => {
    const text = key in zh ? zh[key as keyof typeof zh] : key
    return text.replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? ''))
  }
}

it('renders the shared chrome, the library hero, and filters the grid by the query', async () => {
  const selectPanel = vi.fn()
  const goHome = vi.fn()
  const projects = [
    { name: 'Alpha', path: '/projects/alpha', tags: [], updatedAt: 1_000 },
    { name: 'Beta', path: '/projects/beta', tags: ['writing'], updatedAt: 2_000 },
  ]
  render(<ProjectLibraryPage t={copy()} list={async () => projects} openProject={vi.fn()} deleteProject={vi.fn()}
    forgetProject={vi.fn()} openFolder={vi.fn()} goHome={goHome}
    panels={[{ id: 'account' as never, label: 'Account center' }]} activePanel={null}
    selectPanel={selectPanel} renderSlot={noSlots} />)

  // The library renders the same chrome as home, with its own entry marked.
  expect(screen.getByRole('button', { name: zh['legacy.011'] })).toBeTruthy()
  expect(screen.getByRole('button', { name: zh['legacy.012'] }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('heading', { name: zh['legacy.007'], level: 1 })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Account center' }))
  expect(selectPanel).toHaveBeenCalledWith('account')
  fireEvent.click(screen.getByRole('button', { name: zh['legacy.011'] }))
  expect(goHome).toHaveBeenCalledOnce()
  await screen.findByText('Alpha')
  expect(screen.getByText('Beta')).toBeTruthy()
  expect(screen.getByText('2' + zh['legacy.048'])).toBeTruthy()

  // Every card resolves a cover variant; a missing cover class used to leak the
  // literal string "undefined" into the card's class list.
  for (const card of document.querySelectorAll('article')) {
    expect(card.className).not.toContain('undefined')
    expect(card.querySelector('span[class*="cover"]')).not.toBeNull()
  }

  fireEvent.change(screen.getByRole('textbox', { name: zh['legacy.013'] }), { target: { value: 'beta' } })
  await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
  expect(screen.getByText('Beta')).toBeTruthy()
})

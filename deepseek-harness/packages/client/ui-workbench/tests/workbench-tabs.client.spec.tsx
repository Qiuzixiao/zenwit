// @vitest-environment jsdom
/**
 * The tab strip's empty state. An empty pane has nothing to close, drag or
 * activate, but it must still name where it is (the start page) instead of
 * showing a bare + button with no context.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TabBar } from '../src/client/workbench/WorkbenchTabs.tsx'
import { en } from '../src/client/workbench/locales.ts'

afterEach(cleanup)

/** One strip render with an empty pane and no openable options. */
function renderStrip(): void {
  render(
    <TabBar
      paneId="pane:1"
      tabs={[]}
      active={null}
      onActivate={() => {}}
      onClose={() => {}}
      onNewTab={() => {}}
      newTabOptions={[]}
      onDropTab={() => {}}
    />,
  )
}

it('names the start page in an empty pane', () => {
  renderStrip()
  const chip = screen.getByText(en.start)
  expect(chip).not.toBeNull()
  // It labels the pane rather than being a tab: no close control to click.
  expect(screen.queryByRole('button', { name: en.close })).toBeNull()
})

it('keeps the new-tab control in the empty strip', () => {
  renderStrip()
  expect(screen.getByRole('button', { name: en.newTab })).not.toBeNull()
})

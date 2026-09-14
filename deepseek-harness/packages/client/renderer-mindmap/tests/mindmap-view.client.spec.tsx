// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PreviewViewProps } from '@deepseek-ai/dsh-client-ui-workbench/preview'
import { MindmapView } from '../src/client/MindmapView.tsx'

const t = ((key: string) => key) as unknown as PreviewViewProps['t']

function view(source: string) {
  return render(<MindmapView path="/p/plan.mm" mediaType="text/plain" source={source} revision={0} t={t} resolve={() => ''} />)
}

afterEach(() => { cleanup() })

describe('mindmap view', () => {
  it('renders a node tree with children', () => {
    view('<map><node TEXT="Root"><node TEXT="Child"/></node></map>')
    expect(screen.getByText('Root')).toBeTruthy()
    expect(screen.getByText('Child')).toBeTruthy()
  })

  it('renders a leaf without a child list', () => {
    view('<map><node TEXT="Only"/></map>')
    expect(screen.getByText('Only')).toBeTruthy()
  })

  it('marks a folded node', () => {
    view('<map><node TEXT="Root" FOLDED="true"/></map>')
    expect(screen.getByText('Root').closest('li')?.getAttribute('data-folded')).toBe('true')
  })

  it('shows a refusal notice for a hostile document', () => {
    view('<!DOCTYPE map>')
    expect(screen.getByRole('alert').textContent).toBe('previewFailed')
  })
})

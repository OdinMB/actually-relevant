import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import WidgetGeneratorPage from './WidgetGeneratorPage'
import { fieldBorderProblems, fieldFocusProblems, focusRingProblems } from '../test/classes'

function renderPage() {
  render(
    <HelmetProvider>
      <MemoryRouter>
        <WidgetGeneratorPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('WidgetGeneratorPage', () => {
  it('rings the issue picker on focus in a brand shade that reaches 3:1 against white', () => {
    renderPage()
    expect(fieldFocusProblems(screen.getByRole('combobox', { name: 'Issue' }))).toEqual([])
  })

  it('outlines the issue picker at rest in a grey that reaches 3:1 against the page', () => {
    renderPage()
    expect(fieldBorderProblems(screen.getByRole('combobox', { name: 'Issue' }))).toEqual([])
  })

  // A checkbox or slider shows focus from the keyboard only, as a button does
  it('shows only the brand ring on the story-count slider and the two checkboxes, from the keyboard', () => {
    renderPage()
    const controls = [
      ['slider', 'Number of stories'],
      ['checkbox', 'Show relevance summaries'],
      ['checkbox', 'Only uplifting stories'],
    ] as const
    for (const [role, name] of controls) expect(focusRingProblems(screen.getByRole(role, { name })), name).toEqual([])
  })
})

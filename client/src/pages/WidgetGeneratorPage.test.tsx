import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PositivityProvider } from '../contexts/PositivityContext'
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
  it('shows only the brand ring on the two sliders and the checkbox, from the keyboard', () => {
    renderPage()
    const controls = [
      ['slider', 'Number of stories'],
      ['slider', "Widget's mix of news, from heavy to uplifting"],
      ['checkbox', 'Show relevance summaries'],
    ] as const
    for (const [role, name] of controls) expect(focusRingProblems(screen.getByRole(role, { name })), name).toEqual([])
  })

  it("starts the widget's mix at the reader's own site setting and puts it in both embed codes", () => {
    localStorage.setItem('ar-positivity', '100')
    try {
      render(
        <HelmetProvider>
          <MemoryRouter>
            <PositivityProvider>
              <WidgetGeneratorPage />
            </PositivityProvider>
          </MemoryRouter>
        </HelmetProvider>,
      )
      const dial = screen.getByRole('slider', { name: "Widget's mix of news, from heavy to uplifting" })
      expect(dial).toHaveValue('100')
      expect(screen.getByText(/data-mix="uplifting"/)).toBeInTheDocument()
      expect(screen.getByText(/\/embed\?mix=uplifting/)).toBeInTheDocument()

      fireEvent.change(dial, { target: { value: '75' } })
      expect(screen.getByText(/data-mix="mostly-uplifting"/)).toBeInTheDocument()
      // The widget's dial is its own: the site setting stays where the reader left it
      expect(localStorage.getItem('ar-positivity')).toBe('100')
    } finally {
      localStorage.removeItem('ar-positivity')
    }
  })
})

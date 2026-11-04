import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import WidgetGeneratorPage from './WidgetGeneratorPage'
import { fieldFocusProblems } from '../test/classes'

describe('WidgetGeneratorPage', () => {
  it('rings the issue picker on focus in a brand shade that reaches 3:1 against white', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <WidgetGeneratorPage />
        </MemoryRouter>
      </HelmetProvider>,
    )
    expect(fieldFocusProblems(screen.getByRole('combobox', { name: 'Issue' }))).toEqual([])
  })
})

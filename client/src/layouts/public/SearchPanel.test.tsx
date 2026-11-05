import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchPanel from './SearchPanel'
import { fieldBorderProblems, fieldFocusProblems } from '../../test/classes'

function renderPanel() {
  render(
    <MemoryRouter>
      <SearchPanel query="" onQueryChange={vi.fn()} onClose={vi.fn()} />
    </MemoryRouter>,
  )
  return screen.getByRole('textbox', { name: 'Search stories' })
}

describe('SearchPanel', () => {
  it('rings the search field on focus in a brand shade that reaches 3:1 against white', () => {
    expect(fieldFocusProblems(renderPanel())).toEqual([])
  })

  it('outlines the search field at rest in a grey that reaches 3:1 against the page and its fill', () => {
    expect(fieldBorderProblems(renderPanel())).toEqual([])
  })
})

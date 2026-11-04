import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchPanel from './SearchPanel'
import { fieldFocusProblems } from '../../test/classes'

describe('SearchPanel', () => {
  it('rings the search field on focus in a brand shade that reaches 3:1 against white', () => {
    render(
      <MemoryRouter>
        <SearchPanel query="" onQueryChange={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    )
    expect(fieldFocusProblems(screen.getByRole('textbox', { name: 'Search stories' }))).toEqual([])
  })
})

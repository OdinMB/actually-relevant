import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Pagination from './Pagination'
import { focusRingProblems } from '../test/classes'

describe('Pagination', () => {
  it('fills the current page in a brand shade dark enough for its white number (4.5:1)', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />)
    const current = screen.getByRole('button', { name: 'Page 2' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveClass('text-white')
    // White on brand-500 is 4.0:1, on brand-600 4.9:1, on brand-700 6.6:1
    const fills = [...current.classList].filter(c => c.startsWith('bg-'))
    expect(fills).toHaveLength(1)
    expect(fills[0]).toMatch(/^bg-brand-[6-9]00$/)
  })

  it('shows keyboard focus on every button as the brand ring alone, without the browser outline beside it', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Previous page', 'Page 1', 'Page 2', 'Page 3', 'Page 5', 'Next page'])
    for (const button of buttons) expect(focusRingProblems(button), button.getAttribute('aria-label') ?? '').toEqual([])
  })

  // The brand-500 ring against the brand-700 fill is about 1.6:1; the gap puts white on both sides of it
  it('sets the ring of the filled current page off its fill by a white gap', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveClass('focus-visible:ring-offset-2')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Pagination from './Pagination'

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
})

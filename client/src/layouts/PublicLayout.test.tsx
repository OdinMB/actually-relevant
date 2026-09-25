import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import PublicLayout from './PublicLayout'
import { BRAND } from '../config'
import { announcedText } from '../test/stories'

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <PublicLayout />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('PublicLayout', () => {
  beforeAll(() => {
    // jsdom implements neither native <dialog> methods nor scrolling
    HTMLDialogElement.prototype.showModal = vi.fn()
    HTMLDialogElement.prototype.close = vi.fn()
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })

  it('exposes the site-wide AI statement to assistive technology', () => {
    renderLayout()
    const statement = screen.getByText(BRAND.claimSupport)
    expect(statement.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('shows the AI notice as the first thing in <main>, above every page, where the skip link lands', () => {
    renderLayout()
    const main = screen.getByRole('main')
    const note = screen.getByRole('note')
    expect(main.firstElementChild).toBe(note)
    expect(announcedText(note)).toBe('Written and curated with care by AI. How it works')
    expect(within(note).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/methodology')
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', `#${main.id}`)
  })

  it('keeps the bottom sign-off as it was', () => {
    renderLayout()
    expect(screen.getByText('Curated with care by AI.')).toBeInTheDocument()
  })
})

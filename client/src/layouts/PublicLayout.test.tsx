import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import PublicLayout from './PublicLayout'
import { BRAND } from '../config'

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
})

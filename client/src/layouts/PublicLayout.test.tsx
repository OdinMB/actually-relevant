import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

  it('shows the AI line in the header on every page, as its own link to the explainer, not inside the home link', () => {
    renderLayout()
    const header = screen.getByRole('banner')
    const aiLine = within(header).getByRole('link', { name: 'Written and curated by AI: how it works' })
    expect(aiLine).toHaveAttribute('href', '/methodology')
    expect(aiLine.textContent).toContain('Written & curated by AI')
    expect(aiLine.parentElement?.closest('a')).toBeNull()

    const home = within(header).getByRole('link', { name: /Actually Relevant/ })
    expect(home).toHaveAttribute('href', '/')
    expect(home).toHaveTextContent(BRAND.claim.replace(/\.$/, ''))
    expect(home).not.toContainElement(aiLine)
  })

  it('no longer puts an AI notice band at the top of <main>', () => {
    renderLayout()
    expect(screen.queryByRole('note')).toBeNull()
    expect(within(screen.getByRole('main')).queryByText(/curated/i)).toBeNull()
  })

  it('keeps the bottom sign-off as it was', () => {
    renderLayout()
    expect(screen.getByText('Curated with care by AI.')).toBeInTheDocument()
  })

  it('places the bottom sign-off inside the footer landmark, so no page content sits outside a landmark', () => {
    renderLayout()
    const footer = screen.getByRole('contentinfo')
    expect(footer).toContainElement(screen.getByText(BRAND.claimSupport))
  })
})

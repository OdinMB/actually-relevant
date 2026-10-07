import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import PublicLayout from './PublicLayout'
import { BRAND } from '../config'
import { toggleSaved } from '../lib/preferences'

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

  it('keeps the line badge out of the home link name, so the home link reads as logo and claim only', () => {
    renderLayout()
    const header = screen.getByRole('banner')
    const home = within(header).getByRole('link', { name: /Actually Relevant/ })
    expect(home).toHaveAccessibleName(`Actually Relevant ${BRAND.claim.replace(/\.$/, '')}`)
  })

  describe('Saved link', () => {
    const savedLinks = () =>
      within(screen.getByRole('banner')).queryAllByRole('link', { name: /^Saved/, hidden: true })

    beforeEach(() => {
      localStorage.clear()
    })

    it('is absent, in the header and the mobile menu, while nothing is saved', () => {
      renderLayout()
      expect(savedLinks()).toHaveLength(0)
    })

    it('appears when the first story is saved and goes when the last is removed, without a reload', () => {
      renderLayout()

      act(() => {
        toggleSaved('a-story')
      })
      expect(savedLinks()).toHaveLength(2)
      expect(savedLinks()[0]).toHaveAttribute('href', '/saved')

      act(() => {
        toggleSaved('a-story')
      })
      expect(savedLinks()).toHaveLength(0)
    })

    it('comes after Newsletter and Podcast, in the header and the mobile menu', () => {
      localStorage.setItem('ar-saved-stories', JSON.stringify(['a-story']))
      renderLayout()
      const header = screen.getByRole('banner')
      const order = [
        ...within(header).getAllByRole('button', { name: 'Newsletter', hidden: true }),
        ...within(header).getAllByRole('link', { name: /^(Podcast|Saved)/, hidden: true }),
      ]
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map((el) => el.textContent?.replace(/\s*\(\d+\)$/, '').trim())
      expect(order).toEqual(['Newsletter', 'Podcast', 'Saved', 'Newsletter', 'Podcast', 'Saved Stories'])
    })
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

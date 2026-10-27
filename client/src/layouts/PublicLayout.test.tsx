import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, within, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import PublicLayout from './PublicLayout'
import { BRAND } from '../config'
import { toggleSaved } from '../lib/preferences'

// The layout holds the signup and feedback dialogs, whose forms fetch a form token when they mount
const mockTokens = vi.hoisted(() => ({ getSubscribeToken: vi.fn(), getFeedbackToken: vi.fn() }))
vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, publicApi: { ...actual.publicApi, ...mockTokens } }
})

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

  beforeEach(() => {
    mockTokens.getSubscribeToken.mockReset().mockResolvedValue({ token: 'form-token' })
    mockTokens.getFeedbackToken.mockReset().mockResolvedValue({ token: 'form-token' })
  })

  it('requests no form token on a page view while the signup and feedback dialogs stay closed', async () => {
    renderLayout()
    await act(async () => {})

    expect(mockTokens.getSubscribeToken).not.toHaveBeenCalled()
    expect(mockTokens.getFeedbackToken).not.toHaveBeenCalled()
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
    const savedLinks = () => within(screen.getByRole('banner')).queryAllByRole('link', { name: /^Saved/, hidden: true })

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
      const order = [...within(header).getAllByRole('link', { name: /^(Newsletter|Podcast|Saved)/, hidden: true })]
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map(el => el.textContent?.replace(/\s*\(\d+\)$/, '').trim())
      expect(order).toEqual(['Newsletter', 'Podcast', 'Saved', 'Newsletter', 'Podcast', 'Saved Stories'])
    })
  })

  it('no longer puts an AI notice band at the top of <main>', () => {
    renderLayout()
    expect(screen.queryByRole('note')).toBeNull()
    expect(within(screen.getByRole('main')).queryByText(/curated/i)).toBeNull()
  })

  it('has no bottom sign-off above the footer: the header AI line is the site-wide notice', () => {
    renderLayout()
    expect(screen.queryByText(BRAND.claimSupport)).toBeNull()
  })

  describe('Search panel', () => {
    const openSearch = () => fireEvent.click(within(screen.getByRole('navigation', { name: 'Issue categories' })).getByRole('button', { name: 'Open search' }))
    const searchBox = () => screen.queryByRole('textbox', { name: 'Search stories' })

    it('clears the query on the first Escape and closes on the second', () => {
      renderLayout()
      openSearch()
      fireEvent.change(searchBox()!, { target: { value: 'climate' } })

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(searchBox()).toHaveValue('')

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(searchBox()).toBeNull()
    })

    it('keeps an unsent query when closed with the toggle and reopened', () => {
      renderLayout()
      openSearch()
      fireEvent.change(searchBox()!, { target: { value: 'water' } })
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Issue categories' })).getByRole('button', { name: 'Close search' }))
      expect(searchBox()).toBeNull()

      openSearch()
      expect(searchBox()).toHaveValue('water')
    })
  })
})

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import PublicLayout from './PublicLayout'
import { BRAND } from '../config'
import { toggleSaved } from '../lib/preferences'
import { ApiError } from '../lib/api'

// The layout holds the signup and feedback dialogs, whose forms fetch a form token when they mount,
// and the header's "This week" link, which reads the newsletter archive's first page
const mockTokens = vi.hoisted(() => ({ getSubscribeToken: vi.fn(), getFeedbackToken: vi.fn(), newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, publicApi: { ...actual.publicApi, ...mockTokens } }
})

const HOUR = 60 * 60 * 1000
function archiveOf(...issues: { slug: string; ageMs: number }[]) {
  return {
    data: issues.map(({ slug, ageMs }) => ({ slug, title: slug, publishedAt: new Date(Date.now() - ageMs).toISOString(), storyCount: 4 })),
    total: issues.length,
    page: 1,
    pageSize: 20,
    totalPages: issues.length > 0 ? 1 : 0,
  }
}

function renderLayout(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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
    mockTokens.newsletterArchive.mockReset().mockResolvedValue(archiveOf())
  })

  it('requests no form token on a page view while the signup and feedback dialogs stay closed', async () => {
    renderLayout()
    await act(async () => {})

    expect(mockTokens.getSubscribeToken).not.toHaveBeenCalled()
    expect(mockTokens.getFeedbackToken).not.toHaveBeenCalled()
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

    it('takes the icons out of the desktop header links while it shows, so four links fit beside the logo', () => {
      const desktopIcons = () =>
        [...screen.getByRole('banner').querySelectorAll('a[href="/newsletter"], a[href="/podcast"], a[href="/saved"]')]
          .filter(link => !link.closest('#mobile-nav-menu'))
          .map(link => link.querySelector('svg')!)
      renderLayout()
      expect(desktopIcons()).toHaveLength(2)
      for (const icon of desktopIcons()) expect(icon).not.toHaveClass('hidden')

      act(() => {
        toggleSaved('a-story')
      })
      expect(desktopIcons()).toHaveLength(3)
      for (const icon of desktopIcons()) expect(icon).toHaveClass('hidden')
    })
  })

  describe('This week link', () => {
    const header = () => screen.getByRole('banner')
    const thisWeekLinks = () => within(header()).queryAllByRole('link', { name: 'This week', hidden: true })
    const menuToggle = () => header().querySelector('[aria-controls="mobile-nav-menu"]')!

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'webdriver')
    })

    it("leads to the newest issue's web edition, in the header and the mobile menu, named by its text", async () => {
      mockTokens.newsletterArchive.mockResolvedValue(archiveOf({ slug: 'week-43-2026', ageMs: 30 * HOUR }, { slug: 'week-42-2026', ageMs: 198 * HOUR }))
      renderLayout()

      await waitFor(() => expect(thisWeekLinks()).toHaveLength(2))
      for (const link of thisWeekLinks()) {
        expect(link).toHaveAttribute('href', '/newsletter/week-43-2026')
        expect(link).toHaveAccessibleName('This week')
        expect(link.textContent?.trim()).toBe('This week')
      }
      expect(mockTokens.newsletterArchive).toHaveBeenCalledTimes(1)
      expect(mockTokens.newsletterArchive).toHaveBeenCalledWith(1)
    })

    it('comes first, and Newsletter and Podcast still lead where they did', async () => {
      mockTokens.newsletterArchive.mockResolvedValue(archiveOf({ slug: 'week-43-2026', ageMs: 30 * HOUR }))
      renderLayout()

      await waitFor(() => expect(thisWeekLinks()).toHaveLength(2))
      const links = within(header()).getAllByRole('link', { name: /^(This week|Newsletter|Podcast)$/, hidden: true })
      const desktopAndMenu = [
        ['This week', '/newsletter/week-43-2026'],
        ['Newsletter', '/newsletter'],
        ['Podcast', '/podcast'],
      ]
      expect(links.map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([...desktopAndMenu, ...desktopAndMenu])
    })

    it('closes the mobile menu when tapped, as the other menu links do', async () => {
      mockTokens.newsletterArchive.mockResolvedValue(archiveOf({ slug: 'week-43-2026', ageMs: 30 * HOUR }))
      renderLayout()
      await waitFor(() => expect(thisWeekLinks()).toHaveLength(2))

      fireEvent.click(menuToggle())
      expect(menuToggle()).toHaveAttribute('aria-expanded', 'true')
      const menu = document.getElementById('mobile-nav-menu')!
      fireEvent.click(within(menu).getByRole('link', { name: 'This week', hidden: true }))
      expect(menuToggle()).toHaveAttribute('aria-expanded', 'false')
    })

    it('is absent while the archive loads', () => {
      mockTokens.newsletterArchive.mockReturnValue(new Promise(() => {}))
      renderLayout()
      expect(thisWeekLinks()).toHaveLength(0)
    })

    it('is absent, leaving the header as it was, while no issue is published', async () => {
      renderLayout()
      await act(async () => {})

      expect(mockTokens.newsletterArchive).toHaveBeenCalled()
      expect(thisWeekLinks()).toHaveLength(0)
      expect(within(header()).queryByText(/this week/i)).toBeNull()
    })

    it('is absent, with nothing said, when the archive cannot be loaded', async () => {
      mockTokens.newsletterArchive.mockRejectedValue(new ApiError(500, 'Internal server error'))
      renderLayout()
      await act(async () => {})

      expect(mockTokens.newsletterArchive).toHaveBeenCalled()
      expect(thisWeekLinks()).toHaveLength(0)
      expect(within(header()).queryByText(/this week|could not|error/i)).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('is absent once the newest issue is more than a week and a day old', async () => {
      mockTokens.newsletterArchive.mockResolvedValue(archiveOf({ slug: 'week-41-2026', ageMs: 9 * 24 * HOUR }))
      renderLayout()
      await act(async () => {})

      expect(mockTokens.newsletterArchive).toHaveBeenCalled()
      expect(thisWeekLinks()).toHaveLength(0)
    })

    it('is neither fetched nor shown while prerendering, so no static page carries it', async () => {
      Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
      mockTokens.newsletterArchive.mockResolvedValue(archiveOf({ slug: 'week-43-2026', ageMs: 30 * HOUR }))
      renderLayout()
      await act(async () => {})

      expect(mockTokens.newsletterArchive).not.toHaveBeenCalled()
      expect(thisWeekLinks()).toHaveLength(0)
    })

    it('stays out while prerendering even when another part of the page has loaded the archive', async () => {
      // /newsletter's issue list fetches the same first page during prerendering, unguarded
      Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      queryClient.setQueryData(['public-newsletter-archive', 1], archiveOf({ slug: 'week-43-2026', ageMs: 30 * HOUR }))
      renderLayout(queryClient)
      await act(async () => {})

      expect(thisWeekLinks()).toHaveLength(0)
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

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import PublicLayout from './PublicLayout'
import { BRAND } from '../config'
import { toggleSaved } from '../lib/preferences'
import { focusRingProblems } from '../test/classes'

// The layout holds the signup and feedback dialogs, whose forms fetch a form token when they mount
const mockTokens = vi.hoisted(() => ({ getSubscribeToken: vi.fn(), getFeedbackToken: vi.fn() }))
vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, publicApi: { ...actual.publicApi, ...mockTokens } }
})

/** How the last navigation went (PUSH or REPLACE) and where it led. */
function NavigationProbe() {
  const { pathname, search } = useLocation()
  return <div data-testid="navigation">{`${useNavigationType()} ${pathname}${search}`}</div>
}

function renderLayout(url = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <QueryClientProvider client={queryClient}>
          <PublicLayout />
          <NavigationProbe />
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
    expect(aiLine.textContent).toContain('Written & curated byAI')
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

  it('shows only the brand ring on keyboard focus on every link and button around the page: skip link, header, mobile menu and footer', () => {
    renderLayout()
    const controls = [
      screen.getByRole('link', { name: 'Skip to content' }),
      // The mobile menu is a closed dialog in the header, hence hidden
      ...within(screen.getByRole('banner')).getAllByRole('link', { hidden: true }),
      ...within(screen.getByRole('banner')).getAllByRole('button', { hidden: true }),
      ...within(screen.getByRole('contentinfo')).getAllByRole('link'),
    ]
      // The issue tabs and the desktop search toggle get the same classes through `.issue-nav-link` in index.css
      .filter(control => !control.classList.contains('issue-nav-link'))
    expect(controls.length).toBeGreaterThan(30)

    const problems = controls.map(control => [control.getAttribute('aria-label') ?? control.textContent, focusRingProblems(control)] as const)
    expect(problems.filter(([, found]) => found.length > 0)).toEqual([])
  })

  describe('Actually Uplifting edition', () => {
    const claim = BRAND.claim.replace(/\.$/, '')
    const home = () => within(screen.getByRole('banner')).getByRole('link', { name: /^Actually (Relevant|Uplifting)/ })
    const seeAllNews = () => within(screen.getByRole('banner')).queryByRole('link', { name: 'See all news' })

    beforeEach(() => {
      localStorage.clear()
    })

    it('at Only uplifting, names the home link after the edition, shows the row with its way back, and keeps the header AI line', () => {
      renderLayout('/?mix=uplifting')
      const header = screen.getByRole('banner')

      expect(home()).toHaveAccessibleName(`${BRAND.upliftingEdition} ${claim}`)
      expect(home()).toHaveAttribute('href', '/')
      expect(seeAllNews()).toBeInTheDocument()
      expect(focusRingProblems(seeAllNews()!)).toEqual([])
      expect(within(header).getByRole('link', { name: 'Written and curated by AI: how it works' })).toBeInTheDocument()
    })

    it('at any other position, shows the Actually Relevant logo and no row', () => {
      renderLayout('/?mix=mostly-uplifting')

      expect(home()).toHaveAccessibleName(`Actually Relevant ${claim}`)
      expect(seeAllNews()).toBeNull()
    })

    it('leaves the edition in place from "See all news": the same page at the balanced mix, history replaced, focus on <main>', async () => {
      renderLayout('/search?q=x&mix=uplifting')

      await userEvent.click(seeAllNews()!)

      expect(screen.getByTestId('navigation')).toHaveTextContent(/^REPLACE \/search\?q=x&mix=balanced$/)
      expect(seeAllNews()).toBeNull()
      expect(home()).toHaveAccessibleName(`Actually Relevant ${claim}`)
      expect(screen.getByRole('main')).toHaveFocus()
    })

    it('keeps the address hash when "See all news" stays on the same page', async () => {
      renderLayout('/search?q=x&mix=uplifting#results')

      expect(seeAllNews()).toHaveAttribute('href', '/search?q=x&mix=balanced#results')
    })

    it('drops the hash when "See all news" leaves the landing page for the homepage', () => {
      renderLayout('/uplifting#stories')

      expect(seeAllNews()).toHaveAttribute('href', '/?mix=balanced')
    })

    it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
      'leaves focus and the page alone on a click that opens a new tab or window (%o)',
      init => {
        renderLayout('/search?q=x&mix=uplifting')
        // jsdom does not open tabs: stop the browser's own follow-through once the app has seen the click
        const stopDefault = (event: Event) => event.preventDefault()
        window.addEventListener('click', stopDefault)
        window.addEventListener('auxclick', stopDefault)
        try {
          fireEvent.click(seeAllNews()!, init)
        } finally {
          window.removeEventListener('click', stopDefault)
          window.removeEventListener('auxclick', stopDefault)
        }

        expect(screen.getByRole('main')).not.toHaveFocus()
        expect(screen.getByTestId('navigation')).toHaveTextContent(/^POP \/search\?q=x&mix=uplifting$/)
      },
    )

    it('leaves the landing page for the homepage at the balanced mix, as a new history entry', async () => {
      renderLayout('/uplifting')

      await userEvent.click(seeAllNews()!)

      expect(screen.getByTestId('navigation')).toHaveTextContent(/^PUSH \/\?mix=balanced$/)
      expect(seeAllNews()).toBeNull()
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

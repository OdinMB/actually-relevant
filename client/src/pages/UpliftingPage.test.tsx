import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicStory } from '@shared/types'
import { makeStory } from '../test/stories'

const mockApi = vi.hoisted(() => ({ homepage: vi.fn(), newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

vi.mock('../components/SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe: vi.fn() }),
}))

import { PositivityProvider } from '../contexts/PositivityContext'
import { MoodDialPanel } from '../components/PositivitySlider'
import { BRAND } from '../config'
import { SEO, DefaultSeo } from '../lib/seo'
import UpliftingPage from './UpliftingPage'

const ISSUES = [
  { id: 'i1', name: 'Human Development', slug: 'human-development' },
  { id: 'i2', name: 'Planet & Climate', slug: 'planet-climate' },
  { id: 'i3', name: 'Existential Threats', slug: 'existential-threats' },
  { id: 'i4', name: 'Science & Technology', slug: 'science-technology' },
]

function story(id: string, day: number, emotionTag: PublicStory['emotionTag']): PublicStory {
  return makeStory({ id, slug: id, title: `${id} headline`, titleLabel: `${id} label`, emotionTag, datePublished: `2026-10-${day}T00:00:00Z` })
}

/** Uplifting stories in two issues; the newest story of all is a calm one, so the balanced hero differs */
const HOMEPAGE = {
  issues: ISSUES,
  storiesByIssue: {
    'human-development': { uplifting: [story('up-1', 28, 'uplifting'), story('up-2', 26, 'uplifting')], calm: [story('calm-1', 30, 'calm')], negative: [] },
    'planet-climate': { uplifting: [], calm: [story('calm-2', 27, 'calm')], negative: [] },
    'existential-threats': { uplifting: [story('up-3', 25, 'uplifting')], calm: [], negative: [] },
    'science-technology': { uplifting: [], calm: [], negative: [story('heavy-1', 29, 'frustrating')] },
  },
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderPage(url = '/uplifting') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <QueryClientProvider client={client}>
          <PositivityProvider>
            {/* The site-wide defaults the app renders above every page */}
            <DefaultSeo />
            <MoodDialPanel />
            <UpliftingPage />
            <LocationProbe />
          </PositivityProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const PAGE_URL = `${SEO.siteUrl}/uplifting`
const h1s = () => screen.queryAllByRole('heading', { level: 1 })
const sectionHeadings = () =>
  screen
    .queryAllByRole('heading', { level: 2 })
    .map(h => h.textContent)
    .filter(text => !text?.endsWith('headline'))
const headAttr = (selector: string, attr: string) => Array.from(document.head.querySelectorAll(selector)).map(el => el.getAttribute(attr))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockApi.homepage.mockResolvedValue(HOMEPAGE)
  mockApi.newsletterArchive.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })
})

describe('UpliftingPage', () => {
  it('arrives in the edition over a stored balanced mix: one h1, visually hidden, the hero headline under it, uplifting sections only', async () => {
    localStorage.setItem('ar-positivity', '50')
    renderPage()

    expect(await screen.findByRole('heading', { level: 2, name: 'up-1 headline' })).toBeInTheDocument()
    expect(h1s()).toHaveLength(1)
    expect(h1s()[0]).toHaveTextContent(BRAND.upliftingEdition)
    // No intro above the feed: the page looks like the homepage in the edition
    expect(h1s()[0]).toHaveClass('sr-only')
    expect(sectionHeadings()).toEqual(['Human Development', 'Existential Threats'])
  })

  it('keeps the hidden h1 as the only h1 while the stories load', () => {
    mockApi.homepage.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(h1s()).toHaveLength(1)
    expect(h1s()[0]).toHaveTextContent(BRAND.upliftingEdition)
  })

  it("gives the page its own head: its own canonical, og:url and title, not the homepage's", async () => {
    renderPage()

    await waitFor(() => expect(headAttr('meta[property="og:url"]', 'content')).toEqual([PAGE_URL]))
    expect(headAttr('link[rel="canonical"]', 'href')).toEqual([PAGE_URL])
    expect(document.title).not.toBe(SEO.defaultTitle)
    expect(headAttr('meta[property="og:title"]', 'content')).toEqual([document.title])
  })

  it('drops the hidden h1 when the dial leaves Only uplifting on the page, so the balanced hero is the one h1', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'up-1 headline' })

    fireEvent.change(screen.getByRole('slider', { name: 'Mix of news, from heavy to uplifting' }), { target: { value: '50' } })

    expect(h1s()).toHaveLength(1)
    expect(h1s()[0]).toHaveTextContent('calm-1 headline')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/uplifting\?mix=balanced$/)
  })

  it('has no a11y violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 2, name: 'up-1 headline' })

    expect(await axe(container)).toHaveNoViolations()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicStory } from '@shared/types'
import { makeStory, announcedText } from '../test/stories'
import { focusRingProblems } from '../test/classes'

const mockApi = vi.hoisted(() => ({ homepage: vi.fn(), newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

vi.mock('../components/SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe: vi.fn() }),
}))

import { PositivityProvider } from '../contexts/PositivityContext'
import HomePage from './HomePage'

const ISSUES = [
  { id: 'i1', name: 'Human Development', slug: 'human-development' },
  { id: 'i2', name: 'Planet & Climate', slug: 'planet-climate' },
  { id: 'i3', name: 'Existential Threats', slug: 'existential-threats' },
  { id: 'i4', name: 'Science & Technology', slug: 'science-technology' },
]
type Buckets = { uplifting: PublicStory[]; calm: PublicStory[]; negative: PublicStory[] }
const none: Buckets = { uplifting: [], calm: [], negative: [] }

function story(id: string, day: number, emotionTag: PublicStory['emotionTag']): PublicStory {
  return makeStory({ id, slug: id, title: `${id} headline`, titleLabel: `${id} label`, emotionTag, datePublished: `2026-09-${day}T00:00:00Z` })
}

function homepage(byIssue: Record<string, Partial<Buckets>>) {
  return {
    issues: ISSUES,
    storiesByIssue: Object.fromEntries(ISSUES.map(issue => [issue.slug, { ...none, ...byIssue[issue.slug] }])),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderHome(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <QueryClientProvider client={client}>
          <PositivityProvider>
            <HomePage />
            <LocationProbe />
          </PositivityProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const NOTE = 'This mix of news has no stories right now. Show the balanced mix'
const EMPTY = 'No stories published yet. Check back soon.'
const SUPPORT = 'Free. Independent. No ads.'
const NEWSLETTER = 'Don’t miss what’s actually relevant.'
const sectionHeadings = () => screen.queryAllByRole('heading', { level: 2 }).map(h => h.textContent)
const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

/** Stories in every issue, none of them uplifting */
const NO_UPLIFTING = homepage({
  'human-development': { calm: [story('calm-1', 22, 'calm'), story('calm-2', 21, 'calm')] },
  'planet-climate': { negative: [story('heavy-1', 20, 'frustrating')] },
  'existential-threats': { negative: [story('heavy-2', 19, 'scary')] },
  'science-technology': { calm: [story('calm-3', 18, 'calm')] },
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockApi.newsletterArchive.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })
})

describe('HomePage when the mix leaves it with no stories', () => {
  it('says so in a short note with one link to the balanced mix, and shows nothing else', async () => {
    mockApi.homepage.mockResolvedValue(NO_UPLIFTING)
    renderHome('/?mix=uplifting')

    const note = await screen.findByRole('status')
    expect(announcedText(note)).toBe(NOTE)
    const link = within(note).getByRole('link', { name: 'Show the balanced mix' })
    expect(link).toHaveAttribute('href', '/?mix=balanced')
    expect(link).toHaveClass('underline')
    expect(focusRingProblems(link)).toEqual([])

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(sectionHeadings()).toEqual([])
    expect(screen.queryByTestId('latest-issue-slot')).toBeNull()
    expect(screen.queryByText(SUPPORT)).toBeNull()
    expect(screen.queryByText(NEWSLETTER)).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('shows the balanced mix in place when the link is followed', async () => {
    mockApi.homepage.mockResolvedValue(NO_UPLIFTING)
    renderHome('/?mix=uplifting')

    await userEvent.click(await screen.findByRole('link', { name: 'Show the balanced mix' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'calm-1 headline' })).toBeInTheDocument()
    expect(sectionHeadings()).toEqual(['Human Development', 'Planet & Climate', 'Existential Threats', 'Science & Technology'])
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/\?mix=balanced$/)
    expect(localStorage.getItem('ar-positivity')).toBe('50')
    expect(mockApi.homepage).toHaveBeenCalledTimes(1)
  })

  it('keeps the other parameters of the address in the link', async () => {
    mockApi.homepage.mockResolvedValue(NO_UPLIFTING)
    renderHome('/?ref=feed&mix=uplifting')

    expect(await screen.findByRole('link', { name: 'Show the balanced mix' })).toHaveAttribute('href', '/?ref=feed&mix=balanced')
  })

  it('also shows the note when the mix comes from the stored preference, not the address', async () => {
    localStorage.setItem('ar-positivity', '100')
    mockApi.homepage.mockResolvedValue(NO_UPLIFTING)
    renderHome('/')

    expect(announcedText(await screen.findByRole('status'))).toBe(NOTE)
  })

  it('says no stories are published, not that the mix has none, when the API answered with none', async () => {
    mockApi.homepage.mockResolvedValue(homepage({}))
    renderHome('/?mix=uplifting')

    expect(await screen.findByText(EMPTY)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Show the balanced mix' })).toBeNull()
  })
})

describe('HomePage when the mix leaves some sections with no stories', () => {
  it('shows only the sections with stories, and lays out and places its banners by those', async () => {
    mockApi.homepage.mockResolvedValue(
      homepage({
        'human-development': { calm: [story('calm-1', 30, 'calm')] },
        'planet-climate': { uplifting: [story('up-1', 29, 'uplifting'), story('up-2', 28, 'uplifting')] },
        'existential-threats': { uplifting: [story('up-3', 27, 'uplifting')] },
        'science-technology': { uplifting: [story('up-4', 26, 'uplifting')] },
      }),
    )
    renderHome('/?mix=uplifting')

    expect(await screen.findByRole('heading', { level: 1, name: 'up-1 headline' })).toBeInTheDocument()
    expect(sectionHeadings()).toEqual(['Planet & Climate', 'Existential Threats', 'Science & Technology'])
    expect(screen.queryByRole('status')).toBeNull()

    // The first section shown sits under the newsletter card's slot, which takes its top margin
    const slot = screen.getByTestId('latest-issue-slot')
    expect(precedes(slot, section('Planet & Climate'))).toBe(true)
    expect(section('Planet & Climate')).not.toHaveClass('mt-14')
    expect(section('Existential Threats')).toHaveClass('mt-14')

    // The support banner follows the second section shown, the newsletter banner the third
    const support = screen.getByText(SUPPORT)
    const newsletter = screen.getByText(NEWSLETTER)
    expect(precedes(section('Existential Threats'), support)).toBe(true)
    expect(precedes(support, section('Science & Technology'))).toBe(true)
    expect(precedes(section('Science & Technology'), newsletter)).toBe(true)
  })

  it('ends with the last section shown, with no pull quote after it', async () => {
    mockApi.homepage.mockResolvedValue(
      homepage({
        'human-development': { uplifting: [story('up-1', 30, 'uplifting'), story('up-2', 29, 'uplifting')] },
        'planet-climate': { uplifting: [story('up-3', 28, 'uplifting')] },
        'existential-threats': { uplifting: [story('up-4', 27, 'uplifting')] },
        'science-technology': { calm: [story('calm-1', 26, 'calm')] },
      }),
    )
    const { container } = renderHome('/?mix=uplifting')

    await screen.findByRole('heading', { level: 1, name: 'up-1 headline' })
    expect(sectionHeadings()).toEqual(['Human Development', 'Planet & Climate', 'Existential Threats'])
    // One pull quote, after the first section; none below the last one shown
    const pullQuotes = container.querySelectorAll('footer')
    expect(pullQuotes).toHaveLength(1)
    expect(precedes(section('Human Development'), pullQuotes[0]!)).toBe(true)
    expect(precedes(pullQuotes[0]!, section('Planet & Climate'))).toBe(true)
  })

  it('shows the one story a mix has as the hero, and says nothing about the rest', async () => {
    mockApi.homepage.mockResolvedValue(
      homepage({
        'human-development': { uplifting: [story('up-1', 30, 'uplifting')] },
        'planet-climate': { calm: [story('calm-1', 29, 'calm')] },
      }),
    )
    renderHome('/?mix=uplifting')

    expect(await screen.findByRole('heading', { level: 1, name: 'up-1 headline' })).toBeInTheDocument()
    expect(sectionHeadings()).toEqual([])
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
  })
})

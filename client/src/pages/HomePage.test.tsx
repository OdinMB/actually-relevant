import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PaginatedResponse, PublicNewsletterIssueSummary } from '@shared/types'
import HomePage from './HomePage'
import { makeStory, announcedText } from '../test/stories'
import { focusRingProblems } from '../test/classes'

const mockApi = vi.hoisted(() => ({ newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

const hero = makeStory({
  id: 'hero',
  slug: 'hero',
  title: 'Hero headline',
  titleLabel: 'Hero label',
  quote: 'Words from the hero story.',
  quoteAttribution: 'Dr. Hero',
  datePublished: '2026-09-22T00:00:00Z',
  issue: { id: 'i1', name: 'Human Development', slug: 'human-development' },
})
const card = makeStory({
  id: 'card',
  slug: 'card',
  title: 'Card headline',
  titleLabel: 'Card label',
  datePublished: '2026-09-21T00:00:00Z',
  issue: { id: 'i1', name: 'Human Development', slug: 'human-development' },
})
const other = makeStory({ id: 'other', slug: 'other', title: 'Other headline', titleLabel: 'Other label' })

vi.mock('../hooks/useHomepageData', () => ({
  useHomepageData: () => ({
    isLoading: false,
    data: {
      issues: [
        { id: 'i1', name: 'Human Development', slug: 'human-development' },
        { id: 'i2', name: 'Planet & Climate', slug: 'planet-climate' },
      ],
      storiesByIssue: {
        'human-development': { uplifting: [], calm: [hero, card], negative: [] },
        'planet-climate': { uplifting: [], calm: [other], negative: [] },
      },
    },
  }),
}))

vi.mock('../components/SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe: vi.fn() }),
}))

const NOW = new Date('2026-10-25T09:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

function archive(...issues: { slug: string; title: string; daysAgo: number; storyCount: number }[]): PaginatedResponse<PublicNewsletterIssueSummary> {
  return {
    data: issues.map(({ daysAgo, ...rest }) => ({ ...rest, publishedAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString() })),
    total: issues.length,
    page: 1,
    pageSize: 20,
    totalPages: issues.length > 0 ? 1 : 0,
  }
}

let queryClient: QueryClient

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockApi.newsletterArchive.mockReset().mockResolvedValue(archive())
})

afterEach(() => {
  vi.useRealTimers()
})

function renderHome() {
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  )
}

/** Waits until the archive request has answered or failed. */
async function archiveSettled() {
  await waitFor(() => expect(['success', 'error']).toContain(queryClient.getQueryState(['public-newsletter-archive', 1])?.status))
}

describe('HomePage newsletter card', () => {
  const newsletterLinks = () => screen.queryAllByRole('link').filter(link => link.getAttribute('href')?.startsWith('/newsletter'))

  it("leads to the latest issue's web edition in one link, named by its visible text", async () => {
    mockApi.newsletterArchive.mockResolvedValue(
      archive(
        { slug: 'week-43-2026', title: 'Week 43, 2026', daysAgo: 1, storyCount: 6 },
        { slug: 'week-42-2026', title: 'Week 42, 2026', daysAgo: 8, storyCount: 5 },
      ),
    )
    renderHome()

    const card = await screen.findByRole('link', { name: 'This week’s newsletter Week 43, 2026 · 6 stories' })
    expect(card).toHaveAttribute('href', '/newsletter/week-43-2026')
    expect(newsletterLinks()).toEqual([card])
    expect(focusRingProblems(card)).toEqual([])
  })

  it('calls an issue a week old or older the latest, not this week’s', async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive({ slug: 'week-40-2026', title: 'Week 40, 2026', daysAgo: 20, storyCount: 1 }))
    renderHome()

    expect(await screen.findByRole('link', { name: 'Latest newsletter Week 40, 2026 · 1 story' })).toHaveAttribute('href', '/newsletter/week-40-2026')
  })

  it.each([
    ['no issue is published', () => mockApi.newsletterArchive.mockResolvedValue(archive())],
    ['the archive fails to load', () => mockApi.newsletterArchive.mockRejectedValue(new Error('Network error'))],
  ])('is not shown when %s, and says nothing about it', async (_, arrange) => {
    arrange()
    renderHome()
    await archiveSettled()

    expect(newsletterLinks()).toEqual([])
    expect(screen.queryByText(/newsletter Week/)).toBeNull()
    expect(screen.getByTestId('latest-issue-slot')).toBeEmptyDOMElement()
  })

  it('arrives into a place kept for it above the first section, so it moves nothing already shown', async () => {
    let answer!: (value: PaginatedResponse<PublicNewsletterIssueSummary>) => void
    mockApi.newsletterArchive.mockReturnValue(new Promise(resolve => (answer = resolve)))
    renderHome()

    const slot = screen.getByTestId('latest-issue-slot')
    const firstSection = screen.getByRole('heading', { level: 2, name: 'Human Development' }).closest('section')!
    expect(slot).toBeEmptyDOMElement()
    expect(slot.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await act(async () => answer(archive({ slug: 'week-43-2026', title: 'Week 43, 2026', daysAgo: 1, storyCount: 6 })))

    const card = await screen.findByRole('link', { name: /^This week’s newsletter/ })
    expect(screen.getByTestId('latest-issue-slot')).toBe(slot)
    expect(slot).toContainElement(card)
    // The slot takes the place of the first section's top margin (jsdom can't measure, so the classes stand in)
    expect(slot).toHaveClass('min-h-20', 'md:min-h-28')
    expect(firstSection).not.toHaveClass('mt-14')
  })
})

describe('HomePage AI disclosure', () => {
  it('shows the "AI" badge next to the hero title label, above the headline', () => {
    const { container } = renderHome()
    const heroSection = container.querySelector<HTMLElement>('.hero-section')!
    const row = within(heroSection).getByText('Hero label').parentElement!
    expect(announcedText(row)).toBe('AI-generated Hero label')
    const headline = within(heroSection).getByRole('heading', { level: 1, name: 'Hero headline' })
    expect(row.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('follows the hero quote attribution with the AI selection note', () => {
    const { container } = renderHome()
    const heroSection = container.querySelector<HTMLElement>('.hero-section')!
    expect(within(heroSection).getByText('— Dr. Hero · selected and potentially translated by AI')).toBeInTheDocument()
  })

  it('badges every story card link', () => {
    renderHome()
    expect(screen.getByRole('link', { name: 'AI-generated Card label Card headline' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI-generated Other label Other headline' })).toBeInTheDocument()
  })

  it('shows the pull quote with the "Selected by AI" badge and the note', () => {
    const { container } = renderHome()
    const footer = container.querySelector('footer')!
    expect(announcedText(footer)).toMatch(/^Selected by AI — .+ · selected and potentially translated by AI$/)
  })
})

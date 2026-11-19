import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicOverview, PublicOverviewEntry } from '@shared/types'
import { ApiError } from '../lib/api'
import { inPrerenderer } from '../test/prerenderer'
import { announcedText } from '../test/stories'

const mockApi = vi.hoisted(() => ({ overviews: { get: vi.fn(), list: vi.fn() } }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

const openFeedback = vi.hoisted(() => vi.fn())
vi.mock('../components/FeedbackProvider', () => ({ useFeedback: () => ({ openFeedback }) }))

import OverviewPage from './OverviewPage'

const metaContent = (selector: string) => document.head.querySelector(selector)?.getAttribute('content')

const entry = (slug: string, date: string, overrides: Partial<PublicOverviewEntry> = {}): PublicOverviewEntry => ({
  slug,
  title: `Headline ${slug}`,
  titleLabel: 'Ebola',
  datePublished: `${date}T08:00:00.000Z`,
  role: 'routine',
  roleKind: null,
  updates: [],
  ...overrides,
})

const OVERVIEW: PublicOverview = {
  id: 'overview-1',
  slug: 'ebola-in-ituri',
  title: 'Ebola in Ituri',
  area: { name: 'Human Development', slug: 'human-development' },
  status: 'open',
  closedReason: null,
  closedAt: null,
  since: '2026-10-01T08:00:00.000Z',
  lastEntryAt: '2026-11-10T08:00:00.000Z',
  lastChange: '2026-11-12T09:00:00.000Z',
  stories: 5,
  stands: {
    asOf: '2026-11-12',
    writtenAt: '2026-11-12T09:00:00.000Z',
    sentences: [{ text: 'Cases fell for three weeks.', citations: [{ sourceId: 'S1', sentence: 'Cases fell again.' }] }],
    doing: [{ text: 'Vaccination goes on.', citations: [{ sourceId: 'S2', sentence: 'Teams vaccinated 4,000.' }] }],
  },
  sources: [
    {
      id: 'S1',
      origin: 'source',
      outlet: 'Nation',
      host: 'nation.example',
      url: 'https://nation.example/a',
      title: 'Cases fall',
      date: '2026-11-11',
      country: 'Kenya',
      kind: 'news-report',
      storyId: null,
      slug: null,
      via: { slug: 'e', title: 'Headline e' },
    },
    {
      id: 'S2',
      origin: 'source',
      outlet: 'WHO',
      host: 'who.example',
      url: 'https://who.example/b',
      title: 'Vaccination update',
      date: '2026-11-09',
      country: null,
      kind: 'official-body',
      storyId: null,
      slug: null,
      via: { slug: 'd', title: 'Headline d' },
    },
  ],
  entries: [
    entry('e', '2026-11-10', { updates: [{ date: '2026-11-12', note: 'A newer count.' }] }),
    entry('d', '2026-11-03', { role: 'turning_point', roleKind: 'response' }),
    entry('c', '2026-10-20'),
    entry('b', '2026-10-12'),
    entry('a', '2026-10-02'),
  ],
  aiGenerated: { fields: ['title', 'stands', 'entries'], models: ['gpt-6.1-sol'], digitalSourceType: 'x' },
}

function renderPage(slug = 'ebola-in-ituri') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/ongoing/${slug}`]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/ongoing/:slug" element={<OverviewPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.overviews.get.mockResolvedValue(OVERVIEW)
})

describe('OverviewPage', () => {
  it('opens with where it stands in time, the area, the AI title, the count and the AI label', async () => {
    renderPage()
    const title = await screen.findByRole('heading', { level: 1, name: 'Ebola in Ituri' })
    expect(title).toHaveAttribute('data-ai-generated', 'title')
    expect(screen.getByText('Ongoing story · since October 2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Human Development' })).toHaveAttribute('href', '/issues/human-development')
    expect(screen.getByText('5 stories · last change Nov 12, 2026')).toBeInTheDocument()
    // The owner's label, its "AI" badge between "by" and the comma, announced as the word
    const label = screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.startsWith('Summary and timeline by') === true)
    expect(announcedText(label)).toBe('Summary and timeline by AI, from our stories and their sources.')
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/methodology')
  })

  it('shows "Where this stands" and "What\'s being done" cited, each source naming the story of ours it came through', async () => {
    renderPage()
    const stands = (await screen.findByRole('heading', { level: 2, name: 'Where this stands' })).closest('section')!
    expect(stands).toHaveAttribute('data-ai-generated', 'stands')
    expect(within(stands).getByText('Cases fell for three weeks.')).toBeInTheDocument()
    expect(within(stands).getByText('Vaccination goes on.').parentElement).toHaveTextContent(/^What's being done:/)
    expect(within(stands).getByRole('button', { name: 'Source: Nation' })).toBeInTheDocument()

    const list = screen.getByRole('heading', { level: 2, name: 'Sources' }).closest('section')!
    expect(list).toHaveAttribute('data-ai-generated', 'stands')
    expect(within(list).getByRole('link', { name: 'Headline e' })).toHaveAttribute('href', '/stories/e')
    expect(within(list).getAllByText('via our story', { exact: false })).toHaveLength(2)
  })

  it('leaves out "What\'s being done" when nothing sourced exists, and the whole block when no stands is served', async () => {
    mockApi.overviews.get.mockResolvedValue({ ...OVERVIEW, stands: { ...OVERVIEW.stands!, doing: [] } })
    const { unmount } = renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Where this stands' })
    expect(screen.queryByText(/What's being done/)).toBeNull()
    unmount()

    mockApi.overviews.get.mockResolvedValue({ ...OVERVIEW, stands: null, sources: [], aiGenerated: { ...OVERVIEW.aiGenerated, fields: ['title', 'entries'] } })
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Timeline' })
    expect(screen.queryByRole('heading', { name: 'Where this stands' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull()
  })

  it('lists the timeline by month, the turning point with its kind, an Update under its story, and the routine stories folded', async () => {
    const user = userEvent.setup()
    renderPage()
    const timeline = (await screen.findByRole('heading', { level: 2, name: 'Timeline' })).closest('section')!
    expect(timeline).toHaveAttribute('data-ai-generated', 'entries')
    expect(
      within(timeline)
        .getAllByRole('heading', { level: 3 })
        .map(h => h.textContent),
    ).toEqual(['November 2026', 'October 2026'])
    expect(within(timeline).getByText('Turning point · response')).toBeInTheDocument()
    expect(within(timeline).getByText('A newer count.').parentElement).toHaveTextContent('Updated Nov 12: A newer count.')
    // Each story links its page, its AI label behind the badge
    expect(within(timeline).getByRole('link', { name: 'AI-generated Ebola Headline d' })).toHaveAttribute('href', '/stories/d')

    // October has no turning point: its newest story shows, the other two fold
    expect(within(timeline).queryByRole('link', { name: /Headline b/ })).toBeNull()
    const fold = within(timeline).getByRole('button', { name: '+ 2 stories' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    await user.click(fold)
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    expect(within(timeline).getByRole('link', { name: /Headline b/ })).toBeInTheDocument()
    expect(within(timeline).getByRole('link', { name: /Headline a/ })).toBeInTheDocument()
  })

  it('narrows the timeline to its turning points', async () => {
    const user = userEvent.setup()
    renderPage()
    const all = await screen.findByRole('button', { name: 'All' })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Turning points' }))
    expect(screen.getByRole('button', { name: 'Turning points' })).toHaveAttribute('aria-pressed', 'true')
    const timeline = screen.getByRole('heading', { level: 2, name: 'Timeline' }).closest('section')!
    expect(
      within(timeline)
        .getAllByRole('heading', { level: 3 })
        .map(h => h.textContent),
    ).toEqual(['November 2026'])
    expect(
      within(timeline)
        .getAllByRole('link')
        .map(l => l.getAttribute('href')),
    ).toEqual(['/stories/d'])
  })

  it('reports an error about the ongoing story itself, naming the overview', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Report an error' }))
    expect(openFeedback).toHaveBeenCalledWith({ id: 'overview-1', title: 'Ebola in Ituri', kind: 'overview' })
  })

  it("sets the head tags the server's link preview writes, with the ongoing-story image and its JSON-LD", async () => {
    renderPage()
    await waitFor(() =>
      expect(metaContent('meta[name="description"]')).toBe(
        '5 stories since October 2026, followed as one ongoing story. Summary and timeline by AI, from our stories and their sources.',
      ),
    )
    expect(document.title).toBe('Ebola in Ituri: ongoing story - Actually Relevant')
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://actuallyrelevant.news/ongoing/ebola-in-ituri')
    expect(metaContent('meta[property="og:type"]')).toBe('website')
    expect(metaContent('meta[property="og:image"]')).toBe('/api/section-images/ongoing.png')
    const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => JSON.parse(s.textContent ?? '{}'))
    expect(ld.find(d => d['@type'] === 'CollectionPage')).toMatchObject({
      name: 'Ebola in Ituri',
      dateModified: '2026-11-12T09:00:00.000Z',
      mainEntity: { '@type': 'ItemList', numberOfItems: 5 },
    })
  })

  it('says the ongoing story was not found, with noindex, also in the prerenderer, while overviews are off or it is not public', async () => {
    await inPrerenderer(async () => {
      mockApi.overviews.get.mockRejectedValue(new ApiError(404, 'Ongoing story not found'))
      renderPage('gone')
      expect(await screen.findByRole('heading', { level: 1, name: 'Ongoing Story Not Found' })).toBeInTheDocument()
      await waitFor(() => expect(metaContent('meta[name="robots"]')).toBe('noindex'))
    })
  })

  it('has no a11y violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(await axe(container)).toHaveNoViolations()
  })
})

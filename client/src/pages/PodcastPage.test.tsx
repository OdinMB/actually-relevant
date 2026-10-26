import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicPodcastResponse } from '@shared/types'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { APPLE_PODCASTS_URL } from '../config'
import { PODCAST_SUBSCRIBE_PATH } from '../lib/podcast'

const mockApi = vi.hoisted(() => ({ podcast: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

const openSubscribe = vi.hoisted(() => vi.fn())
vi.mock('../components/SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe }),
}))

import PodcastPage, { PODCAST_FEED_URL } from './PodcastPage'

const AUDIO_URL = 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.mp3'
const POCKET_CASTS_URL = 'https://pca.st/example'

const RESPONSE: PublicPodcastResponse = {
  show: {
    title: 'Actually Relevant',
    description: 'A weekly briefing. Written and voiced by AI.',
    feedUrl: 'https://actuallyrelevant.news/podcast.xml',
    artworkUrl: 'https://audio.actuallyrelevant.news/show/artwork-2026-10.jpg',
    listenLinks: [
      { name: 'Apple Podcasts', url: APPLE_PODCASTS_URL },
      { name: 'Pocket Casts', url: POCKET_CASTS_URL },
    ],
  },
  episodes: [
    {
      id: 'podcast-1',
      title: 'W42: Clean air',
      aiLine: 'AI-generated: Everything in this episode was written and voiced by AI.',
      summary: 'Two stories.',
      publishedAt: '2026-10-12T07:30:00.000Z',
      durationSec: 372,
      audioUrl: AUDIO_URL,
      audioBytes: 123,
      transcriptUrl: null,
      stories: [
        { title: 'Air data ruling', publisher: 'Nation', sourceUrl: 'https://news.example/1', slug: 'air' },
        { title: 'Vaccine rollout', publisher: 'Phys.org', sourceUrl: 'https://news.example/2', slug: null },
      ],
      aiGenerated: { fields: ['title', 'summary', 'audioUrl', 'transcriptUrl'], digitalSourceType: 'x' },
    },
  ],
}

function renderPage(path = '/podcast') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={client}>
          <PodcastPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.podcast.mockResolvedValue(RESPONSE)
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

async function expandStories() {
  const toggle = await screen.findByRole('button', { name: /Stories \(2\)/ })
  fireEvent.click(toggle)
  return toggle
}

/** jsdom has no Clipboard API; the copy button only needs `writeText`. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

function subscribeSection() {
  return screen.getByRole('region', { name: 'Subscribe' })
}

describe('PodcastPage', () => {
  it('shows the AI subtitle before any episode', async () => {
    renderPage()
    const subtitle = screen.getByText(AI_DISCLOSURE_COPY.podcastSubtitle.lead, { exact: false })
    const episode = await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(subtitle.compareDocumentPosition(episode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says "AI" in the subtitle once, through the inline badge', () => {
    renderPage()
    const subtitle = screen.getByText(AI_DISCLOSURE_COPY.podcastSubtitle.lead, { exact: false })
    const { lead, tail } = AI_DISCLOSURE_COPY.podcastSubtitle
    expect(`${lead} ${tail}`).not.toMatch(/\bAI\b/)
    expect(subtitle.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
  })

  it('does not repeat the per-episode AI line on the page', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(screen.queryByText(RESPONSE.episodes[0]!.aiLine)).toBeNull()
  })

  it('collapses each episode story list until its toggle is pressed', async () => {
    renderPage()
    const toggle = await screen.findByRole('button', { name: /Stories \(2\)/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(list).not.toBeNull()
    expect(list?.hidden).toBe(true)
    expect(screen.queryByRole('link', { name: 'Air data ruling' })).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(list?.hidden).toBe(false)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(list?.hidden).toBe(true)
  })

  it('links the episode transcript page beside the stories toggle', async () => {
    renderPage()
    const toggle = await screen.findByRole('button', { name: /Stories \(2\)/ })
    const transcript = screen.getByRole('link', { name: /Transcript/ })
    expect(transcript.getAttribute('href')).toBe('/podcast/podcast-1/transcript')
    expect(toggle.closest('[data-episode-actions]')).toBe(transcript.closest('[data-episode-actions]'))
  })

  it('has no stories toggle for an episode without stories, but still its transcript link', async () => {
    mockApi.podcast.mockResolvedValue({ ...RESPONSE, episodes: [{ ...RESPONSE.episodes[0], stories: [] }] })
    renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(screen.queryByRole('button', { name: /Stories/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Transcript/ }).getAttribute('href')).toBe('/podcast/podcast-1/transcript')
  })

  it('streams each episode from the CDN without preloading', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    const audio = container.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe(AUDIO_URL)
    expect(audio?.getAttribute('preload')).toBe('none')
  })

  it('shows each configured app once, in its order, in the Subscribe row and not under Episodes', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    const apple = screen.getAllByRole('link', { name: /Apple Podcasts/ })
    const pocketCasts = screen.getAllByRole('link', { name: /Pocket Casts/ })
    expect(apple).toHaveLength(1)
    expect(pocketCasts).toHaveLength(1)
    expect(apple[0]).toHaveAccessibleName('Listen on Apple Podcasts (opens in new tab)')
    expect(apple[0]?.getAttribute('href')).toBe(APPLE_PODCASTS_URL)
    expect(pocketCasts[0]).toHaveAccessibleName('Listen on Pocket Casts (opens in new tab)')
    expect(pocketCasts[0]?.getAttribute('href')).toBe(POCKET_CASTS_URL)
    expect(pocketCasts[0]?.getAttribute('target')).toBe('_blank')
    expect(subscribeSection()).toContainElement(apple[0] ?? null)
    expect(subscribeSection()).toContainElement(pocketCasts[0] ?? null)
    expect(apple[0]!.compareDocumentPosition(pocketCasts[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const copy = within(subscribeSection()).getByRole('button', { name: 'Copy RSS feed' })
    expect(pocketCasts[0]!.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('links Apple Podcasts with its badge before the show data loads, and keeps it if loading fails', async () => {
    mockApi.podcast.mockRejectedValue(new Error('down'))
    renderPage()
    const apple = within(subscribeSection()).getByRole('link', { name: 'Listen on Apple Podcasts (opens in new tab)' })
    expect(apple.getAttribute('href')).toBe(APPLE_PODCASTS_URL)
    await screen.findByText('The episodes could not be loaded. Please try again later.')
    expect(within(subscribeSection()).getByRole('link', { name: /Listen on Apple Podcasts/ })).toBeInTheDocument()
  })

  it('shows the feed address as text to select, not as a link to the XML', () => {
    renderPage()
    expect(within(subscribeSection()).getByText(PODCAST_FEED_URL)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: PODCAST_FEED_URL })).toBeNull()
  })

  it('copies the feed address and announces "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    renderPage()
    // The live region is in the page before the copy, so its change is announced
    const status = within(subscribeSection()).getByRole('status')
    expect(status.textContent).toBe('')
    fireEvent.click(within(subscribeSection()).getByRole('button', { name: 'Copy RSS feed' }))
    expect(writeText).toHaveBeenCalledWith(PODCAST_FEED_URL)
    await waitFor(() => expect(status.textContent).toBe('Copied'))
  })

  it('points to the address when the browser does not allow the copy', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    renderPage()
    const status = within(subscribeSection()).getByRole('status')
    fireEvent.click(within(subscribeSection()).getByRole('button', { name: 'Copy RSS feed' }))
    await waitFor(() => expect(status.textContent).toMatch(/select the address/i))
  })

  it('points to the address when the browser has no clipboard access', async () => {
    renderPage()
    const status = within(subscribeSection()).getByRole('status')
    fireEvent.click(within(subscribeSection()).getByRole('button', { name: 'Copy RSS feed' }))
    await waitFor(() => expect(status.textContent).toMatch(/select the address/i))
  })

  it('links our analysis only for stories that have a page', async () => {
    renderPage()
    await expandStories()
    expect(screen.getByRole('link', { name: 'Air data ruling' }).getAttribute('href')).toBe('/stories/air')
    expect(screen.queryByRole('link', { name: 'Vaccine rollout' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'source' })).toHaveLength(2)
  })

  it('offers the newsletter after the episodes', async () => {
    renderPage()
    const episode = await screen.findByRole('heading', { name: /W42: Clean air/ })
    const subscribe = screen.getByRole('button', { name: 'Get the weekly newsletter' })
    expect(episode.compareDocumentPosition(subscribe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'read past issues' }).getAttribute('href')).toBe('/newsletter')

    fireEvent.click(subscribe)
    expect(openSubscribe).toHaveBeenCalledTimes(1)
  })

  describe('arriving through a link to the Subscribe section', () => {
    const original = Element.prototype.scrollIntoView
    const scrolledTo: Element[] = []
    beforeEach(() => {
      scrolledTo.length = 0
      // jsdom has no scrollIntoView
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolledTo.push(this)
      }
    })
    afterEach(() => {
      Element.prototype.scrollIntoView = original
    })

    it('scrolls to the Subscribe heading', () => {
      renderPage(PODCAST_SUBSCRIBE_PATH)
      expect(scrolledTo).toEqual([screen.getByRole('heading', { level: 2, name: 'Subscribe' })])
    })

    it('does not scroll without a hash', () => {
      renderPage()
      expect(scrolledTo).toEqual([])
    })
  })

  it('has no a11y violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(await axe(container)).toHaveNoViolations()
    await expandStories()
    expect(await axe(container)).toHaveNoViolations()
  })
})

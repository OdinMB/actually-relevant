import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicPodcastResponse } from '@shared/types'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'

const mockApi = vi.hoisted(() => ({ podcast: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import PodcastPage, { PODCAST_FEED_URL } from './PodcastPage'

const AUDIO_URL = 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.mp3'

const RESPONSE: PublicPodcastResponse = {
  show: {
    title: 'Actually Relevant',
    description: 'A weekly briefing. Written and voiced by AI.',
    feedUrl: 'https://actuallyrelevant.news/podcast.xml',
    artworkUrl: 'https://audio.actuallyrelevant.news/show/artwork-2026-10.jpg',
    listenLinks: [{ name: 'Apple Podcasts', url: 'https://podcasts.apple.com/x' }],
  },
  episodes: [{
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
  }],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter>
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

async function expandStories() {
  const toggle = await screen.findByRole('button', { name: /Stories \(2\)/ })
  fireEvent.click(toggle)
  return toggle
}

describe('PodcastPage', () => {
  it('shows the AI subtitle before any episode', async () => {
    renderPage()
    const subtitle = screen.getByText(AI_DISCLOSURE_COPY.podcastSubtitle)
    const episode = await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(subtitle.compareDocumentPosition(episode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not repeat the per-episode AI line on the page', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(screen.queryByText(RESPONSE.episodes[0].aiLine)).toBeNull()
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

  it('shows the transcript link beside the stories toggle only when the episode has one', async () => {
    mockApi.podcast.mockResolvedValue({
      ...RESPONSE,
      episodes: [{ ...RESPONSE.episodes[0], transcriptUrl: 'https://audio.actuallyrelevant.news/episodes/x.vtt' }],
    })
    renderPage()
    const toggle = await screen.findByRole('button', { name: /Stories \(2\)/ })
    const transcript = screen.getByRole('link', { name: /Transcript/ })
    expect(transcript.getAttribute('href')).toBe('https://audio.actuallyrelevant.news/episodes/x.vtt')
    expect(toggle.closest('[data-episode-actions]')).toBe(transcript.closest('[data-episode-actions]'))
  })

  it('has no stories toggle for an episode without stories', async () => {
    mockApi.podcast.mockResolvedValue({ ...RESPONSE, episodes: [{ ...RESPONSE.episodes[0], stories: [] }] })
    renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(screen.queryByRole('button', { name: /Stories/ })).toBeNull()
  })

  it('streams each episode from the CDN without preloading, and links the feed', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    const audio = container.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe(AUDIO_URL)
    expect(audio?.getAttribute('preload')).toBe('none')
    expect(screen.getByRole('link', { name: PODCAST_FEED_URL }).getAttribute('href')).toBe(PODCAST_FEED_URL)
  })

  it('links our analysis only for stories that have a page', async () => {
    renderPage()
    await expandStories()
    expect(screen.getByRole('link', { name: 'Air data ruling' }).getAttribute('href')).toBe('/stories/air')
    expect(screen.queryByRole('link', { name: 'Vaccine rollout' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'source' })).toHaveLength(2)
  })

  it('has no a11y violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { name: /W42: Clean air/ })
    expect(await axe(container)).toHaveNoViolations()
    await expandStories()
    expect(await axe(container)).toHaveNoViolations()
  })
})

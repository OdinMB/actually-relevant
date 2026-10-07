import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicPodcastEpisodeDetail } from '@shared/types'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { ApiError } from '../lib/api'

const mockApi = vi.hoisted(() => ({ podcastEpisode: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import PodcastTranscriptPage from './PodcastTranscriptPage'

const AUDIO_URL = 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.mp3'

const EPISODE: PublicPodcastEpisodeDetail = {
  id: 'podcast-1',
  title: 'W42: Clean air',
  aiLine: 'AI-generated: Everything in this episode was written and voiced by AI.',
  summary: 'Two stories.',
  publishedAt: '2026-10-12T07:30:00.000Z',
  durationSec: 372,
  audioUrl: AUDIO_URL,
  audioBytes: 123,
  transcriptUrl: 'https://audio.actuallyrelevant.news/episodes/x.vtt',
  stories: [
    { title: 'Air data ruling', publisher: 'Nation', sourceUrl: 'https://news.example/1', slug: 'air' },
    { title: 'Vaccine rollout', publisher: 'Phys.org', sourceUrl: 'https://news.example/2', slug: null },
  ],
  aiGenerated: { fields: ['title', 'summary', 'audioUrl', 'transcriptUrl', 'transcript'], digitalSourceType: 'x' },
  transcript: [
    { story: null, turns: [{ speaker: 'Host A', text: 'Everything you are about to hear was written by AI.' }] },
    { story: null, turns: [{ speaker: 'Host A', text: 'Welcome to the week.' }] },
    {
      story: { title: 'Air data ruling', publisher: 'Nation', sourceUrl: 'https://news.example/1', slug: 'air' },
      turns: [{ speaker: 'Host B', text: 'A court ruled on air data.' }, { speaker: 'Host A', text: 'It matters for millions.' }],
    },
    {
      story: { title: 'Vaccine rollout', publisher: 'Phys.org', sourceUrl: 'https://news.example/2', slug: null },
      turns: [{ speaker: 'Host A', text: 'Ten more countries.' }],
    },
    { story: null, turns: [{ speaker: 'Host A', text: 'Thanks for listening.' }] },
  ],
}

function renderPage(id = 'podcast-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/podcast/${id}/transcript`]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/podcast/:id/transcript" element={<PodcastTranscriptPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.podcastEpisode.mockResolvedValue(EPISODE)
})

describe('PodcastTranscriptPage', () => {
  it('loads the episode named in the URL', async () => {
    renderPage('podcast-1')
    await screen.findByRole('heading', { level: 1, name: /W42: Clean air/ })
    expect(mockApi.podcastEpisode).toHaveBeenCalledWith('podcast-1')
  })

  it('shows the AI subtitle before the transcript', async () => {
    renderPage()
    const firstTurn = await screen.findByText('Welcome to the week.')
    const subtitle = screen.getByText(AI_DISCLOSURE_COPY.podcastSubtitle)
    expect(subtitle.compareDocumentPosition(firstTurn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders one paragraph per turn, each under its host name', async () => {
    const { container } = renderPage()
    await screen.findByText('Welcome to the week.')
    const turns = container.querySelectorAll('[data-transcript-turn]')
    expect(turns).toHaveLength(6)
    expect(turns[2].textContent).toBe('Host B: A court ruled on air data.')
  })

  it('heads each story segment with the story, linked to our story page when it has one', async () => {
    renderPage()
    const air = await screen.findByRole('heading', { level: 3, name: 'Air data ruling' })
    expect(air.querySelector('a')?.getAttribute('href')).toBe('/stories/air')
    const vaccine = screen.getByRole('heading', { level: 3, name: 'Vaccine rollout' })
    expect(vaccine.querySelector('a')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2)
  })

  it('streams the episode from the CDN without preloading and links back to all episodes', async () => {
    const { container } = renderPage()
    await screen.findByText('Welcome to the week.')
    const audio = container.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe(AUDIO_URL)
    expect(audio?.getAttribute('preload')).toBe('none')
    expect(container.querySelector('a[href="/podcast"]')).not.toBeNull()
  })

  it('says the episode was not found when it is not published', async () => {
    mockApi.podcastEpisode.mockRejectedValue(new ApiError(404, 'Episode not found'))
    const { container } = renderPage('gone')
    await screen.findByRole('heading', { level: 1, name: /not found/i })
    expect(container.querySelector('audio')).toBeNull()
    expect(container.querySelector('a[href="/podcast"]')).not.toBeNull()
  })

  it('has no a11y violations', async () => {
    const { container } = renderPage()
    await screen.findByText('Welcome to the week.')
    expect(await axe(container)).toHaveNoViolations()
  })
})

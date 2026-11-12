import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import EmbedPage, { loadEmbedStories } from './EmbedPage'
import { makeStory, announcedText } from '../test/stories'
import { publicApi } from '../lib/api'
import type { PublicStory } from '@shared/types'

vi.mock('../lib/api', () => ({
  publicApi: {
    stories: {
      list: vi.fn(async () => ({ data: [makeStory()], total: 1, page: 1, pageSize: 3, totalPages: 1 })),
    },
  },
}))

function renderEmbed(query = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/embed${query}`]}>
        <EmbedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EmbedPage AI header', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver; the page only uses it to post its height to the parent
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  })

  it.each(['', '?theme=dark'])('labels the embedded headlines at the top, before the first story (%s)', async query => {
    renderEmbed(query)
    const headline = await screen.findByText('AI label: AI headline')
    const header = screen.getByText('AI-generated headlines from Actually Relevant').closest('p')!
    expect(announcedText(header)).toBe('AI-generated headlines from Actually Relevant')
    expect(header.querySelector('[aria-hidden="true"]')?.textContent).toBe('AI')
    expect(header.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('mix', () => {
    const list = vi.mocked(publicApi.stories.list)
    const page = (stories: PublicStory[]) => ({ data: stories, total: stories.length, page: 1, pageSize: 3, totalPages: 1 })

    it('without a mix, lists the newest stories as before', async () => {
      list.mockClear()
      await loadEmbedStories({ count: 3, mix: null })
      expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 3, issueSlug: undefined, emotionTags: undefined })
    })

    it('at uplifting, and for the older mood=uplifting, lists only uplifting stories', async () => {
      list.mockClear()
      renderEmbed('?mood=uplifting')
      await screen.findByText('AI label: AI headline')
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ emotionTags: 'uplifting' }))
    })

    it('below the far end, mixes positive and negative stories as the homepage does', async () => {
      list.mockClear()
      list.mockResolvedValueOnce(
        page([
          makeStory({ id: 'p1', emotionTag: 'calm', datePublished: '2026-11-05T00:00:00Z' }),
          makeStory({ id: 'n1', emotionTag: 'scary', datePublished: '2026-11-04T00:00:00Z' }),
          makeStory({ id: 'p2', emotionTag: 'uplifting', datePublished: '2026-11-03T00:00:00Z' }),
          makeStory({ id: 'n2', emotionTag: 'frustrating', datePublished: '2026-11-02T00:00:00Z' }),
        ]),
      )

      const result = await loadEmbedStories({ count: 2, issue: 'planet-climate', mix: 50 })

      expect(list).toHaveBeenCalledTimes(1)
      expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 50, issueSlug: 'planet-climate', emotionTags: undefined })
      expect(result.data.map(s => s.id)).toEqual(['p1', 'n1'])
    })
  })

  it.each([
    ['its relevance summary', makeStory({ relevanceSummary: 'Why it matters.', summary: 'Long summary.' }), 'Why it matters.'],
    [
      'its summary when it has no relevance summary, as a researched story does',
      makeStory({ relevanceSummary: null, summary: 'Researched summary.' }),
      'Researched summary.',
    ],
  ])('with ?summary=true, shows %s', async (_name, story, shown) => {
    vi.mocked(publicApi.stories.list).mockResolvedValueOnce({ data: [story], total: 1, page: 1, pageSize: 3, totalPages: 1 })
    renderEmbed('?summary=true')
    expect(await screen.findByText(shown)).toBeInTheDocument()
  })

  it('keeps the "Powered by" footer', async () => {
    renderEmbed()
    await screen.findByText('AI label: AI headline')
    expect(screen.getByText('Powered by Actually Relevant')).toBeInTheDocument()
  })
})

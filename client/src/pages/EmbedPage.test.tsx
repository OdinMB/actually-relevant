import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import EmbedPage from './EmbedPage'
import { makeStory, announcedText } from '../test/stories'

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

  it.each(['', '?theme=dark'])('labels the embedded headlines at the top, before the first story (%s)', async (query) => {
    renderEmbed(query)
    const headline = await screen.findByText('AI label: AI headline')
    const header = screen.getByText('AI-generated headlines from Actually Relevant').closest('p')!
    expect(announcedText(header)).toBe('AI-generated headlines from Actually Relevant')
    expect(header.querySelector('[aria-hidden="true"]')?.textContent).toBe('AI')
    expect(header.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the "Powered by" footer', async () => {
    renderEmbed()
    await screen.findByText('AI label: AI headline')
    expect(screen.getByText('Powered by Actually Relevant')).toBeInTheDocument()
  })
})

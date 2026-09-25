import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import StoryPage from './StoryPage'

/** AI-written story fields the page renders, with text that identifies each one. */
const AI_TEXT = {
  titleLabel: 'AI label text',
  title: 'AI headline text',
  summary: 'AI summary text',
  quote: 'AI quote text',
  quoteAttribution: 'AI attribution text',
  relevanceReasons: 'AI reason text',
  antifactors: 'AI caveat text',
} as const

const story = {
  id: 'story-1',
  slug: 'ai-story',
  sourceUrl: 'https://example.com/article',
  sourceTitle: 'Original headline',
  sourceDatePublished: null,
  datePublished: '2026-09-20T00:00:00.000Z',
  dateCrawled: '2026-09-20T00:00:00.000Z',
  marketingBlurb: 'AI blurb',
  ...AI_TEXT,
  relevanceReasons: `- ${AI_TEXT.relevanceReasons}`,
  antifactors: `- ${AI_TEXT.antifactors}`,
  issue: { name: 'Planet & Climate', slug: 'planet-climate' },
  feed: { id: 'feed-1', title: 'Example Feed', displayTitle: null, issue: { name: 'Planet & Climate', slug: 'planet-climate' } },
}

const mockStory = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../hooks/usePublicStories', () => ({
  usePublicStory: () => ({ data: mockStory.current, isLoading: false, error: null }),
  useRelatedStories: () => ({ data: [], isLoading: false }),
  useClusterMembers: () => ({ data: null }),
}))

function renderStory(data: unknown) {
  mockStory.current = data
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <StoryPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('StoryPage', () => {
  it('does not mark the original source headline when the story has no AI title', () => {
    renderStory({ ...story, title: null, titleLabel: null })
    const heading = screen.getByRole('heading', { level: 1, name: story.sourceTitle })
    expect(heading.closest('[data-ai-generated]')).toBeNull()
  })

  it('marks every rendered AI-generated field with a machine-readable data attribute', () => {
    renderStory(story)

    for (const [field, text] of Object.entries(AI_TEXT)) {
      const element = screen.getByText(text, { exact: false })
      const marked = element.closest('[data-ai-generated]')
      expect(marked, `${field} is not inside a data-ai-generated element`).not.toBeNull()
      expect(marked!.getAttribute('data-ai-generated')!.split(' ')).toContain(field)
    }
  })
})

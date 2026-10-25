import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import StoryPage from './StoryPage'
import FeedbackProvider from '../components/FeedbackProvider'

const mockApi = vi.hoisted(() => ({ submitFeedback: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

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

describe('StoryPage "Report an error"', () => {
  beforeEach(() => {
    // jsdom has no <dialog> behavior: mirror it with the open attribute
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }
    mockApi.submitFeedback.mockReset().mockResolvedValue({ success: true })
  })

  it('opens the feedback dialog bound to the story and sends a correction with its id', async () => {
    mockStory.current = story
    render(
      <HelmetProvider>
        <MemoryRouter>
          <FeedbackProvider>
            <StoryPage />
          </FeedbackProvider>
        </MemoryRouter>
      </HelmetProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Report an error' }))

    const dialog = screen.getByRole('dialog', { name: 'Report an error' })
    expect(within(dialog).getByText(`${AI_TEXT.titleLabel}: ${AI_TEXT.title}`)).toBeInTheDocument()
    const message = within(dialog).getByRole('textbox', { name: 'What is wrong?' })
    await waitFor(() => expect(message).toHaveFocus())
    await userEvent.type(message, 'Wrong date')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith({ category: 'correction', message: 'Wrong date', storyId: 'story-1' })
  })
})

describe('StoryPage', () => {
  it('does not mark the original source headline when the story has no AI title', () => {
    renderStory({ ...story, title: null, titleLabel: null })
    const heading = screen.getByRole('heading', { level: 1, name: story.sourceTitle })
    expect(heading.closest('[data-ai-generated]')).toBeNull()
  })

  it('labels the story as AI-generated in the metadata row under the headline, as plain text', () => {
    renderStory(story)
    const label = screen.getByText('AI-generated summary and analysis')
    expect(label.closest('a')).toBeNull()
    // The "AI" badge next to it is visible but not announced twice
    expect(label.previousElementSibling?.getAttribute('aria-hidden')).toBe('true')
    expect(label.previousElementSibling?.textContent).toBe('AI')
    const headline = screen.getByRole('heading', { level: 1 })
    expect(headline.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // ...and above the AI summary
    expect(label.compareDocumentPosition(screen.getByText(AI_TEXT.summary)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('follows the label with a separate "How it works" link to the methodology page', () => {
    renderStory(story)
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/methodology')
  })

  it('follows the quote attribution with the AI selection note', () => {
    renderStory(story)
    expect(screen.getByText(`— ${AI_TEXT.quoteAttribution} · selected and potentially translated by AI`)).toBeInTheDocument()
  })

  it('shows the AI selection note under a quote that has no attribution', () => {
    renderStory({ ...story, quoteAttribution: null })
    expect(screen.getByText('Selected and potentially translated by AI')).toBeInTheDocument()
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

  it("points og:image and twitter:image at the story's own preview image", async () => {
    renderStory(story)
    await waitFor(() => {
      expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('/api/stories/ai-story/og.png')
    })
    expect(document.head.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe('/api/stories/ai-story/og.png')
  })
})

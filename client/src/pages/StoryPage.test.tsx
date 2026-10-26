import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import StoryPage from './StoryPage'
import FeedbackProvider from '../components/FeedbackProvider'
import SubscribeProvider from '../components/SubscribeProvider'

const mockApi = vi.hoisted(() => ({ submitFeedback: vi.fn(), getFeedbackToken: vi.fn(), getSubscribeToken: vi.fn() }))
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

/** What usePublicStory answers: the story in `current`, or the loading and error states. */
const mockStory = vi.hoisted(() => ({ current: null as unknown, isLoading: false, error: null as Error | null }))
const mockRelated = vi.hoisted(() => ({ current: [] as unknown[] }))

vi.mock('../hooks/usePublicStories', () => ({
  usePublicStory: () => ({ data: mockStory.current, isLoading: mockStory.isLoading, error: mockStory.error }),
  useRelatedStories: () => ({ data: mockRelated.current, isLoading: false }),
  useClusterMembers: () => ({ data: null }),
}))

// jsdom has no modal dialog support: opening and closing only toggle the `open` attribute here.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  mockStory.isLoading = false
  mockStory.error = null
  mockRelated.current = []
})

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
    mockApi.submitFeedback.mockReset().mockResolvedValue({ success: true })
    mockApi.getFeedbackToken.mockReset().mockResolvedValue({ token: 'form-token' })
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

    expect(mockApi.submitFeedback).toHaveBeenCalledWith({ category: 'correction', message: 'Wrong date', storyId: 'story-1', formToken: 'form-token' })
  })
})

describe('StoryPage newsletter line', () => {
  const subscribeButton = () => screen.queryByRole('button', { name: 'Subscribe to the newsletter' })

  it('ends the story with one line offering the newsletter, after the analysis and before related stories', () => {
    mockRelated.current = [{ ...story, id: 'story-2', slug: 'related-story', title: 'Related headline' }]
    renderStory(story)

    const button = subscribeButton()
    expect(button).not.toBeNull()
    expect(button!.closest('p')).toHaveTextContent(/^Get stories like this once a week\. Subscribe to the newsletter$/)
    const caveat = screen.getByText(AI_TEXT.antifactors)
    expect(caveat.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const related = screen.getByRole('heading', { level: 2, name: 'Related Stories' })
    expect(button!.compareDocumentPosition(related) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // jsdom can't measure: a box with a 24px minimum height is the WCAG 2.5.8 target (.context/accessibility.md)
    expect(button).toHaveClass('inline-flex', 'min-h-6')
  })

  it("opens the site's signup dialog", async () => {
    mockApi.getSubscribeToken.mockReset().mockResolvedValue({ token: 'form-token' })
    mockStory.current = story
    render(
      <HelmetProvider>
        <MemoryRouter>
          <SubscribeProvider>
            <StoryPage />
          </SubscribeProvider>
        </MemoryRouter>
      </HelmetProvider>,
    )
    expect(screen.queryByRole('dialog', { name: 'Stay informed' })).toBeNull()

    await userEvent.click(subscribeButton()!)

    const dialog = screen.getByRole('dialog', { name: 'Stay informed' })
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Email address' })).toHaveFocus())
  })

  it.each([
    ['while the story loads', { isLoading: true }],
    ['when the story is not found', {}],
    ['when the story fails to load', { error: new Error('Network error') }],
  ])('is not shown %s', (_, state: { isLoading?: boolean; error?: Error }) => {
    Object.assign(mockStory, state)
    renderStory(null)

    expect(subscribeButton()).toBeNull()
    expect(screen.queryByText(/stories like this/i)).toBeNull()
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

  it('names the article author, as the one page type that sets article:author', async () => {
    renderStory(story)
    await waitFor(() => {
      expect(Array.from(document.head.querySelectorAll('meta[property="article:author"]')).map(el => el.getAttribute('content'))).toEqual([
        'RelevanceAI by Actually Relevant',
      ])
    })
  })
})

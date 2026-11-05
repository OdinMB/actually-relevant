import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StoryPage from './StoryPage'
import FeedbackProvider from '../components/FeedbackProvider'
import SubscribeProvider from '../components/SubscribeProvider'
import { TEXT_LINK } from '../lib/control-classes'
import { focusRingProblems, sizeByBreakpoint } from '../test/classes'
import { contrastRatio } from '../test/contrast'
import { announcedText } from '../test/stories'

const mockApi = vi.hoisted(() => ({ submitFeedback: vi.fn(), getFeedbackToken: vi.fn(), getSubscribeToken: vi.fn(), newsletterArchive: vi.fn() }))
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
/** What useStoryAppearances answers; undefined while it loads or when it failed. */
const mockAppearances = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('../hooks/usePublicStories', () => ({
  usePublicStory: () => ({ data: mockStory.current, isLoading: mockStory.isLoading, error: mockStory.error }),
  useRelatedStories: () => ({ data: mockRelated.current, isLoading: false }),
  useClusterMembers: () => ({ data: null }),
  useStoryAppearances: () => ({ data: mockAppearances.current }),
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

const NOW = new Date('2026-10-25T09:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

/** One page of the newsletter archive holding one issue published `daysAgo` before NOW, or none. */
function archive(latest?: { slug: string; daysAgo: number }) {
  const data = latest
    ? [{ slug: latest.slug, title: 'Week 43, 2026', publishedAt: new Date(NOW.getTime() - latest.daysAgo * DAY_MS).toISOString(), storyCount: 6 }]
    : []
  return { data, total: data.length, page: 1, pageSize: 20, totalPages: data.length }
}

let queryClient: QueryClient

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockApi.newsletterArchive.mockReset().mockResolvedValue(archive())
  mockStory.isLoading = false
  mockStory.error = null
  mockRelated.current = []
  mockAppearances.current = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

/** The providers every story page renders inside, plus any the test adds. */
function Providers({ children }: { children: ReactNode }) {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

function renderStory(data: unknown) {
  mockStory.current = data
  return render(
    <Providers>
      <StoryPage />
    </Providers>,
  )
}

/** Waits until the archive request has answered or failed. */
async function archiveSettled() {
  await waitFor(() => expect(['success', 'error']).toContain(queryClient.getQueryState(['public-newsletter-archive', 1])?.status))
}

describe('StoryPage "Report an error"', () => {
  beforeEach(() => {
    mockApi.submitFeedback.mockReset().mockResolvedValue({ success: true })
    mockApi.getFeedbackToken.mockReset().mockResolvedValue({ token: 'form-token' })
  })

  it('opens the feedback dialog bound to the story and sends a correction with its id', async () => {
    mockStory.current = story
    render(
      <Providers>
        <FeedbackProvider>
          <StoryPage />
        </FeedbackProvider>
      </Providers>,
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

  it('shows only the brand ring on keyboard focus, in the shared in-sentence link style', () => {
    renderStory(story)
    const button = screen.getByRole('button', { name: 'Report an error' })
    expect(focusRingProblems(button)).toEqual([])
    expect(button).toHaveClass(...TEXT_LINK.split(' '))
  })
})

describe('StoryPage actions under the headline', () => {
  it('puts the bookmark and share buttons on a line of their own on phones, with no separator leading into it', () => {
    renderStory(story)
    const bookmark = screen.getByRole('button', { name: 'Bookmark story' })
    const copy = screen.getByRole('button', { name: 'Copy link' })
    const actions = bookmark.parentElement!
    expect(actions.contains(copy)).toBe(true)
    expect(actions).toHaveClass('max-md:basis-full')
    expect(actions.previousElementSibling).toHaveTextContent('|')
    expect(actions.previousElementSibling).toHaveClass('max-md:hidden')
  })

  it('gives the bookmark a 44px square box on phones and a 24px one from md up, like the share buttons', () => {
    renderStory(story)
    const bookmark = screen.getByRole('button', { name: 'Bookmark story' })
    for (const axis of ['w', 'h'] as const) {
      expect(sizeByBreakpoint(bookmark, axis).get('')).toBeGreaterThanOrEqual(44)
      expect(sizeByBreakpoint(bookmark, axis).get('md')).toBeGreaterThanOrEqual(24)
    }
  })
})

describe('StoryPage structure for screen readers', () => {
  it('titles the analysis sections as second-level headings, kept in the ruled style', () => {
    renderStory(story)
    for (const name of ['Why This Matters', 'Caveats']) {
      expect(screen.getByRole('heading', { level: 2, name })).toHaveClass('ruled-heading')
    }
  })

  it('has one h1 and never skips a heading level, down to the related stories', () => {
    mockRelated.current = [{ ...story, id: 'story-2', slug: 'related-story', title: 'Related headline' }]
    renderStory(story)
    const levels = screen.getAllByRole('heading').map(heading => Number(heading.tagName.slice(1)))
    expect(levels[0]).toBe(1)
    expect(levels.filter(level => level === 1)).toHaveLength(1)
    expect(levels).toContain(3) // the related story's card title, under "Related Stories"
    levels.slice(1).forEach((level, i) => expect(level, `heading ${i + 2} after an h${levels[i]}`).toBeLessThanOrEqual(levels[i]! + 1))
  })

  it('hides the "|" separators in the metadata row from screen readers', () => {
    renderStory(story)
    const row = screen.getByRole('heading', { level: 1 }).nextElementSibling!
    const separators = [...row.querySelectorAll('span')].filter(span => span.childElementCount === 0 && span.textContent === '|')
    expect(separators).toHaveLength(5)
    for (const separator of separators) expect(separator).toHaveAttribute('aria-hidden', 'true')
    expect(announcedText(row)).not.toContain('|')
  })
})

describe('StoryPage metadata row on phones', () => {
  // jsdom has no layout, so the classes that do it are what a test can check
  it('draws each "|" in front of the item it leads into, so the row cuts off one that a wrap leaves at the start of a line', () => {
    renderStory(story)
    const row = screen.getByRole('heading', { level: 1 }).nextElementSibling!
    for (const separator of [...row.querySelectorAll('span')].filter(span => span.childElementCount === 0 && span.textContent === '|')) {
      expect(separator).toHaveClass('max-md:hidden')
    }

    const date = row.querySelector('time')!
    const textItems = date.parentElement!
    expect(textItems).toHaveClass('overflow-x-clip', 'md:contents')
    // 4px of room past each clipped edge, for the focus ring of an item at a line's start or end
    expect(textItems).toHaveClass('-mx-1', 'px-1', 'basis-[calc(100%+0.5rem)]')
    const items = [...textItems.children].filter(child => child.textContent !== '|')
    expect(items[0]).toBe(date)
    for (const item of items.slice(1)) {
      expect(item).toHaveClass('max-md:relative', "max-md:before:content-['|'_/_'']")
    }
    // The bookmark and share buttons reach left of the row on phones (their 44px boxes), so they stay outside what it cuts off
    expect(textItems).not.toContainElement(screen.getByRole('button', { name: 'Bookmark story' }))
  })
})

describe('StoryPage analysis points', () => {
  /** The numbers in front of a section's points, which sighted readers see as text. */
  const pointNumbers = (heading: string) =>
    [...screen.getByRole('heading', { level: 2, name: heading }).closest('section')!.querySelectorAll('span[aria-hidden="true"]')].filter(span =>
      /^\d+$/.test(span.textContent ?? ''),
    ) as HTMLElement[]
  /** jsdom reports an inline color as `rgb(r, g, b)`. */
  const hexOf = (color: string) =>
    `#${color
      .match(/\d+/g)!
      .map(n => Number(n).toString(16).padStart(2, '0'))
      .join('')}`

  it.each(['Why This Matters', 'Caveats'])(
    'numbers the points under "%s" in the 700 text shade (above the 3:1 large-text bar) on white, at full opacity',
    heading => {
      renderStory(story)
      const numbers = pointNumbers(heading)
      expect(numbers).toHaveLength(1)
      for (const number of numbers) {
        expect(number.style.opacity).toBe('')
        expect(contrastRatio(hexOf(number.style.color), '#ffffff')).toBeGreaterThanOrEqual(4.5)
      }
    },
  )
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

  it("opens the site's signup dialog, with the link to this week's issue beside it", async () => {
    mockApi.getSubscribeToken.mockReset().mockResolvedValue({ token: 'form-token' })
    mockApi.newsletterArchive.mockResolvedValue(archive({ slug: 'week-43-2026', daysAgo: 1 }))
    mockStory.current = story
    render(
      <Providers>
        <SubscribeProvider>
          <StoryPage />
        </SubscribeProvider>
      </Providers>,
    )
    await screen.findByRole('link', { name: 'read this week’s issue' })
    expect(screen.queryByRole('dialog', { name: 'Stay informed' })).toBeNull()

    await userEvent.click(subscribeButton()!)

    const dialog = screen.getByRole('dialog', { name: 'Stay informed' })
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Email address' })).toHaveFocus())
  })

  it("goes on, in the same sentence, to a link to this week's issue on the web", async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive({ slug: 'week-43-2026', daysAgo: 1 }))
    renderStory(story)

    const link = await screen.findByRole('link', { name: 'read this week’s issue' })
    expect(link).toHaveAttribute('href', '/newsletter/week-43-2026')
    expect(link.closest('p')).toBe(subscribeButton()!.closest('p'))
    expect(link.closest('p')).toHaveTextContent(/^Get stories like this once a week\. Subscribe to the newsletter, or read this week’s issue$/)
    expect(link).toHaveClass('inline-flex', 'min-h-6')
  })

  it('calls an issue a week old or older the latest issue', async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive({ slug: 'week-40-2026', daysAgo: 20 }))
    renderStory(story)

    expect(await screen.findByRole('link', { name: 'read the latest issue' })).toHaveAttribute('href', '/newsletter/week-40-2026')
  })

  it.each([
    ['no issue is published', () => mockApi.newsletterArchive.mockResolvedValue(archive())],
    ['the archive fails to load', () => mockApi.newsletterArchive.mockRejectedValue(new Error('Network error'))],
  ])('keeps to the subscribe offer alone when %s', async (_, arrange) => {
    arrange()
    renderStory(story)
    await archiveSettled()

    expect(subscribeButton()!.closest('p')).toHaveTextContent(/^Get stories like this once a week\. Subscribe to the newsletter$/)
    expect(screen.queryByRole('link', { name: /issue/ })).toBeNull()
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

describe('StoryPage newsletter issue and podcast episode', () => {
  const ISSUE = { slug: 'week-43-2026', title: 'Week 43, 2026', publishedAt: '2026-10-24T04:30:00.000Z', storyCount: 6 }
  const EPISODE = {
    id: 'episode-43',
    title: 'W43: Clean air',
    aiLine: 'Written and voiced by AI.',
    summary: 'Two hosts talk through the week.',
    publishedAt: '2026-10-24T05:00:00.000Z',
    durationSec: 372,
    audioUrl: 'https://audio.example/e.mp3',
    audioBytes: 123,
    transcriptUrl: null,
    stories: [],
    aiGenerated: { fields: ['title'], digitalSourceType: 'trainedAlgorithmicMedia' },
  }
  const issueLink = () => screen.queryByRole('link', { name: /^Featured in the newsletter/ })
  const episodeLink = () => screen.queryByRole('link', { name: /^Featured on the podcast/ })
  const subscribeButton = () => screen.getByRole('button', { name: 'Subscribe to the newsletter' })

  it('names the issue and the episode the story was in, after "Report an error" and before the newsletter line', () => {
    mockAppearances.current = { newsletterIssue: ISSUE, podcastEpisode: EPISODE }
    renderStory(story)

    expect(issueLink()).toHaveAttribute('href', '/newsletter/week-43-2026')
    expect(episodeLink()).toHaveAttribute('href', '/podcast/episode-43/transcript')
    const report = screen.getByRole('button', { name: 'Report an error' })
    expect(report.compareDocumentPosition(issueLink()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(episodeLink()!.compareDocumentPosition(subscribeButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['while the answer is on its way, or after it failed', undefined],
    ['for a story in neither', { newsletterIssue: null, podcastEpisode: null }],
  ])('adds nothing %s', async (_, appearances) => {
    mockAppearances.current = appearances
    mockApi.newsletterArchive.mockResolvedValue(archive({ slug: 'week-43-2026', daysAgo: 1 }))
    renderStory(story)

    expect(await screen.findByRole('link', { name: 'read this week’s issue' })).toBeInTheDocument()
    expect(screen.queryByText(/^Featured/)).toBeNull()
  })

  it("drops the newsletter line's issue link when the story's issue is the newest one, which the card already links", async () => {
    mockAppearances.current = { newsletterIssue: ISSUE, podcastEpisode: null }
    mockApi.newsletterArchive.mockResolvedValue(archive({ slug: 'week-43-2026', daysAgo: 1 }))
    renderStory(story)
    await archiveSettled()

    expect(subscribeButton().closest('p')).toHaveTextContent(/^Get stories like this once a week\. Subscribe to the newsletter$/)
    const toIssue = screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/newsletter/week-43-2026')
    expect(toIssue).toEqual([issueLink()])
  })

  it("keeps the line's link to the newest issue when the story was in an older one", async () => {
    mockAppearances.current = { newsletterIssue: { ...ISSUE, slug: 'week-40-2026', title: 'Week 40, 2026' }, podcastEpisode: null }
    mockApi.newsletterArchive.mockResolvedValue(archive({ slug: 'week-43-2026', daysAgo: 1 }))
    renderStory(story)

    expect(await screen.findByRole('link', { name: 'read this week’s issue' })).toHaveAttribute('href', '/newsletter/week-43-2026')
    expect(issueLink()).toHaveAttribute('href', '/newsletter/week-40-2026')
  })

  it.each([
    ['while the story loads', { isLoading: true }],
    ['when the story is not found', {}],
    ['when the story fails to load', { error: new Error('Network error') }],
  ])('is not shown %s', (_, state: { isLoading?: boolean; error?: Error }) => {
    mockAppearances.current = { newsletterIssue: ISSUE, podcastEpisode: EPISODE }
    Object.assign(mockStory, state)
    renderStory(null)

    expect(issueLink()).toBeNull()
    expect(episodeLink()).toBeNull()
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
    const label = screen.getByText(
      (_, el) => el?.tagName === 'SPAN' && el.textContent?.startsWith('Summary and analysis by') === true && !el.querySelector('a'),
    )
    expect(label.closest('a')).toBeNull()
    // The "AI" badge is the label's only "AI", announced as the word itself
    expect(announcedText(label)).toBe('Summary and analysis by AI.')
    const headline = screen.getByRole('heading', { level: 1 })
    expect(headline.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // ...and above the AI summary
    expect(label.compareDocumentPosition(screen.getByText(AI_TEXT.summary)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('links the story issue only at the end of the page, not above the headline', () => {
    renderStory(story)
    const issueLinks = screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/issues/planet-climate')
    expect(issueLinks.map(link => link.textContent)).toEqual(['More in Planet & Climate →'])
  })

  it('follows the label with a separate "How it works" link to the methodology page', () => {
    renderStory(story)
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/methodology')
  })

  it('shows only the brand ring when "How it works" has keyboard focus', () => {
    renderStory(story)
    expect(focusRingProblems(screen.getByRole('link', { name: 'How it works' }))).toEqual([])
  })

  it('follows the quote attribution with the AI selection note', () => {
    renderStory(story)
    expect(screen.getByText(`— ${AI_TEXT.quoteAttribution} · chosen by AI, may be translated`)).toBeInTheDocument()
  })

  it('shows the AI selection note under a quote that has no attribution', () => {
    renderStory({ ...story, quoteAttribution: null })
    expect(screen.getByText('Chosen by AI, may be translated')).toBeInTheDocument()
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

describe('StoryPage link-preview text', () => {
  const metaContent = (selector: string) => document.head.querySelector(selector)?.getAttribute('content')

  it('describes the story by its summary as plain text, without Markdown marks or URLs', async () => {
    renderStory({ ...story, summary: '**Cities** cut smog, [the agency](https://example.org/report) says, by _a third_.' })
    const plain = 'Cities cut smog, the agency says, by a third.'
    await waitFor(() => expect(metaContent('meta[name="description"]')).toBe(plain))
    expect(metaContent('meta[property="og:description"]')).toBe(plain)
  })

  it('cuts the plain text, not the Markdown, to the description limits', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    renderStory({ ...story, summary: `**${long}**` })
    await waitFor(() => expect(metaContent('meta[name="description"]')).toBe(long.slice(0, 160)))
    expect(metaContent('meta[property="og:description"]')).toBe(long.slice(0, 200))
  })

  it('falls back to the title when the summary has no text', async () => {
    renderStory({ ...story, summary: null })
    await waitFor(() => expect(metaContent('meta[name="description"]')).toBe(`${AI_TEXT.titleLabel}: ${AI_TEXT.title}`))
  })

  it('pre-fills the share text with the blurb as plain text', () => {
    renderStory({ ...story, marketingBlurb: '**Nation** reports [cleaner air](https://example.org/air).' })
    const href = screen.getByRole('link', { name: 'Share on X' }).getAttribute('href')!
    expect(new URL(href).searchParams.get('text')).toMatch(/^Nation reports cleaner air\. /)
  })
})

describe('StoryPage for search engines', () => {
  it('keeps the not-found view out of search results', async () => {
    renderStory(null)
    expect(screen.getByRole('heading', { level: 1, name: 'Story Not Found' })).toBeInTheDocument()
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex'))
  })

  it('leaves a published story indexable', async () => {
    renderStory(story)
    await waitFor(() => expect(document.head.querySelector('meta[property="og:image"]')).not.toBeNull())
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { inAutomatedBrowser } from '../test/automatedBrowser'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicNewsletterIssue } from '@shared/types'
import { ApiError } from '../lib/api'

const mockApi = vi.hoisted(() => ({ newsletterIssue: vi.fn(), issues: { list: vi.fn() } }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import NewsletterIssuePage from './NewsletterIssuePage'

const ISSUE: PublicNewsletterIssue = {
  slug: 'week-42-2026',
  title: 'Week 42, 2026',
  publishedAt: '2026-10-18T09:00:00.000Z',
  aiLabel: { lead: 'AI-generated:', text: 'AI selected the stories in this issue and wrote the headlines and summaries.' },
  content: [
    'A hopeful week for clean air.',
    '',
    '---',
    '',
    '# Planet & Climate',
    '',
    '## Cities cut smog',
    'Nation · [original article](https://news.example/1) · [relevance analysis](https://actuallyrelevant.news/stories/clean-air)',
    '',
    'Why it matters for millions.',
    '',
    '## Old story',
    'Other · [original article](https://news.example/2)',
    '',
    '> "A quote."',
    '> — Someone',
  ].join('\n'),
  stories: [
    {
      headline: 'Cities cut smog',
      title: 'Cities cut smog',
      titleLabel: 'Air Quality',
      sourceTitle: 'Smog falls',
      sourceUrl: 'https://news.example/1',
      publisher: 'Nation',
      slug: 'clean-air',
    },
    { headline: 'Old story', title: null, titleLabel: null, sourceTitle: 'Old story', sourceUrl: 'https://news.example/2', publisher: 'Other', slug: null },
  ],
  aiGenerated: { fields: ['content', 'stories'], digitalSourceType: 'x' },
}

function renderPage(slug = 'week-42-2026') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/newsletter/${slug}`]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/newsletter/:slug" element={<NewsletterIssuePage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.newsletterIssue.mockResolvedValue(ISSUE)
  mockApi.issues.list.mockResolvedValue([])
})

/** The colored dot in a section heading. */
function dotOf(heading: HTMLElement): string {
  return heading.querySelector('.rounded-full')?.className ?? ''
}

describe('NewsletterIssuePage', () => {
  it("shows the issue's AI label before any AI-written text", async () => {
    renderPage()
    const label = await screen.findByText(ISSUE.aiLabel.text, { exact: false })
    const intro = screen.getByText('A hopeful week for clean air.')
    expect(label.closest('[data-newsletter-ai-label]')).not.toBeNull()
    expect(label.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(ISSUE.aiLabel.lead).tagName).toBe('STRONG')
    expect(intro.closest('[data-ai-generated="content"]')).not.toBeNull()
  })

  it('renders each story headline with the AI badge and title label, linked to its story page', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { level: 3, name: 'Cities cut smog' })
    expect(heading.querySelector('a')?.getAttribute('href')).toBe('/stories/clean-air')
    const labelRow = heading.previousElementSibling as HTMLElement
    expect(labelRow.textContent).toContain('AI')
    expect(labelRow.textContent).toContain('Air Quality')
    // A story that is no longer published keeps the badge but has no link
    const old = screen.getByRole('heading', { level: 3, name: 'Old story' })
    expect(old.querySelector('a')).toBeNull()
    expect(old.previousElementSibling?.textContent).toContain('AI')
  })

  it('keeps site links in the app and opens other links in a new tab', async () => {
    renderPage()
    const analysis = await screen.findByRole('link', { name: 'relevance analysis' })
    expect(analysis.getAttribute('href')).toBe('/stories/clean-air')
    const original = screen.getAllByRole('link', { name: 'original article' })[0]!
    expect(original.getAttribute('target')).toBe('_blank')
    expect(original.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders issue sections as headings under the page title', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Week 42, 2026' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Planet & Climate' })).toBeInTheDocument()
  })

  it("colors a section's dot by its category, found by name among the site's categories", async () => {
    // Renamed since: the slug, not the name, picks the color
    mockApi.issues.list.mockResolvedValue([{ name: 'Planet & Climate', slug: 'existential-threats', children: [] }])
    renderPage()
    const section = await screen.findByRole('heading', { level: 2, name: 'Planet & Climate' })
    await waitFor(() => expect(dotOf(section)).toContain('bg-red-400'))
  })

  it("colors a section's dot from its name while the categories cannot load", async () => {
    mockApi.issues.list.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    renderPage()
    const section = await screen.findByRole('heading', { level: 2, name: 'Planet & Climate' })
    expect(dotOf(section)).toContain('bg-teal-400')
  })

  it("sets each story's publisher line in small type, apart from its text", async () => {
    renderPage()
    const meta = (await screen.findAllByRole('link', { name: 'original article' }))[0]!.closest('p')!
    expect(meta.textContent).toContain('Nation')
    expect(meta.className).toContain('text-sm')
    expect(screen.getByText('Why it matters for millions.').className).not.toContain('text-sm')
  })

  it('shows a quote and its attribution apart, as the email does', async () => {
    renderPage()
    const quote = await screen.findByText('“A quote.”')
    const attribution = screen.getByText('— Someone')
    expect(quote.closest('blockquote')).toContainElement(attribution)
    expect(quote).not.toContainElement(attribution)
  })

  it('offers the podcast after the issue text', async () => {
    renderPage()
    const lastText = await screen.findByText('A quote.', { exact: false })
    const podcast = screen.getByRole('link', { name: 'Try the weekly podcast' })
    expect(podcast.getAttribute('href')).toBe('/podcast')
    expect(lastText.compareDocumentPosition(podcast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(podcast.closest('[data-ai-generated]')).toBeNull()
  })

  it('shows the not-found state for an unpublished issue', async () => {
    mockApi.newsletterIssue.mockRejectedValue(new ApiError(404, 'Issue not found'))
    renderPage('draft-issue')
    expect(await screen.findByRole('heading', { name: 'Issue Not Found' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows the not-found state and its noindex in an automated browser too, since issue pages are never prerendered', async () => {
    await inAutomatedBrowser(async () => {
      mockApi.newsletterIssue.mockRejectedValue(new ApiError(404, 'Issue not found'))
      renderPage('draft-issue')
      expect(await screen.findByRole('heading', { level: 1, name: 'Issue Not Found' })).toBeInTheDocument()
      await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex'))
    })
  })

  it('says the issue could not load right now on any other failure, and loads it in place on "Try again"', async () => {
    mockApi.newsletterIssue.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    renderPage()

    const heading = await screen.findByRole('heading', { level: 1, name: "This issue couldn't load" })
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.queryByText(/not found|taken down/i)).toBeNull()
    expect(screen.getByRole('link', { name: '← All issues' })).toHaveAttribute('href', '/newsletter')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Week 42, 2026' })).toBeInTheDocument()
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Week 42, 2026' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

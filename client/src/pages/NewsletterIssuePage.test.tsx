import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicNewsletterIssue } from '@shared/types'
import { ApiError } from '../lib/api'

const mockApi = vi.hoisted(() => ({ newsletterIssue: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import NewsletterIssuePage from './NewsletterIssuePage'

const ISSUE: PublicNewsletterIssue = {
  slug: 'week-42-2026',
  title: 'Week 42, 2026',
  publishedAt: '2026-10-18T09:00:00.000Z',
  aiLabel: { lead: 'AI-generated:', text: 'AI selected the stories in this issue and wrote the intro, headlines, and summaries.' },
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
    { headline: 'Cities cut smog', title: 'Cities cut smog', titleLabel: 'Air Quality', sourceTitle: 'Smog falls', sourceUrl: 'https://news.example/1', publisher: 'Nation', slug: 'clean-air' },
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
})

describe('NewsletterIssuePage', () => {
  it('shows the issue\'s AI label before any AI-written text', async () => {
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
    const original = screen.getAllByRole('link', { name: 'original article' })[0]
    expect(original.getAttribute('target')).toBe('_blank')
    expect(original.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders issue sections as headings under the page title', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Week 42, 2026' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Planet & Climate' })).toBeInTheDocument()
  })

  it('shows the not-found state for an unpublished issue', async () => {
    mockApi.newsletterIssue.mockRejectedValue(new ApiError(404, 'Issue not found'))
    renderPage('draft-issue')
    expect(await screen.findByRole('heading', { name: 'Issue Not Found' })).toBeInTheDocument()
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Week 42, 2026' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

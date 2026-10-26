import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { NEWSLETTER_PROMISE } from '../config'

const mockApi = vi.hoisted(() => ({ newsletterArchive: vi.fn(), getSubscribeToken: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import NewsletterPage from './NewsletterPage'
import { PublishHint } from '../components/admin/NewsletterDetail'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <NewsletterPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.getSubscribeToken.mockResolvedValue({ token: 'form-token' })
  mockApi.newsletterArchive.mockResolvedValue({
    data: [
      { slug: 'week-42-2026', title: 'Week 42, 2026', publishedAt: '2026-10-18T09:00:00.000Z', storyCount: 8 },
      { slug: 'week-41-2026', title: 'Week 41, 2026', publishedAt: '2026-10-11T09:00:00.000Z', storyCount: 1 },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  })
})

describe('NewsletterPage', () => {
  it('shows the AI subtitle, then the signup form, then the past issues', async () => {
    renderPage()
    const subtitle = screen.getByText(AI_DISCLOSURE_COPY.newsletterSubtitle.lead, { exact: false })
    const email = screen.getByRole('textbox', { name: /email/i })
    const firstIssue = await screen.findByRole('link', { name: 'Week 42, 2026' })
    expect(subtitle.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(email.compareDocumentPosition(firstIssue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(subtitle.textContent).toContain(AI_DISCLOSURE_COPY.newsletterSubtitle.tail)
  })

  it('shows a skeleton while loading, then links each issue with its date and story count', async () => {
    const { container } = renderPage()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    const link = await screen.findByRole('link', { name: 'Week 42, 2026' })
    expect(link.getAttribute('href')).toBe('/newsletter/week-42-2026')
    expect(screen.getByText('October 18, 2026')).toBeInTheDocument()
    expect(screen.getByText(/8 stories/)).toBeInTheDocument()
    expect(screen.getByText(/1 story$/)).toBeInTheDocument()
    expect(mockApi.newsletterArchive).toHaveBeenCalledWith(1)
  })

  it('says what a subscriber gets in the left-aligned column, without a link back to this page', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled())

    expect(screen.getByText(NEWSLETTER_PROMISE)).toHaveClass('text-left')
    expect(screen.queryByRole('link', { name: /past issues/i })).not.toBeInTheDocument()
  })

  it('links the newsletter RSS feed, visibly and for feed autodiscovery', async () => {
    renderPage()
    const link = screen.getByRole('link', { name: 'Follow new issues by RSS' })
    expect(link.getAttribute('href')).toBe('/api/newsletters/feed.xml')
    await waitFor(() => {
      const alternate = document.head.querySelector('link[rel="alternate"][type="application/rss+xml"]')
      expect(alternate?.getAttribute('href')).toBe('/api/newsletters/feed.xml')
      expect(alternate?.getAttribute('title')).toBe('Actually Relevant newsletter')
    })
  })

  it('offers the podcast after the past issues', async () => {
    renderPage()
    const lastIssue = await screen.findByRole('link', { name: 'Week 41, 2026' })
    const podcast = screen.getByRole('link', { name: 'Try the weekly podcast' })
    expect(podcast.getAttribute('href')).toBe('/podcast')
    expect(lastIssue.compareDocumentPosition(podcast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says so when no issue is published yet', async () => {
    mockApi.newsletterArchive.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })
    renderPage()
    expect(await screen.findByText('No issues have been published yet.')).toBeInTheDocument()
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('link', { name: 'Week 42, 2026' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('PublishHint (admin)', () => {
  it('says that publishing makes a draft public on the website', () => {
    render(<PublishHint newsletter={{ status: 'draft', slug: null }} />)
    expect(screen.getByText(/Publishing makes this issue public on the website/)).toBeInTheDocument()
  })

  it("links a published issue's public page", () => {
    render(<PublishHint newsletter={{ status: 'published', slug: 'week-42-2026' }} />)
    expect(screen.getByRole('link', { name: '/newsletter/week-42-2026' }).getAttribute('href')).toBe('/newsletter/week-42-2026')
  })
})

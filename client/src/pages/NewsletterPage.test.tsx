import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { NEWSLETTER_PROMISE } from '../config'
import { inAutomatedBrowser } from '../test/automatedBrowser'

const mockApi = vi.hoisted(() => ({ newsletterArchive: vi.fn(), getSubscribeToken: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import NewsletterPage from './NewsletterPage'
import { PublishHint } from '../components/admin/NewsletterDetail'
import { ApiError } from '../lib/api'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <NewsletterPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
  return { ...result, client }
}

const ARCHIVE = {
  data: [
    { slug: 'week-42-2026', title: 'Week 42, 2026', publishedAt: '2026-10-18T09:00:00.000Z', storyCount: 8 },
    { slug: 'week-41-2026', title: 'Week 41, 2026', publishedAt: '2026-10-11T09:00:00.000Z', storyCount: 1 },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.getSubscribeToken.mockResolvedValue({ token: 'form-token' })
  mockApi.newsletterArchive.mockResolvedValue(ARCHIVE)
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
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage()
    await screen.findByRole('link', { name: 'Week 42, 2026' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('NewsletterPage when the past issues do not load', () => {
  const failure = () => screen.findByRole('heading', { level: 3, name: "The past issues couldn't load" })

  it.each([
    ['the server fails', new ApiError(500, 'Failed to fetch newsletters')],
    ['the API is not there', new ApiError(404, 'Not Found')],
    ['the connection drops', new TypeError('Failed to fetch')],
  ])('says the past issues could not load, under their heading, when %s', async (_, error) => {
    mockApi.newsletterArchive.mockRejectedValue(error)
    renderPage()

    const heading = await failure()
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.getByRole('region', { name: 'Past issues' })).toContainElement(heading)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('No issues have been published yet.')).toBeNull()
  })

  it('lists the issues in place when "Try again" succeeds', async () => {
    mockApi.newsletterArchive.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ARCHIVE)
    renderPage()
    await failure()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: 'Week 42, 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockApi.newsletterArchive).toHaveBeenCalledTimes(2)
  })

  it('says so when the next page fails, and shows that page once "Try again" succeeds', async () => {
    const page2 = { ...ARCHIVE, data: [{ slug: 'week-40-2026', title: 'Week 40, 2026', publishedAt: '2026-10-04T09:00:00.000Z', storyCount: 5 }], page: 2 }
    mockApi.newsletterArchive.mockImplementation((page: number) =>
      page === 1 ? Promise.resolve({ ...ARCHIVE, totalPages: 2 }) : Promise.reject(new TypeError('Failed to fetch')),
    )
    renderPage()
    await screen.findByRole('link', { name: 'Week 42, 2026' })

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await failure()
    expect(screen.queryByRole('link', { name: 'Week 42, 2026' })).toBeNull()

    mockApi.newsletterArchive.mockImplementation((page: number) => Promise.resolve(page === 1 ? { ...ARCHIVE, totalPages: 2 } : { ...page2, totalPages: 2 }))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Week 40, 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the signup form usable beside the failure', async () => {
    mockApi.newsletterArchive.mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()
    await failure()

    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument()
  })

  it('has no detectable accessibility violations in the failure', async () => {
    mockApi.newsletterArchive.mockRejectedValue(new TypeError('Failed to fetch'))
    const { container } = renderPage()
    await failure()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('shows the skeleton in the prerenderer, so the failure is never baked into the static page', async () => {
    await inAutomatedBrowser(async () => {
      mockApi.newsletterArchive.mockRejectedValue(new TypeError('Failed to fetch'))
      const { container, client } = renderPage()

      await waitFor(() => expect(client.getQueryState(['public-newsletter-archive', 1])?.status).toBe('error'))
      expect(container.querySelector('.animate-pulse')).not.toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
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

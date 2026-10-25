import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'

const mockApi = vi.hoisted(() => ({ newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import NewsletterArchivePage from './NewsletterArchivePage'
import { PublishHint } from '../components/admin/NewsletterDetail'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <NewsletterArchivePage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe('NewsletterArchivePage', () => {
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

  it('links to the signup page', async () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Subscribe' }).getAttribute('href')).toBe('/newsletter')
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { NewsletterEdition, PublicNewsletterIssueSummary } from '@shared/types'
import { useLatestNewsletterIssue } from './useNewsletterArchive'
import { setPrerendering } from '../test/prerenderer'

const mockApi = vi.hoisted(() => ({ newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

const NOW = new Date('2026-10-25T09:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

function issue(slug: string, daysAgo: number, edition: NewsletterEdition = 'full'): PublicNewsletterIssueSummary {
  return { slug, title: `Title of ${slug}`, edition, publishedAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(), storyCount: 6 }
}

function archive(...issues: PublicNewsletterIssueSummary[]) {
  return { data: issues, total: issues.length, page: 1, pageSize: 20, totalPages: issues.length > 0 ? 1 : 0 }
}

/** The cache entry of the archive's first page with both editions, which /newsletter's All view reads too. */
const FIRST_PAGE_KEY = ['public-newsletter-archive', 1, 'all']

function renderLatest(edition?: NewsletterEdition) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { queryClient, ...renderHook(() => useLatestNewsletterIssue(edition), { wrapper }) }
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  mockApi.newsletterArchive.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  setPrerendering(false)
})

describe('useLatestNewsletterIssue', () => {
  it("is the newest published issue, from the archive's first page", async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('week-43-2026', 1), issue('week-42-2026', 8)))
    const { result } = renderLatest()

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({ slug: 'week-43-2026', title: 'Title of week-43-2026', storyCount: 6 })
    expect(mockApi.newsletterArchive).toHaveBeenCalledWith(1, undefined)
  })

  it('shares its request with the Past issues list on /newsletter', async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('week-43-2026', 1)))
    const { result, queryClient } = renderLatest()

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(queryClient.getQueryData(FIRST_PAGE_KEY)).toEqual(archive(issue('week-43-2026', 1)))
  })

  it("is one edition's newest issue when asked, from that edition's own cache entry", async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('actually-uplifting-week-43-2026', 1, 'uplifting')))
    const { result, queryClient } = renderLatest('uplifting')

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({ slug: 'actually-uplifting-week-43-2026', edition: 'uplifting' })
    expect(mockApi.newsletterArchive).toHaveBeenCalledWith(1, 'uplifting')
    expect(queryClient.getQueryData(['public-newsletter-archive', 1, 'uplifting'])).toBeDefined()
    expect(queryClient.getQueryData(FIRST_PAGE_KEY)).toBeUndefined()
  })

  it.each([
    ['one day', 1, true],
    ['six days', 6.9, true],
    ['seven days', 7, false],
    ['a month', 30, false],
  ])("is this week's issue only while it is under a week old (%s old)", async (_, daysAgo, thisWeek) => {
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('latest', daysAgo)))
    const { result } = renderLatest()

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current!.thisWeek).toBe(thisWeek)
  })

  it('is null while the archive loads', () => {
    mockApi.newsletterArchive.mockReturnValue(new Promise(() => {}))
    const { result } = renderLatest()

    expect(result.current).toBeNull()
  })

  it('is null when no issue is published', async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive())
    const { result, queryClient } = renderLatest()

    await waitFor(() => expect(queryClient.getQueryState(FIRST_PAGE_KEY)?.status).toBe('success'))
    expect(result.current).toBeNull()
  })

  it('is null when the archive fails to load', async () => {
    mockApi.newsletterArchive.mockRejectedValue(new Error('Network error'))
    const { result, queryClient } = renderLatest()

    await waitFor(() => expect(queryClient.getQueryState(FIRST_PAGE_KEY)?.status).toBe('error'))
    expect(result.current).toBeNull()
  })

  it('asks for nothing while the page is prerendered, so no static HTML carries a dated issue', () => {
    setPrerendering(true)
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('week-43-2026', 1)))
    const { result } = renderLatest()

    expect(mockApi.newsletterArchive).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })
})

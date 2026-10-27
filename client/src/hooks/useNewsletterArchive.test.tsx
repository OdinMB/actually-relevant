import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PublicNewsletterIssueSummary } from '@shared/types'
import { useLatestNewsletterIssue } from './useNewsletterArchive'

const mockApi = vi.hoisted(() => ({ newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

const NOW = new Date('2026-10-25T09:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

function issue(slug: string, daysAgo: number): PublicNewsletterIssueSummary {
  return { slug, title: `Title of ${slug}`, publishedAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(), storyCount: 6 }
}

function archive(...issues: PublicNewsletterIssueSummary[]) {
  return { data: issues, total: issues.length, page: 1, pageSize: 20, totalPages: issues.length > 0 ? 1 : 0 }
}

function renderLatest() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { queryClient, ...renderHook(() => useLatestNewsletterIssue(), { wrapper }) }
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  mockApi.newsletterArchive.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'webdriver')
})

describe('useLatestNewsletterIssue', () => {
  it("is the newest published issue, from the archive's first page", async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('week-43-2026', 1), issue('week-42-2026', 8)))
    const { result } = renderLatest()

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({ slug: 'week-43-2026', title: 'Title of week-43-2026', storyCount: 6 })
    expect(mockApi.newsletterArchive).toHaveBeenCalledWith(1)
  })

  it('shares its request with the Past issues list on /newsletter', async () => {
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('week-43-2026', 1)))
    const { result, queryClient } = renderLatest()

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(queryClient.getQueryData(['public-newsletter-archive', 1])).toEqual(archive(issue('week-43-2026', 1)))
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

    await waitFor(() => expect(queryClient.getQueryState(['public-newsletter-archive', 1])?.status).toBe('success'))
    expect(result.current).toBeNull()
  })

  it('is null when the archive fails to load', async () => {
    mockApi.newsletterArchive.mockRejectedValue(new Error('Network error'))
    const { result, queryClient } = renderLatest()

    await waitFor(() => expect(queryClient.getQueryState(['public-newsletter-archive', 1])?.status).toBe('error'))
    expect(result.current).toBeNull()
  })

  it('asks for nothing while the page is prerendered, so no static HTML carries a dated issue', () => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
    mockApi.newsletterArchive.mockResolvedValue(archive(issue('week-43-2026', 1)))
    const { result } = renderLatest()

    expect(mockApi.newsletterArchive).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })
})

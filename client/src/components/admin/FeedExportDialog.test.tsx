import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Feed } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { feedIssues, makeFeed, makeQuality } from '../../test/feeds'
import { buildCoverageGapsPrompt, buildFixProblemFeedsPrompt } from './feedExportPrompts'
import { FeedExportDialog } from './FeedExportDialog'

const mockFeedsApi = vi.hoisted(() => ({ list: vi.fn(), quality: vi.fn() }))
const mockIssuesApi = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { feeds: mockFeedsApi, issues: mockIssuesApi },
}))

const mockDownload = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock('../../lib/download', () => mockDownload)

const now = new Date(2026, 10, 1, 10, 0)
const healthy = makeFeed({ id: 'feed-healthy' })
const broken = makeFeed({ id: 'feed-broken', title: 'Broken Feed', lastCrawlResult: 'RSS fetch failed: HTTP 404' })
const inactive = makeFeed({ id: 'feed-inactive', active: false })
const quality = { 'feed-healthy': makeQuality(), 'feed-broken': makeQuality(), 'feed-inactive': makeQuality() }

function stubClipboard() {
  const writeText = vi.fn((_text: string) => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

function serveFeeds(feeds: Feed[]) {
  mockFeedsApi.list.mockResolvedValue(feeds)
  mockFeedsApi.quality.mockResolvedValue(quality)
  mockIssuesApi.list.mockResolvedValue(feedIssues)
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <FeedExportDialog open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** The export's feed ids, from the text the dialog handed to the download or the clipboard. */
function exportedIds(text: string): string[] {
  const data = JSON.parse(text) as { feeds: { id: string }[] }
  return data.feeds.map(feed => feed.id)
}

async function loaded() {
  await screen.findByRole('radio', { name: /Feeds with problems \(1\)/ })
}

describe('FeedExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('downloads the feeds with problems as a dated JSON file', async () => {
    serveFeeds([healthy, broken, inactive])
    renderDialog()
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }))

    expect(mockDownload.downloadFile).toHaveBeenCalledWith('feeds-problems-2026-11-01.json', expect.any(String), 'application/json')
    expect(exportedIds(mockDownload.downloadFile.mock.calls[0]![1] as string)).toEqual(['feed-broken'])
  })

  it('copies every feed, inactive ones included, when All feeds is chosen', async () => {
    serveFeeds([healthy, broken, inactive])
    const writeText = stubClipboard()
    renderDialog()
    await loaded()

    fireEvent.click(screen.getByRole('radio', { name: /All feeds/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(exportedIds(writeText.mock.calls[0]![0])).toEqual(['feed-healthy', 'feed-broken', 'feed-inactive'])
    expect(mockFeedsApi.list).toHaveBeenCalledWith(undefined)
  })

  it('copies the fix prompt with the feeds with problems and the gap prompt with every feed', async () => {
    serveFeeds([healthy, broken, inactive])
    const writeText = stubClipboard()
    renderDialog()
    await loaded()
    const input = { feeds: [healthy, broken, inactive], issues: feedIssues, quality, now }

    fireEvent.click(screen.getByRole('button', { name: 'Copy fix prompt' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(buildFixProblemFeedsPrompt(input)))

    fireEvent.click(screen.getByRole('button', { name: 'Copy gap analysis prompt' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(buildCoverageGapsPrompt(input)))
  })

  it('keeps the fix prompt unavailable, with its reason, while no feed has problems', async () => {
    serveFeeds([healthy, inactive])
    const writeText = stubClipboard()
    renderDialog()
    await screen.findByRole('radio', { name: /Feeds with problems \(0\)/ })

    const fix = screen.getByRole('button', { name: 'Copy fix prompt' })
    expect(fix).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(fix)

    expect(writeText).not.toHaveBeenCalled()
  })

  it('offers nothing to export until the feeds, their metrics and the issues have loaded', async () => {
    serveFeeds([healthy, broken])
    mockIssuesApi.list.mockReturnValue(new Promise(() => {}))
    const writeText = stubClipboard()
    renderDialog()
    await loaded()

    const download = screen.getByRole('button', { name: 'Download JSON' })
    expect(download).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(download)
    fireEvent.click(screen.getByRole('button', { name: 'Copy gap analysis prompt' }))

    expect(mockDownload.downloadFile).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })
})

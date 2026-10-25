import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'

const mockAxiosGet = vi.hoisted(() => vi.fn())
const mockFs = vi.hoisted(() => ({ access: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() }))
const mockGetFeeds = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({ default: { get: mockAxiosGet } }))
vi.mock('fs/promises', () => mockFs)
vi.mock('./feed.js', () => ({ getFeeds: mockGetFeeds }))

const { fetchFavicon, fetchAllFavicons } = await import('./favicon.js')

const FEED_ID = '11111111-2222-4333-8444-555555555555'
const BIG_ICON = Buffer.alloc(1200, 1) // larger than Google's generic globe (<= 400 bytes)

type Reply = { status?: number; type?: string; body?: Buffer | string }

/** Answer axios.get by URL: exact match first, else the first key the URL starts with; 404 otherwise. */
function serve(routes: Record<string, Reply>) {
  mockAxiosGet.mockImplementation(async (url: string) => {
    const reply = routes[url] ?? Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1]
    if (!reply) return { status: 404, headers: {}, data: Readable.from([]) }
    const body = typeof reply.body === 'string' ? Buffer.from(reply.body) : (reply.body ?? Buffer.alloc(0))
    return { status: reply.status ?? 200, headers: { 'content-type': reply.type ?? 'image/png' }, data: Readable.from([body]) }
  })
}

const requestedUrls = () => mockAxiosGet.mock.calls.map(c => c[0] as string)

describe('fetchFavicon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.access.mockRejectedValue(new Error('ENOENT')) // no favicon saved yet
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.mkdir.mockResolvedValue(undefined)
  })

  it('refuses a feed id that is not a UUID (it becomes a file name)', async () => {
    await expect(fetchFavicon('../../etc/passwd', 'https://example.com/rss')).rejects.toThrow('Invalid feed ID format')
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('skips a feed whose favicon already exists unless forced', async () => {
    mockFs.access.mockResolvedValue(undefined)
    expect(await fetchFavicon(FEED_ID, 'https://example.com/rss')).toEqual({ success: true, message: 'Already exists' })
    expect(mockAxiosGet).not.toHaveBeenCalled()
  })

  it("saves Google's favicon for the homepage's host", async () => {
    serve({ 'https://www.google.com/s2/favicons?domain=news.example.com': { body: BIG_ICON } })

    const result = await fetchFavicon(FEED_ID, 'https://feeds.example.com/rss', 'https://news.example.com/')

    expect(result).toEqual({ success: true, message: 'Favicon saved' })
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining(`${FEED_ID}.png`), BIG_ICON)
  })

  it("falls back to the page's <link rel=icon> when Google answers its generic globe", async () => {
    serve({
      'https://www.google.com/s2/favicons': { body: Buffer.alloc(300, 1) },
      'https://example.com/static/icon-32.png': { body: BIG_ICON },
      'https://example.com': {
        type: 'text/html',
        body: '<html><head><link rel="icon" sizes="16x16" href="/static/icon-16.png"><link rel="icon" sizes="32x32" href="/static/icon-32.png"></head></html>',
      },
    })

    const result = await fetchFavicon(FEED_ID, 'https://example.com/rss', null, true)

    expect(result.success).toBe(true)
    // The 32px icon is preferred over the 16px one
    expect(requestedUrls()).toContain('https://example.com/static/icon-32.png')
    expect(requestedUrls()).not.toContain('https://example.com/static/icon-16.png')
  })

  it('never fetches a <link href> that points at a private address', async () => {
    serve({
      'https://www.google.com/s2/favicons': { status: 404 },
      'https://example.com': { type: 'text/html', body: '<link rel="icon" href="http://169.254.169.254/latest/meta-data">' },
    })

    const result = await fetchFavicon(FEED_ID, 'https://example.com/rss', null, true)

    expect(result.success).toBe(false)
    expect(requestedUrls()).not.toContain('http://169.254.169.254/latest/meta-data')
  })

  it('ignores a response that is not an image, or that is too large', async () => {
    serve({
      'https://www.google.com/s2/favicons': { type: 'text/html', body: BIG_ICON },
      'https://example.com/favicon.ico': { body: Buffer.alloc(200_000, 1) },
    })

    const result = await fetchFavicon(FEED_ID, 'https://example.com/rss', null, true)

    expect(result).toEqual({ success: false, message: 'No favicon found for example.com' })
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('tries progressively shorter domains', async () => {
    serve({ 'https://www.google.com/s2/favicons?domain=politico.com': { body: BIG_ICON } })

    const result = await fetchFavicon(FEED_ID, 'https://feeder-prod.int.politico.com/rss', null, true)

    expect(result.success).toBe(true)
    const googleCalls = requestedUrls().filter(u => u.startsWith('https://www.google.com'))
    expect(googleCalls.map(u => new URL(u).searchParams.get('domain'))).toEqual(['feeder-prod.int.politico.com', 'int.politico.com', 'politico.com'])
  })

  it('fetches through the SSRF guard', async () => {
    serve({ 'https://www.google.com/s2/favicons': { body: BIG_ICON } })
    await fetchFavicon(FEED_ID, 'https://example.com/rss', null, true)
    expect(mockAxiosGet.mock.calls[0][1]).toEqual(expect.objectContaining({ lookup: expect.any(Function), beforeRedirect: expect.any(Function) }))
  })
})

describe('fetchAllFavicons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.mkdir.mockResolvedValue(undefined)
  })

  it('counts saved, missing and skipped favicons over the active feeds', async () => {
    const saved = '11111111-2222-4333-8444-000000000001'
    const existing = '11111111-2222-4333-8444-000000000002'
    const missing = '11111111-2222-4333-8444-000000000003'
    mockGetFeeds.mockResolvedValue([
      { id: saved, title: 'Saved', rssUrl: 'https://saved.example.com/rss', url: null },
      { id: existing, title: 'Existing', rssUrl: 'https://existing.example.com/rss', url: null },
      { id: missing, title: 'Missing', rssUrl: 'https://missing.example.com/rss', url: null },
    ])
    mockFs.access.mockImplementation(async (path: string) => {
      if (!path.includes(existing)) throw new Error('ENOENT')
    })
    serve({ 'https://www.google.com/s2/favicons?domain=saved.example.com': { body: BIG_ICON } })

    const result = await fetchAllFavicons()

    expect(mockGetFeeds).toHaveBeenCalledWith({ active: true })
    expect(result).toEqual({ succeeded: 1, failed: 1, skipped: 1, errors: ['Missing: not found'] })
  })
})

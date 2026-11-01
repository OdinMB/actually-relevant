import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'

const mockAxiosGet = vi.hoisted(() => vi.fn())
const mockStore = vi.hoisted(() => ({ hasFavicon: vi.fn(), saveFavicon: vi.fn(), activeFeedsForFavicons: vi.fn() }))
const mockToFaviconPng = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({ default: { get: mockAxiosGet } }))
vi.mock('./faviconStore.js', () => mockStore)
// Conversion has its own tests (faviconImage.test.ts); here it marks what it was given
vi.mock('./faviconImage.js', () => ({ toFaviconPng: mockToFaviconPng }))

const { fetchFavicon, fetchAllFavicons, fetchFaviconsInBackground } = await import('./favicon.js')

const FEED_ID = '11111111-2222-4333-8444-555555555555'
const BIG_ICON = Buffer.alloc(1200, 1) // larger than Google's generic globe (<= 400 bytes)
const UNDECODABLE = Buffer.alloc(1300, 2)
const converted = (raw: Buffer) => Buffer.concat([Buffer.from('png:'), raw.subarray(0, 4)])

const feed = (rssUrl: string, url: string | null = null, id = FEED_ID) => ({ id, rssUrl, url })

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

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.hasFavicon.mockResolvedValue(false)
  mockStore.saveFavicon.mockResolvedValue(undefined)
  mockToFaviconPng.mockImplementation(async (raw: Buffer) => (raw.equals(UNDECODABLE) ? null : converted(raw)))
})

describe('fetchFavicon', () => {
  it('skips a feed whose favicon is stored unless forced', async () => {
    mockStore.hasFavicon.mockResolvedValue(true)
    expect(await fetchFavicon(feed('https://example.com/rss'))).toEqual({ success: true, message: 'Already exists' })
    expect(mockAxiosGet).not.toHaveBeenCalled()
  })

  it("stores Google's favicon for the homepage's host as a PNG, with the URL it came from", async () => {
    serve({ 'https://www.google.com/s2/favicons?domain=news.example.com': { body: BIG_ICON } })

    const result = await fetchFavicon(feed('https://feeds.example.com/rss', 'https://news.example.com/'))

    expect(result).toEqual({ success: true, message: 'Favicon saved' })
    expect(mockStore.saveFavicon).toHaveBeenCalledWith(FEED_ID, converted(BIG_ICON), 'https://www.google.com/s2/favicons?domain=news.example.com&sz=32')
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

    const result = await fetchFavicon(feed('https://example.com/rss'), true)

    expect(result.success).toBe(true)
    // The 32px icon is preferred over the 16px one
    expect(requestedUrls()).toContain('https://example.com/static/icon-32.png')
    expect(requestedUrls()).not.toContain('https://example.com/static/icon-16.png')
    expect(mockStore.saveFavicon).toHaveBeenCalledWith(FEED_ID, converted(BIG_ICON), 'https://example.com/static/icon-32.png')
  })

  it('passes over an image that cannot be made into a PNG and tries the next source', async () => {
    serve({
      'https://www.google.com/s2/favicons': { body: UNDECODABLE },
      'https://example.com/favicon.ico': { type: 'image/x-icon', body: BIG_ICON },
    })

    const result = await fetchFavicon(feed('https://example.com/rss'), true)

    expect(result.success).toBe(true)
    expect(mockStore.saveFavicon).toHaveBeenCalledWith(FEED_ID, converted(BIG_ICON), 'https://example.com/favicon.ico')
  })

  it('never fetches a <link href> that points at a private address', async () => {
    serve({
      'https://www.google.com/s2/favicons': { status: 404 },
      'https://example.com': { type: 'text/html', body: '<link rel="icon" href="http://169.254.169.254/latest/meta-data">' },
    })

    const result = await fetchFavicon(feed('https://example.com/rss'), true)

    expect(result.success).toBe(false)
    expect(requestedUrls()).not.toContain('http://169.254.169.254/latest/meta-data')
  })

  it('ignores a response that is not an image, or that is too large', async () => {
    serve({
      'https://www.google.com/s2/favicons': { type: 'text/html', body: BIG_ICON },
      'https://example.com/favicon.ico': { body: Buffer.alloc(200_000, 1) },
    })

    const result = await fetchFavicon(feed('https://example.com/rss'), true)

    expect(result).toEqual({ success: false, message: 'No favicon found for example.com' })
    expect(mockToFaviconPng).not.toHaveBeenCalled()
    expect(mockStore.saveFavicon).not.toHaveBeenCalled()
  })

  it('tries progressively shorter domains', async () => {
    serve({ 'https://www.google.com/s2/favicons?domain=politico.com': { body: BIG_ICON } })

    const result = await fetchFavicon(feed('https://feeder-prod.int.politico.com/rss'), true)

    expect(result.success).toBe(true)
    const googleCalls = requestedUrls().filter(u => u.startsWith('https://www.google.com'))
    expect(googleCalls.map(u => new URL(u).searchParams.get('domain'))).toEqual(['feeder-prod.int.politico.com', 'int.politico.com', 'politico.com'])
  })

  it('fetches through the SSRF guard', async () => {
    serve({ 'https://www.google.com/s2/favicons': { body: BIG_ICON } })
    await fetchFavicon(feed('https://example.com/rss'), true)
    expect(mockAxiosGet.mock.calls[0][1]).toEqual(expect.objectContaining({ lookup: expect.any(Function), beforeRedirect: expect.any(Function) }))
  })
})

describe('fetchAllFavicons', () => {
  it('fetches only the active feeds without a stored favicon, and counts the rest as skipped', async () => {
    const saved = '11111111-2222-4333-8444-000000000001'
    const stored = '11111111-2222-4333-8444-000000000002'
    const missing = '11111111-2222-4333-8444-000000000003'
    mockStore.activeFeedsForFavicons.mockResolvedValue([
      { id: saved, title: 'Saved', rssUrl: 'https://saved.example.com/rss', url: null, hasFavicon: false },
      { id: stored, title: 'Stored', rssUrl: 'https://stored.example.com/rss', url: null, hasFavicon: true },
      { id: missing, title: 'Missing', rssUrl: 'https://missing.example.com/rss', url: null, hasFavicon: false },
    ])
    serve({ 'https://www.google.com/s2/favicons?domain=saved.example.com': { body: BIG_ICON } })

    const result = await fetchAllFavicons()

    expect(result).toEqual({ succeeded: 1, failed: 1, skipped: 1, errors: ['Missing: not found'] })
    expect(requestedUrls().some(u => u.includes('stored.example.com'))).toBe(false)
    expect(mockStore.saveFavicon.mock.calls.map(c => c[0])).toEqual([saved])
  })
})

describe('fetchFaviconsInBackground', () => {
  it('refetches each feed, even one with a stored favicon (its address changed)', async () => {
    mockStore.hasFavicon.mockResolvedValue(true)
    serve({ 'https://www.google.com/s2/favicons': { body: BIG_ICON } })

    await fetchFaviconsInBackground([feed('https://a.example/rss', null, 'a'), feed('https://b.example/rss', 'https://b.example', 'b')])

    expect(mockStore.saveFavicon.mock.calls.map(c => c[0]).sort()).toEqual(['a', 'b'])
  })

  it('settles without an error when a fetch or a save fails, so it can never fail its caller', async () => {
    serve({ 'https://www.google.com/s2/favicons': { body: BIG_ICON } })
    mockStore.saveFavicon.mockRejectedValue(new Error('database down'))

    await expect(fetchFaviconsInBackground([feed('https://a.example/rss', null, 'a'), feed('not a url', null, 'b')])).resolves.toBeUndefined()
  })

  it('fetches a few feeds at a time, not a whole changeset at once', async () => {
    let inFlight = 0
    let most = 0
    mockAxiosGet.mockImplementation(async () => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
      return { status: 200, headers: { 'content-type': 'image/png' }, data: Readable.from([BIG_ICON]) }
    })

    await fetchFaviconsInBackground(Array.from({ length: 12 }, (_, i) => feed(`https://f${i}.example/rss`, null, `f${i}`)))

    expect(mockStore.saveFavicon).toHaveBeenCalledTimes(12)
    expect(most).toBeGreaterThan(1)
    expect(most).toBeLessThanOrEqual(5)
  })
})

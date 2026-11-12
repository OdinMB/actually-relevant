import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'stream'

const mockAxiosGet = vi.hoisted(() => vi.fn())
const mockLimiterRun = vi.hoisted(() => vi.fn((_url: string, fn: () => Promise<unknown>) => fn()))

vi.mock('axios', () => ({ default: { get: mockAxiosGet } }))
vi.mock('../lib/crawlLimiter.js', () => ({ crawlLimiter: { run: mockLimiterRun } }))
// Retries have their own tests (retry.test.ts); here each attempt is the last
vi.mock('../lib/retry.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/retry.js')>()),
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

const { checkOptOut, _resetOptOutCache } = await import('./publisherOptOut.js')
const { CRAWLER_USER_AGENT } = await import('../lib/crawlerIdentity.js')
const { config } = await import('../config.js')

type Reply = { status?: number; body?: string } | Error

/** Answer axios.get by exact URL; 404 for anything else. */
function serve(routes: Record<string, Reply>) {
  mockAxiosGet.mockImplementation(async (url: string) => {
    const reply = routes[url]
    if (reply instanceof Error) throw reply
    if (!reply) return { status: 404, headers: {}, data: Readable.from([]) }
    return { status: reply.status ?? 200, headers: {}, data: Readable.from([Buffer.from(reply.body ?? '')]) }
  })
}

const PAGE = { fetchesPage: true }
const RSS_TEXT = { fetchesPage: false }
const requestedUrls = () => mockAxiosGet.mock.calls.map(c => c[0] as string)

beforeEach(() => {
  vi.clearAllMocks()
  _resetOptOutCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checkOptOut', () => {
  it('finds no reservation when the host has neither robots.txt nor tdmrep.json', async () => {
    serve({})
    expect(await checkOptOut('https://news.example/2026/story', PAGE)).toEqual({ reserved: false })
    expect(requestedUrls().sort()).toEqual(['https://news.example/.well-known/tdmrep.json', 'https://news.example/robots.txt'])
  })

  it('reserves a page robots.txt disallows for us, and names robots.txt as the reason', async () => {
    serve({ 'https://news.example/robots.txt': { body: 'User-agent: ActuallyRelevant\nDisallow: /2026/\n' } })
    const verdict = await checkOptOut('https://news.example/2026/story', PAGE)
    expect(verdict).toMatchObject({ reserved: true, unverified: false, reason: expect.stringContaining('robots.txt') })
    expect(await checkOptOut('https://news.example/other', PAGE)).toEqual({ reserved: false })
  })

  it('does not apply robots.txt path rules when no page is fetched', async () => {
    serve({ 'https://news.example/robots.txt': { body: 'User-agent: *\nDisallow: /\n' } })
    expect(await checkOptOut('https://news.example/2026/story', RSS_TEXT)).toEqual({ reserved: false })
  })

  it('reserves on Content-Signal ai-input=no, whether or not the page is fetched', async () => {
    serve({ 'https://news.example/robots.txt': { body: 'User-agent: *\nContent-Signal: search=yes, ai-input=no\nAllow: /\n' } })
    expect(await checkOptOut('https://news.example/a', PAGE)).toMatchObject({ reserved: true, reason: expect.stringContaining('Content-Signal') })
    expect(await checkOptOut('https://news.example/a', RSS_TEXT)).toMatchObject({ reserved: true, reason: expect.stringContaining('Content-Signal') })
  })

  it('reserves on a matching tdmrep.json entry, whether or not the page is fetched', async () => {
    serve({ 'https://news.example/.well-known/tdmrep.json': { body: JSON.stringify([{ location: '/news/*', 'tdm-reservation': 1 }]) } })
    expect(await checkOptOut('https://news.example/news/a', PAGE)).toMatchObject({ reserved: true, reason: expect.stringContaining('TDMRep') })
    expect(await checkOptOut('https://news.example/news/a', RSS_TEXT)).toMatchObject({ reserved: true })
    expect(await checkOptOut('https://news.example/blog/a', RSS_TEXT)).toEqual({ reserved: false })
  })

  it('allows everything when robots.txt answers any 4xx', async () => {
    for (const status of [401, 403, 410, 429]) {
      _resetOptOutCache()
      serve({ 'https://news.example/robots.txt': { status, body: 'User-agent: *\nDisallow: /\n' } })
      expect(await checkOptOut('https://news.example/a', PAGE)).toEqual({ reserved: false })
    }
  })

  it('treats robots.txt that answers 5xx, times out or cannot be reached as disallowing, unverified', async () => {
    const timeout = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
    const unreachable = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    for (const reply of [{ status: 503 }, timeout, unreachable]) {
      _resetOptOutCache()
      serve({ 'https://news.example/robots.txt': reply })
      expect(await checkOptOut('https://news.example/a', PAGE)).toMatchObject({ reserved: true, unverified: true })
      expect(await checkOptOut('https://news.example/a', RSS_TEXT)).toMatchObject({ reserved: true, unverified: true })
    }
  })

  it('treats an unreachable tdmrep.json as no reservation', async () => {
    serve({ 'https://news.example/.well-known/tdmrep.json': { status: 502 } })
    expect(await checkOptOut('https://news.example/a', PAGE)).toEqual({ reserved: false })
  })

  it('refuses a private host without fetching anything', async () => {
    serve({})
    expect(await checkOptOut('http://169.254.169.254/latest/meta-data', PAGE)).toMatchObject({ reserved: true, unverified: true })
    expect(await checkOptOut('not a url', PAGE)).toMatchObject({ reserved: true, unverified: true })
    expect(mockAxiosGet).not.toHaveBeenCalled()
  })

  it('reads only the first maxFileBytes of a large robots.txt', async () => {
    const filler = `# ${'x'.repeat(98)}\n`.repeat(Math.ceil(config.publisherOptOut.maxFileBytes / 100) + 10)
    serve({ 'https://news.example/robots.txt': { body: `User-agent: *\nDisallow: /early/\n${filler}Disallow: /late/\n` } })
    expect(await checkOptOut('https://news.example/early/a', PAGE)).toMatchObject({ reserved: true })
    expect(await checkOptOut('https://news.example/late/a', PAGE)).toEqual({ reserved: false })
  })

  it('sends the crawler user agent, through the per-domain limiter and the SSRF guard, with a timeout', async () => {
    serve({})
    await checkOptOut('https://news.example/a', PAGE)
    for (const [url, options] of mockAxiosGet.mock.calls) {
      expect(options).toMatchObject({ headers: { 'User-Agent': CRAWLER_USER_AGENT }, lookup: expect.any(Function), beforeRedirect: expect.any(Function) })
      expect(options.signal).toBeInstanceOf(AbortSignal)
      expect(mockLimiterRun).toHaveBeenCalledWith(url, expect.any(Function))
    }
  })
})

describe('checkOptOut cache', () => {
  it('reads each host once within the cache lifetime, and again after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    serve({})
    await checkOptOut('https://news.example/a', PAGE)
    await checkOptOut('https://news.example/b', RSS_TEXT)
    expect(mockAxiosGet).toHaveBeenCalledTimes(2) // robots.txt and tdmrep.json

    await checkOptOut('https://other.example/a', PAGE)
    expect(mockAxiosGet).toHaveBeenCalledTimes(4)

    vi.setSystemTime(Date.now() + config.publisherOptOut.cacheHours * 3_600_000 + 1)
    await checkOptOut('https://news.example/a', PAGE)
    expect(mockAxiosGet).toHaveBeenCalledTimes(6)
  })

  it('shares one read among concurrent checks of a host', async () => {
    serve({})
    await Promise.all([checkOptOut('https://news.example/a', PAGE), checkOptOut('https://news.example/b', PAGE), checkOptOut('https://news.example/c', PAGE)])
    expect(mockAxiosGet).toHaveBeenCalledTimes(2)
  })

  it('asks an unreachable host again after retryMinutes, not after the full lifetime', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    serve({ 'https://news.example/robots.txt': { status: 503 } })
    await checkOptOut('https://news.example/a', PAGE)
    await checkOptOut('https://news.example/a', PAGE)
    expect(mockAxiosGet).toHaveBeenCalledTimes(2)

    serve({})
    vi.setSystemTime(Date.now() + config.publisherOptOut.retryMinutes * 60_000 + 1)
    expect(await checkOptOut('https://news.example/a', PAGE)).toEqual({ reserved: false })
    expect(mockAxiosGet).toHaveBeenCalledTimes(4)
  })
})

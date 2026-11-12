import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'
import type { AxiosResponse } from 'axios'

// The opt-out check runs for real; only the network under it is faked
const mockAxiosGet = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { get: mockAxiosGet } }))
vi.mock('../lib/crawlLimiter.js', () => ({ crawlLimiter: { run: (_url: string, fn: () => Promise<unknown>) => fn() } }))
vi.mock('../lib/retry.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/retry.js')>()),
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

const { getFollowingCheckedRedirects, MAX_REDIRECTS } = await import('./checkedRedirects.js')
const { checkOptOut, _resetOptOutCache } = await import('./publisherOptOut.js')

/** Each host's robots.txt by URL (status 200 with that body, or a status); anything else 404. */
function serveHostFiles(files: Record<string, string | number>) {
  mockAxiosGet.mockImplementation(async (url: string) => {
    const file = files[url]
    if (file === undefined || typeof file === 'number') return { status: file ?? 404, headers: {}, data: Readable.from([]) }
    return { status: 200, headers: {}, data: Readable.from([Buffer.from(file)]) }
  })
}

type Page = { status: number; location?: string; body?: string }

/** A `getOnce` answering page URLs from a table, recording what was requested. */
function pages(table: Record<string, Page>) {
  const requested: string[] = []
  const getOnce = async (url: string): Promise<AxiosResponse<string>> => {
    requested.push(url)
    const page = table[url]
    if (!page) throw new Error(`unexpected request: ${url}`)
    return { status: page.status, headers: page.location ? { location: page.location } : {}, data: page.body ?? '' } as AxiosResponse<string>
  }
  return { getOnce, requested }
}

const robotsFetches = () => mockAxiosGet.mock.calls.map(c => String(c[0])).filter(u => u.endsWith('/robots.txt'))

beforeEach(() => {
  vi.clearAllMocks()
  _resetOptOutCache()
})

describe('getFollowingCheckedRedirects', () => {
  it('does not request a page on another host whose robots.txt disallows it, and reports the reservation', async () => {
    serveHostFiles({ 'https://publisher.example/robots.txt': 'User-agent: *\nDisallow: /\n' })
    const { getOnce, requested } = pages({ 'https://feeds.example/~r/item': { status: 302, location: 'https://publisher.example/story' } })

    const result = await getFollowingCheckedRedirects('https://feeds.example/~r/item', getOnce)

    expect(result).toEqual({ reservedHop: { url: 'https://publisher.example/story', reason: expect.stringContaining('robots.txt'), unverified: false } })
    expect(requested).toEqual(['https://feeds.example/~r/item'])
  })

  it('reports a target host whose robots.txt cannot be read as an unverified reservation', async () => {
    serveHostFiles({ 'https://publisher.example/robots.txt': 503 })
    const { getOnce, requested } = pages({ 'https://feeds.example/a': { status: 301, location: 'https://publisher.example/story' } })

    expect(await getFollowingCheckedRedirects('https://feeds.example/a', getOnce)).toMatchObject({ reservedHop: { unverified: true } })
    expect(requested).toEqual(['https://feeds.example/a'])
  })

  it('follows a redirect to another host that allows the page, and returns its answer', async () => {
    serveHostFiles({ 'https://publisher.example/robots.txt': 'User-agent: *\nDisallow: /private/\n' })
    const { getOnce, requested } = pages({
      'https://short.example/x': { status: 307, location: 'https://publisher.example/story' },
      'https://publisher.example/story': { status: 200, body: '<html>story</html>' },
    })

    const result = await getFollowingCheckedRedirects('https://short.example/x', getOnce)

    expect(result).toMatchObject({ response: { status: 200, data: '<html>story</html>' } })
    expect(requested).toEqual(['https://short.example/x', 'https://publisher.example/story'])
  })

  it('resolves a relative Location on the same host without reading its robots.txt again', async () => {
    serveHostFiles({})
    await checkOptOut('https://news.example/2026/r/1', { fetchesPage: true }) // the crawler checks the item URL first
    const { getOnce, requested } = pages({
      'https://news.example/2026/r/1': { status: 301, location: '../story?id=1' },
      'https://news.example/2026/story?id=1': { status: 200, body: 'ok' },
    })

    expect(await getFollowingCheckedRedirects('https://news.example/2026/r/1', getOnce)).toMatchObject({ response: { data: 'ok' } })
    expect(requested).toEqual(['https://news.example/2026/r/1', 'https://news.example/2026/story?id=1'])
    expect(robotsFetches()).toEqual(['https://news.example/robots.txt'])
  })

  it('does not request a same-host target whose path robots.txt disallows', async () => {
    serveHostFiles({ 'https://news.example/robots.txt': 'User-agent: *\nDisallow: /members/\n' })
    const { getOnce, requested } = pages({ 'https://news.example/s/1': { status: 302, location: '/members/story' } })

    expect(await getFollowingCheckedRedirects('https://news.example/s/1', getOnce)).toMatchObject({
      reservedHop: { url: 'https://news.example/members/story' },
    })
    expect(requested).toEqual(['https://news.example/s/1'])
  })

  it(`follows at most ${MAX_REDIRECTS} redirects, then fails`, async () => {
    serveHostFiles({})
    const table: Record<string, Page> = {}
    for (let i = 0; i <= MAX_REDIRECTS; i++) table[`https://loop.example/${i}`] = { status: 302, location: `/${i + 1}` }
    const { getOnce, requested } = pages(table)

    await expect(getFollowingCheckedRedirects('https://loop.example/0', getOnce)).rejects.toThrow('redirects')
    expect(requested).toHaveLength(MAX_REDIRECTS + 1)
  })

  it('refuses a redirect to a private address before checking or requesting it', async () => {
    serveHostFiles({})
    const { getOnce, requested } = pages({ 'https://feeds.example/a': { status: 302, location: 'http://169.254.169.254/latest/meta-data' } })

    await expect(getFollowingCheckedRedirects('https://feeds.example/a', getOnce)).rejects.toThrow('Blocked redirect')
    expect(requested).toEqual(['https://feeds.example/a'])
    expect(mockAxiosGet).not.toHaveBeenCalled()
  })

  it('fails on a 3xx without a Location, and returns any non-3xx answer as it came', async () => {
    serveHostFiles({})
    const { getOnce } = pages({ 'https://news.example/a': { status: 302 }, 'https://news.example/b': { status: 204 } })

    await expect(getFollowingCheckedRedirects('https://news.example/a', getOnce)).rejects.toThrow('Location')
    expect(await getFollowingCheckedRedirects('https://news.example/b', getOnce)).toMatchObject({ response: { status: 204 } })
  })
})

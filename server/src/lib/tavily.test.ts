import { describe, it, expect, vi, beforeEach } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post } }))

import { searchTavily, tavilyRequestBody, TAVILY_URL, type TavilySearch } from './tavily.js'

const KEY = 'tvly-test-secret-123'
const search: TavilySearch = { query: 'Pakistan rooftop solar 22 GW', startDate: '2026-10-29', endDate: '2026-11-19' }
const fast = { retry: { baseDelayMs: 1 } }

const okResponse = (usage?: { credits: number }) => ({
  data: {
    query: search.query,
    results: [
      {
        url: 'https://www.pakistantoday.com.pk/solar',
        title: 'Pakistan adds 22GW',
        content: 'The prime minister said …',
        raw_content: 'Full text',
        published_date: 'Wed, 12 Nov 2026 08:00:00 GMT',
        favicon: 'https://www.pakistantoday.com.pk/favicon.ico',
        score: 0.9,
      },
      { url: 'https://dawn.com/b', title: null, content: null },
    ],
    ...(usage ? { usage } : {}),
  },
})

beforeEach(() => {
  post.mockReset()
})

describe('searchTavily', () => {
  it('asks for news in the date window, at advanced depth, with favicons and raw content', () => {
    expect(tavilyRequestBody(search)).toMatchObject({
      query: search.query,
      topic: 'news',
      search_depth: 'advanced',
      start_date: '2026-10-29',
      end_date: '2026-11-19',
      include_favicon: true,
      include_raw_content: 'text',
      include_usage: true,
      max_results: 8,
    })
  })

  it('sends the key in the Authorization header only, never in the body', async () => {
    post.mockResolvedValue(okResponse({ credits: 2 }))
    await searchTavily(search, KEY)
    const [url, body, options] = post.mock.calls[0]!
    expect(url).toBe(TAVILY_URL)
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(options.headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it('reads credits from the usage field, else counts them by depth', async () => {
    post.mockResolvedValueOnce(okResponse({ credits: 3 })).mockResolvedValueOnce(okResponse())
    expect((await searchTavily(search, KEY)).credits).toBe(3)
    expect((await searchTavily(search, KEY)).credits).toBe(2)
  })

  it('maps the results, filling what Tavily left out', async () => {
    post.mockResolvedValue(okResponse({ credits: 2 }))
    expect((await searchTavily(search, KEY)).results).toEqual([
      {
        url: 'https://www.pakistantoday.com.pk/solar',
        title: 'Pakistan adds 22GW',
        content: 'The prime minister said …',
        rawContent: 'Full text',
        publishedDate: 'Wed, 12 Nov 2026 08:00:00 GMT',
        favicon: 'https://www.pakistantoday.com.pk/favicon.ico',
      },
      { url: 'https://dawn.com/b', title: '', content: '', rawContent: null, publishedDate: null, favicon: null },
    ])
  })

  it('refuses a response of an unexpected shape', async () => {
    post.mockResolvedValue({ data: { results: 'none' } })
    await expect(searchTavily(search, KEY)).rejects.toThrow(/unexpected shape/)
  })

  it('rethrows a failure with its status only, carrying neither the headers nor the key', async () => {
    const axiosLike = Object.assign(new Error(`Request failed with status code 401 (Bearer ${KEY})`), {
      config: { headers: { Authorization: `Bearer ${KEY}` } },
      response: { status: 401, data: { detail: `invalid key ${KEY}` } },
    })
    post.mockRejectedValue(axiosLike)
    const err = await searchTavily(search, KEY, fast).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Tavily search failed: HTTP 401')
    const exposed = JSON.stringify({ message: (err as Error).message, stack: (err as Error).stack, ...(err as object) })
    expect(exposed).not.toContain(KEY)
    expect(exposed).not.toContain('Authorization')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('names a network failure by its code alone', async () => {
    post.mockRejectedValue(Object.assign(new Error(`connect ENOTFOUND api.tavily.com ${KEY}`), { code: 'ENOTFOUND' }))
    const err = await searchTavily(search, KEY, fast).catch((e: unknown) => e)
    expect((err as Error).message).toBe('Tavily search failed: ENOTFOUND')
  })

  it('retries a retryable status', async () => {
    const unavailable = Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } })
    post.mockRejectedValueOnce(unavailable).mockResolvedValueOnce(okResponse({ credits: 2 }))
    expect((await searchTavily(search, KEY, fast)).results).toHaveLength(2)
    expect(post).toHaveBeenCalledTimes(2)
  })
})

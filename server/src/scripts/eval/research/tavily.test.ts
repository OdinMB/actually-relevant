import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post } }))

import { createTavilyClient, tavilyRequestBody, TAVILY_URL, type TavilySearch } from './tavily.js'

const KEY = 'tvly-test-secret-123'
const search: TavilySearch = { query: 'Pakistan rooftop solar 22 GW', startDate: '2026-10-29', endDate: '2026-11-19' }

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
    ],
    ...(usage ? { usage } : {}),
  },
})

describe('tavily client', () => {
  let dir: string
  const cacheFile = () => join(dir, '.cache', 'tavily.jsonl')
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tavily-'))
    post.mockReset()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('asks for news in the date window, at advanced depth, with favicons and raw content', () => {
    expect(tavilyRequestBody(search)).toMatchObject({
      query: search.query,
      topic: 'news',
      search_depth: 'advanced',
      start_date: '2026-10-29',
      end_date: '2026-11-19',
      include_favicon: true,
      include_raw_content: 'text',
      max_results: 8,
    })
  })

  it('sends the key in the Authorization header only, never in the body or the cache', async () => {
    post.mockResolvedValue(okResponse({ credits: 2 }))
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false })
    await client.search(search)
    const [url, body, config] = post.mock.calls[0]!
    expect(url).toBe(TAVILY_URL)
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(config.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(readFileSync(cacheFile(), 'utf8')).not.toContain(KEY)
  })

  it('reads credits from the usage field, else counts them by depth', async () => {
    post.mockResolvedValueOnce(okResponse({ credits: 3 })).mockResolvedValueOnce(okResponse())
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false })
    expect((await client.search(search)).credits).toBe(3)
    expect((await client.search({ ...search, query: 'another query' })).credits).toBe(2)
    expect(client.creditsRecorded()).toBe(5)
  })

  it('maps the results to the client shape', async () => {
    post.mockResolvedValue(okResponse({ credits: 2 }))
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false })
    const [result] = (await client.search(search)).results
    expect(result).toEqual({
      url: 'https://www.pakistantoday.com.pk/solar',
      title: 'Pakistan adds 22GW',
      content: 'The prime minister said …',
      rawContent: 'Full text',
      publishedDate: 'Wed, 12 Nov 2026 08:00:00 GMT',
      favicon: 'https://www.pakistantoday.com.pk/favicon.ico',
    })
  })

  it('answers a repeated request from the cache without a request, keeping its recorded credits', async () => {
    post.mockResolvedValue(okResponse({ credits: 2 }))
    const first = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false })
    await first.search(search)
    const resumed = createTavilyClient({ cacheFile: cacheFile(), apiKey: undefined, offline: true })
    expect(resumed.creditsRecorded()).toBe(2)
    const again = await resumed.search(search)
    expect(again).toMatchObject({ cached: true, credits: 2 })
    expect(again.results).toHaveLength(1)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('throws before any request in an offline (dry) run', async () => {
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: true })
    await expect(client.search(search)).rejects.toThrow(/offline/)
    expect(post).not.toHaveBeenCalled()
  })

  it('throws naming only the variable when the key is missing', async () => {
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: undefined, offline: false })
    await expect(client.search(search)).rejects.toThrow(/^TAVILY_API_KEY is missing$/)
    expect(post).not.toHaveBeenCalled()
  })

  it('rethrows a failure with its status only, carrying neither the headers nor the key', async () => {
    const axiosLike = Object.assign(new Error(`Request failed with status code 401 (Bearer ${KEY})`), {
      config: { headers: { Authorization: `Bearer ${KEY}` } },
      response: { status: 401, data: { detail: `invalid key ${KEY}` } },
    })
    post.mockRejectedValue(axiosLike)
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false, retry: { baseDelayMs: 1 } })
    const err = await client.search(search).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/HTTP 401/)
    const exposed = JSON.stringify({ message: (err as Error).message, stack: (err as Error).stack, ...(err as object) })
    expect(exposed).not.toContain(KEY)
    expect(exposed).not.toContain('Authorization')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('retries a retryable status and records nothing for the failed attempts', async () => {
    const unavailable = Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } })
    post.mockRejectedValueOnce(unavailable).mockResolvedValueOnce(okResponse({ credits: 2 }))
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false, retry: { baseDelayMs: 1 } })
    expect((await client.search(search)).results).toHaveLength(1)
    expect(post).toHaveBeenCalledTimes(2)
    expect(client.creditsRecorded()).toBe(2)
  })
})

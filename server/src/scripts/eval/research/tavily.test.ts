import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post } }))

import { createTavilyClient, type TavilySearch } from './tavily.js'

// The HTTP request itself (body, header, credits, retries, sanitized errors) is lib/tavily.test.ts's.
const KEY = 'tvly-test-secret-123'
const search: TavilySearch = { query: 'Pakistan rooftop solar 22 GW', startDate: '2026-10-29', endDate: '2026-11-19' }

const okResponse = (credits: number) => ({
  data: { results: [{ url: 'https://www.pakistantoday.com.pk/solar', title: 'Pakistan adds 22GW', content: 'The prime minister said …' }], usage: { credits } },
})

describe('eval tavily client', () => {
  let dir: string
  const cacheFile = () => join(dir, '.cache', 'tavily.jsonl')
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tavily-'))
    post.mockReset()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the key out of the cache file', async () => {
    post.mockResolvedValue(okResponse(2))
    await createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false }).search(search)
    expect(readFileSync(cacheFile(), 'utf8')).not.toContain(KEY)
  })

  it('answers a repeated request from the cache without a request, keeping its recorded credits', async () => {
    post.mockResolvedValueOnce(okResponse(2)).mockResolvedValueOnce(okResponse(3))
    const first = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false })
    await first.search(search)
    await first.search({ ...search, query: 'another query' })
    expect(first.creditsRecorded()).toBe(5)
    const resumed = createTavilyClient({ cacheFile: cacheFile(), apiKey: undefined, offline: true })
    expect(resumed.creditsRecorded()).toBe(5)
    const again = await resumed.search(search)
    expect(again).toMatchObject({ cached: true, credits: 2 })
    expect(again.results).toHaveLength(1)
    expect(post).toHaveBeenCalledTimes(2)
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

  it('records nothing for a failed request', async () => {
    post.mockRejectedValue(Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } }))
    const client = createTavilyClient({ cacheFile: cacheFile(), apiKey: KEY, offline: false, retry: { baseDelayMs: 1 } })
    await expect(client.search(search)).rejects.toThrow(/HTTP 401/)
    expect(client.creditsRecorded()).toBe(0)
  })
})

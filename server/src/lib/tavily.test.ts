import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post } }))

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchCreditsBound, searchTavily, tavilyRequestBody, TAVILY_URL, type TavilySearch } from './tavily.js'
import { createRunScope, runInScope } from './runUsage.js'
import { TAVILY_USD_PER_CREDIT } from './apiPrices.js'
import { _resetSpendGuard, createCap, installSpendGuard, NO_CAP, openCap, SpendCapReached, SpendRefused, type TaskCap } from './spendCap.js'
import { config } from '../config.js'

const KEY = 'tvly-test-secret-123'
const search: TavilySearch = { query: 'Pakistan rooftop solar 22 GW', startDate: '2026-10-29', endDate: '2026-11-19' }
const fast = { retry: { baseDelayMs: 1 } }

const okResponse = (usage?: { credits: number }) => ({
  status: 200,
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

  it("keeps research's request body byte for byte when no option is given", () => {
    expect(JSON.stringify(tavilyRequestBody(search))).toBe(
      '{"query":"Pakistan rooftop solar 22 GW","topic":"news","search_depth":"advanced","start_date":"2026-10-29","end_date":"2026-11-19",' +
        '"max_results":8,"include_favicon":true,"include_raw_content":"text","include_answer":false,"include_images":false,"include_usage":true}',
    )
  })

  it("takes story context's options: depth, topic and results, and no start date for an open window", () => {
    const body = tavilyRequestBody({ query: 'peatland agency Indonesia', endDate: '2026-11-14', depth: 'basic', topic: 'general', maxResults: 5 })
    expect(body).toMatchObject({ search_depth: 'basic', topic: 'general', max_results: 5, end_date: '2026-11-14', include_raw_content: 'text' })
    expect(body).not.toHaveProperty('start_date')
    expect(tavilyRequestBody({ query: 'q', startDate: '2026-10-15', endDate: '2026-11-14', depth: 'basic' })).toMatchObject({ start_date: '2026-10-15' })
  })

  it('counts a basic search without usage at one credit, and its credits reach the run it is made in', async () => {
    post.mockResolvedValue(okResponse())
    const scope = createRunScope({ jobName: 'build_story_context', flex: false })
    const answer = await runInScope(scope, () => searchTavily({ query: 'q', endDate: '2026-11-14', depth: 'basic', topic: 'general', maxResults: 5 }, KEY))
    expect(answer.credits).toBe(1)
    expect(scope.usage).toMatchObject({ searchCredits: 1, otherUsd: expect.closeTo(config.research.tavilyUsdPerCredit, 10) })
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

  it("counts the search's credits and their cost in the job run it is made in", async () => {
    post.mockResolvedValue(okResponse({ credits: 3 }))
    const scope = createRunScope({ jobName: 'research_stories', flex: false })
    await runInScope(scope, () => searchTavily(search, KEY))
    expect(scope.usage).toMatchObject({ searchCredits: 3, otherUsd: expect.closeTo(3 * config.research.tavilyUsdPerCredit, 10) })
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

describe('searchTavily under a task spend cap', () => {
  const dirs: string[] = []
  const caps: TaskCap[] = []
  const withCap = (usd: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'tavily-cap-'))
    dirs.push(dir)
    createCap(dir, 'task', usd)
    const cap = openCap(dir, 'task')
    caps.push(cap)
    installSpendGuard(cap)
    return cap
  }
  afterEach(() => {
    _resetSpendGuard()
    for (const c of caps.splice(0)) c.close()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('bounds a search by its depth: one credit at basic, two at advanced, and refuses a depth it has no price for', () => {
    expect(searchCreditsBound(tavilyRequestBody({ ...search, depth: 'basic' }))).toBe(1)
    expect(searchCreditsBound(tavilyRequestBody(search))).toBe(2)
    expect(() => searchCreditsBound({ ...tavilyRequestBody(search), search_depth: 'ultra' as never })).toThrow(SpendRefused)
  })

  it('reserves the credits before the search leaves, and settles at the credits the answer reports', async () => {
    const cap = withCap(1)
    post.mockImplementation(async () => {
      expect(cap.state()).toMatchObject({ openCount: 1, openUsd: 2 * TAVILY_USD_PER_CREDIT })
      return okResponse({ credits: 1 })
    })
    await searchTavily(search, KEY)
    expect(cap.state()).toMatchObject({ openCount: 0, settledUsd: TAVILY_USD_PER_CREDIT })
  })

  it('settles an answer without usage and a failed attempt at the reservation, and a rejected one at nothing', async () => {
    const cap = withCap(1)
    post.mockResolvedValueOnce(okResponse())
    await searchTavily(search, KEY)
    expect(cap.state().settledUsd).toBeCloseTo(2 * TAVILY_USD_PER_CREDIT, 12)
    const unavailable = Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } })
    post.mockRejectedValueOnce(unavailable).mockResolvedValueOnce(okResponse({ credits: 2 }))
    await searchTavily(search, KEY, fast)
    expect(cap.state().settledUsd).toBeCloseTo(6 * TAVILY_USD_PER_CREDIT, 12)
    post.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } }))
    await expect(searchTavily(search, KEY, fast)).rejects.toThrow(/HTTP 400/)
    expect(cap.state()).toMatchObject({ openCount: 0, settledUsd: expect.closeTo(6 * TAVILY_USD_PER_CREDIT, 12) })
  })

  it('never sends a search that does not fit, nor one without a cap, and throws the refusal itself, unretried', async () => {
    withCap(TAVILY_USD_PER_CREDIT)
    await expect(searchTavily(search, KEY, fast)).rejects.toBeInstanceOf(SpendCapReached)
    expect(post).not.toHaveBeenCalled()
    _resetSpendGuard()
    installSpendGuard(NO_CAP)
    await expect(searchTavily(search, KEY, fast)).rejects.toBeInstanceOf(SpendRefused)
    expect(post).not.toHaveBeenCalled()
  })
})

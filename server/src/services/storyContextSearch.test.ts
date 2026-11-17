import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, searchTavily } = vi.hoisted(() => ({
  mockPrisma: { contextSearchCache: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() } },
  searchTavily: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/tavily.js', () => ({ searchTavily }))

import { contextSearch, pruneSearchCache } from './storyContextSearch.js'
import { passageAround, pickNewSources, searchKey, searchResultFrom, tavilyRequestFor } from './storyContextSources.js'

const NOW = new Date('2026-11-16T01:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const policy = (refused: string[] = []) => ({ optedOut: vi.fn(async (url: string) => refused.includes(url)) })
const request = { query: 'Peat restoration  Indonesia', recent: false, endDate: '2026-11-14' }

const tavilyResult = (url: string, content = 'x'.repeat(900), rawContent: string | null = null) => ({
  url,
  title: `T ${url}`,
  content,
  rawContent,
  publishedDate: '2026-11-10',
  favicon: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.contextSearchCache.findUnique.mockResolvedValue(null)
  mockPrisma.contextSearchCache.upsert.mockResolvedValue({})
})

describe('searchKey', () => {
  it('normalizes case and spacing, and tells the recent flag apart; the end date plays no part', () => {
    expect(searchKey({ query: ' peat restoration INDONESIA ', recent: false })).toBe(searchKey({ query: 'Peat restoration  Indonesia', recent: false }))
    expect(searchKey({ query: 'peat restoration indonesia', recent: true })).not.toBe(searchKey({ query: 'peat restoration indonesia', recent: false }))
  })
})

describe('tavilyRequestFor', () => {
  it('asks at basic depth on the general topic for 5 results, ending on the story day, opening 30 days back only for recent data', () => {
    expect(tavilyRequestFor(request)).toEqual({ query: request.query, endDate: '2026-11-14', depth: 'basic', topic: 'general', maxResults: 5 })
    expect(tavilyRequestFor({ ...request, recent: true })).toMatchObject({ startDate: '2026-10-15' })
  })

  it("chooses a result's text as research does: the passages, or the raw text when they are short", () => {
    expect(searchResultFrom(tavilyResult('https://a.example', 'p'.repeat(900), 'raw')).text).toBe('p'.repeat(900))
    expect(searchResultFrom(tavilyResult('https://a.example', 'short', 'r'.repeat(5000))).text).toBe('r'.repeat(4000))
  })
})

describe('contextSearch', () => {
  it('answers a query asked within 7 days from the cache, at no credit cost', async () => {
    mockPrisma.contextSearchCache.findUnique.mockResolvedValue({
      createdAt: new Date(NOW.getTime() - 6 * DAY),
      results: [{ url: 'https://a.example', title: 't', date: null, text: 'x' }],
    })
    const answer = await contextSearch(request, policy(), NOW)
    expect(answer).toEqual({ results: [{ url: 'https://a.example', title: 't', date: null, text: 'x' }], credits: 0, cached: true })
    expect(searchTavily).not.toHaveBeenCalled()
  })

  it('searches again after 7 days, and caches only the results whose publishers do not opt out', async () => {
    mockPrisma.contextSearchCache.findUnique.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 8 * DAY), results: [] })
    searchTavily.mockResolvedValue({ results: [tavilyResult('https://refuses.example/a'), tavilyResult('https://ok.example/a')], credits: 1 })
    const answer = await contextSearch(request, policy(['https://refuses.example/a']), NOW)
    expect(answer.cached).toBe(false)
    expect(answer.credits).toBe(1)
    expect(answer.results.map(r => r.url)).toEqual(['https://ok.example/a'])
    expect(searchTavily).toHaveBeenCalledWith(expect.objectContaining({ depth: 'basic', topic: 'general', maxResults: 5 }), expect.anything())
    const write = mockPrisma.contextSearchCache.upsert.mock.calls[0]![0]
    expect(write.where.key).toBe(searchKey(request))
    expect(write.create.results.map((r: { url: string }) => r.url)).toEqual(['https://ok.example/a'])
  })

  it('prunes cached answers older than 7 days', async () => {
    mockPrisma.contextSearchCache.deleteMany.mockResolvedValue({ count: 2 })
    expect(await pruneSearchCache(NOW)).toBe(2)
    expect(mockPrisma.contextSearchCache.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(NOW.getTime() - 7 * DAY) } } })
  })
})

describe('pickNewSources', () => {
  const r = (url: string, text = 'text') => ({ url, title: 't', date: null, text })

  it("keeps at most 2 a search and 5 in all, never a URL or domain among the story's sources", () => {
    const { picked, drops } = pickNewSources(
      [
        { results: [r('https://www.orig.example/other'), r('https://a.example/1'), r('https://b.example/1'), r('https://c.example/1')] },
        { results: [r('https://a.example/1'), r('https://d.example/1'), r('https://e.example/1')] },
        { results: [r('https://f.example/1'), r('https://g.example/1'), r('https://h.example/1', ' ')] },
      ],
      { urls: ['https://known.example/story'], domains: ['orig.example'] },
    )
    expect(picked.map(p => [p.search, p.result.url])).toEqual([
      [0, 'https://a.example/1'],
      [0, 'https://b.example/1'],
      [1, 'https://d.example/1'],
      [1, 'https://e.example/1'],
      [2, 'https://f.example/1'],
    ])
    expect(drops.map(d => [d.url, d.reason])).toEqual([
      ['https://www.orig.example/other', 'known'],
      ['https://c.example/1', 'per-query'],
      ['https://a.example/1', 'known'],
      ['https://g.example/1', 'cap'],
      ['https://h.example/1', 'empty'],
    ])
  })

  it('drops research’s blocklisted domains and a known URL', () => {
    const { picked, drops } = pickNewSources([{ results: [r('https://news.prnewswire.com/x'), r('https://known.example/story/')] }], {
      urls: ['https://known.example/story'],
      domains: [],
    })
    expect(picked).toEqual([])
    expect(drops.map(d => d.reason)).toEqual(['blocklist', 'known'])
  })
})

describe('passageAround', () => {
  it('keeps the sentence with one either side, and the sentence alone when not found or too long', () => {
    const text = 'First one. Second one. The key sentence is here. Fourth one. Fifth.'
    expect(passageAround(text, 'The key sentence is here.')).toBe('Second one. The key sentence is here. Fourth one.')
    expect(passageAround(text, 'Not in the text.')).toBe('Not in the text.')
    expect(passageAround(`${'a'.repeat(500)}. The key sentence. ${'b'.repeat(500)}.`, 'The key sentence.')).toBe('The key sentence.')
  })
})

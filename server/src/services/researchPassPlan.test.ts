import { describe, expect, it } from 'vitest'
import type { GapList } from '../schemas/storyContext.js'
import { researchStory } from '../test/passFixtures.js'
import { coverageSearches, gapSearches, knownPages, laterStory, laterWindow, readPages } from './researchPassPlan.js'
import { EMPTY_POOL, type Pool, type PoolSearch, type PoolSource } from './researchPool.js'

const gap = (response: 'yes' | 'no', searches: GapList['searches'] = [], quote = ''): GapList => ({
  slots: [
    { slot: 'compared', needed: true, covered: 'no' },
    { slot: 'response', needed: true, covered: response },
  ],
  responseInStory: quote,
  responseSearches: { action: 'peat restoration', elsewhere: 'peat fires prevented elsewhere' },
  searches,
})

const made = (query: string, extra: Partial<PoolSearch> = {}): PoolSearch => ({
  kind: 'gap',
  slot: 'compared',
  angle: null,
  query,
  normalizedQuery: query.toLowerCase(),
  windowStart: null,
  windowEnd: null,
  depth: 'basic',
  credits: 1,
  results: 3,
  cached: false,
  passId: 'p1',
  ...extra,
})

const page = (ref: string, url: string, extra: Partial<PoolSource> = {}): PoolSource => ({
  id: 'row',
  ref,
  origin: 'search',
  earlierStoryId: null,
  url,
  outlet: '',
  title: '',
  date: null,
  kind: 'news-report',
  country: '',
  relation: '',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: 'p1',
  ...extra,
})

const story = { title: 'Indonesia peat fires burn record area', text: 'Fires burned 2.8 million hectares.' }
const compared = { slot: 'compared' as const, wanted: 'w', query: 'peat fires record years', recent: false }

describe('gapSearches', () => {
  it('searches both response angles first while the story neither reports nor covers the response', () => {
    const plan = gapSearches(gap('no', [compared]), story, EMPTY_POOL)
    expect(plan.searches.map(s => [s.slot, s.angle ?? null])).toEqual([
      ['response', 'action'],
      ['response', 'elsewhere'],
      ['compared', null],
    ])
  })

  it('searches no response angle once a fact covers the response', () => {
    expect(gapSearches(gap('yes', [compared]), story, EMPTY_POOL).searches.map(s => s.slot)).toEqual(['compared'])
  })

  it('skips, and lists, a query and a response angle the pool searched in any earlier pass, coverage queries included', () => {
    const pool: Pool = {
      ...EMPTY_POOL,
      searches: [made('Peat Fires  Record Years', { kind: 'coverage', slot: null }), made('x', { slot: 'response', angle: 'action' })],
    }
    const plan = gapSearches(gap('no', [compared]), story, pool)
    expect(plan.searches.map(s => s.query)).toEqual(['peat fires prevented elsewhere'])
    expect(plan.skipped.map(s => s.query)).toEqual(['peat restoration', 'peat fires record years'])
  })
})

describe('coverageSearches', () => {
  it('keeps the queries no earlier pass made, in order, and lists the rest', () => {
    const pool: Pool = { ...EMPTY_POOL, searches: [made('kenya floods', { kind: 'coverage', slot: null })] }
    const queries = [
      { query: 'Kenya  Floods', language: 'en' },
      { query: 'Kenia Überschwemmungen', language: 'de' },
    ]
    expect(coverageSearches(queries, pool)).toEqual({ search: [queries[1]], skipped: [queries[0]] })
  })
})

describe('the pages a pass does not read again', () => {
  const pool: Pool = {
    ...EMPTY_POOL,
    sources: [page('S0', 'https://www.news.example/story?utm_source=x'), page('E1', '', { origin: 'earlier', earlierStoryId: 'st-1' })],
    dropped: [{ url: 'https://paywall.example/a', reason: 'unusable', passId: 'p1' }],
  }

  it('are the pages the pool holds and those it left out, by their normalized address', () => {
    expect([...knownPages(pool)].sort()).toEqual(['news.example/story', 'paywall.example/a'])
  })

  it('give the gap searches the pages, their domains and the pages read before', () => {
    expect(readPages(pool)).toEqual({ urls: ['https://www.news.example/story?utm_source=x'], domains: ['news.example'], read: ['https://paywall.example/a'] })
  })
})

describe("a later pass's window", () => {
  it('starts at the last pass’s day and ends today, or at the eval’s sampling day before it', () => {
    expect(laterWindow('2026-11-14', '2026-11-20')).toEqual({ start: '2026-11-14', end: '2026-11-20' })
    expect(laterWindow('2026-11-14T22:00:00.000Z', '2026-11-20T01:00:00.000Z', '2026-11-18T00:00:00Z')).toEqual({ start: '2026-11-14', end: '2026-11-18' })
    expect(laterWindow('2026-11-21', '2026-11-20')).toEqual({ start: '2026-11-20', end: '2026-11-20' })
  })

  it('offers the earlier-coverage step only our stories published since and not linked yet', () => {
    const candidate = (id: string, day: string) => ({
      id,
      slug: null,
      title: id,
      titleLabel: null,
      summary: '',
      relevanceSummary: '',
      whyItMatters: '',
      datePublished: `${day}T08:00:00.000Z`,
      distance: 0.1,
    })
    const story = researchStory({ earlier: [candidate('old', '2026-11-10'), candidate('linked', '2026-11-16'), candidate('new', '2026-11-16')] })
    const linked = { sources: [page('E1', '', { origin: 'earlier', earlierStoryId: 'linked' })] }
    expect(laterStory(story, linked, { start: '2026-11-14', end: '2026-11-20' }).earlier.map(e => e.id)).toEqual(['new'])
  })
})

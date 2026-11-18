import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { promptParts, promptText } from '../lib/promptCache.js'
import type { GapList } from '../schemas/storyContext.js'
import { researchStory } from '../test/passFixtures.js'
import {
  coverageSearches,
  gapSearches,
  knownPages,
  laterStory,
  laterWindow,
  planKey,
  planSteps,
  readPages,
  storedPlan,
  type CoveragePlan,
  type PlanRecord,
} from './researchPassPlan.js'
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
  const coverage = (query: string, start: string | null, end: string | null) =>
    made(query, { kind: 'coverage', slot: null, windowStart: start, windowEnd: end })
  const window = { start: '2026-11-15', end: '2026-11-20' }

  it('keeps the queries no earlier pass searched over this window, in order, and lists the rest', () => {
    const pool: Pool = { ...EMPTY_POOL, searches: [coverage('kenya floods', '2026-11-10', '2026-11-20')] }
    const queries = [
      { query: 'Kenya  Floods', language: 'en' },
      { query: 'Kenia Überschwemmungen', language: 'de' },
    ]
    expect(coverageSearches(queries, pool, window)).toEqual({ search: [queries[1]], skipped: [queries[0]] })
  })

  it('searches a query made before again over the days that search did not cover: a later pass looks for what was reported since', () => {
    const queries = [{ query: 'Kenya floods', language: 'en' }]
    // The first pass searched up to the 15th; this pass's window runs to the 20th
    const before = { ...EMPTY_POOL, searches: [coverage('kenya floods', '2026-11-08', '2026-11-15')] }
    expect(coverageSearches(queries, before, window)).toEqual({ search: queries, skipped: [] })
    // A legacy run's search, or a gap search of the same words, has no window it covered
    const unknown = { ...EMPTY_POOL, searches: [coverage('kenya floods', null, null), made('kenya floods')] }
    expect(coverageSearches(queries, unknown, window)).toEqual({ search: queries, skipped: [] })
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

describe('the coverage plan', () => {
  const schema = z.object({ queries: z.array(z.string()) })
  const written = [{ query: 'peat fires', language: 'en' }]
  const empty = (): PlanRecord => ({ confirm: null, queries: null, use: {} })

  it("keys a step on its prompt's text and its schema, split or whole alike", () => {
    expect(planKey(promptParts('Rules.', 'Data.'), schema)).toBe(planKey(promptText(promptParts('Rules.', 'Data.')), schema))
    expect(planKey('Rules.\n\nOther data.', schema)).not.toBe(planKey('Rules.\n\nData.', schema))
    expect(planKey('Rules.', schema)).not.toBe(planKey('Rules.', z.object({ queries: z.array(z.number()) })))
  })

  it('takes the stored answer under the same key without asking, and asks under another', async () => {
    const stored: CoveragePlan = { confirm: null, queries: { key: planKey('Prompt.', schema), answer: written } }
    const ask = vi.fn(async () => [{ query: 'asked', language: 'en' }])

    const same = empty()
    expect(await planSteps(same, stored, false)('queries', 'Prompt.', schema, ask)).toEqual(written)
    expect(ask).not.toHaveBeenCalled()
    expect(same).toEqual({ confirm: null, queries: stored.queries, use: { queries: 'reused' } })

    const other = empty()
    expect(await planSteps(other, stored, false)('queries', 'Another prompt.', schema, ask)).toEqual([{ query: 'asked', language: 'en' }])
    expect(other).toMatchObject({ queries: { key: planKey('Another prompt.', schema) }, use: { queries: 'changed' } })
  })

  it('asks on a first pass and with nothing stored, and keeps no answer the call did not give', async () => {
    const stored: CoveragePlan = { confirm: null, queries: { key: planKey('Prompt.', schema), answer: written } }
    const first = empty()
    await planSteps(first, stored, true)('queries', 'Prompt.', schema, async () => written)
    expect(first.use).toEqual({ queries: 'first pass' })

    const none = empty()
    expect(await planSteps(none, null, false)('confirm', 'Prompt.', schema, async () => null)).toBeNull()
    expect(none).toEqual({ confirm: null, queries: null, use: { confirm: 'no stored plan' } })
  })

  it('reads a stored plan, a step that does not read as an entry as none, and anything else as no plan', () => {
    expect(storedPlan({ confirm: { key: 'k', answer: [2] }, queries: { key: 'q', answer: 'not a list' }, use: {} })).toEqual({
      confirm: { key: 'k', answer: [2] },
      queries: null,
    })
    expect(storedPlan({})).toEqual({ confirm: null, queries: null })
    expect(storedPlan(null)).toBeNull()
    expect(storedPlan('plan')).toBeNull()
  })
})

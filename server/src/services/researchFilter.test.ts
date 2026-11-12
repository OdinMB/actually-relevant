import { describe, it, expect } from 'vitest'
import {
  anchorDate,
  domainOf,
  dropOptedOut,
  filterCandidates,
  keepExtracted,
  searchWindow,
  MAX_SOURCES,
  PASSAGE_MIN_CHARS,
  RAW_CONTENT_MAX_CHARS,
  type CandidateSource,
} from './researchFilter.js'

/** Text of `n` words unique to `seed`, so two sources only overlap where a test makes them. */
const text = (seed: string, n = 120) => Array.from({ length: n }, (_, i) => `${seed}word${i}`).join(' ')

const WINDOW = { start: '2026-10-29', end: '2026-11-19' }
const ORIGINAL = { url: 'https://www.pakistantoday.com.pk/2026/11/12/solar', text: text('original') }

function source(url: string, over: Partial<CandidateSource> = {}): CandidateSource {
  return {
    origin: 'search',
    url,
    title: url,
    outlet: domainOf(url),
    date: '2026-11-12',
    passages: text(url, 200),
    rawContent: null,
    favicon: null,
    ...over,
  }
}

const run = (search: CandidateSource[], own: CandidateSource[] = []) => filterCandidates({ original: ORIGINAL, own, search, window: WINDOW })
const keptUrls = (r: ReturnType<typeof run>) => r.selected.map(s => s.url)
const reasonOf = (r: ReturnType<typeof run>, url: string) => r.dropped.find(d => d.url === url)?.reason

describe('searchWindow and anchorDate', () => {
  it('spans 14 days before to 7 days after the anchor', () => {
    expect(searchWindow('2026-11-12T09:30:00.000Z')).toEqual(WINDOW)
  })

  it('caps the end at the sampling date, so a recent story never asks for a future date', () => {
    expect(searchWindow('2026-11-12T09:30:00.000Z', '2026-11-13T08:00:00.000Z')).toEqual({ start: '2026-10-29', end: '2026-11-13' })
    expect(searchWindow('2026-11-12T09:30:00.000Z', '2026-12-31T00:00:00.000Z')).toEqual(WINDOW)
  })

  it("anchors on the article's own date when it is plausible, else on the crawl date", () => {
    expect(anchorDate('2026-11-11T20:00:00.000Z', '2026-11-12T06:00:00.000Z')).toBe('2026-11-11T20:00:00.000Z')
    expect(anchorDate(null, '2026-11-12T06:00:00.000Z')).toBe('2026-11-12T06:00:00.000Z')
    expect(anchorDate('1970-01-01T00:00:00.000Z', '2026-11-12T06:00:00.000Z')).toBe('2026-11-12T06:00:00.000Z')
    expect(anchorDate('2026-12-30T00:00:00.000Z', '2026-11-12T06:00:00.000Z')).toBe('2026-11-12T06:00:00.000Z')
  })
})

describe('filterCandidates', () => {
  it('drops results dated outside the window, and undated ones', () => {
    const r = run([
      source('https://a.example/early', { date: '2026-10-28' }),
      source('https://b.example/late', { date: '2026-11-20' }),
      source('https://c.example/undated', { date: null }),
      source('https://d.example/in', { date: 'Wed, 19 Nov 2026 23:00:00 GMT' }),
    ])
    expect(keptUrls(r)).toEqual(['https://d.example/in'])
    expect(r.dropped.map(d => d.reason)).toEqual(['date', 'date', 'undated'])
  })

  it("drops the original's own URL and domain, and blocklisted domains", () => {
    const r = run([
      source('https://pakistantoday.com.pk/2026/11/12/solar/'),
      source('https://www.pakistantoday.com.pk/other-story'),
      source('https://www.prnewswire.com/news/solar'),
      source('https://news.globenewswire.com/solar'),
      source('https://www.reuters.com/solar'),
    ])
    expect(keptUrls(r)).toEqual(['https://www.reuters.com/solar'])
    expect(r.dropped.map(d => d.reason)).toEqual(['original', 'original', 'blocklist', 'blocklist'])
  })

  it('keeps one result per domain, the first', () => {
    const r = run([source('https://www.dawn.com/a'), source('https://dawn.com/b'), source('https://www.bbc.co.uk/a'), source('https://news.bbc.co.uk/b')])
    expect(keptUrls(r)).toEqual(['https://www.dawn.com/a', 'https://www.bbc.co.uk/a'])
    expect(r.dropped.map(d => d.reason)).toEqual(['same-domain', 'same-domain'])
  })

  it('collapses syndicated copies to the earliest, and drops copies of the original', () => {
    const wire = text('wire', 150)
    const r = run([
      source('https://a.example/copy', { date: '2026-11-13', passages: `${wire} extra lines from the second outlet` }),
      source('https://b.example/copy', { date: '2026-11-11', passages: `A local intro. ${wire}` }),
      source('https://c.example/original-copy', { passages: ORIGINAL.text }),
      source('https://d.example/own-text'),
    ])
    expect(keptUrls(r)).toEqual(['https://b.example/copy', 'https://d.example/own-text'])
    expect(reasonOf(r, 'https://a.example/copy')).toBe('syndicated')
    expect(reasonOf(r, 'https://c.example/original-copy')).toBe('syndicated')
  })

  it('fills own sources first and holds the caps', () => {
    const cluster = ['a', 'b', 'c'].map(n => source(`https://cluster-${n}.example/x`, { origin: 'cluster' }))
    const neighbours = ['a', 'b', 'c'].map(n => source(`https://neighbour-${n}.example/x`, { origin: 'neighbour' }))
    const search = ['a', 'b', 'c', 'd'].map(n => source(`https://search-${n}.example/x`))
    const r = run(search, [...cluster, ...neighbours])
    expect(r.selected).toHaveLength(MAX_SOURCES - 1)
    expect(keptUrls(r)).toEqual([
      'https://cluster-a.example/x',
      'https://cluster-b.example/x',
      'https://neighbour-a.example/x',
      'https://neighbour-b.example/x',
      'https://search-a.example/x',
    ])
    expect(r.dropped.filter(d => d.reason === 'cap')).toHaveLength(5)
  })

  it('prefers a country domain not yet covered when filling from search, keeping the input order', () => {
    const r = run([source('https://one.com/x'), source('https://two.com/x'), source('https://three.de/x')], [])
    expect(keptUrls(r)).toEqual(['https://one.com/x', 'https://two.com/x', 'https://three.de/x'])
    const capped = run(
      [source('https://one.com/x'), source('https://two.com/x'), source('https://three.de/x'), source('https://four.fr/x')],
      [source('https://own-a.com/x', { origin: 'cluster' }), source('https://own-b.com/x', { origin: 'cluster' })],
    )
    // 2 own + 3 from search: the .de and .fr results win over a second .com one
    expect(keptUrls(capped).slice(2)).toEqual(['https://one.com/x', 'https://three.de/x', 'https://four.fr/x'])
    expect(reasonOf(capped, 'https://two.com/x')).toBe('cap')
  })

  it('uses raw content, cut, only when the passages are short', () => {
    const long = 'p'.repeat(PASSAGE_MIN_CHARS)
    const raw = `${text('raw', 400)} ${'r'.repeat(RAW_CONTENT_MAX_CHARS)}`
    const r = run([
      source('https://short.example/x', { passages: 'Only a short passage.', rawContent: raw }),
      source('https://long.example/x', { passages: long, rawContent: text('rawlong', 400) }),
      source('https://none.example/x', { passages: 'Only a short passage too.', rawContent: null }),
    ])
    const [short, longKept, none] = r.selected
    expect(short).toMatchObject({ usedRawContent: true })
    expect(short?.text).toHaveLength(RAW_CONTENT_MAX_CHARS)
    expect(longKept).toMatchObject({ usedRawContent: false, text: long })
    expect(none).toMatchObject({ usedRawContent: false, text: 'Only a short passage too.' })
    expect(r.rawContentUsed).toBe(1)
  })

  it('takes a result two queries both returned once, without counting a drop', () => {
    const r = run([source('https://a.example/x'), source('https://a.example/x/')])
    expect(keptUrls(r)).toEqual(['https://a.example/x'])
    expect(r.dropped).toEqual([])
  })
})

describe('keepExtracted', () => {
  type S = { name: string; isOriginal: boolean; extraction: { usable: boolean; relation: 'same-development' | 'background' | 'off-topic'; kind: string } }
  const s = (name: string, kind: string, over: Partial<S['extraction']> = {}, isOriginal = false): S => ({
    name,
    isOriginal,
    extraction: { usable: true, relation: 'same-development', kind, ...over },
  })

  it('drops opinion and press releases when a news report exists', () => {
    const r = keepExtracted([s('S0', 'analysis', {}, true), s('news', 'news-report'), s('op', 'opinion'), s('pr', 'press-release'), s('bg', 'analysis')])
    expect(r.kept.map(k => k.name)).toEqual(['S0', 'news', 'bg'])
    expect(r.dropped.map(d => [d.source.name, d.reason])).toEqual([
      ['op', 'opinion'],
      ['pr', 'press-release'],
    ])
  })

  it('keeps opinion and press releases when no news report exists', () => {
    const r = keepExtracted([s('S0', 'analysis', {}, true), s('op', 'opinion'), s('pr', 'press-release')])
    expect(r.kept.map(k => k.name)).toEqual(['S0', 'op', 'pr'])
  })

  it('drops unusable and off-topic sources, never the original', () => {
    const r = keepExtracted([
      s('S0', 'news-report', { usable: false, relation: 'off-topic' }, true),
      s('paywall', 'other', { usable: false }),
      s('elsewhere', 'news-report', { relation: 'off-topic' }),
      s('older', 'analysis', { relation: 'background' }),
    ])
    expect(r.kept.map(k => k.name)).toEqual(['S0', 'older'])
    expect(r.dropped.map(d => d.reason)).toEqual(['unusable', 'off-topic'])
  })
})

describe('dropOptedOut', () => {
  const optedOut = new Set(['https://refuses.example/a', 'https://dawn.com/own'])
  const policy = { optedOut: async (url: string) => optedOut.has(url) }

  it('drops the candidates the policy reports opted out with opt-out, own and search alike, and keeps the rest in order', async () => {
    const own = [source('https://dawn.com/own', { origin: 'cluster' }), source('https://geo.tv/own', { origin: 'neighbour' })]
    const search = [source('https://reuters.com/a'), source('https://refuses.example/a'), source('https://bbc.co.uk/b')]
    const r = await dropOptedOut({ own, search }, policy)
    expect(r.own.map(c => c.url)).toEqual(['https://geo.tv/own'])
    expect(r.search.map(c => c.url)).toEqual(['https://reuters.com/a', 'https://bbc.co.uk/b'])
    expect(r.dropped).toEqual([
      { url: 'https://dawn.com/own', origin: 'cluster', reason: 'opt-out' },
      { url: 'https://refuses.example/a', origin: 'search', reason: 'opt-out' },
    ])
  })

  it('keeps everything, checking nothing, without a policy', async () => {
    const search = [source('https://refuses.example/a')]
    expect(await dropOptedOut({ own: [], search }, undefined)).toEqual({ own: [], search, dropped: [] })
  })
})

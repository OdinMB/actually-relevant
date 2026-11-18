import { describe, expect, it } from 'vitest'
import { WorkingPool, type OfferedFact } from './researchPassPool.js'
import { EMPTY_POOL, type Pool, type PoolFact, type PoolSource } from './researchPool.js'
import type { ContextFactData } from './storyContextChecks.js'

const page = (ref: string, url: string, over: Partial<PoolSource> = {}): PoolSource => ({
  id: `id-${ref}`,
  ref,
  origin: 'search',
  earlierStoryId: null,
  url,
  outlet: `Outlet ${ref}`,
  title: `Title ${ref}`,
  date: '2026-11-12',
  kind: 'news-report',
  country: '',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: 'pass-0',
  ...over,
})

const poolFact = (ref: string): PoolFact => ({
  id: `id-${ref}`,
  ref,
  sourceRef: ref.replace(/F\d+$/, ''),
  reusedFromId: null,
  supportingSentence: `Sentence of ${ref}.`,
  passage: null,
  supportFound: true,
  statement: `Statement of ${ref}.`,
  measures: '',
  slot: null,
  structured: null,
  extractedBy: { model: 'm', promptVersion: 'v' },
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: 'pass-0',
  drop: null,
})

const contextFact = (ref: string, url: string, statement: string): ContextFactData => ({
  ref,
  origin: 'search',
  reusedFromId: null,
  slot: null,
  source: { id: ref.replace(/F\d+$/, ''), url, outlet: 'Outlet', title: 'Title', date: '2026-09-30', kind: 'news-report' },
  supportingSentence: `Sentence: ${statement}`,
  passage: null,
  supportFound: true,
  statement,
  value: null,
  valueHigh: null,
  unit: '',
  approx: 'exact',
  provisional: false,
  counted: '',
  place: '',
  asOf: null,
  credited: '',
  creditedKind: null,
  validity: 'fixed',
  verdict: 'unjudged',
  verdictProblem: null,
  model: 'm',
  promptVersion: 'v',
})

/** An earlier story's fact on `url`, as the input offers it. */
const offered = (storyId: string, id: string, url: string): OfferedFact => ({ storyId, fact: { ...contextFact('X1F1', url, `Earlier fact ${id}.`), id } })

const earlier = page('E1', '', { origin: 'earlier', earlierStoryId: 'earlier-a', outlet: 'Actually Relevant' })
const pool: Pool = {
  ...EMPTY_POOL,
  sources: [page('S0', 'https://original.example/a'), page('S1', 'https://dawn.example/a'), earlier],
  facts: [poolFact('S1F1')],
}

describe('WorkingPool', () => {
  it('offers a linked earlier story’s facts under refs it reserves after the pages, and the gap searches number their pages after them', () => {
    const working = new WorkingPool(pool, 'pass-1')
    const facts = working.offer([
      offered('earlier-b', 'b', 'https://b.example/x'),
      offered('earlier-a', 'a1', 'https://a.example/x'),
      offered('earlier-a', 'a2', 'https://a.example/x'),
    ])

    expect(facts.map(f => [f.ref, f.source.id, f.reusedFromId, f.verdict])).toEqual([
      ['S2F1', 'S2', 'a1', 'supported'],
      ['S2F2', 'S2', 'a2', 'supported'],
    ])
    expect(working.nextPageNumber()).toBe(3)
    // Offered again, each keeps its refs
    expect(working.offer([offered('earlier-a', 'a2', 'https://a.example/x')]).map(f => f.ref)).toEqual(['S2F2'])
  })

  it("offers a fact of a page the pool holds under that page's ref, and a fact the pool then adds to the page skips the reserved ref", () => {
    const working = new WorkingPool(pool, 'pass-1')
    const [fact] = working.offer([offered('earlier-a', 'a', 'https://dawn.example/a')])
    expect(fact).toMatchObject({ ref: 'S1F2', source: { id: 'S1' } })

    working.admitGapFacts([contextFact('S9F1', 'https://dawn.example/a', 'A gap fact.')], true)
    expect(working.facts.map(f => f.ref)).toEqual(['S1F1', 'S1F3'])
  })

  it('admits a cited offered fact under the refs the card cites, and a gap page at its address takes the reserved ref', () => {
    const working = new WorkingPool(pool, 'pass-1')
    const [fact] = working.offer([offered('earlier-a', 'a', 'https://a.example/x')])
    working.admitGapFacts([contextFact('S3F1', 'https://a.example/x', 'A gap fact.'), contextFact('S4F1', 'https://c.example/y', 'Another.')], true)
    working.admitOffered(fact!)

    expect(working.sources.filter(s => s.id === null).map(s => [s.ref, s.url])).toEqual([
      ['S2', 'https://a.example/x'],
      ['S4', 'https://c.example/y'],
    ])
    expect(working.facts.filter(f => f.id === null).map(f => [f.ref, f.verdict, f.reusedFromId])).toEqual([
      ['S2F2', 'unjudged', null],
      ['S4F1', 'unjudged', null],
      ['S2F1', 'supported', 'a'],
    ])
  })

  it('never offers a fact the pool holds, nor one of a story the pass does not link', () => {
    const held = { ...poolFact('S1F2'), statement: 'Earlier fact held.', supportingSentence: 'Sentence: Earlier fact held.', sourceRef: 'S1' }
    const working = new WorkingPool({ ...pool, facts: [...pool.facts, held] }, 'pass-1')
    const again: OfferedFact = { storyId: 'earlier-a', fact: { ...contextFact('X1F1', 'https://dawn.example/a', 'Earlier fact held.'), id: 'h' } }
    expect(working.offer([again, offered('earlier-z', 'z', 'https://z.example/x')])).toEqual([])
  })
})

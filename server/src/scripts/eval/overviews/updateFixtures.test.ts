import { describe, expect, it } from 'vitest'
import { buildResearchedStory } from '../../../services/researchedStory.js'
import { researchView, type Article, type ArticleVersionData, type PoolFact, type PoolSource } from '../../../services/researchPool.js'
import type { AnswerKey } from './keySchema.js'
import { updateCaseCeiling, updateFixtures, updateSlugs, type UpdateStory } from './updateFixtures.js'

const source = (ref: string): PoolSource => ({
  id: `src-${ref}`,
  ref,
  origin: ref === 'S0' ? 'original' : 'search',
  earlierStoryId: null,
  url: `https://news.example/${ref}`,
  outlet: 'News',
  title: 'Floods',
  date: '2026-10-01',
  kind: 'news-report',
  country: '',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: false,
  firstPassId: null,
})

const fact = (ref: string, statement: string, over: Partial<PoolFact> = {}): PoolFact => ({
  id: `fact-${ref}`,
  ref,
  sourceRef: ref.replace(/F\d+$/, ''),
  reusedFromId: null,
  supportingSentence: `${statement} (source)`,
  passage: null,
  supportFound: true,
  statement,
  measures: '',
  slot: null,
  structured: null,
  extractedBy: { model: 'm', promptVersion: 'legacy' },
  verdict: 'unjudged',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: null,
  drop: null,
  ...over,
})

const pool = {
  sources: [source('S0'), source('S1')],
  facts: [
    fact('S1F1', 'Floods displaced 4,000 people in 2026.', { measures: 'people displaced' }),
    fact('S1F2', 'Aid groups sent tents.'),
    fact('S1F3', 'An uncited fact.'),
  ],
}

const article: Article = {
  titleLabel: 'Floods',
  title: 'Floods hit the valley',
  story: [
    { text: 'Floods displaced 4,000 people in the valley.', factIds: ['S1F1'] },
    { text: 'Aid groups sent tents.', factIds: ['S1F2'] },
  ],
  whyThisMatters: [{ text: 'Thousands lost their homes.', factIds: ['S1F1'] }],
  caveats: [],
  summary: 'Floods displaced thousands.',
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Floods in the valley.',
}

const version: ArticleVersionData = {
  id: null,
  number: 1,
  kind: 'legacy',
  status: 'current',
  passId: null,
  title: article.title,
  titleLabel: article.titleLabel,
  summary: article.summary,
  marketingBlurb: article.marketingBlurb,
  quote: null,
  quoteAttribution: null,
  relevanceReasons: null,
  antifactors: null,
  emotionTag: null,
  research: buildResearchedStory({ draft: article, ...researchView(pool) }),
  article: null,
  changes: [],
  note: null,
}

const story: UpdateStory = { slug: 'floods-a', storyDay: '2026-10-01', version, pool }

const value = (v: number, asOf: string, quote: string, matches = true) => ({
  figure: 'displaced',
  value: v,
  approx: 'about' as const,
  asOf,
  matches,
  countedAs: matches ? null : 'one district',
  quote,
})

const entry = (slug: string, date: string, over: Partial<AnswerKey['entries'][number]> = {}): AnswerKey['entries'][number] => ({
  slug,
  date,
  title: `Story ${slug}`,
  join: 'must',
  role: 'routine',
  kind: null,
  values: [],
  statuses: [],
  why: 'belongs',
  ...over,
})

const key: AnswerKey = {
  schemaVersion: 1,
  id: 'floods',
  title: 'Valley floods',
  charter: { in: 'The valley floods.', out: [], endEvent: 'Waters recede.' },
  figures: [{ key: 'displaced', name: 'Displaced', unit: 'people', definition: 'people displaced in the valley', cumulative: true, variants: [] }],
  entries: [
    entry('floods-a', '2026-10-01', { values: [value(4000, '2026-10-01', 'displaced 4,000 people')] }),
    entry('floods-b', '2026-10-05', {
      role: 'turning_point',
      kind: 'response',
      title: 'Army opens relief camps',
      values: [value(9000, '2026-10-05', 'nearly 9,000')],
    }),
    entry('floods-c', '2026-10-06', { values: [value(500, '2026-10-06', '500 in one district', false)] }),
    entry('floods-late', '2026-12-30', { values: [value(20000, '2026-12-30', '20,000')] }),
    entry('floods-optional', '2026-10-03', { join: 'optional' }),
  ],
  nearMisses: [{ slug: 'drought-north', date: '2026-10-02', title: 'Drought hits the north', why: 'Same region, other disaster.' }],
  notes: '',
}

const stories = new Map<string, UpdateStory | null>([
  ['floods-a', story],
  ['floods-b', null],
])

describe('updateFixtures', () => {
  const { fixtures, left } = updateFixtures([key], stories, { half: 'all' })
  const of = (kind: string) => fixtures.find(f => f.kind === kind)!

  it('loads every must entry of the keys once', () => {
    expect(updateSlugs([key, key], 'all')).toEqual(['floods-a', 'floods-b', 'floods-c', 'floods-late'])
  })

  it("gives a story the later entries' matching figure values and turning points in the window as fresh facts", () => {
    const k = of('key')
    const added = k.input.pool.facts.filter(f => k.input.fresh.has(f.ref))
    expect(added.map(f => f.statement)).toEqual(['Displaced (people displaced in the valley): about 9,000 people as of 2026-10-05.', 'Army opens relief camps'])
    expect(added.map(f => f.ref)).toEqual(['S2F1', 'S3F1'])
    expect(added[0]).toMatchObject({ supportingSentence: 'nearly 9,000', verdict: 'supported', structured: { asOf: '2026-10-05', value: 9000 } })
    // A changed figure is expected flagged where the story states it; the turning point on any section
    expect(k.expected).toEqual({
      sections: [{ label: 'Story paragraph 1', why: 'displaced: 4000 as of 2026-10-01 → 9000 as of 2026-10-05' }],
      facts: [{ ref: 'S3F1', why: 'response: Army opens relief camps' }],
      demote: [],
      strict: false,
    })
    expect(k.input.storyDay).toBe('2026-10-01')
  })

  it("counts the version's cited facts supported, as the pass's check would leave them, and no other", () => {
    const facts = new Map(of('key').input.pool.facts.map(f => [f.ref, f.verdict]))
    expect([facts.get('S1F1'), facts.get('S1F2'), facts.get('S1F3')]).toEqual(['supported', 'supported', 'unjudged'])
  })

  it("keeps the verdicts a pass's own check gave: a rejected cited fact gives no correction case", () => {
    const judged: UpdateStory = { ...story, pool: { ...pool, facts: pool.facts.map(f => (f.ref === 'S1F1' ? { ...f, verdict: 'rejected' as const } : f)) } }
    const kinds = updateFixtures([key], new Map([['floods-a', judged]]), { half: 'all' }).fixtures.map(f => f.kind)
    expect(kinds).toEqual(['key', 'benign'])
  })

  it('plants a correction of a cited fact for the same measure, expecting every section citing it flagged and it demoted', () => {
    const n = of('wrong-number')
    const planted = n.input.pool.facts.find(f => n.input.fresh.has(f.ref))!
    expect(planted).toMatchObject({ statement: 'Floods displaced 6,000 people in 2026.', measures: 'people displaced' })
    expect(n.expected).toEqual({
      sections: [
        { label: 'Story paragraph 1', why: 'S1F1 corrected: 4,000 → 6,000' },
        { label: 'Why This Matters 1', why: 'S1F1 corrected: 4,000 → 6,000' },
      ],
      facts: [],
      demote: ['S1F1'],
      strict: true,
    })
    expect(of('wrong-year').input.pool.facts.find(f => f.ref === 'S2F1')!.statement).toBe('Floods displaced 4,000 people in 2025.')
  })

  it('adds the first near miss as a benign fact that changes nothing', () => {
    const b = of('benign')
    expect(b.input.pool.facts.find(f => b.input.fresh.has(f.ref))!.statement).toBe('Drought hits the north')
    expect(b.expected).toEqual({ sections: [], facts: [], demote: [], strict: true })
  })

  it('leaves out a story with no researched version, and reads only the first `limit` stories', () => {
    expect(fixtures.map(f => f.id)).toEqual(['floods-a:key', 'floods-a:wrong-number', 'floods-a:wrong-year', 'floods-a:benign'])
    expect(left.map(l => l.slug)).toEqual(['floods-b', 'floods-c', 'floods-late'])
    expect(left[0]).toEqual({ slug: 'floods-b', reason: 'no researched version: not found, or never researched' })
    expect(updateFixtures([key], stories, { half: 'all', limit: 0 }).fixtures).toEqual([])
  })

  it('expects nothing of a routine window, and leaves out a figure whose quote no section holds', () => {
    const routine: AnswerKey = {
      ...key,
      entries: [
        entry('floods-a', '2026-10-01', { values: [value(4000, '2026-10-01', 'a quote nowhere in the story')] }),
        entry('floods-c', '2026-10-06', { values: [value(5000, '2026-10-06', '5,000')] }),
      ],
    }
    const k = updateFixtures([routine], stories, { half: 'all' }).fixtures.find(f => f.kind === 'key')!
    expect(k.expected).toEqual({ sections: [], facts: [], demote: [], strict: true })
    expect(k.unplaced).toEqual(['displaced: 4000 as of 2026-10-01 → 5000 as of 2026-10-06'])
  })

  it('skips a must entry outside the stories its source covers: no case, not left out, not counted toward the limit', () => {
    const both = new Map<string, UpdateStory | null>([
      ['floods-a', story],
      ['floods-c', { ...story, slug: 'floods-c' }],
    ])
    const scoped = updateFixtures([key], both, { half: 'all', only: new Set(['floods-c']), limit: 1 })
    expect(scoped.fixtures.map(f => f.id)).toEqual(['floods-c:wrong-number', 'floods-c:wrong-year', 'floods-c:benign'])
    expect(scoped.left).toEqual([])
  })

  it("names an in-scope story without a version by the source's reason", () => {
    const { fixtures: none, left: missing } = updateFixtures([key], stories, { half: 'all', only: new Set(['floods-b']), missing: 'the reason given' })
    expect(none).toEqual([])
    expect(missing).toEqual([{ slug: 'floods-b', reason: 'the reason given' }])
  })
})

describe('updateCaseCeiling', () => {
  it('counts each story a key case only when later entries give new facts, a correction case of each kind, and a benign case only with a near miss', () => {
    expect(updateCaseCeiling([key], { half: 'all' })).toEqual({ stories: 4, cases: { key: 1, 'wrong-number': 4, 'wrong-year': 4, benign: 4 } })
    expect(updateCaseCeiling([{ ...key, nearMisses: [] }], { half: 'all' }).cases.benign).toBe(0)
  })

  it('counts only the in-scope must entries, each slug once, the first `limit` of them', () => {
    const scope = new Set(['floods-a', 'floods-c', 'floods-optional'])
    expect(updateCaseCeiling([key, key], { half: 'all', only: scope })).toEqual({
      stories: 2,
      cases: { key: 1, 'wrong-number': 2, 'wrong-year': 2, benign: 2 },
    })
    expect(updateCaseCeiling([key], { half: 'all', only: scope, limit: 1 })).toEqual({
      stories: 1,
      cases: { key: 1, 'wrong-number': 1, 'wrong-year': 1, benign: 1 },
    })
    expect(updateCaseCeiling([key], { half: 'all', limit: 0 })).toEqual({ stories: 0, cases: { key: 0, 'wrong-number': 0, 'wrong-year': 0, benign: 0 } })
  })
})

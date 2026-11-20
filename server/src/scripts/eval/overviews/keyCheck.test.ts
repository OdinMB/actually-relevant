import { describe, it, expect } from 'vitest'
import { parseKey, type AnswerKey } from './keySchema.js'
import { normalizeQuote } from '../../../lib/quoteMatch.js'
import { checkKey, checkKeyFiles, keySlugs, publishedTexts, summarizeKey, type KeyStory } from './keyCheck.js'

const story = (slug: string, extra: Partial<KeyStory> = {}): KeyStory => ({
  slug,
  status: 'published',
  datePublished: new Date('2026-06-01T02:45:00Z'),
  title: `${slug} title`,
  summary: 'Congo’s outbreak has killed 4,887 people — the most yet.',
  relevanceReasons: '- More than 11,000 cases make this a regional crisis.',
  antifactors: null,
  research: null,
  hasResearchRun: false,
  hasResearchFacts: false,
  ...extra,
})

const research = (text: string) => ({
  paragraphs: [{ sentences: [{ text, citations: [] }] }],
  whyThisMatters: [],
  caveats: [],
  quoteSourceId: null,
  sources: [],
})

function answerKey(edit: (k: Record<string, any>) => void = () => undefined): AnswerKey {
  const k: Record<string, any> = {
    schemaVersion: 1,
    id: 'ebola',
    title: 'Ebola',
    charter: { in: '', out: [], endEvent: '' },
    closed: { slug: 'b', date: '2026-06-02' },
    figures: [{ key: 'deaths', name: 'Deaths', unit: 'people', definition: 'All', cumulative: true, variants: [] }],
    entries: [
      {
        slug: 'a',
        date: '2026-06-01',
        title: 'A',
        join: 'must',
        role: 'routine',
        why: 'x',
        values: [
          { figure: 'deaths', value: 4887, approx: 'exact', asOf: '2026-06-01', matches: true, quote: "Congo's outbreak has killed 4,887 people - the most" },
        ],
      },
      { slug: 'b', date: '2026-06-02', title: 'B', join: 'optional', role: 'turning_point', kind: 'milestone', why: 'x' },
    ],
    nearMisses: [{ slug: 'x', date: '2026-06-01', title: 'X', why: 'x' }],
  }
  edit(k)
  const { key, errors } = parseKey(k)
  if (!key) throw new Error(errors.join('; '))
  return key
}

const byslug = (...stories: KeyStory[]) => new Map(stories.map(s => [s.slug, s]))

describe('normalizeQuote', () => {
  it('evens out whitespace, quote marks and dashes, and nothing else', () => {
    expect(normalizeQuote('  Congo’s  “worst” outbreak – so far—now  ')).toBe(`Congo's "worst" outbreak - so far-now`)
    expect(normalizeQuote('Deaths Rose')).toBe('Deaths Rose')
  })
})

describe('publishedTexts', () => {
  it("holds the story's published fields and its applied research's paragraphs", () => {
    expect(publishedTexts(story('a', { research: research('Researched paragraph.') }))).toEqual([
      'a title',
      'Congo’s outbreak has killed 4,887 people — the most yet.',
      '- More than 11,000 cases make this a regional crisis.',
      'Researched paragraph.',
    ])
  })

  it('leaves out a stored version that fails its schema', () => {
    expect(publishedTexts(story('a', { research: { paragraphs: 'nope' } }))).toHaveLength(3)
  })
})

describe('checkKey', () => {
  it('passes a key whose stories are published on its dates and state its quotes', () => {
    expect(checkKey(answerKey(), byslug(story('a'), story('b', { datePublished: new Date('2026-06-02T23:59:00Z') }), story('x')))).toEqual([])
  })

  it('reports a story that is missing or not published', () => {
    expect(checkKey(answerKey(), byslug(story('a'), story('b', { status: 'rejected', datePublished: null })))).toEqual([
      'entry b: not published (status rejected)',
      'near miss x: no story with this slug',
    ])
  })

  it("compares an entry's date with its UTC publication day", () => {
    expect(
      checkKey(
        answerKey(),
        byslug(story('a', { datePublished: new Date('2026-05-31T23:30:00Z') }), story('b', { datePublished: new Date('2026-06-02T00:10:00Z') }), story('x')),
      ),
    ).toEqual(['entry a: dated 2026-06-01, published 2026-05-31 (UTC)'])
  })

  it("finds a quote in the applied research's paragraphs, and reports one the story does not state", () => {
    const quote = (q: string) =>
      answerKey(k => {
        k.entries[0].values[0].quote = q
      })
    const stories = byslug(
      story('a', { research: research('WHO counted 5,000 deaths by June.') }),
      story('b', { datePublished: new Date('2026-06-02T10:00:00Z') }),
      story('x'),
    )
    expect(checkKey(quote('counted 5,000 deaths'), stories)).toEqual([])
    expect(checkKey(quote('counted 5,100 deaths'), stories)).toEqual(['entry a: quote not found: "counted 5,100 deaths"'])
  })

  it("finds a response's quote in the story it names, and reports one it does not state", () => {
    const responding = (q: string) =>
      answerKey(k => {
        k.entries[0].values[0].quote = 'counted 5,000 deaths'
        Object.assign(k, { schemaVersion: 2, responses: [{ date: '2026-06-02', what: 'Vaccination', slug: 'a', quote: q }] })
      })
    const stories = byslug(
      story('a', { research: research('WHO counted 5,000 deaths by June; ring vaccination began.') }),
      story('b', { datePublished: new Date('2026-06-02T10:00:00Z') }),
      story('x'),
    )
    expect(checkKey(responding('ring vaccination began'), stories)).toEqual([])
    expect(checkKey(responding('mass vaccination began'), stories)).toEqual(['response a: quote not found: "mass vaccination began"'])
  })

  it("finds the end's quote in the story that reports it, and reports one it does not state", () => {
    const ending = (q: string) =>
      answerKey(k => {
        k.entries[0].values[0].quote = '4,887 people'
        k.closed = { slug: 'b', date: '2026-06-02', quote: q }
      })
    const stories = byslug(
      story('a'),
      story('b', { datePublished: new Date('2026-06-02T10:00:00Z'), summary: 'The outbreak was declared over on Tuesday.' }),
      story('x'),
    )
    expect(checkKey(ending('declared over'), stories)).toEqual([])
    expect(checkKey(ending('declared finished'), stories)).toEqual(['closed b: quote not found: "declared finished"'])
  })

  it("checks a center's entries, near misses and response against the database, each error naming the center", () => {
    const centered = answerKey(k => {
      k.entries[0].values[0].quote = '4,887 people'
      k.centers = [
        {
          from: '2026-06-03',
          title: 'Regional Ebola',
          charter: { in: 'Wider.', out: [], endEvent: null },
          why: 'It spread',
          entries: [{ slug: 'c', date: '2026-06-03', title: 'C', join: 'must', role: 'routine', why: 'x' }],
          nearMisses: [{ slug: 'y', date: '2026-06-03', title: 'Y', why: 'x' }],
          responses: [{ date: '2026-06-03', what: 'Screening', slug: 'c', quote: 'border screening' }],
        },
      ]
    })
    expect(keySlugs(centered)).toEqual(['a', 'b', 'x', 'c', 'y'])
    const base = [story('a'), story('b', { datePublished: new Date('2026-06-02T10:00:00Z') }), story('x')]
    expect(checkKey(centered, byslug(...base, story('c', { datePublished: new Date('2026-06-04T01:00:00Z') })))).toEqual([
      'center "Regional Ebola" entry c: dated 2026-06-03, published 2026-06-04 (UTC)',
      'center "Regional Ebola" near miss y: no story with this slug',
      'center "Regional Ebola" response c: quote not found: "border screening"',
    ])
    expect(summarizeKey(centered, byslug())).toMatchObject({ toReview: 2 })
  })
})

describe('keySlugs and summarizeKey', () => {
  it('lists every slug the key names, once', () => {
    expect(keySlugs(answerKey())).toEqual(['a', 'b', 'x'])
  })

  it('counts the key, the entry stories with a stored research run and the drafts left to review', () => {
    expect(summarizeKey(answerKey(), byslug(story('a', { hasResearchRun: true }), story('b')))).toEqual({
      id: 'ebola',
      title: 'Ebola',
      must: 1,
      optional: 1,
      nearMisses: 1,
      figures: 1,
      values: 1,
      responses: 0,
      closed: '2026-06-02',
      withResearchRun: 1,
      toReview: 1,
    })
    const reviewed = answerKey(k => {
      k.closed.reviewed = true
      Object.assign(k, { schemaVersion: 2, responses: [{ date: '2026-06-02', what: 'Vaccination', slug: 'a', quote: '4,887', reviewed: true }] })
    })
    expect(summarizeKey(reviewed, byslug())).toMatchObject({ responses: 1, toReview: 0 })
  })
})

describe('checkKeyFiles', () => {
  it("adds the database's errors to each parsed file's own, in one load of every slug", async () => {
    const loads: string[][] = []
    const load = async (slugs: string[]) => {
      loads.push(slugs)
      return byslug(story('a'), story('x'))
    }
    const results = await checkKeyFiles(
      [
        { file: 'ebola.json', key: answerKey(), errors: ['figure deaths has 1 values, fewer than 3'] },
        { file: 'broken.json', key: null, errors: ['not valid JSON'] },
      ],
      load,
    )
    expect(results).toEqual([
      {
        file: 'ebola.json',
        summary: expect.objectContaining({ id: 'ebola', must: 1 }),
        errors: ['figure deaths has 1 values, fewer than 3', 'entry b: no story with this slug'],
      },
      { file: 'broken.json', summary: null, errors: ['not valid JSON'] },
    ])
    expect(loads).toEqual([['a', 'b', 'x']])
  })

  it('reads no stories when no key parses', async () => {
    const loads: string[][] = []
    await checkKeyFiles([{ file: 'broken.json', key: null, errors: ['x'] }], async slugs => {
      loads.push(slugs)
      return new Map()
    })
    expect(loads).toEqual([])
  })
})

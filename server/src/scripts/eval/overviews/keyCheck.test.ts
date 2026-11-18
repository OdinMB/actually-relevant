import { describe, it, expect } from 'vitest'
import { parseKey, type AnswerKey } from './keySchema.js'
import { checkKey, checkKeyFiles, keySlugs, normalizeQuote, publishedTexts, summarizeKey, type KeyStory } from './keyCheck.js'

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
})

describe('keySlugs and summarizeKey', () => {
  it('lists every slug the key names, once', () => {
    expect(keySlugs(answerKey())).toEqual(['a', 'b', 'x'])
  })

  it('counts the key and the entry stories with a stored research run', () => {
    expect(summarizeKey(answerKey(), byslug(story('a', { hasResearchRun: true }), story('b')))).toEqual({
      id: 'ebola',
      title: 'Ebola',
      must: 1,
      optional: 1,
      nearMisses: 1,
      figures: 1,
      values: 1,
      closed: '2026-06-02',
      withResearchRun: 1,
    })
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

import { describe, it, expect } from 'vitest'
import type { ResearchStory } from './fixtures.js'
import type { ResearchSource, StoryResearch } from './pipeline.js'
import { citedOutlets, dropTotals, ratingChange, renderDrafts, renderResearchReport, researchFileNames, verdictCounts } from './report.js'
import type { Draft } from './schemas.js'

const src = (id: string, outlet: string, origin: ResearchSource['origin'] = 'search'): ResearchSource => ({
  id,
  origin,
  url: `https://${outlet}/x`,
  title: `${outlet} title`,
  outlet,
  date: '2026-11-12',
  favicon: null,
  usedRawContent: false,
  kind: 'news-report',
  country: 'Pakistan',
  relation: 'same-development',
  facts: [{ id: `${id}F1`, statement: `${outlet} fact`, supportingSentence: `${outlet} sentence`, measures: '', found: true }],
  voices: [],
})

const draft = (rating: number): Draft => ({
  titleLabel: 'Solar power',
  title: 'Pakistan adds 22 GW of rooftop solar',
  story: [{ sentences: [{ text: 'Pakistan added 22 GW of rooftop solar in two years.', factIds: ['S1F1', 'S2F1', 'S1F1'] }] }],
  summary: 'Summary',
  whyThisMatters: [{ text: 'Cheap power reaches millions.', factIds: [] }],
  caveats: [{ text: 'Imports came first.', factIds: ['E1F1'] }],
  quote: 'We have added 22GW',
  quoteAttribution: 'Prime minister',
  quoteSourceId: 'S0',
  marketingBlurb: 'Blurb',
  relevanceCalculation: ['- **Energy:** 6'],
  rating,
  oldNews: { isOld: false, firstHappened: 'unknown' },
  contradicted: { isContradicted: false, factIds: [] },
})

function result(storyId: string, over: Partial<StoryResearch> = {}): StoryResearch {
  return {
    storyId,
    calls: [{ step: 'write', outcome: 'ok', usage: { input: 1000, cached: 0, output: 500, reasoning: 100 }, costUsd: 0.002 }],
    credits: 2,
    searches: [{ query: 'q', language: 'en', results: 3, credits: 2, cached: false }],
    candidates: 4,
    drops: { syndicated: 1 },
    sources: [src('S0', 'Pakistan Today', 'original'), src('S1', 'Dawn', 'cluster'), src('S2', 'reuters.com')],
    earlier: [
      {
        id: 'E1',
        storyId: 'e1',
        slug: 'e1',
        title: 'Earlier',
        date: '2026-03-01',
        relation: 'background',
        facts: [{ id: 'E1F1', statement: 'e', supportingSentence: 'e', measures: '', found: false }],
      },
    ],
    draft: draft(4),
    rewritten: false,
    problems: [],
    support: { facts: 4, found: 3 },
    verdict: { kind: 'research-rating', rating: 4 },
    ...over,
  }
}

const story = (id: string, relevance: number): ResearchStory => ({
  id,
  slug: `${id}-slug`,
  datePublished: '2026-11-13T07:00:00.000Z',
  original: {
    storyId: id,
    title: 't',
    url: 'https://www.pakistantoday.com.pk/x',
    outlet: 'Pakistan Today',
    language: 'en',
    datePublished: null,
    dateCrawled: '2026-11-12T08:00:00.000Z',
    content: 'c',
  },
  assess: { title: 't', content: 'c', publisher: 'p', url: 'u', guidelines: { factors: '', antifactors: '', ratings: '' }, emotionTag: null },
  published: {
    titleLabel: 'Label',
    title: `${id} published title`,
    summary: 's',
    whyThisMatters: '- w',
    caveats: '- c',
    relevance,
    relevanceCalculation: '',
    quote: null,
    quoteAttribution: null,
    marketingBlurb: null,
  },
  clusterMembers: [],
  neighbours: [],
  earlier: [],
})

describe('citedOutlets', () => {
  it('names each cited outlet once, in order, our earlier stories as ours and unknown ids as they are', () => {
    expect(citedOutlets(['S1F1', 'S2F1', 'S1F3', 'E1F1', 'S9F9'], result('a'))).toEqual(['Dawn', 'reuters.com', 'Actually Relevant (earlier)', 'S9F9'])
  })
})

describe('ratingChange', () => {
  it('compares the research rating with the stored one for every story with a draft', () => {
    const c = ratingChange(
      [story('a', 6), story('b', 5), story('c', 6)],
      [result('a'), result('b', { draft: draft(5) }), result('c', { draft: null, verdict: { kind: 'fallback', reason: 'budget' } })],
    )
    expect(c).toEqual({
      compared: 2,
      mean: -1,
      down: 1,
      same: 1,
      up: 0,
      byDelta: [
        [-2, 1],
        [0, 1],
      ],
    })
  })
})

describe('verdictCounts and dropTotals', () => {
  it('counts verdicts and fallback reasons, and sums drops by reason', () => {
    const results = [
      result('a'),
      result('b', { verdict: { kind: 'fallback', reason: 'budget' }, drops: { syndicated: 2, cap: 1 } }),
      result('c', { verdict: { kind: 'fallback', reason: 'budget' } }),
    ]
    expect(verdictCounts(results)).toEqual({
      kinds: { keep: 0, 'research-rating': 1, stale: 0, contradicted: 0, fallback: 2 },
      fallbackReasons: [['budget', 2]],
    })
    expect(dropTotals(results)).toEqual({ syndicated: 4, cap: 1 })
  })
})

describe('researchFileNames', () => {
  it('tags a --limit run so it never overwrites the full report', () => {
    expect(researchFileNames()).toEqual({ report: 'research-report.md', drafts: 'research-drafts.md' })
    expect(researchFileNames(3)).toEqual({ report: 'research-report-limit-3.md', drafts: 'research-drafts-limit-3.md' })
  })
})

describe('renderers', () => {
  const stories = [story('a', 6), story('b', 6)]
  const results = [result('a'), result('b', { draft: null, sources: [], earlier: [], verdict: { kind: 'fallback', reason: 'no usable source' } })]

  it('renders citations in the drafts as outlet names', () => {
    const md = renderDrafts({ stories, results, siteUrl: 'https://actuallyrelevant.news' })
    expect(md).toContain('Pakistan added 22 GW of rooftop solar in two years. [Dawn; reuters.com]')
    expect(md).toContain('Imports came first. [Actually Relevant (earlier)]')
    expect(md).toContain('no usable source')
  })

  it('renders the report for researched and skipped stories', () => {
    const md = renderResearchReport({
      generatedAt: '2026-11-12T10:00:00.000Z',
      fixtures: { createdAt: '2026-11-12T09:00:00.000Z', anchor: '2026-11-12T07:00:00.000Z', size: 30, dbClass: 'local', shortfalls: [] },
      stories,
      results,
      skipped: [{ storyId: 'c', reason: 'budget: $0.0010 left, a story may need $0.0200' }],
      budgetUsd: 3,
      spentUsd: 0.05,
      thisRunUsd: 0.004,
      creditsRecorded: 4,
      relevanceMin: 5,
    })
    expect(md).toContain('a published title')
    expect(md).toContain('budget: $0.0010 left')
  })
})

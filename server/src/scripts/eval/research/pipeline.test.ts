import { describe, it, expect } from 'vitest'
import type { z } from 'zod'
import type { Arm, CallOutcome, CallRecord, SuiteContext } from '../types.js'
import type { ResearchStory } from './fixtures.js'
import { researchStory, type StepName } from './pipeline.js'
import type { Draft, Earlier, Extraction, FactCheck, Queries } from './schemas.js'
import type { TavilyResponse, TavilySearch } from './tavily.js'

const words = (seed: string, n = 150) => Array.from({ length: n }, (_, i) => `${seed}w${i}`).join(' ')

function story(over: Partial<ResearchStory> = {}): ResearchStory {
  const original = {
    storyId: 'story-1',
    title: 'Pakistan adds 22GW of rooftop solar',
    url: 'https://www.pakistantoday.com.pk/solar',
    outlet: 'Pakistan Today',
    language: 'en',
    datePublished: '2026-11-12T06:00:00.000Z',
    dateCrawled: '2026-11-12T08:00:00.000Z',
    content: `Pakistan has added 22GW of rooftop solar in just two years. ${words('original')}`,
  }
  return {
    id: 'story-1',
    slug: 'pakistan-solar',
    datePublished: '2026-11-13T07:00:00.000Z',
    original,
    assess: {
      title: original.title,
      content: original.content,
      publisher: 'Pakistan Today',
      url: original.url,
      guidelines: { factors: 'f', antifactors: 'a', ratings: 'r' },
      emotionTag: 'calm',
    },
    published: {
      titleLabel: 'Solar power',
      title: 'Pakistan adds 22 GW of rooftop solar',
      summary: 'Summary',
      whyThisMatters: '- why',
      caveats: '- caveat',
      relevance: 6,
      relevanceCalculation: '- calc',
      quote: null,
      quoteAttribution: null,
      marketingBlurb: null,
    },
    clusterMembers: [
      { ...original, storyId: 'member-1', url: 'https://dawn.com/solar', outlet: 'Dawn', content: `Dawn reports the solar boom. ${words('dawn')}` },
    ],
    neighbours: [],
    earlier: [
      {
        id: 'earlier-1',
        slug: 'earlier',
        title: 'Pakistan imports Chinese panels',
        titleLabel: null,
        summary: 'Pakistan imported 17 GW of Chinese panels in 2024.',
        relevanceSummary: '',
        whyItMatters: '',
        datePublished: '2026-03-01T00:00:00.000Z',
        distance: 0.2,
      },
    ],
    ...over,
  }
}

const searchResponse = (urls: string[]): TavilyResponse => ({
  results: urls.map(url => ({
    url,
    title: url,
    content: `Coverage of the solar boom. ${words(url.replace(/\W/g, ''), 200)}`,
    rawContent: null,
    publishedDate: '2026-11-12',
    favicon: null,
  })),
  credits: 2,
  cached: false,
})

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  usable: true,
  relation: 'same-development',
  kind: 'news-report',
  country: 'Pakistan',
  facts: [
    {
      statement: 'Pakistan added 22 GW of rooftop solar in two years.',
      supportingSentence: 'Pakistan has added 22GW of rooftop solar in just two years.',
      measures: '',
    },
    { statement: 'The boom cut grid demand.', supportingSentence: 'The boom cut grid demand.', measures: '' },
  ],
  voices: [],
  ...over,
})

const goodDraft = (factIds = ['S0F1']): Draft => ({
  titleLabel: 'Solar power',
  title: 'Pakistan adds 22 GW of rooftop solar',
  story: [{ sentences: [{ text: 'Pakistan added 22 GW of rooftop solar in two years.', factIds }] }],
  summary: 'Summary',
  whyThisMatters: [{ text: 'Cheap power reaches millions.', factIds: [] }],
  caveats: [{ text: 'The grid lags behind.', factIds: [] }],
  quote: 'We have added 22GW',
  quoteAttribution: 'Prime minister',
  quoteSourceId: 'S0',
  marketingBlurb: 'Pakistan added 22 GW of rooftop solar.',
  relevanceCalculation: ['- **Energy:** 6'],
  rating: 6,
  oldNews: { isOld: false, firstHappened: 'unknown' },
  contradicted: { isContradicted: false, factIds: [] },
})

type Responder = { [K in StepName]?: (prompt: string) => unknown }

/** A context that answers each step from `responders` (by the schema's base name) and records the calls. */
function fakeContext(responders: Responder, outcome: CallOutcome = 'ok'): SuiteContext & { calls: string[] } {
  const calls: string[] = []
  const stepOf: Record<string, StepName> = {
    'research-confirm': 'confirm',
    'research-queries': 'queries',
    'research-extract': 'extract',
    'research-earlier': 'earlier',
    'research-write': 'write',
    'research-fact-check': 'fact-check',
  }
  return {
    calls,
    async call<T>(_arm: Arm, schemaName: string, _schema: z.ZodType<T>, prompt: string): Promise<CallRecord<T>> {
      const base = schemaName.split('#')[0] ?? ''
      let step = stepOf[base] ?? 'write'
      if (step === 'write' && prompt.includes('<PROBLEMS>')) step = 'rewrite'
      calls.push(step)
      const parsed = outcome === 'ok' ? ((responders[step]?.(prompt) ?? null) as T | null) : null
      return {
        key: `${calls.length}`,
        arm: 'gpt-6-luna@low',
        schema: schemaName,
        outcome: outcome === 'ok' && parsed === null ? 'parse_failure' : outcome,
        parsed,
        content: '',
        finishReason: 'stop',
        usage: { input: 100, cached: 0, output: 50, reasoning: 10 },
        costUsd: outcome === 'skipped' ? 0 : 0.001,
        latencyMs: 1,
        at: '',
      }
    },
  }
}

function fakeTavily(response: TavilyResponse) {
  const requests: TavilySearch[] = []
  return {
    requests,
    async search(r: TavilySearch) {
      requests.push(r)
      return response
    },
  }
}

const queries = (): Queries => ({ queries: [{ query: 'Pakistan rooftop solar 22 GW', language: 'en' }] })
const earlier = (): Earlier => ({
  stories: [
    {
      number: 1,
      relation: 'background',
      facts: [{ statement: 'Pakistan imported 17 GW of panels in 2024.', supportingSentence: 'Pakistan imported 17 GW of Chinese panels in 2024.' }],
    },
  ],
})
const allSupported = (prompt: string): FactCheck => ({
  sentences: [...prompt.matchAll(/<SENTENCE number="(\d+)">/g)].map(m => ({ number: Number(m[1]), supported: true, problem: '' })),
})

const baseResponders = (over: Responder = {}): Responder => ({
  queries,
  extract: () => extraction(),
  earlier,
  write: () => goodDraft(),
  'fact-check': allSupported,
  ...over,
})

describe('researchStory', () => {
  it('ends the story as fallback with reason budget when a call is skipped for the budget', async () => {
    const ctx = fakeContext(baseResponders(), 'skipped')
    const r = await researchStory(story(), { ctx, tavily: fakeTavily(searchResponse([])), relevanceMin: 5 })
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'budget' })
    expect(r.draft).toBeNull()
  })

  it('falls back when no source but the original is left', async () => {
    const ctx = fakeContext(baseResponders())
    const r = await researchStory(story({ clusterMembers: [] }), { ctx, tavily: fakeTavily(searchResponse([])), relevanceMin: 5 })
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'no usable source' })
    expect(ctx.calls).not.toContain('extract')

    const unusable = fakeContext(baseResponders({ extract: p => (p.includes('Dawn') ? extraction({ usable: false, facts: [] }) : extraction()) }))
    const r2 = await researchStory(story(), { ctx: unusable, tavily: fakeTavily(searchResponse([])), relevanceMin: 5 })
    expect(r2.verdict).toEqual({ kind: 'fallback', reason: 'no usable source' })
    expect(r2.drops).toMatchObject({ unusable: 1 })
  })

  it('falls back with the Tavily error', async () => {
    const tavily = {
      async search(): Promise<TavilyResponse> {
        throw new Error('Tavily search failed: HTTP 432')
      },
    }
    const r = await researchStory(story(), { ctx: fakeContext(baseResponders()), tavily, relevanceMin: 5 })
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'tavily: Tavily search failed: HTTP 432' })
  })

  it('rewrites exactly once after a failed check, and falls back when the rewrite fails it too', async () => {
    const ctx = fakeContext(baseResponders({ write: () => goodDraft(['S9F9']), rewrite: () => goodDraft(['S9F9']) }))
    const r = await researchStory(story(), { ctx, tavily: fakeTavily(searchResponse(['https://reuters.com/a'])), relevanceMin: 5 })
    expect(ctx.calls.filter(c => c === 'write')).toHaveLength(1)
    expect(ctx.calls.filter(c => c === 'rewrite')).toHaveLength(1)
    expect(r.rewritten).toBe(true)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'check failed after one rewrite' })
    expect(r.problems[0]?.problem).toContain('S9F9')
    expect(r.draft).not.toBeNull()
  })

  it('keeps a draft the rewrite fixed, after a fact check that found an unsupported sentence', async () => {
    let checks = 0
    const ctx = fakeContext(
      baseResponders({
        'fact-check': p => {
          checks++
          return checks === 1 ? { sentences: [{ number: 1, supported: false, problem: 'two years is not stated' }] } : allSupported(p)
        },
        rewrite: () => goodDraft(['S0F1', 'S1F1']),
      }),
    )
    const r = await researchStory(story(), { ctx, tavily: fakeTavily(searchResponse([])), relevanceMin: 5 })
    expect(ctx.calls.filter(c => c === 'rewrite')).toHaveLength(1)
    expect(ctx.calls.filter(c => c === 'fact-check')).toHaveLength(2)
    expect(r.verdict).toEqual({ kind: 'keep' })
    expect(r.draft?.story[0]?.sentences[0]?.factIds).toEqual(['S0F1', 'S1F1'])
  })

  it('gates the checked draft on its rating', async () => {
    const ctx = fakeContext(baseResponders({ write: () => ({ ...goodDraft(), rating: 3 }) }))
    const r = await researchStory(story(), { ctx, tavily: fakeTavily(searchResponse([])), relevanceMin: 5 })
    expect(r.verdict).toEqual({ kind: 'research-rating', rating: 3 })
  })

  it('assigns fact ids per kept source in order, the original first and our earlier stories last', async () => {
    const ctx = fakeContext(baseResponders())
    const tavily = fakeTavily(searchResponse(['https://reuters.com/a', 'https://bbc.co.uk/b']))
    const r = await researchStory(story(), { ctx, tavily, relevanceMin: 5 })
    expect(r.sources.map(s => [s.id, s.origin, s.outlet])).toEqual([
      ['S0', 'original', 'Pakistan Today'],
      ['S1', 'cluster', 'Dawn'],
      ['S2', 'search', 'reuters.com'],
      ['S3', 'search', 'bbc.co.uk'],
    ])
    expect(r.sources[2]?.facts.map(f => f.id)).toEqual(['S2F1', 'S2F2'])
    expect(r.earlier.map(e => [e.id, e.facts.map(f => f.id)])).toEqual([['E1', ['E1F1']]])
    // Found: the original's first supporting sentence and the earlier story's; the fakes' others are invented
    expect(r.support).toEqual({ facts: 9, found: 2 })
  })

  it('records every call by step and the credits of every search, in the story window', async () => {
    const ctx = fakeContext(baseResponders())
    const tavily = fakeTavily(searchResponse(['https://reuters.com/a']))
    const r = await researchStory(story(), { ctx, tavily, relevanceMin: 5 })
    expect(r.calls.map(c => c.step).sort()).toEqual(['earlier', 'extract', 'extract', 'extract', 'fact-check', 'queries', 'write'])
    expect(r.credits).toBe(2)
    expect(tavily.requests).toEqual([{ query: 'Pakistan rooftop solar 22 GW', startDate: '2026-10-29', endDate: '2026-11-19' }])
  })

  it('keeps only the neighbours the dedup prompt confirms', async () => {
    const neighbour = (n: number) => ({
      ...story().original,
      storyId: `neighbour-${n}`,
      url: `https://neighbour${n}.example/x`,
      outlet: `Neighbour ${n}`,
      content: words(`neighbour${n}`),
      assessed: { title: `Neighbour ${n}`, summary: 'summary' },
      distance: 0.1 * n,
    })
    const ctx = fakeContext(
      baseResponders({
        confirm: () => ({
          assessments: [
            { candidateNumber: 1, isDuplicate: false, reason: '' },
            { candidateNumber: 2, isDuplicate: true, reason: '' },
          ],
        }),
      }),
    )
    const r = await researchStory(story({ neighbours: [neighbour(1), neighbour(2)] }), { ctx, tavily: fakeTavily(searchResponse([])), relevanceMin: 5 })
    expect(ctx.calls[0]).toBe('confirm')
    expect(r.sources.map(s => s.outlet)).toEqual(['Pakistan Today', 'Dawn', 'Neighbour 2'])
  })
})

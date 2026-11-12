import { describe, it, expect } from 'vitest'
import type { TavilySearch } from '../lib/tavily.js'
import type { Draft, Earlier, Extraction, FactCheck, Queries } from '../schemas/research.js'
import type { ResearchStory } from './researchInput.js'
import {
  BudgetExhaustedError,
  researchStory,
  type PlannedStep,
  type ResearchCall,
  type ResearchDeps,
  type ResearchSearchAnswer,
  type StepName,
  type StepOutcome,
} from './researchPipeline.js'

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

const searchResponse = (urls: string[]): ResearchSearchAnswer => ({
  results: urls.map(url => ({
    url,
    title: url,
    content: `Coverage of the solar boom. ${words(url.replace(/\W/g, ''), 200)}`,
    rawContent: null,
    publishedDate: '2026-11-12',
    favicon: null,
  })),
  credits: 2,
})

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  usable: true,
  relation: 'same-development',
  kind: 'news-report',
  outlet: '',
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

const MODEL_OF: Record<StepName, string> = {
  confirm: 'small-model',
  queries: 'small-model',
  extract: 'small-model',
  earlier: 'small-model',
  write: 'medium-model',
  'fact-check': 'small-model',
  rewrite: 'medium-model',
}

/** A step caller that answers each step from `responders` and records the steps called. */
function fakeCall(responders: Responder, outcome: StepOutcome = 'ok'): { call: ResearchCall; steps: StepName[] } {
  const steps: StepName[] = []
  const call: ResearchCall = async <T>(step: StepName, _schema: unknown, prompt: string) => {
    steps.push(step)
    const parsed = outcome === 'ok' ? ((responders[step]?.(prompt) ?? null) as T | null) : null
    return {
      parsed,
      outcome: outcome === 'ok' && parsed === null ? 'parse_failure' : outcome,
      usage: { input: 100, cached: 10, output: 50, reasoning: 10 },
      costUsd: outcome === 'skipped' ? 0 : step === 'write' ? 0.004 : 0.001,
      model: MODEL_OF[step],
    }
  }
  return { call, steps }
}

function fakeTavily(response: ResearchSearchAnswer) {
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
  sentences: [...prompt.matchAll(/<SENTENCE number="(\d+)">/g)].map(m => ({ number: Number(m[1]), supported: true, problem: '', key: false })),
})

const baseResponders = (over: Responder = {}): Responder => ({
  queries,
  extract: () => extraction(),
  earlier,
  write: () => goodDraft(),
  'fact-check': allSupported,
  ...over,
})

function deps(over: Partial<ResearchDeps> & { responders?: Responder; outcome?: StepOutcome } = {}) {
  const { responders, outcome, ...rest } = over
  const fake = fakeCall(responders ?? baseResponders(), outcome)
  const tavily = fakeTavily(searchResponse([]))
  return { fake, tavily, deps: { call: fake.call, tavily, relevanceMin: 5, ...rest } satisfies ResearchDeps }
}

describe('researchStory', () => {
  it('records each call with the model and cost its caller returned', async () => {
    const { deps: d } = deps()
    const r = await researchStory(story(), d)
    expect(r.calls.find(c => c.step === 'write')).toEqual({
      step: 'write',
      outcome: 'ok',
      usage: { input: 100, cached: 10, output: 50, reasoning: 10 },
      costUsd: 0.004,
      model: 'medium-model',
    })
    expect(r.calls.filter(c => c.step === 'extract').every(c => c.model === 'small-model' && c.costUsd === 0.001)).toBe(true)
    expect(r.verdict).toEqual({ kind: 'keep' })
  })

  it('ends the run as fallback with reason budget when a call is skipped for the budget', async () => {
    const { deps: d } = deps({ outcome: 'skipped' })
    const r = await researchStory(story(), d)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'budget' })
    expect(r.draft).toBeNull()
  })

  it('ends the run as fallback with reason budget when the Tavily search is refused for the budget', async () => {
    const { deps: d } = deps({
      tavily: {
        async search(): Promise<ResearchSearchAnswer> {
          throw new BudgetExhaustedError()
        },
      },
    })
    expect((await researchStory(story(), d)).verdict).toEqual({ kind: 'fallback', reason: 'budget' })
  })

  it('asks before the extraction batch, and makes none of its calls when the batch is refused', async () => {
    const batches: PlannedStep[][] = []
    const { deps: d, fake } = deps({
      admit: async batch => {
        batches.push(batch)
        return false
      },
    })
    const r = await researchStory(story(), d)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'budget' })
    expect(batches).toHaveLength(1)
    expect(batches[0]?.map(b => b.step)).toEqual(['extract', 'extract', 'earlier'])
    expect(batches[0]?.[0]?.prompt).toContain('Pakistan has added 22GW')
    expect(fake.steps).not.toContain('extract')
    expect(fake.steps).not.toContain('earlier')
  })

  it('runs the batch it admits', async () => {
    const { deps: d, fake } = deps({ admit: async () => true })
    const r = await researchStory(story(), d)
    expect(fake.steps.filter(s => s === 'extract')).toHaveLength(2)
    expect(r.verdict).toEqual({ kind: 'keep' })
  })

  it('falls back when no source but the original is left', async () => {
    const { deps: d, fake } = deps()
    const r = await researchStory(story({ clusterMembers: [] }), d)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'no usable source' })
    expect(fake.steps).not.toContain('extract')

    const { deps: unusable } = deps({
      responders: baseResponders({ extract: p => (p.includes('Dawn') ? extraction({ usable: false, facts: [] }) : extraction()) }),
    })
    const r2 = await researchStory(story(), unusable)
    expect(r2.verdict).toEqual({ kind: 'fallback', reason: 'no usable source' })
    expect(r2.drops).toMatchObject({ unusable: 1 })
  })

  it('falls back with the Tavily error', async () => {
    const { deps: d } = deps({
      tavily: {
        async search(): Promise<ResearchSearchAnswer> {
          throw new Error('Tavily search failed: HTTP 432')
        },
      },
    })
    expect((await researchStory(story(), d)).verdict).toEqual({ kind: 'fallback', reason: 'tavily: Tavily search failed: HTTP 432' })
  })

  it('drops the sources the opt-out policy refuses, and records whether it was checked', async () => {
    const tavily = fakeTavily(searchResponse(['https://reuters.com/a', 'https://refuses.example/b']))
    const { deps: d } = deps({ tavily, sourcePolicy: { optedOut: async url => url.startsWith('https://refuses.example/') } })
    const r = await researchStory(story(), d)
    expect(r.sources.map(s => s.url)).not.toContain('https://refuses.example/b')
    expect(r.sources.map(s => s.url)).toContain('https://reuters.com/a')
    expect(r.drops['opt-out']).toBe(1)
    expect(r.optOutChecked).toBe(true)

    const { deps: unchecked } = deps()
    expect((await researchStory(story(), unchecked)).optOutChecked).toBe(false)
  })

  it('rewrites exactly once after a failed check, and falls back when the rewrite fails it too', async () => {
    const tavily = fakeTavily(searchResponse(['https://reuters.com/a']))
    const { deps: d, fake } = deps({ tavily, responders: baseResponders({ write: () => goodDraft(['S9F9']), rewrite: () => goodDraft(['S9F9']) }) })
    const r = await researchStory(story(), d)
    expect(fake.steps.filter(c => c === 'write')).toHaveLength(1)
    expect(fake.steps.filter(c => c === 'rewrite')).toHaveLength(1)
    expect(r.rewritten).toBe(true)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'no story sentence passed the check after one rewrite' })
    expect(r.problems[0]?.problem).toContain('S9F9')
    expect(r.draft).not.toBeNull()
  })

  it('falls back when the fact check judges an unsupported claim key after the rewrite, and runs it beside the citation check', async () => {
    const failsKey = (p: string): FactCheck => ({
      sentences: allSupported(p).sentences.map(s => (s.number === 1 ? { number: 1, supported: false, problem: 'no source says it happened', key: true } : s)),
    })
    const { deps: d, fake } = deps({ responders: baseResponders({ 'fact-check': failsKey, rewrite: () => goodDraft() }) })
    const r = await researchStory(story(), d)
    expect(fake.steps.filter(c => c === 'fact-check')).toHaveLength(2)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'a key claim failed the check after one rewrite (Story paragraph 1, sentence 1)' })
  })

  it('lets a source date support the date a sentence gives', async () => {
    const dated = (): Draft => ({
      ...goodDraft(),
      story: [{ sentences: [{ text: 'On Thursday, November 12, Pakistan said it had added 22 GW of rooftop solar in two years.', factIds: ['S0F1'] }] }],
    })
    const { deps: d, fake } = deps({ responders: baseResponders({ write: dated }) })
    const r = await researchStory(story(), d)
    expect(fake.steps).not.toContain('rewrite')
    expect(r.verdict).toEqual({ kind: 'keep' })
  })

  it('drops a bullet that still fails after the rewrite and keeps the rest of the draft', async () => {
    const withBullets = (): Draft => ({
      ...goodDraft(),
      whyThisMatters: [
        { text: 'Cheap power reaches millions.', factIds: [] },
        { text: 'About 40 households benefit.', factIds: [] },
      ],
    })
    const { deps: d } = deps({ responders: baseResponders({ write: withBullets, rewrite: withBullets }) })
    const r = await researchStory(story(), d)
    expect(r.rewritten).toBe(true)
    expect(r.verdict).toEqual({ kind: 'keep' })
    expect(r.problems.map(p => p.label)).toEqual(['Why This Matters 2'])
    expect(r.draft?.whyThisMatters.map(b => b.text)).toEqual(['Cheap power reaches millions.'])
  })

  it('decodes the XML escapes a model copies from its prompt into its answer', async () => {
    const { deps: d } = deps({
      responders: baseResponders({
        extract: () =>
          extraction({
            facts: [{ statement: 'It&apos;s growing.', supportingSentence: 'Pakistan has added 22GW of rooftop solar in just two years.', measures: '' }],
          }),
        write: () => ({ ...goodDraft(), quote: '&quot;We have added 22GW&quot;' }),
      }),
    })
    const r = await researchStory(story(), d)
    expect(r.sources[0]?.facts[0]?.statement).toBe(`It's growing.`)
    expect(r.draft?.quote).toBe('"We have added 22GW"')
  })

  it('keeps a draft the rewrite fixed, after a fact check that found an unsupported sentence', async () => {
    let checks = 0
    const { deps: d, fake } = deps({
      responders: baseResponders({
        'fact-check': p => {
          checks++
          return checks === 1 ? { sentences: [{ number: 1, supported: false, problem: 'two years is not stated', key: false }] } : allSupported(p)
        },
        rewrite: () => goodDraft(['S0F1', 'S1F1']),
      }),
    })
    const r = await researchStory(story(), d)
    expect(fake.steps.filter(c => c === 'rewrite')).toHaveLength(1)
    expect(fake.steps.filter(c => c === 'fact-check')).toHaveLength(2)
    expect(r.verdict).toEqual({ kind: 'keep' })
    expect(r.draft?.story[0]?.sentences[0]?.factIds).toEqual(['S0F1', 'S1F1'])
  })

  it('gates the checked draft on its rating', async () => {
    const { deps: d } = deps({ responders: baseResponders({ write: () => ({ ...goodDraft(), rating: 3 }) }) })
    expect((await researchStory(story(), d)).verdict).toEqual({ kind: 'research-rating', rating: 3 })
  })

  it('assigns fact ids per kept source in order, the original first and our earlier stories last', async () => {
    const tavily = fakeTavily(searchResponse(['https://reuters.com/a', 'https://bbc.co.uk/b']))
    const { deps: d } = deps({ tavily })
    const r = await researchStory(story(), d)
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

  it('names a search source by the outlet name the extraction read from its page, else by its domain; the original and our own sources keep their feed names', async () => {
    const tavily = fakeTavily(searchResponse(['https://www.cleantechnica.com/a', 'https://reuters.com/b', 'https://bbc.co.uk/c']))
    const named: Record<string, string> = {
      'https://www.cleantechnica.com/a': '  CleanTechnica\n',
      'https://reuters.com/b': 'R'.repeat(61),
      'https://bbc.co.uk/c': ' ',
      'https://www.pakistantoday.com.pk/solar': 'Another Name',
      'https://dawn.com/solar': 'Dawn News Online',
    }
    const { deps: d } = deps({
      tavily,
      responders: baseResponders({ extract: prompt => extraction({ outlet: named[/<URL>(.*?)<\/URL>/.exec(prompt)?.[1] ?? ''] ?? '' }) }),
    })
    const r = await researchStory(story(), d)
    expect(r.sources.map(s => [s.origin, s.outlet])).toEqual([
      ['original', 'Pakistan Today'],
      ['cluster', 'Dawn'],
      ['search', 'CleanTechnica'],
      // Longer than an outlet's name: taken for a misreading
      ['search', 'reuters.com'],
      ['search', 'bbc.co.uk'],
    ])
  })

  it('records every call by step and the credits of every search, in the story window', async () => {
    const tavily = fakeTavily(searchResponse(['https://reuters.com/a']))
    const { deps: d } = deps({ tavily })
    const r = await researchStory(story(), d)
    expect(r.calls.map(c => c.step).sort()).toEqual(['earlier', 'extract', 'extract', 'extract', 'fact-check', 'queries', 'write'])
    expect(r.credits).toBe(2)
    expect(r.searches).toEqual([{ query: 'Pakistan rooftop solar 22 GW', language: 'en', results: 1, credits: 2, cached: false }])
    expect(tavily.requests).toEqual([{ query: 'Pakistan rooftop solar 22 GW', startDate: '2026-10-29', endDate: '2026-11-19' }])
  })

  it('never asks Tavily for a date after the run (production passes the run time as latestDate)', async () => {
    const tavily = fakeTavily(searchResponse(['https://reuters.com/a']))
    const { deps: d } = deps({ tavily })
    await researchStory(story(), { ...d, latestDate: '2026-11-13T05:00:00.000Z' })
    expect(tavily.requests).toEqual([{ query: 'Pakistan rooftop solar 22 GW', startDate: '2026-10-29', endDate: '2026-11-13' }])
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
    const { deps: d, fake } = deps({
      responders: baseResponders({
        confirm: () => ({
          assessments: [
            { candidateNumber: 1, isDuplicate: false, reason: '' },
            { candidateNumber: 2, isDuplicate: true, reason: '' },
          ],
        }),
      }),
    })
    const r = await researchStory(story({ neighbours: [neighbour(1), neighbour(2)] }), d)
    expect(fake.steps[0]).toBe('confirm')
    expect(r.sources.map(s => s.outlet)).toEqual(['Pakistan Today', 'Dawn', 'Neighbour 2'])
  })
})

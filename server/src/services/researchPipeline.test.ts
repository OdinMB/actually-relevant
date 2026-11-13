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
  story: [{ text: 'Pakistan added 22 GW of rooftop solar in two years.', factIds }],
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
  items: [...prompt.matchAll(/<ITEM number="(\d+)"/g)].map(m => ({
    number: Number(m[1]),
    supported: true,
    problem: '',
    key: false,
    copiedSentence: '',
    followsSource: '',
  })),
})
/** The number the fact-check prompt gives the item with this label. */
const itemNumber = (prompt: string, label: string) => Number(new RegExp(`<ITEM number="(\\d+)" label="${label}">`).exec(prompt)?.[1])
/** The fact check's answer with one item's verdict changed. */
const judging =
  (label: string, verdict: Partial<FactCheck['items'][number]>) =>
  (prompt: string): FactCheck => ({
    items: allSupported(prompt).items.map(i => (i.number === itemNumber(prompt, label) ? { ...i, ...verdict } : i)),
  })

const twoParagraphs = (): Draft => ({
  ...goodDraft(),
  story: [
    { text: 'Pakistan added 22 GW of rooftop solar in two years.', factIds: ['S0F1'] },
    { text: 'The boom cut grid demand, Dawn reports.', factIds: ['S1F2'] },
  ],
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
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'budget', category: 'technical' })
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
    expect((await researchStory(story(), d)).verdict).toEqual({ kind: 'fallback', reason: 'budget', category: 'technical' })
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
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'budget', category: 'technical' })
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

  it('falls back when no source but the original is left: no other coverage when none survives the filter', async () => {
    const { deps: d, fake } = deps()
    const r = await researchStory(story({ clusterMembers: [] }), d)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'no usable source', category: 'no_other_coverage' })
    expect(fake.steps).not.toContain('extract')

    // The only other report is refused by its publisher's opt-out
    const { deps: optedOut } = deps({ sourcePolicy: { optedOut: async url => url.startsWith('https://dawn.com/') } })
    expect((await researchStory(story(), optedOut)).verdict).toEqual({ kind: 'fallback', reason: 'no usable source', category: 'no_other_coverage' })
  })

  it.each([
    ['unreadable', extraction({ usable: false, facts: [] }), 'unusable'],
    ['about another development', extraction({ relation: 'off-topic', facts: [] }), 'off-topic'],
    ['a press release beside a news report', extraction({ kind: 'press-release' }), 'press-release'],
  ])('falls back as not confirmed when the other reports survive the filter but the extraction keeps none: %s', async (_name, other, drop) => {
    const { deps: d } = deps({ responders: baseResponders({ extract: p => (p.includes('Dawn') ? other : extraction()) }) })
    const r = await researchStory(story(), d)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'no usable source', category: 'not_confirmed' })
    expect(r.drops).toMatchObject({ [drop]: 1 })
  })

  it('falls back as technical when every other report’s extraction failed', async () => {
    const { deps: d } = deps({ responders: baseResponders({ extract: p => (p.includes('Dawn') ? null : extraction()) }) })
    const r = await researchStory(story(), d)
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'no usable source', category: 'technical' })
    expect(r.drops).toMatchObject({ 'extraction-failed': 1 })
  })

  it('falls back as technical on a step the story cannot do without, and on an unexpected error', async () => {
    const { deps: noQueries } = deps({ responders: baseResponders({ queries: () => null }) })
    expect((await researchStory(story(), noQueries)).verdict).toEqual({ kind: 'fallback', reason: 'queries: parse_failure', category: 'technical' })

    const { deps: broken } = deps({
      responders: baseResponders({
        write: () => {
          throw new Error('boom')
        },
      }),
    })
    expect((await researchStory(story(), broken)).verdict).toEqual({ kind: 'fallback', reason: 'error: boom', category: 'technical' })
  })

  it('falls back with the Tavily error', async () => {
    const { deps: d } = deps({
      tavily: {
        async search(): Promise<ResearchSearchAnswer> {
          throw new Error('Tavily search failed: HTTP 432')
        },
      },
    })
    expect((await researchStory(story(), d)).verdict).toEqual({ kind: 'fallback', reason: 'tavily: Tavily search failed: HTTP 432', category: 'technical' })
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
    expect(r.verdict).toEqual({
      kind: 'fallback',
      reason: 'an item that cannot be dropped failed the check after one rewrite (Story paragraph 1)',
      category: 'draft_failed_check',
    })
    expect(r.failedOn).toBe('Story paragraph 1')
    expect(r.problems[0]?.problem).toContain('S9F9')
    expect(r.draft).not.toBeNull()
  })

  it('falls back when the fact check judges an unsupported claim key after the rewrite, and runs it beside the citation check', async () => {
    const failsKey = judging('Story paragraph 1', { supported: false, problem: 'no source says it happened', key: true })
    const { deps: d, fake } = deps({ responders: baseResponders({ 'fact-check': failsKey, rewrite: () => goodDraft() }) })
    const r = await researchStory(story(), d)
    expect(fake.steps.filter(c => c === 'fact-check')).toHaveLength(2)
    expect(r.verdict).toEqual({
      kind: 'fallback',
      reason: 'a key claim failed the check after one rewrite (Story paragraph 1)',
      category: 'draft_failed_check',
    })
    expect(r.failedOn).toBe('Story paragraph 1')
  })

  it("never shows the writer the article's text, so every source wording it reads is in front of the checks", async () => {
    const prompts: string[] = []
    const { deps: d } = deps({
      responders: baseResponders({
        write: p => {
          prompts.push(p)
          return goodDraft()
        },
      }),
    })
    await researchStory(story(), d)
    // The original's first sentence reaches it only as its fact's supporting sentence; the rest of its text not at all
    expect(prompts[0]).toContain('<SENTENCE>Pakistan has added 22GW of rooftop solar in just two years.</SENTENCE>')
    expect(prompts[0]).not.toContain('originalw42')
  })

  it("names each voice's quote in the write prompt by the id the judge's flags use", async () => {
    const writes: string[] = []
    const checks: string[] = []
    const voiced = () =>
      extraction({
        voices: [
          { name: 'A farmer', role: 'grower', stance: 'Doubtful.', quote: '' },
          { name: 'A minister', role: 'minister', stance: 'Pleased.', quote: 'Wir sind stolz.' },
        ],
      })
    const { deps: d } = deps({
      responders: baseResponders({
        extract: voiced,
        write: p => {
          writes.push(p)
          return goodDraft()
        },
        'fact-check': p => {
          checks.push(p)
          return allSupported(p)
        },
      }),
    })
    await researchStory(story(), d)
    const ids = (prompt: string) => [...prompt.matchAll(/<QUOTE id="([^"]+)"[^>]*>Wir sind stolz\.<\/QUOTE>/g)].map(m => m[1])
    expect(ids(writes[0]!)).toEqual(['S0Q2', 'S1Q2'])
    expect(ids(checks[0]!)).toEqual(['S0Q2', 'S1Q2'])
  })

  it('records the items the fact check leaves out as unjudged, and keeps the draft', async () => {
    const leavesOut = (p: string): FactCheck => ({
      items: allSupported(p).items.filter(i => i.number !== itemNumber(p, 'Summary') && i.number !== itemNumber(p, 'Caveat 1')),
    })
    const { deps: d, fake } = deps({ responders: baseResponders({ 'fact-check': leavesOut }) })
    const r = await researchStory(story(), d)
    expect(r.checks.map(c => c.unjudged)).toEqual([['Caveat 1', 'Summary']])
    expect(fake.steps).not.toContain('rewrite')
    expect(r.verdict).toEqual({ kind: 'keep' })
  })

  it('falls back on a draft with no caveat even when it passes its checks, naming the part', async () => {
    const { deps: d, fake } = deps({ responders: baseResponders({ write: () => ({ ...goodDraft(), caveats: [] }) }) })
    const r = await researchStory(story(), d)
    expect(fake.steps).not.toContain('rewrite')
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'the draft has no caveat', category: 'draft_failed_check' })
    expect(r.failedOn).toBe('Caveats')
  })

  it("sends every item to the judge in order, the uncited without cited facts, beside each outside source's own words and none of ours", async () => {
    const prompts: string[] = []
    const voiced = () => extraction({ voices: [{ name: 'A minister', role: 'minister', stance: 'Pleased.', quote: 'Wir sind stolz.' }] })
    const { deps: d } = deps({
      responders: baseResponders({
        extract: voiced,
        write: twoParagraphs,
        'fact-check': p => {
          prompts.push(p)
          return allSupported(p)
        },
      }),
    })
    const r = await researchStory(story(), d)
    expect(r.earlier.map(e => e.id)).toEqual(['E1'])
    const items = [...prompts[0]!.matchAll(/<ITEM number="(\d+)" label="([^"]+)">([\s\S]*?)<\/ITEM>/g)].map(m => [
      Number(m[1]),
      m[2],
      m[3]!.includes('<CITED_FACTS>'),
    ])
    expect(items).toEqual([
      [1, 'Title', false],
      [2, 'Story paragraph 1', true],
      [3, 'Story paragraph 2', true],
      [4, 'Why This Matters 1', false],
      [5, 'Caveat 1', false],
      [6, 'Summary', false],
      [7, 'Blurb', false],
      [8, 'Key quote', false],
    ])
    const wording = /<SOURCE_WORDING>([\s\S]*?)<\/SOURCE_WORDING>/.exec(prompts[0]!)?.[1] ?? ''
    expect([...wording.matchAll(/id="([^"]+)"/g)].map(m => m[1])).toEqual(['S0', 'S0T', 'S0F1', 'S0F2', 'S0Q1', 'S1', 'S1T', 'S1F1', 'S1F2', 'S1Q1'])
    expect(wording).toContain('Wir sind stolz.')
  })

  describe('the key quote', () => {
    const quoteItem = (prompt: string) => /<ITEM number="(\d+)" label="Key quote">([\s\S]*?)<\/ITEM>/.exec(prompt)

    it('goes to the judge as the last item, with its attribution and the source it names, and a hint when code does not find its words there', async () => {
      const prompts: string[] = []
      const voiced = () =>
        extraction({ voices: [{ name: 'Shehbaz Sharif', role: 'prime minister', stance: 'Pleased.', quote: 'We have added 22GW of solar on our roofs.' }] })
      const responders = (quote: string) =>
        baseResponders({
          extract: voiced,
          write: () => ({ ...goodDraft(), quote }),
          'fact-check': p => {
            prompts.push(p)
            return allSupported(p)
          },
        })
      await researchStory(story(), deps({ responders: responders('We have added 22GW of solar [on rooftops]') }).deps)
      await researchStory(story(), deps({ responders: responders('We have installed 22GW') }).deps)

      const [found, notFound] = prompts.map(quoteItem)
      expect(Number(found?.[1])).toBe(prompts[0]!.match(/<ITEM /g)?.length)
      expect(found?.[2]).toContain('<ATTRIBUTION>Prime minister</ATTRIBUTION>')
      expect(found?.[2]).toContain('<QUOTED_SOURCE>S0</QUOTED_SOURCE>')
      expect(found?.[2]).not.toContain('QUOTE_NOT_FOUND')
      expect(notFound?.[2]).toContain('<QUOTE_NOT_FOUND/>')
      // The judge sees who spoke each quote, to check the attribution
      expect(prompts[0]).toContain('<QUOTE id="S0Q1" speaker="Shehbaz Sharif, prime minister">')
    })

    it('is rewritten when the judge finds it unfaithful, and dropped, never the run, when the rewrite still fails it', async () => {
      const rewrites: string[] = []
      const { deps: d } = deps({
        responders: baseResponders({
          rewrite: p => {
            rewrites.push(p)
            return goodDraft()
          },
          'fact-check': judging('Key quote', { supported: false, problem: 'the prime minister did not say this', key: true }),
        }),
      })
      const r = await researchStory(story(), d)
      expect(rewrites[0]).toContain('- Key quote (&quot;We have added 22GW&quot;) fails the fact check: the prime minister did not say this')
      expect(r.verdict).toEqual({ kind: 'keep' })
      expect(r.failedOn).toBeNull()
      expect(r.draft).toMatchObject({ quote: '', quoteAttribution: '', quoteSourceId: '' })
      expect(r.problems).toEqual([expect.objectContaining({ label: 'Key quote', kind: 'fact', by: 'judge', key: false })])
      expect(r.checks.map(c => c.problems.map(p => p.label))).toEqual([['Key quote'], ['Key quote']])
    })

    it('fails in code, without the judge, when it names no source of the run; the rewrite can fix it, else it is dropped', async () => {
      const prompts: string[] = []
      const run = async (rewritten: string) => {
        const { deps: d } = deps({
          responders: baseResponders({
            write: () => ({ ...goodDraft(), quoteSourceId: 'E1' }),
            rewrite: () => ({ ...goodDraft(), quoteSourceId: rewritten }),
            'fact-check': p => {
              prompts.push(p)
              return allSupported(p)
            },
          }),
        })
        return researchStory(story(), d)
      }
      const fixed = await run('S0')
      expect(quoteItem(prompts[0]!)).toBeNull()
      expect(fixed.checks[0]?.problems).toEqual([
        expect.objectContaining({ label: 'Key quote', kind: 'fact', by: 'code', problem: expect.stringContaining('E1') }),
      ])
      expect(quoteItem(prompts[1]!)).not.toBeNull()
      expect(fixed.verdict).toEqual({ kind: 'keep' })
      expect(fixed.draft).toMatchObject({ quote: 'We have added 22GW', quoteSourceId: 'S0' })

      const dropped = await run('S9')
      expect(dropped.verdict).toEqual({ kind: 'keep' })
      expect(dropped.draft).toMatchObject({ quote: '', quoteAttribution: '', quoteSourceId: '' })
    })

    it("is never flagged for copying, in code or by the judge, though it repeats a source's words in quotation marks", async () => {
      const said = 'Households across the country installed more panels this year than in any year before, the energy ministry said.'
      const withSaying = () =>
        extraction({ facts: [...extraction().facts, { statement: 'Households installed a record number of panels.', supportingSentence: said, measures: '' }] })
      const quote = `“${said}”`
      const { deps: d, fake } = deps({
        responders: baseResponders({
          extract: withSaying,
          write: () => ({ ...goodDraft(), quote, quoteAttribution: 'Energy ministry', quoteSourceId: 'S1' }),
          'fact-check': judging('Key quote', { copiedSentence: 'S1F3', followsSource: 'S1' }),
        }),
      })
      const r = await researchStory(story(), d)
      expect(fake.steps).not.toContain('rewrite')
      expect(r.checks[0]?.problems).toEqual([])
      expect(r.checks[0]?.longestRuns.map(l => l.label)).not.toContain('Key quote')
      expect(r.draft?.quote).toBe(quote)
    })

    it('fails nothing when the judge leaves it out: it is recorded as unjudged and kept', async () => {
      const leavesOut = (p: string): FactCheck => ({ items: allSupported(p).items.filter(i => i.number !== itemNumber(p, 'Key quote')) })
      const { deps: d, fake } = deps({ responders: baseResponders({ 'fact-check': leavesOut }) })
      const r = await researchStory(story(), d)
      expect(r.checks.map(c => c.unjudged)).toEqual([['Key quote']])
      expect(fake.steps).not.toContain('rewrite')
      expect(r.draft?.quote).toBe('We have added 22GW')
    })
  })

  it('rewrites a paragraph the judge finds copied, saying so, and drops it when the rewrite still copies', async () => {
    const rewrites: string[] = []
    const { deps: d } = deps({
      responders: baseResponders({
        write: twoParagraphs,
        rewrite: p => {
          rewrites.push(p)
          return twoParagraphs()
        },
        'fact-check': judging('Story paragraph 2', { copiedSentence: 'S1F2' }),
      }),
    })
    const r = await researchStory(story(), d)
    // The line quotes the source sentence it echoed, so the rewrite can see it
    expect(rewrites[0]).toContain(
      '- Story paragraph 2 (&quot;The boom cut grid demand, Dawn reports.&quot;) renders S1F2 (&quot;The boom cut grid demand.&quot;) closely',
    )
    expect(r.verdict).toEqual({ kind: 'keep' })
    expect(r.draft?.story.map(p => p.text)).toEqual(['Pakistan added 22 GW of rooftop solar in two years.'])
    expect(r.checks.map(c => c.problems.map(p => [p.label, p.kind, p.by, p.sourceId]))).toEqual([
      [['Story paragraph 2', 'copying', 'judge', 'S1']],
      [['Story paragraph 2', 'copying', 'judge', 'S1']],
    ])
    expect(r.checks[0]?.longestRuns).toContainEqual({ label: 'Story paragraph 2', sourceId: 'S1', against: 'wording', words: 5 })
  })

  it("rewrites a paragraph that repeats a run of a source's words, and drops it when the rewrite still does", async () => {
    const said = 'Households across the country installed more panels this year than in any year before, the energy ministry said.'
    const withSaying = () =>
      extraction({ facts: [...extraction().facts, { statement: 'Households installed a record number of panels.', supportingSentence: said, measures: '' }] })
    const copying = (): Draft => ({
      ...twoParagraphs(),
      story: [twoParagraphs().story[0]!, { text: 'Households across the country installed more panels this year than in any year before.', factIds: ['S1F3'] }],
    })
    const rewrites: string[] = []
    const { deps: d } = deps({
      responders: baseResponders({
        extract: withSaying,
        write: copying,
        rewrite: p => {
          rewrites.push(p)
          return copying()
        },
      }),
    })
    const r = await researchStory(story(), d)
    expect(rewrites[0]).toContain('repeats 14 words in a row from S1&apos;s own words')
    expect(r.problems).toContainEqual(expect.objectContaining({ label: 'Story paragraph 2', kind: 'copying', by: 'code', sourceId: 'S1', against: 'wording' }))
    expect(r.verdict).toEqual({ kind: 'keep' })
    expect(r.draft?.story).toHaveLength(1)
  })

  it("maps the judge's verdicts back to their items, and ignores a support verdict on an item that cites nothing", async () => {
    const judged = (p: string): FactCheck => {
      const unsupported = new Set(['Title', 'Why This Matters 1', 'Story paragraph 2'].map(label => itemNumber(p, label)))
      return { items: allSupported(p).items.map(i => (unsupported.has(i.number) ? { ...i, supported: false, problem: 'the grid is not mentioned' } : i)) }
    }
    const { deps: d } = deps({ responders: baseResponders({ write: twoParagraphs, rewrite: twoParagraphs, 'fact-check': judged }) })
    const r = await researchStory(story(), d)
    expect(r.problems).toEqual([
      expect.objectContaining({ label: 'Story paragraph 2', kind: 'fact', by: 'judge', problem: 'fails the fact check: the grid is not mentioned' }),
    ])
    expect(r.verdict).toEqual({ kind: 'keep' })
  })

  it('lets a source date support the date a paragraph gives', async () => {
    const dated = (): Draft => ({
      ...goodDraft(),
      story: [{ text: 'On Thursday, November 12, Pakistan said it had added 22 GW of rooftop solar in two years.', factIds: ['S0F1'] }],
    })
    const { deps: d, fake } = deps({ responders: baseResponders({ write: dated }) })
    const r = await researchStory(story(), d)
    expect(fake.steps).not.toContain('rewrite')
    expect(r.verdict).toEqual({ kind: 'keep' })
  })

  it('lets a reworded number pass the code check and hands it to the fact check as a hint for its item, recorded with the pass', async () => {
    const prompts: string[] = []
    // The fact says "in two years": the old number check failed this paragraph on 2024 and 2025
    const reworded = (): Draft => ({ ...goodDraft(), story: [{ text: 'Pakistan added 22 GW of rooftop solar in 2024 and 2025.', factIds: ['S0F1'] }] })
    const { deps: d, fake } = deps({
      responders: baseResponders({
        write: reworded,
        'fact-check': p => {
          prompts.push(p)
          return allSupported(p)
        },
      }),
    })
    const r = await researchStory(story(), d)
    const item = (label: string) => new RegExp(`<ITEM number="${itemNumber(prompts[0]!, label)}"[\\s\\S]*?</ITEM>`).exec(prompts[0]!)?.[0]
    expect(item('Story paragraph 1')).toContain('<NUMBERS_NOT_FOUND>2024; 2025</NUMBERS_NOT_FOUND>')
    expect(prompts[0]!.match(/<NUMBERS_NOT_FOUND>/g)).toHaveLength(1)
    expect(fake.steps).not.toContain('rewrite')
    expect(r.checks).toEqual([expect.objectContaining({ problems: [], numberHints: [{ label: 'Story paragraph 1', numbers: ['2024', '2025'] }] })])
    expect(r.verdict).toEqual({ kind: 'keep' })
  })

  it("lets the fact check's verdict on a hinted number decide: an uncited bullet's number fails only when it judges so, and is then dropped", async () => {
    const withBullets = (): Draft => ({
      ...goodDraft(),
      whyThisMatters: [
        { text: 'Cheap power reaches millions.', factIds: [] },
        { text: 'About 40 households benefit.', factIds: [] },
      ],
    })
    const { deps: passes, fake } = deps({ responders: baseResponders({ write: withBullets }) })
    const kept = await researchStory(story(), passes)
    expect(fake.steps).not.toContain('rewrite')
    expect(kept.checks[0]?.numberHints).toEqual([{ label: 'Why This Matters 2', numbers: ['40'] }])
    expect(kept.draft?.whyThisMatters).toHaveLength(2)

    const fails = judging('Why This Matters 2', { supported: false, problem: 'no fact gives 40 households' })
    const { deps: d } = deps({ responders: baseResponders({ write: withBullets, rewrite: withBullets, 'fact-check': fails }) })
    const r = await researchStory(story(), d)
    expect(r.rewritten).toBe(true)
    expect(r.verdict).toEqual({ kind: 'keep' })
    expect(r.problems).toEqual([
      expect.objectContaining({ label: 'Why This Matters 2', kind: 'fact', by: 'judge', problem: 'fails the fact check: no fact gives 40 households' }),
    ])
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
          return checks === 1 ? judging('Story paragraph 1', { supported: false, problem: 'two years is not stated' })(p) : allSupported(p)
        },
        rewrite: () => goodDraft(['S0F1', 'S1F1']),
      }),
    })
    const r = await researchStory(story(), d)
    expect(fake.steps.filter(c => c === 'rewrite')).toHaveLength(1)
    expect(fake.steps.filter(c => c === 'fact-check')).toHaveLength(2)
    expect(r.verdict).toEqual({ kind: 'keep' })
    expect(r.draft?.story[0]?.factIds).toEqual(['S0F1', 'S1F1'])
    expect(r.checks.map(c => c.problems.length)).toEqual([1, 0])
  })

  it('records a checked draft rated below the bar as research-rating, and old news before it', async () => {
    const { deps: d } = deps({ responders: baseResponders({ write: () => ({ ...goodDraft(), rating: 3 }) }) })
    expect((await researchStory(story(), d)).verdict).toEqual({ kind: 'research-rating', rating: 3 })

    const old = () => ({ ...goodDraft(), rating: 3, oldNews: { isOld: true, firstHappened: '2025-01-01' } })
    const { deps: stale } = deps({ responders: baseResponders({ write: old }) })
    expect((await researchStory(story(), stale)).verdict).toEqual({ kind: 'stale', firstHappened: '2025-01-01' })
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

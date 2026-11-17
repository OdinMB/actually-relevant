import { describe, it, expect } from 'vitest'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import { TavilyError } from '../lib/tavily.js'
import type { BoxesAnswer, ContextExtraction, ContextSlot, GapList } from '../schemas/storyContext.js'
import { buildStoryContext, CONTEXT_PROMPT_VERSIONS, planSearches, type ContextDeps, type ContextInput, type ContextStep } from './storyContextPipeline.js'
import type { ContextSearchAnswer, ContextSearchRequest } from './storyContextSources.js'

const input = (over: Partial<ContextInput> = {}): ContextInput => ({
  storyId: 'story-1',
  title: 'Indonesia peat fires burn 2.88 million hectares',
  summary: 'Fires in Indonesia burned 2.88 million hectares.',
  storyDay: '2026-11-14',
  layout: {
    paragraphs: [{ id: 'P1', text: 'Fires burned 2.88 million hectares across Indonesia.', sourceUrls: ['https://orig.example/a'] }],
    points: [{ id: 'W1', text: 'Smoke reaches millions of people.', sourceUrls: ['https://orig.example/a'] }],
    caveats: ['Counts vary between agencies.'],
  },
  researchRunId: 'rr-1',
  sources: [
    {
      id: 'S0',
      url: 'https://orig.example/a',
      title: 'Fires',
      outlet: 'Orig',
      date: '2026-11-12',
      kind: 'news-report',
      facts: [
        {
          id: 'S0F1',
          statement: 'Fires burned 2.88 million hectares.',
          supportingSentence: 'Fires have burned 2.88 million hectares.',
          measures: 'area burned',
          found: true,
        },
        {
          id: 'S0F2',
          statement: 'The 2015 fires burned 2.6 million hectares.',
          supportingSentence: 'In 2015, 2.6 million hectares burned.',
          measures: '',
          found: true,
        },
      ],
      voices: [],
    },
  ],
  reusable: [],
  ...over,
})

const fields = {
  value: null,
  valueHigh: null,
  unit: '',
  approx: 'exact' as const,
  provisional: false,
  counted: '',
  place: '',
  asOf: '',
  credited: '',
  creditedKind: 'none' as const,
  validity: 'fixed' as const,
}

const gap = (response: 'yes' | 'partly' | 'no', searches: GapList['searches'] = [], responseInStory = ''): GapList => ({
  slots: [
    { slot: 'compared', needed: true, covered: 'no' },
    { slot: 'why_now', needed: true, covered: 'no' },
    { slot: 'build_up', needed: false, covered: 'no' },
    { slot: 'response', needed: true, covered: response },
  ],
  responseInStory,
  searches,
})

const search = (slot: ContextSlot, query: string, recent = false) => ({ slot, wanted: `wanted for ${slot}`, query, recent })

interface Fakes {
  gap?: GapList
  boxes?: BoxesAnswer
  extract?: (prompt: string) => ContextExtraction | null
  /** Labels the checks reject. */
  reject?: string[]
  answers?: Record<string, ContextSearchAnswer>
  searchError?: Error
  optedOut?: string[]
}

const result = (url: string, text = 'Officials say a moratorium on peat drainage has cut fires by half since 2016. Other text.') => ({
  url,
  title: `Title ${url}`,
  date: '2026-11-10',
  text,
})

function fakeDeps(f: Fakes = {}) {
  const prompts: Partial<Record<ContextStep, string[]>> = {}
  const requests: ContextSearchRequest[] = []
  const deps: ContextDeps = {
    async call(step, _schema, prompt) {
      prompts[step] = [...(prompts[step] ?? []), prompt]
      let parsed: unknown
      if (step === 'structure') parsed = { facts: [...prompt.matchAll(/<FACT id="([^"]+)"/g)].map(m => ({ id: m[1], ...fields })) }
      else if (step === 'gap-list') parsed = f.gap ?? gap('yes')
      else if (step === 'extract')
        parsed = f.extract
          ? f.extract(prompt)
          : {
              usable: true,
              kind: 'official-body',
              outlet: 'Agency',
              facts: [
                {
                  statement: 'A moratorium cut fires by half.',
                  supportingSentence: 'Officials say a moratorium on peat drainage has cut fires by half since 2016.',
                  slot: 'response',
                  ...fields,
                },
              ],
            }
      else if (step === 'write') parsed = f.boxes ?? { figures: null, boxes: [] }
      else {
        const labels = [...prompt.matchAll(/<ITEM number="\d+" label="([^"]+)"/g)].map(m => m[1]!)
        parsed = {
          items: labels.map((label, i) => {
            const bad = (f.reject ?? []).includes(label)
            return { number: i + 1, supported: !bad, problem: bad ? 'not stated' : '', key: false, copiedSentence: '', followsSource: '' }
          }),
        }
      }
      return { parsed: parsed as never, outcome: parsed === null ? 'parse_failure' : 'ok', usage: ZERO_USAGE, costUsd: 0.001, model: `model-${step}` }
    },
    async search(request) {
      requests.push(request)
      if (f.searchError) throw f.searchError
      return f.answers?.[request.query] ?? { results: [result(`https://new-${requests.length}.example/a`)], credits: 1, cached: false }
    },
    sourcePolicy: { optedOut: async url => (f.optedOut ?? []).includes(url) },
  }
  return { deps, prompts, requests }
}

const responseBox = (factIds: string[]): BoxesAnswer['boxes'][number] => ({
  slot: 'response',
  heading: "What's being done",
  teaser: 'A moratorium since 2016',
  place: 'W1',
  sentences: [{ text: 'A drainage moratorium has halved fires since 2016.', factIds }],
  visual: { kind: 'none', tiles: [], measure: '', unit: '', points: [], apart: null },
})

describe('buildStoryContext', () => {
  it('skips a story whose research run holds no facts', async () => {
    const { deps, prompts } = fakeDeps()
    const out = await buildStoryContext(input({ sources: [{ ...input().sources[0]!, facts: [] }] }), deps)
    expect(out).toMatchObject({ status: 'skipped', outcome: 'no-research', facts: [], boxes: [] })
    expect(prompts).toEqual({})
  })

  it('searches nothing when nothing needed is uncovered, and stores every fact with its verdict', async () => {
    const { deps, requests, prompts } = fakeDeps({
      gap: { ...gap('yes'), slots: gap('yes').slots.map(s => ({ ...s, covered: 'yes' as const })) },
      reject: ['Fact S0F2'],
    })
    const out = await buildStoryContext(input(), deps)
    expect(requests).toEqual([])
    expect(out.status).toBe('completed')
    expect(out.facts.map(f => [f.ref, f.verdict, f.model, f.promptVersion])).toEqual([
      ['S0F1', 'supported', 'model-structure', CONTEXT_PROMPT_VERSIONS.structure],
      ['S0F2', 'rejected', 'model-structure', CONTEXT_PROMPT_VERSIONS.structure],
    ])
    expect(out.record.droppedFacts).toEqual([
      { ref: 'S0F2', text: 'The 2015 fires burned 2.6 million hectares.', verdict: 'rejected', problem: 'fails the fact check: not stated' },
    ])
    // Rejected facts never reach the write prompt
    expect(prompts.write![0]).toContain('S0F1')
    expect(prompts.write![0]).not.toContain('S0F2')
  })

  it('makes at most 3 searches, an uncovered response first whatever the gap list says', async () => {
    const { deps, requests } = fakeDeps({
      gap: gap('no', [
        search('compared', 'peat fires record 2015 comparison'),
        search('why_now', 'el nino drought indonesia 2026', true),
        search('build_up', 'not needed'),
        search('response', 'indonesia peat restoration agency results'),
        search('compared', 'fourth one'),
      ]),
    })
    const out = await buildStoryContext(input(), deps)
    expect(requests.map(r => [r.query, r.recent, r.endDate])).toEqual([
      ['indonesia peat restoration agency results', false, '2026-11-14'],
      ['peat fires record 2015 comparison', false, '2026-11-14'],
      ['el nino drought indonesia 2026', true, '2026-11-14'],
    ])
    expect(out.record.responseFallback).toBe(false)
  })

  it('adds a response search from the title when the gap list lists none, and records it', async () => {
    const { deps, requests } = fakeDeps({ gap: gap('partly', [search('compared', 'peat fires record')]) })
    const out = await buildStoryContext(input(), deps)
    expect(requests[0]!.query).toBe('Indonesia peat fires burn 2.88 million hectares response')
    expect(out.record.responseFallback).toBe(true)
    expect(out.record.searches.map(s => s.slot)).toEqual(['response', 'compared'])
  })

  it('searches no response the story itself reports, and adds no honest gap for it', async () => {
    const { deps, requests } = fakeDeps({ gap: gap('no', [search('response', 'peat restoration')], 'Smoke reaches millions of people.') })
    const out = await buildStoryContext(input(), deps)
    expect(requests).toEqual([])
    expect(out.record.responseInStory).toBe('Smoke reaches millions of people.')
    expect(out.boxes.some(b => b.gap)).toBe(false)
  })

  it('ignores a claimed response quote the story does not hold', () => {
    const plan = planSearches(gap('no', [], 'A sentence we never wrote.'), { title: 'T', text: 'Our text.' })
    expect(plan).toMatchObject({ storyReports: null, fallback: true, responseSearched: true })
  })

  it('adds the honest gap when the response was searched for and nothing supported answers it', async () => {
    const { deps } = fakeDeps({ gap: gap('no', [search('response', 'peat restoration')]), reject: ['Fact S1F1'] })
    const out = await buildStoryContext(input(), deps)
    expect(out.boxes.at(-1)).toEqual({ type: 'response', heading: '', teaser: '', place: null, sentences: [], visual: null, gap: true })
    expect(out.record.honestGap).toBe(true)
    expect(out.outcome).toBe('built')
  })

  it('writes a response box from a supported search fact, and then no honest gap', async () => {
    const { deps, prompts } = fakeDeps({ gap: gap('no', [search('response', 'peat restoration')]), boxes: { figures: null, boxes: [responseBox(['S1F1'])] } })
    const out = await buildStoryContext(input(), deps)
    expect(out.boxes).toEqual([
      {
        type: 'response',
        heading: "What's being done",
        teaser: 'A moratorium since 2016',
        place: 'W1',
        sentences: [{ text: 'A drainage moratorium has halved fires since 2016.', factIds: ['S1F1'] }],
        visual: null,
        gap: false,
      },
    ])
    const s1 = out.facts.find(f => f.ref === 'S1F1')!
    expect(s1).toMatchObject({
      origin: 'search',
      slot: 'response',
      supportFound: true,
      model: 'model-extract',
      source: { id: 'S1', outlet: 'Agency', kind: 'official-body', date: '2026-11-10' },
    })
    expect(s1.passage).toBe('Officials say a moratorium on peat drainage has cut fires by half since 2016. Other text.')
    expect(out.writer).toEqual({ model: 'model-write', promptVersion: CONTEXT_PROMPT_VERSIONS.write })
    expect(prompts['box-check']![0]).toContain('Box 1 sentence 1')
  })

  it('costs no credits for a cached search, and totals model cost and credits apart', async () => {
    const { deps } = fakeDeps({
      gap: gap('no', [search('response', 'cached query'), search('compared', 'fresh query')]),
      answers: {
        'cached query': { results: [result('https://cached.example/a')], credits: 0, cached: true },
        'fresh query': { results: [result('https://fresh.example/a')], credits: 1, cached: false },
      },
    })
    const out = await buildStoryContext(input(), deps)
    expect(out.credits).toBe(1)
    expect(out.record.searches.map(s => [s.query, s.cached, s.credits, s.kept])).toEqual([
      ['cached query', true, 0, ['https://cached.example/a']],
      ['fresh query', false, 1, ['https://fresh.example/a']],
    ])
    expect(out.modelUsd).toBeCloseTo(out.record.calls.length * 0.001, 10)
    // No box written, so no box check
    expect(out.record.calls.map(c => c.step)).toEqual(['structure', 'gap-list', 'extract', 'extract', 'fact-check', 'write'])
  })

  it("drops opted-out and blocklisted results, and the story's own sources", async () => {
    const { deps, prompts } = fakeDeps({
      gap: gap('no', [search('response', 'q')]),
      optedOut: ['https://refuses.example/a'],
      answers: {
        q: {
          results: [
            result('https://refuses.example/a'),
            result('https://www.prnewswire.com/x'),
            result('https://orig.example/other'),
            result('https://ok.example/a'),
          ],
          credits: 1,
          cached: false,
        },
      },
    })
    const out = await buildStoryContext(input(), deps)
    expect(out.record.sourceDrops).toEqual([
      { url: 'https://refuses.example/a', search: 0, reason: 'opt-out' },
      { url: 'https://www.prnewswire.com/x', search: 0, reason: 'blocklist' },
      { url: 'https://orig.example/other', search: 0, reason: 'known' },
    ])
    expect(prompts.extract).toHaveLength(1)
    expect(prompts.extract![0]).toContain('https://ok.example/a')
    expect(out.record.optOutChecked).toBe(true)
  })

  it('keeps the other sources when one extraction fails to parse', async () => {
    let n = 0
    const { deps } = fakeDeps({
      gap: gap('no', [search('response', 'q')]),
      answers: { q: { results: [result('https://one.example/a'), result('https://two.example/a')], credits: 1, cached: false } },
      extract: () =>
        ++n === 1
          ? null
          : {
              usable: true,
              kind: 'news-report',
              outlet: '',
              facts: [
                {
                  statement: 'A moratorium cut fires.',
                  supportingSentence: 'Officials say a moratorium on peat drainage has cut fires by half since 2016.',
                  slot: 'response',
                  ...fields,
                },
              ],
            },
    })
    const out = await buildStoryContext(input(), deps)
    expect(out.status).toBe('completed')
    expect(out.record.extractionDrops).toEqual([{ url: 'https://one.example/a', reason: 'parse_failure' }])
    expect(out.facts.filter(f => f.origin === 'search').map(f => [f.ref, f.source.outlet])).toEqual([['S2F1', 'two.example']])
  })

  it('ends a story as a technical failure on a Tavily error, with what it spent', async () => {
    const { deps } = fakeDeps({ gap: gap('no', [search('response', 'q')]), searchError: new TavilyError('Tavily search failed: HTTP 502', 502) })
    const out = await buildStoryContext(input(), deps)
    expect(out).toMatchObject({ status: 'failed', outcome: 'technical', error: 'Tavily search failed: HTTP 502', facts: [], boxes: [] })
    expect(out.modelUsd).toBeCloseTo(0.002, 10)
  })

  it('keeps the credits and records of the searches that completed when another fails', async () => {
    const { deps } = fakeDeps({ gap: gap('no', [search('response', 'first'), search('compared', 'fails'), search('why_now', 'third')]) })
    const fake = deps.search
    // The failing search answers first; the others complete after it, and were billed all the same
    deps.search = async request => {
      if (request.query === 'fails') throw new TavilyError('Tavily search failed: HTTP 502', 502)
      await new Promise(resolve => setTimeout(resolve, 5))
      return fake(request)
    }
    const out = await buildStoryContext(input(), deps)
    expect(out).toMatchObject({ status: 'failed', outcome: 'technical', error: 'Tavily search failed: HTTP 502', facts: [], boxes: [] })
    expect(out.credits).toBe(2)
    expect(out.record.searches.map(s => [s.query, s.credits, s.results, s.kept])).toEqual([
      ['first', 1, 1, []],
      ['third', 1, 1, []],
    ])
  })

  it('counts facts the structure step left out as checked and failed', async () => {
    const { deps } = fakeDeps({ reject: [] })
    const original = deps.call
    deps.call = async (step, schema, prompt) =>
      step === 'structure'
        ? {
            parsed: {
              facts: [
                { id: 'S0F1', ...fields },
                { id: 'S9F9', ...fields },
              ],
            } as never,
            outcome: 'ok',
            usage: ZERO_USAGE,
            costUsd: 0,
            model: 'm',
          }
        : original(step, schema, prompt)
    const out = await buildStoryContext(input(), deps)
    expect(out.facts.map(f => f.ref)).toEqual(['S0F1'])
    expect(out.record.facts).toMatchObject({ research: 2, leftOut: 1, supported: 1 })
    expect(out.record.tally).toEqual({ checked: 2, failed: 1 })
  })

  it('offers reused facts under new ids, and stores those a kept box cites', async () => {
    const reused = {
      id: 'earlier-fact-1',
      ref: 'S3F2',
      origin: 'search' as const,
      reusedFromId: null,
      slot: null,
      source: { id: 'S3', url: 'https://earlier.example/a', outlet: 'Earlier', title: 'Earlier', date: '2026-11-01', kind: 'official-body' },
      supportingSentence: 'The agency has restored 1.2 million hectares.',
      passage: null,
      supportFound: true,
      statement: 'The agency restored 1.2 million hectares.',
      ...fields,
      asOf: null,
      creditedKind: null,
      verdict: 'supported' as const,
      verdictProblem: null,
      model: 'old',
      promptVersion: 'old',
    }
    const { deps, prompts } = fakeDeps({ boxes: { figures: null, boxes: [responseBox(['S1F1'])] } })
    const out = await buildStoryContext(input({ reusable: [reused] }), deps)
    expect(prompts['gap-list']![0]).toContain('id="S1F1"')
    expect(out.facts.find(f => f.ref === 'S1F1')).toMatchObject({ reusedFromId: 'earlier-fact-1', verdict: 'supported', model: 'old', source: { id: 'S1' } })
    expect(prompts['fact-check']![0]).not.toContain('Fact S1F1')
  })
})

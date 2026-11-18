import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { config } from '../../../config.js'
import { PASS_STEP_TIERS, passStepEffort } from '../../../services/researchPass.js'
import type { ResearchStory } from '../../../services/researchInput.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import type { Arm, CallRecord, SuiteContext } from '../types.js'
import { evalSearch, firstPassInput, passCall, researchStoryInEval, SMALL, STEP_ARMS } from './pipeline.js'
import type { TavilyResponse, TavilySearch } from './tavily.js'

// The pass's steps themselves are services/researchPass.test.ts's; this is the eval's adapter.

const original = {
  storyId: 's1',
  title: 'Title',
  url: 'https://example.com/a',
  outlet: 'Example',
  language: 'en',
  datePublished: null,
  dateCrawled: '2026-11-12T08:00:00.000Z',
  content: 'Text',
}
const story = {
  id: 's1',
  slug: null,
  datePublished: '2026-11-12T08:00:00.000Z',
  original,
  assess: {
    title: 'Title',
    content: 'Text',
    publisher: 'Example',
    url: original.url,
    guidelines: { factors: '', antifactors: '', ratings: '' },
    emotionTag: null,
  },
  published: {
    titleLabel: null,
    title: 'Title',
    summary: 'Summary',
    whyThisMatters: '- Why',
    caveats: '',
    relevance: 6,
    relevanceCalculation: '',
    quote: null,
    quoteAttribution: null,
    marketingBlurb: null,
  },
  clusterMembers: [],
  neighbours: [],
  earlier: [],
} satisfies ResearchStory

describe('passCall', () => {
  it("holds each step's constant arm at production's default model for the step's tier, and production's effort for the step", () => {
    for (const [step, tier] of Object.entries(PASS_STEP_TIERS)) {
      const production = config.llm.models[tier]
      const effort = passStepEffort(step as keyof typeof PASS_STEP_TIERS) ?? production.reasoningEffort
      expect(STEP_ARMS[step as keyof typeof PASS_STEP_TIERS], step).toEqual({ model: production.name, effort })
    }
    // The extraction steps run below their tier's effort
    for (const step of ['extract', 'gap-extract', 'structure'] as const) expect(STEP_ARMS[step].effort, step).toBe(config.research.extractionEffort)
  })

  it("names research's steps as research's and the card steps as context's, run 2 under its own key", async () => {
    const ctx = fakeEvalContext(() => ({ facts: [] }))
    const schema = z.object({ facts: z.array(z.string()) })
    await passCall(ctx)('queries', schema, 'prompt')
    await passCall(ctx)('gap-extract', schema, 'prompt')
    await passCall(ctx, 2)('cards-write', schema, 'prompt')
    expect(ctx.calls.map(c => c.schemaName)).toEqual([
      expect.stringMatching(/^research-queries#[0-9a-f]{8}$/),
      expect.stringMatching(/^overview-context-extract#[0-9a-f]{8}$/),
      expect.stringMatching(/^overview-context-write#[0-9a-f]{8}~run2$/),
    ])
  })
})

describe('evalSearch', () => {
  it("sends production's gap request, shapes the results as production does, and logs their dates", async () => {
    const requests: TavilySearch[] = []
    const tavily = {
      async search(request: TavilySearch): Promise<TavilyResponse> {
        requests.push(request)
        return {
          results: ['2026-11-10', null].map((d, i) => ({
            url: `https://agency.example/${i}`,
            title: 'Report',
            content: 'A moratorium has cut fires by half since 2016. More text follows here.',
            rawContent: null,
            score: 1,
            publishedDate: d,
            favicon: null,
          })),
          credits: 1,
          cached: true,
        }
      },
    }
    const logged: unknown[] = []
    const answer = await evalSearch(tavily, e => logged.push(e))({ query: 'peat fire moratorium', recent: true, endDate: '2026-11-14' })
    expect(requests[0]).toMatchObject({
      query: 'peat fire moratorium',
      endDate: '2026-11-14',
      startDate: '2026-10-15',
      topic: 'general',
      depth: config.storyContext.searchDepth,
    })
    // A cached answer counts what it cost when made
    expect(answer).toMatchObject({ credits: 1, cached: false })
    expect(answer.results[0]).toEqual({ url: 'https://agency.example/0', title: 'Report', date: '2026-11-10', text: expect.stringContaining('moratorium') })
    expect(logged).toEqual([{ endDate: '2026-11-14', dates: ['2026-11-10', null] }])
  })
})

describe('firstPassInput', () => {
  it('runs a fixture as a first pass: an empty pool, no version, its assessed text as its places, its publishing day', () => {
    const input = firstPassInput(story)
    expect(input).toMatchObject({ story, version: null, pool: { sources: [], facts: [] }, storyDay: '2026-11-12', reusable: [] })
    expect(input.current.layout.paragraphs.map(p => p.text)).toEqual(['Summary'])
    expect(input.current.layout.points.map(p => p.text)).toEqual(['Why'])
  })
})

describe('researchStoryInEval', () => {
  it("calls the eval context with the step's constant arm and a versioned schema name, and records what it returned", async () => {
    const asked: { arm: Arm; schema: string }[] = []
    const ctx: SuiteContext = {
      async call<T>(a: Arm, schemaName: string): Promise<CallRecord<T>> {
        asked.push({ arm: a, schema: schemaName })
        return {
          key: 'k',
          arm: 'gpt-6-luna@low',
          schema: schemaName,
          outcome: 'parse_failure',
          parsed: null,
          content: '{',
          finishReason: 'stop',
          usage: { input: 10, cached: 0, output: 5, reasoning: 1 },
          costUsd: 0.0001,
          latencyMs: 1,
          at: '',
        }
      },
    }
    const tavily = { search: async () => ({ results: [], credits: 0, cached: false }) }
    const r = await researchStoryInEval(story, { ctx, tavily, relevanceMin: 5 })
    expect(asked[0]).toEqual({ arm: SMALL, schema: expect.stringMatching(/^research-queries#[0-9a-f]{8}$/) })
    expect(r.calls[0]).toEqual({
      step: 'queries',
      outcome: 'parse_failure',
      usage: { input: 10, cached: 0, output: 5, reasoning: 1 },
      costUsd: 0.0001,
      model: 'gpt-6-luna',
    })
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'queries: parse_failure', category: 'technical' })
    // No research fact, so no cards: the pass made no other call
    expect(r.calls.map(c => c.step)).toEqual(['queries'])
  })
})

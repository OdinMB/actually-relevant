import { describe, it, expect } from 'vitest'
import type { ResearchStory } from '../../../services/researchInput.js'
import type { Arm, CallRecord, SuiteContext } from '../types.js'
import { researchStoryInEval, SMALL } from './pipeline.js'

// The research steps themselves are services/researchPipeline.test.ts's; this is the eval's adapter.

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
    whyThisMatters: '',
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
    const tavily = { search: async () => ({ results: [], credits: 0 }) }
    const r = await researchStoryInEval(story, { ctx, tavily, relevanceMin: 5 })
    expect(asked).toEqual([{ arm: SMALL, schema: expect.stringMatching(/^research-queries#[0-9a-f]{8}$/) }])
    expect(r.calls).toEqual([
      { step: 'queries', outcome: 'parse_failure', usage: { input: 10, cached: 0, output: 5, reasoning: 1 }, costUsd: 0.0001, model: 'gpt-6-luna' },
    ])
    expect(r.verdict).toEqual({ kind: 'fallback', reason: 'queries: parse_failure' })
  })
})

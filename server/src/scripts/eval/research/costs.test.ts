import { describe, it, expect } from 'vitest'
import { costOf } from '../models.js'
import type { CallOutcome } from '../types.js'
import { deskEstimateUsd, projectMonthly, storyBudgetUsd, summarizeCosts } from './costs.js'
import { STEP_ESTIMATES, type StepCall, type StepName, type StoryResearch } from './pipeline.js'
import { TAVILY_USD_PER_CREDIT } from './tavily.js'

const call = (step: StepName, usd: number, outcome: CallOutcome = 'ok'): StepCall => ({
  step,
  outcome,
  usage: { input: 1000, cached: 200, output: 300, reasoning: 100 },
  costUsd: usd,
})

const result = (storyId: string, calls: StepCall[], credits: number): StoryResearch => ({
  storyId,
  calls,
  credits,
  searches: [],
  candidates: 0,
  drops: {},
  sources: [],
  earlier: [],
  draft: null,
  rewritten: false,
  problems: [],
  support: { facts: 0, found: 0 },
  verdict: { kind: 'keep' },
})

describe('summarizeCosts', () => {
  const results = [
    result('a', [call('queries', 0.001), call('extract', 0.002), call('extract', 0.003, 'parse_failure')], 2),
    result('b', [call('queries', 0.001), call('write', 0.01)], 4),
  ]

  it('sums calls, outcomes, tokens and USD per step', () => {
    const s = summarizeCosts(results)
    expect(s.perStep.extract).toEqual({
      calls: 2,
      outcomes: { ok: 1, parse_failure: 1 },
      usage: { input: 2000, cached: 400, output: 600, reasoning: 200 },
      usd: expect.closeTo(0.005, 10),
    })
    expect(s.perStep.queries.calls).toBe(2)
    expect(s.perStep.rewrite).toEqual({ calls: 0, outcomes: {}, usage: { input: 0, cached: 0, output: 0, reasoning: 0 }, usd: 0 })
  })

  it('sums per story and in total, with the credits', () => {
    const s = summarizeCosts(results)
    expect(s.perStory.map(p => [p.storyId, p.cost.calls, p.credits])).toEqual([
      ['a', 3, 2],
      ['b', 2, 4],
    ])
    expect(s.perStory[1]?.cost.usd).toBeCloseTo(0.011)
    expect(s.total.usd).toBeCloseTo(0.017)
    expect(s.total.calls).toBe(5)
    expect(s.credits).toBe(6)
    expect(s.stories).toBe(2)
  })
})

describe('projectMonthly', () => {
  const summary = (perStoryUsd: number, perStoryCredits: number) => summarizeCosts([result('a', [call('write', perStoryUsd)], perStoryCredits)])

  it('keeps credits inside the free 1,000 at no Tavily cost', () => {
    const p = projectMonthly(summary(0.01, 2), 250)
    expect(p).toMatchObject({ stories: 250, credits: 500, freeCredits: 500, paidCredits: 0, tavilyUsd: 0 })
    expect(p.modelUsd).toBeCloseTo(2.5)
    expect(p.totalUsd).toBeCloseTo(2.5)
  })

  it('prices the credits above the free 1,000', () => {
    const p = projectMonthly(summary(0.01, 6), 250)
    expect(p).toMatchObject({ credits: 1500, freeCredits: 1000, paidCredits: 500 })
    expect(p.tavilyUsd).toBeCloseTo(500 * TAVILY_USD_PER_CREDIT)
    expect(p.totalUsd).toBeCloseTo(2.5 + 4)
  })

  it('projects nothing from no stories', () => {
    expect(projectMonthly(summarizeCosts([]), 250)).toMatchObject({ modelUsd: 0, credits: 0, totalUsd: 0 })
  })
})

describe('desk estimates', () => {
  it("prices a step's tokens with the eval's price table", () => {
    const e = STEP_ESTIMATES.write
    expect(deskEstimateUsd('write')).toBeCloseTo(costOf('gpt-6-luna', { input: e.input, cached: 0, output: e.output, reasoning: 0 }))
  })

  it("budgets a story at every step's estimate plus its searches' credits", () => {
    const steps = Object.keys(STEP_ESTIMATES) as StepName[]
    const models = steps.reduce((sum, s) => sum + deskEstimateUsd(s), 0)
    expect(storyBudgetUsd('en')).toBeCloseTo(models + 2 * TAVILY_USD_PER_CREDIT)
    expect(storyBudgetUsd('de')).toBeCloseTo(models + 4 * TAVILY_USD_PER_CREDIT)
  })
})

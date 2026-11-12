import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getLLMByTier: vi.fn(),
  rateLimitDelay: vi.fn(),
  searchTavily: vi.fn(),
}))
vi.mock('./llm.js', () => ({ getLLMByTier: mocks.getLLMByTier, rateLimitDelay: mocks.rateLimitDelay }))
vi.mock('../lib/tavily.js', async importOriginal => ({ ...(await importOriginal<typeof import('../lib/tavily.js')>()), searchTavily: mocks.searchTavily }))

import { config } from '../config.js'
import { createRunMeter } from './researchCalls.js'
import { callCostUsd } from './researchCost.js'
import { BudgetExhaustedError } from './researchPipeline.js'

const schema = z.object({ a: z.number() })
const search = { query: 'q', startDate: '2026-11-01', endDate: '2026-11-08' }

const answer = (
  over: {
    parsed?: unknown
    content?: string
    finishReason?: string
    usage?: Partial<{ input: number; cached: number; output: number; reasoning: number }>
  } = {},
) => {
  const u = { input: 1000, cached: 400, output: 300, reasoning: 100, ...over.usage }
  return {
    parsed: 'parsed' in over ? over.parsed : { a: 1 },
    raw: new AIMessage({
      content: over.content ?? '{"a":1}',
      response_metadata: { finish_reason: over.finishReason ?? 'stop' },
      usage_metadata: {
        input_tokens: u.input,
        output_tokens: u.output,
        total_tokens: u.input + u.output,
        input_token_details: { cache_read: u.cached },
        output_token_details: { reasoning: u.reasoning },
      },
    }),
  }
}

const meter = (over: { ceilingUsd?: number; monthRoomUsd?: () => Promise<number> } = {}) =>
  createRunMeter({ ceilingUsd: over.ceilingUsd ?? 0.25, monthRoomUsd: over.monthRoomUsd ?? (async () => 30) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLLMByTier.mockReturnValue({ withStructuredOutput: () => ({ invoke: mocks.invoke }) })
  mocks.invoke.mockResolvedValue(answer())
  mocks.searchTavily.mockResolvedValue({ results: [], credits: 2 })
})

describe('createRunMeter: model calls', () => {
  it("turns the answer's usage_metadata into usage and USD on the step's tier model, after the rate-limit delay", async () => {
    const m = meter()
    const res = await m.call('write', schema, 'prompt')
    const model = config.llm.models.medium.name
    const usage = { input: 1000, cached: 400, output: 300, reasoning: 100 }
    expect(res).toEqual({ parsed: { a: 1 }, outcome: 'ok', usage, costUsd: callCostUsd(model, usage), model })
    expect(mocks.getLLMByTier).toHaveBeenCalledWith('medium')
    expect(mocks.rateLimitDelay.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]!)
    expect(m.spentUsd()).toBe(res.costUsd)
  })

  it('gives a truncated or unparsed answer its outcome, and counts what it cost', async () => {
    mocks.invoke.mockResolvedValueOnce(answer({ parsed: { a: 1 }, finishReason: 'length' })).mockResolvedValueOnce(answer({ parsed: null, content: '{"a":' }))
    const m = meter()
    const truncated = await m.call('extract', schema, 'prompt')
    const unparsed = await m.call('extract', schema, 'prompt')
    expect([truncated.outcome, truncated.parsed, unparsed.outcome, unparsed.parsed]).toEqual(['truncated', null, 'parse_failure', null])
    expect(m.spentUsd()).toBeCloseTo(truncated.costUsd + unparsed.costUsd, 12)
    expect(truncated.costUsd).toBeGreaterThan(0)
  })

  it('records a call the model client threw on as an error that cost nothing', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('400 bad request'))
    const res = await meter().call('queries', schema, 'prompt')
    expect(res).toMatchObject({ parsed: null, outcome: 'error', costUsd: 0 })
  })

  it('skips every call once the run reaches its ceiling, without reaching the model', async () => {
    mocks.invoke.mockResolvedValue(answer({ usage: { input: 0, cached: 0, output: 500_000 } }))
    const m = meter({ ceilingUsd: 0.25 })
    expect((await m.call('write', schema, 'prompt')).outcome).toBe('ok')
    expect(m.spentUsd()).toBeGreaterThanOrEqual(0.25)
    mocks.invoke.mockClear()
    const skipped = await m.call('queries', schema, 'prompt')
    expect(skipped).toEqual({
      parsed: null,
      outcome: 'skipped',
      usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
      costUsd: 0,
      model: config.llm.models.small.name,
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it("skips a call the month's cap leaves no room for, without reaching the model", async () => {
    const m = meter({ monthRoomUsd: async () => 0 })
    expect((await m.call('queries', schema, 'prompt')).outcome).toBe('skipped')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('createRunMeter: Tavily', () => {
  it('counts the credits of a search on the meter, at the configured price', async () => {
    const m = meter()
    expect(await m.tavily.search(search)).toEqual({ results: [], credits: 2 })
    expect(m.spentUsd()).toBeCloseTo(2 * config.research.tavilyUsdPerCredit, 12)
  })

  it('refuses a search the budget leaves no room for, without a request', async () => {
    const m = meter({ monthRoomUsd: async () => 0.001 })
    await expect(m.tavily.search(search)).rejects.toBeInstanceOf(BudgetExhaustedError)
    expect(mocks.searchTavily).not.toHaveBeenCalled()
  })

  it('sends the key configured at the time of the call', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-now')
    await meter().tavily.search(search)
    expect(mocks.searchTavily).toHaveBeenCalledWith(search, 'tvly-now')
    vi.unstubAllEnvs()
  })
})

describe('createRunMeter: batches', () => {
  // 4,000 input tokens and the 2,000-token output estimate each: about $0.0015 a call on gpt-6-luna
  const batch = (n: number) => Array.from({ length: n }, () => ({ step: 'extract' as const, prompt: 'x'.repeat(16_000) }))

  it("admits a batch whose estimate fits the run's room, and refuses one that does not", async () => {
    const m = meter({ ceilingUsd: 0.25 })
    expect(await m.admit(batch(5))).toBe(true)
    const tight = meter({ ceilingUsd: 0.005 })
    expect(await tight.admit(batch(5))).toBe(false)
    expect(await tight.admit(batch(1))).toBe(true)
  })

  it("refuses a batch the month's cap leaves no room for", async () => {
    expect(await meter({ monthRoomUsd: async () => 0.005 }).admit(batch(5))).toBe(false)
  })
})

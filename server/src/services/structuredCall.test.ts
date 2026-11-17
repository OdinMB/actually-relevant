import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getLLMByTier: vi.fn(), rateLimitDelay: vi.fn() }))
vi.mock('./llm.js', () => ({ getLLMByTier: mocks.getLLMByTier, rateLimitDelay: mocks.rateLimitDelay }))

import { config } from '../config.js'
import { callCostUsd } from './researchCost.js'
import { structuredCall } from './structuredCall.js'

const schema = z.object({ a: z.number() })

const raw = (finishReason = 'stop') =>
  new AIMessage({
    content: '{"a":1}',
    response_metadata: { finish_reason: finishReason },
    usage_metadata: {
      input_tokens: 1000,
      output_tokens: 300,
      total_tokens: 1300,
      input_token_details: { cache_read: 400 },
      output_token_details: { reasoning: 100 },
    },
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLLMByTier.mockReturnValue({ withStructuredOutput: () => ({ invoke: mocks.invoke }) })
})

describe('structuredCall', () => {
  it("answers on the tier's model after the rate-limit delay, with its usage and its cost at research's prices", async () => {
    mocks.invoke.mockResolvedValue({ parsed: { a: 1 }, raw: raw() })
    const res = await structuredCall('medium', schema, 'prompt')
    const model = config.llm.models.medium.name
    expect(mocks.rateLimitDelay).toHaveBeenCalledTimes(1)
    expect(mocks.getLLMByTier).toHaveBeenCalledWith('medium')
    expect(res).toEqual({
      parsed: { a: 1 },
      outcome: 'ok',
      usage: { input: 1000, cached: 400, output: 300, reasoning: 100 },
      costUsd: callCostUsd(model, { input: 1000, cached: 400, output: 300, reasoning: 100 }),
      model,
    })
  })

  it('keeps no answer the outcome rejects, and still counts what it billed', async () => {
    mocks.invoke.mockResolvedValue({ parsed: { a: 1 }, raw: raw('length') })
    const res = await structuredCall('small', schema, 'prompt')
    expect(res).toMatchObject({ parsed: null, outcome: 'truncated' })
    expect(res.costUsd).toBeGreaterThan(0)
  })

  it('turns a thrown error into an error outcome with no usage, handing the error to the caller to judge', async () => {
    const error = Object.assign(new Error('429 Rate limit reached'), { status: 429 })
    mocks.invoke.mockRejectedValue(error)
    expect(await structuredCall('small', schema, 'prompt')).toEqual({
      parsed: null,
      outcome: 'error',
      usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
      costUsd: 0,
      model: config.llm.models.small.name,
      error,
    })
  })
})

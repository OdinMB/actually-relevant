import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { config } from '../config.js'
import { tokensOf } from '../lib/llmUsage.js'
import { createRunScope, runInScope, settleRun } from '../lib/runUsage.js'
import { _resetSpendGuard, installSpendGuard, type SpendGuard } from '../lib/spendCap.js'
import { openAiFetch, requestKind } from './openaiFetch.js'

const CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const EMBED_URL = 'https://api.openai.com/v1/embeddings'

const answer = (tier: string, usage = { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 } }) =>
  new Response(JSON.stringify({ service_tier: tier, usage, choices: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
const busy = () => new Response(JSON.stringify({ error: { code: 'resource_unavailable' } }), { status: 429 })

const mockFetch = vi.fn<typeof fetch>()
const sentBodies = () => mockFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
const chatInit = { method: 'POST', body: JSON.stringify({ model: 'gpt-6-luna', messages: [] }) }

const inRun = async <T>(flex: boolean, fn: () => Promise<T>, flexUntil: Date | null = null) => {
  const scope = createRunScope({ jobName: 'assess_stories', flex, flexUntil })
  const result = await runInScope(scope, fn)
  return { result, usage: await settleRun(scope) }
}

describe('openAiFetch', () => {
  const originalDelays = config.llm.flex.retryDelaysMs
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    config.llm.flex.retryDelaysMs = [0, 0]
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    config.llm.flex.retryDelaysMs = originalDelays
  })

  it('outside a job run passes the request on untouched and records nothing', async () => {
    mockFetch.mockResolvedValue(answer('default'))
    await openAiFetch(CHAT_URL, chatInit)
    expect(mockFetch).toHaveBeenCalledWith(CHAT_URL, chatInit)
  })

  it('with Flex on asks for flex and records the call at the tier OpenAI answered at', async () => {
    mockFetch.mockResolvedValue(answer('flex'))
    const { result, usage } = await inRun(true, () => openAiFetch(CHAT_URL, chatInit))
    expect(sentBodies()[0]).toMatchObject({ model: 'gpt-6-luna', service_tier: 'flex' })
    expect(await result.json()).toMatchObject({ service_tier: 'flex' })
    expect(usage).toMatchObject({ calls: 1, flexCalls: 1, flexFallbacks: 0, inputTokens: 1000, cachedTokens: 100, outputTokens: 200 })
    expect(usage.costUsd).toBeCloseTo(usage.standardCostUsd * config.llm.flex.priceFactor)
  })

  it('with Flex off sends the request unchanged and records it at standard price', async () => {
    mockFetch.mockResolvedValue(answer('default'))
    const { usage } = await inRun(false, () => openAiFetch(CHAT_URL, chatInit))
    expect(sentBodies()[0]).not.toHaveProperty('service_tier')
    expect(usage).toMatchObject({ calls: 1, flexCalls: 0 })
    expect(usage.costUsd).toBeCloseTo(usage.standardCostUsd)
  })

  it('tries a refused flex call again, then sends it at standard price', async () => {
    mockFetch.mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(answer('default'))
    const { result, usage } = await inRun(true, () => openAiFetch(CHAT_URL, chatInit))
    expect(result.status).toBe(200)
    expect(sentBodies().map(body => body.service_tier ?? 'standard')).toEqual(['flex', 'flex', 'flex', 'standard'])
    expect(usage).toMatchObject({ calls: 1, flexCalls: 0, flexFallbacks: 1 })
  })

  it('stops asking for flex once the cut-off has passed', async () => {
    mockFetch.mockResolvedValue(answer('default'))
    await inRun(true, () => openAiFetch(CHAT_URL, chatInit), new Date(Date.now() - 1000))
    expect(sentBodies()[0]).not.toHaveProperty('service_tier')
  })

  it('never asks for flex on an embedding, and counts its tokens', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ usage: { prompt_tokens: 500, total_tokens: 500 } }), { status: 200 }))
    const { usage } = await inRun(true, () =>
      openAiFetch(EMBED_URL, { method: 'POST', body: JSON.stringify({ model: 'text-embedding-3-small', input: ['a'] }) }),
    )
    expect(sentBodies()[0]).not.toHaveProperty('service_tier')
    expect(usage).toMatchObject({ calls: 1, inputTokens: 500, unpricedCalls: 0 })
  })

  it('records nothing for a failed answer, and hands it back to the SDK', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 500 }))
    const { result, usage } = await inRun(false, () => openAiFetch(CHAT_URL, chatInit))
    expect(result.status).toBe(500)
    expect(usage.calls).toBe(0)
  })

  it('is what the chat models send through: a structured call in a Flex run goes at flex and is counted', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const { createChatModel } = await import('./llm.js')
    const { z } = await import('zod')
    mockFetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: 'c1',
            object: 'chat.completion',
            created: 0,
            model: 'gpt-6-luna',
            service_tier: 'flex',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
            usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    const model = createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'low' }).withStructuredOutput(z.object({ ok: z.boolean() }))
    const { result, usage } = await inRun(true, () => model.invoke('hi'))
    expect(result).toEqual({ ok: true })
    expect(sentBodies()[0]).toMatchObject({ model: 'gpt-6-luna', service_tier: 'flex' })
    expect(usage).toMatchObject({ calls: 1, flexCalls: 1, inputTokens: 50, outputTokens: 5 })
    vi.unstubAllEnvs()
  })

  it('sends every attempt through the installed spend guard: each flex try and the standard one are reserved, the refused tries settled at nothing', async () => {
    const settled: number[] = []
    const reserve = vi.fn<SpendGuard['reserve']>(async usd => ({ usd, settle: (real: number) => void settled.push(real) }))
    installSpendGuard({ reserve })
    try {
      mockFetch.mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(answer('default'))
      await inRun(true, () => openAiFetch(CHAT_URL, chatInit))
      expect(reserve).toHaveBeenCalledTimes(4)
      await vi.waitFor(() => expect(settled).toHaveLength(4))
      expect(settled.slice(0, 3)).toEqual([0, 0, 0])
      expect(settled[3]).toBeGreaterThan(0)
    } finally {
      _resetSpendGuard()
    }
  })

  it('tells model calls and embeddings from other requests', () => {
    expect(requestKind(CHAT_URL)).toBe('model')
    expect(requestKind('https://api.openai.com/v1/responses?x=1')).toBe('model')
    expect(requestKind(EMBED_URL)).toBe('embedding')
    expect(requestKind('https://api.openai.com/v1/files')).toBeNull()
  })

  it('reads Responses API usage too', () => {
    expect(tokensOf({ usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } })).toEqual({
      input: 10,
      cached: 4,
      cacheWrite: 0,
      output: 3,
    })
    expect(tokensOf({})).toEqual({ input: 0, cached: 0, cacheWrite: 0, output: 0 })
  })

  it('reads the tokens written to the cache from Chat Completions and Responses answers', () => {
    expect(tokensOf({ usage: { prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 5 } } })).toEqual({
      input: 10,
      cached: 2,
      cacheWrite: 5,
      output: 3,
    })
    expect(tokensOf({ usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cache_write_tokens: 6 } } })).toMatchObject({ cacheWrite: 6 })
  })
})

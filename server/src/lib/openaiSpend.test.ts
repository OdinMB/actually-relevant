import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MODELS } from './apiPrices.js'
import { cappedFetch, INPUT_OVERHEAD_TOKENS, openAiAnswerUsd, openAiBound } from './openaiSpend.js'
import {
  _resetSpendGuard,
  createCap,
  installSpendGuard,
  NO_CAP,
  openCap,
  SPEND_CAP_REACHED_CODE,
  SPEND_REFUSED_CODE,
  spendRefusalOf,
  SpendRefused,
  type SpendGuard,
  type TaskCap,
} from './spendCap.js'

const CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const M = 1_000_000
const luna = MODELS['gpt-6-luna']
const sol = MODELS['gpt-6.1-sol']
const chat = (extra: Record<string, unknown> = {}, model = 'gpt-6-luna') =>
  JSON.stringify({ model, messages: [{ role: 'user', content: 'Rate this story.' }], ...extra })
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
/** The worst case of a request: every byte a token billed at the dearest input rate, plus the output reserved. */
const worst = (body: string, p: { input: number; cacheWrite: number; output: number }, output: number) =>
  ((bytes(body) + INPUT_OVERHEAD_TOKENS) * p.input * p.cacheWrite + output * p.output) / M

describe('openAiBound', () => {
  it("reserves the body's bytes as input at the cache-write price and the model's maximum output when the request sets no limit", () => {
    const body = chat()
    expect(openAiBound('model', body)).toEqual({ kind: 'model', model: 'gpt-6-luna', usd: worst(body, luna, 128_000) })
  })

  it('counts a character by its UTF-8 bytes, so text outside ASCII is never under-counted', () => {
    const ascii = chat({ messages: [{ role: 'user', content: 'e'.repeat(1000) }] })
    const accented = chat({ messages: [{ role: 'user', content: 'é'.repeat(1000) }] })
    const diff = openAiBound('model', accented).usd - openAiBound('model', ascii).usd
    expect(diff).toBeCloseTo((1000 * luna.input * luna.cacheWrite) / M, 12)
  })

  it("takes a lower output limit the request sets, never a higher one than the model's, and one per answer asked for", () => {
    const limited = chat({ max_completion_tokens: 2_000 })
    expect(openAiBound('model', limited).usd).toBeCloseTo(worst(limited, luna, 2_000), 12)
    const responses = JSON.stringify({ model: 'gpt-6.1-sol', input: 'Rate this story.', max_output_tokens: 500 })
    expect(openAiBound('model', responses).usd).toBeCloseTo(worst(responses, sol, 500), 12)
    const above = chat({ max_completion_tokens: 10_000_000 })
    expect(openAiBound('model', above).usd).toBeCloseTo(worst(above, luna, 128_000), 12)
    const three = chat({ n: 3, max_completion_tokens: 100 })
    expect(openAiBound('model', three).usd).toBeCloseTo(worst(three, luna, 300), 12)
  })

  it('bounds an embedding by its input alone', () => {
    const body = JSON.stringify({ model: 'text-embedding-3-small', input: ['a story'] })
    expect(openAiBound('embedding', body).usd).toBeCloseTo(((bytes(body) + INPUT_OVERHEAD_TOKENS) * 0.02) / M, 15)
  })

  it('refuses a model, or an embedding model, with no price recorded, rather than guessing one', () => {
    expect(() => openAiBound('model', chat({}, 'gpt-4o'))).toThrow(SpendRefused)
    expect(() => openAiBound('model', chat({}, 'gpt-6-luna-2026-09-01'))).toThrow(/gpt-6-luna-2026-09-01/)
    expect(() => openAiBound('embedding', JSON.stringify({ model: 'text-embedding-3-large', input: 'x' }))).toThrow(SpendRefused)
  })

  it('refuses a request its body cannot bound: no JSON body, no model, or another endpoint', () => {
    expect(() => openAiBound('model', undefined)).toThrow(SpendRefused)
    expect(() => openAiBound('model', 'not json')).toThrow(SpendRefused)
    expect(() => openAiBound('model', JSON.stringify({ messages: [] }))).toThrow(SpendRefused)
    expect(() => openAiBound(null, chat())).toThrow(SpendRefused)
  })

  it('refuses a request billed beyond its tokens: an image, context stored at OpenAI, a built-in tool, priority processing', () => {
    const image = chat({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }] })
    expect(() => openAiBound('model', image)).toThrow(/image/)
    expect(() => openAiBound('model', JSON.stringify({ model: 'gpt-6-luna', input: 'x', previous_response_id: 'resp_1' }))).toThrow(SpendRefused)
    expect(() => openAiBound('model', chat({ tools: [{ type: 'web_search' }] }))).toThrow(/tool/)
    expect(() => openAiBound('model', chat({ service_tier: 'priority' }))).toThrow(/priority/)
    // Text parts, a function tool and flex stay bounded
    const text = chat({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }],
      tools: [{ type: 'function', function: { name: 'f' } }],
      service_tier: 'flex',
    })
    expect(openAiBound('model', text).usd).toBeGreaterThan(0)
  })
})

describe('openAiAnswerUsd', () => {
  const bound = openAiBound('model', chat())
  it('prices an answer from its usage, and reads none when it has no usage', () => {
    const json = { usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 } } }
    expect(openAiAnswerUsd(bound, json)).toBeCloseTo((900 * 0.1 + 100 * 0.01 + 200 * 0.5) / M, 12)
    expect(openAiAnswerUsd(bound, { choices: [] })).toBeNull()
    expect(openAiAnswerUsd(bound, { usage: { total_tokens: 5 } })).toBeNull()
    const embedding = openAiBound('embedding', JSON.stringify({ model: 'text-embedding-3-small', input: 'x' }))
    expect(openAiAnswerUsd(embedding, { usage: { prompt_tokens: 500, total_tokens: 500 } })).toBeCloseTo((500 * 0.02) / M, 15)
  })
})

describe('cappedFetch', () => {
  const mockFetch = vi.fn<typeof fetch>()
  const dirs: string[] = []
  const caps: TaskCap[] = []
  const withCap = (usd: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'openai-spend-'))
    dirs.push(dir)
    createCap(dir, 'task', usd)
    const cap = openCap(dir, 'task')
    caps.push(cap)
    installSpendGuard(cap)
    return cap
  }
  const init = { method: 'POST', body: chat() }
  const answer = (status: number, json: unknown = { usage: { prompt_tokens: 1000, completion_tokens: 200 } }) =>
    new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    _resetSpendGuard()
    for (const c of caps.splice(0)) c.close()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('with no guard installed, as in production, is fetch itself: the same arguments, the same answer', async () => {
    const res = answer(200)
    mockFetch.mockResolvedValue(res)
    expect(await cappedFetch(CHAT_URL, init, 'model')).toBe(res)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(CHAT_URL, init)
  })

  it('reserves the worst case before the request leaves, and settles it at the real cost once the answer is read', async () => {
    const cap = withCap(1)
    mockFetch.mockImplementation(async () => {
      expect(cap.state()).toMatchObject({ openCount: 1, openUsd: openAiBound('model', init.body).usd })
      return answer(200)
    })
    const res = await cappedFetch(CHAT_URL, init, 'model')
    expect(await res.json()).toMatchObject({ usage: { prompt_tokens: 1000 } })
    await vi.waitFor(() => expect(cap.state().openCount).toBe(0))
    expect(cap.state().settledUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.5) / M, 12)
  })

  it('settles a rejected request at nothing, a server error, a lost connection and an answer without usage at the full reservation', async () => {
    const cap = withCap(1)
    const reserved = openAiBound('model', init.body).usd
    mockFetch.mockResolvedValueOnce(answer(400, { error: {} }))
    expect((await cappedFetch(CHAT_URL, init, 'model')).status).toBe(400)
    expect(cap.state().settledUsd).toBe(0)
    mockFetch.mockResolvedValueOnce(answer(500, {}))
    await cappedFetch(CHAT_URL, init, 'model')
    expect(cap.state().settledUsd).toBeCloseTo(reserved, 12)
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(cappedFetch(CHAT_URL, init, 'model')).rejects.toThrow(/fetch failed/)
    expect(cap.state().settledUsd).toBeCloseTo(2 * reserved, 12)
    mockFetch.mockResolvedValueOnce(answer(200, { choices: [] }))
    await cappedFetch(CHAT_URL, init, 'model')
    await vi.waitFor(() => expect(cap.state().openCount).toBe(0))
    expect(cap.state().settledUsd).toBeCloseTo(3 * reserved, 12)
  })

  it('never sends a request that does not fit, and answers it with a final refusal the SDK will not retry', async () => {
    withCap(0.01)
    const res = await cappedFetch(CHAT_URL, init, 'model')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(res.status).toBe(402)
    expect(res.headers.get('x-should-retry')).toBe('false')
    expect(await res.json()).toMatchObject({ error: { code: SPEND_CAP_REACHED_CODE } })
  })

  it('without a cap refuses a live request and sends nothing', async () => {
    installSpendGuard(NO_CAP)
    const res = await cappedFetch(CHAT_URL, init, 'model')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ error: { code: SPEND_REFUSED_CODE, message: expect.stringMatching(/--cap/) } })
  })

  it('reaches a chat model as one failed call: asked once, never retried, its error telling the refusal', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const reserve = vi.fn<SpendGuard['reserve']>(() => NO_CAP.reserve(1, 'x'))
    installSpendGuard({ reserve })
    const { createChatModel } = await import('../services/llm.js')
    const { z } = await import('zod')
    const model = createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'low' }).withStructuredOutput(z.object({ ok: z.boolean() }))
    const err = await model.invoke('hi').catch((e: unknown) => e)
    expect(spendRefusalOf(err)).toMatchObject({ kind: 'refused' })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(mockFetch).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})

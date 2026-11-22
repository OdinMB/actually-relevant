import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage } from '@langchain/core/messages'
import { z } from 'zod'
import {
  costOf,
  classifyOutcome,
  estimateInputTokens,
  estimateCallUsd,
  arm,
  cacheKey,
  createEvalContext,
  HOLD_OUTPUT_TOKENS,
  versionedSchemaName,
} from './models.js'
import type { CallRecord } from './types.js'

/** The client factory's model: each live call waits until the test answers it, or fails it. */
const llm = vi.hoisted(() => ({ waiting: [] as ((outcome: 'answer' | 'fail') => void)[] }))
vi.mock('../../services/llm.js', () => ({
  createChatModel: () => ({
    withStructuredOutput: () => ({
      invoke: () =>
        new Promise((resolve, reject) => {
          llm.waiting.push(outcome =>
            outcome === 'fail' ? reject(new Error('429 rate limit')) : resolve({ raw: new AIMessage({ content: '{"ok":true}' }), parsed: { ok: true } }),
          )
        }),
    }),
  }),
}))

const M = 1_000_000

describe('costOf', () => {
  it('bills uncached input at the input rate for models without a cache-write charge', () => {
    expect(costOf('gpt-5-mini', { input: M, cached: 0, output: 0, reasoning: 0 })).toBeCloseTo(0.25)
  })

  it('bills cached input at the cached rate', () => {
    expect(costOf('gpt-5-mini', { input: M, cached: M, output: 0, reasoning: 0 })).toBeCloseTo(0.025)
  })

  it('bills output once, with reasoning tokens already inside it', () => {
    expect(costOf('gpt-5-nano', { input: 0, cached: 0, output: M, reasoning: 800_000 })).toBeCloseTo(0.4)
  })

  it('prices a GPT-6 call as billed: the tokens written to the cache at 1.25× input, the rest of the uncached input at the input rate', () => {
    // 0.5M uncached at 0.10, 0.5M written at 0.10 × 1.25, 1M cached at 0.01
    expect(costOf('gpt-6-luna', { input: 2 * M, cached: M, cacheWrite: M / 2, output: 0, reasoning: 0 })).toBeCloseTo(0.1225)
    expect(costOf('gpt-6-luna', { input: 2 * M, cached: M, output: 0, reasoning: 0 })).toBeCloseTo(0.11)
  })

  it('throws for an unknown model ID', () => {
    expect(() => costOf('gpt-4o' as never, { input: 1, cached: 0, output: 0, reasoning: 0 })).toThrow(/gpt-4o/)
  })
})

describe('classifyOutcome', () => {
  it('maps a parsed response to ok', () => {
    expect(classifyOutcome({ parsed: { a: 1 }, content: '{"a":1}', finishReason: 'stop' })).toBe('ok')
  })

  it('maps content that did not parse to parse_failure', () => {
    expect(classifyOutcome({ parsed: null, content: '{"a":', finishReason: 'stop' })).toBe('parse_failure')
  })

  it('maps a response with no content to empty', () => {
    expect(classifyOutcome({ parsed: null, content: '  ', finishReason: 'stop' })).toBe('empty')
  })

  it('maps finish_reason length to truncated', () => {
    expect(classifyOutcome({ parsed: null, content: '{"a":', finishReason: 'length' })).toBe('truncated')
  })

  it('maps a thrown error to error', () => {
    expect(classifyOutcome({ error: new Error('400') })).toBe('error')
  })
})

describe('createEvalContext', () => {
  const dirs: string[] = []
  const tempLedger = () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-ctx-'))
    dirs.push(dir)
    return join(dir, 'calls.jsonl')
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const schema = z.object({ ok: z.boolean() })
  const luna = arm('gpt-6-luna', 'low')

  it('stops live calls once the ledger reaches the budget', async () => {
    const ctx = createEvalContext({ cacheFile: tempLedger(), budgetUsd: 0, concurrency: 1, offline: false })
    const rec = await ctx.call(luna, 's', schema, 'prompt')
    expect(rec.outcome).toBe('skipped')
    expect(ctx.liveCalls()).toBe(0)
  })

  it('serves a cached call from the ledger without calling the API', async () => {
    const file = tempLedger()
    const cached: CallRecord = {
      key: cacheKey(luna, 's', 'prompt'),
      arm: 'gpt-6-luna@low',
      schema: 's',
      outcome: 'ok',
      parsed: { ok: true },
      content: '{"ok":true}',
      finishReason: 'stop',
      usage: { input: 10, cached: 0, output: 5, reasoning: 0 },
      costUsd: 0.5,
      latencyMs: 42,
      at: '',
    }
    writeFileSync(file, JSON.stringify(cached) + '\n')
    const ctx = createEvalContext({ cacheFile: file, budgetUsd: 0, concurrency: 1, offline: true })
    expect((await ctx.call(luna, 's', schema, 'prompt')).parsed).toEqual({ ok: true })
    expect(ctx.spentUsd()).toBeCloseTo(0.5)
    expect(ctx.spentThisRunUsd()).toBe(0)
  })

  it('adds external spend to the ledger and stops live calls once both together reach the budget', async () => {
    const file = tempLedger()
    const cached: CallRecord = {
      key: cacheKey(luna, 's', 'cached prompt'),
      arm: 'gpt-6-luna@low',
      schema: 's',
      outcome: 'ok',
      parsed: { ok: true },
      content: '{"ok":true}',
      finishReason: 'stop',
      usage: { input: 10, cached: 0, output: 5, reasoning: 0 },
      costUsd: 0.6,
      latencyMs: 42,
      at: '',
    }
    writeFileSync(file, JSON.stringify(cached) + '\n')
    let external = 0.4
    const ctx = createEvalContext({ cacheFile: file, budgetUsd: 1, concurrency: 1, offline: false, externalSpendUsd: () => external })
    expect(ctx.spentUsd()).toBeCloseTo(1)
    const rec = await ctx.call(luna, 's', schema, 'new prompt')
    expect(rec.outcome).toBe('skipped')
    expect(ctx.liveCalls()).toBe(0)
    external = 0.5
    expect(ctx.spentUsd()).toBeCloseTo(1.1)
  })

  it('answers an uncached call skipped, with no call and no cost, in a cache-only run', async () => {
    const ctx = createEvalContext({ cacheFile: tempLedger(), budgetUsd: 10, concurrency: 1, offline: false, cacheOnly: true })
    const rec = await ctx.call(luna, 's', schema, 'prompt')
    expect(rec).toMatchObject({ outcome: 'skipped', parsed: null, costUsd: 0, error: 'not in the cache (--cache-only)' })
    expect(ctx.liveCalls()).toBe(0)
    expect(ctx.spentUsd()).toBe(0)
  })

  it('refuses any uncached call in an offline (dry) run', async () => {
    const ctx = createEvalContext({ cacheFile: tempLedger(), budgetUsd: 10, concurrency: 1, offline: true })
    await expect(ctx.call(luna, 's', schema, 'prompt')).rejects.toThrow(/offline/)
  })

  it('counts each live call against the budget while it is in flight, so calls running at once cannot pass it together, and frees it once recorded or failed', async () => {
    // Prompts of one length hold the same estimate; the budget covers one hold, not two
    const hold = estimateCallUsd({ arm: luna, schemaName: 's', prompt: 'prompt 1', baseOutputTokens: HOLD_OUTPUT_TOKENS })
    const ctx = createEvalContext({ cacheFile: tempLedger(), budgetUsd: hold * 1.5, concurrency: 4, offline: false })
    /** Starts a call, waits until it is the one call in flight, and ends it so. */
    const settle = async (prompt: string, outcome: 'answer' | 'fail') => {
      const call = ctx.call(luna, 's', schema, prompt)
      await vi.waitFor(() => expect(llm.waiting).toHaveLength(1))
      llm.waiting.shift()!(outcome)
      return call
    }
    const first = ctx.call(luna, 's', schema, 'prompt 1')
    const second = ctx.call(luna, 's', schema, 'prompt 2')
    // Only the first reached the model; the second was answered at once
    await vi.waitFor(() => expect(llm.waiting).toHaveLength(1))
    expect(await second).toMatchObject({ outcome: 'skipped', error: 'budget exhausted' })
    llm.waiting.shift()!('answer')
    expect((await first).outcome).toBe('ok')
    // The first call cost nothing as recorded, and a failed call costs nothing: neither hold stands in the way after
    expect((await settle('prompt 3', 'fail')).outcome).toBe('error')
    expect((await settle('prompt 4', 'answer')).outcome).toBe('ok')
    expect(ctx.liveCalls()).toBe(3)
  })
})

describe('versionedSchemaName', () => {
  const rating = (text: string) => z.object({ rating: z.number().int().describe(text) })

  it('is stable for the same schema', () => {
    expect(versionedSchemaName('assess', rating('Rating 1-10'))).toBe(versionedSchemaName('assess', rating('Rating 1-10')))
  })

  it('changes when only a field description changes, so an edited schema never reads a stale cache entry', () => {
    const before = versionedSchemaName('assess', rating('Conservative rating 1-10'))
    const after = versionedSchemaName('assess', rating('Rating 1-10'))
    expect(after).not.toBe(before)
    expect(cacheKey(arm('gpt-6-luna', 'medium'), after, 'p')).not.toBe(cacheKey(arm('gpt-6-luna', 'medium'), before, 'p'))
  })

  it('keeps the base name readable in the ledger', () => {
    expect(versionedSchemaName('dedup', rating('x'))).toMatch(/^dedup#[0-9a-f]{8}$/)
  })
})

describe('estimates', () => {
  it('counts Han characters as one token each and other text at four characters per token', () => {
    expect(estimateInputTokens('abcdefgh')).toBe(2)
    expect(estimateInputTokens('中文字')).toBe(3)
  })

  it('scales output for Luna and for effort', () => {
    const prompt = ''
    const base = estimateCallUsd({ arm: arm('gpt-6-luna', 'medium'), schemaName: 's', prompt, baseOutputTokens: M })
    const low = estimateCallUsd({ arm: arm('gpt-6-luna', 'low'), schemaName: 's', prompt, baseOutputTokens: M })
    expect(base).toBeCloseTo(0.5 * 1.25)
    expect(low).toBeCloseTo(0.5 * 1.25 * 0.4)
  })
})

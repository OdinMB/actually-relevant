import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { costOf, classifyOutcome, estimateInputTokens, estimateCallUsd, arm, cacheKey, createEvalContext } from './models.js'
import type { CallRecord } from './types.js'

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

  it('adds the GPT-6 cache-write surcharge to uncached input only', () => {
    // 1M uncached at 0.10 × 1.25, 1M cached at 0.01
    expect(costOf('gpt-6-luna', { input: 2 * M, cached: M, output: 0, reasoning: 0 })).toBeCloseTo(0.135)
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
      key: cacheKey(luna, 's', 'prompt'), arm: 'gpt-6-luna@low', schema: 's', outcome: 'ok', parsed: { ok: true }, content: '{"ok":true}',
      finishReason: 'stop', usage: { input: 10, cached: 0, output: 5, reasoning: 0 }, costUsd: 0.5, latencyMs: 42, at: '',
    }
    writeFileSync(file, JSON.stringify(cached) + '\n')
    const ctx = createEvalContext({ cacheFile: file, budgetUsd: 0, concurrency: 1, offline: true })
    expect((await ctx.call(luna, 's', schema, 'prompt')).parsed).toEqual({ ok: true })
    expect(ctx.spentUsd()).toBeCloseTo(0.5)
    expect(ctx.spentThisRunUsd()).toBe(0)
  })

  it('refuses any uncached call in an offline (dry) run', async () => {
    const ctx = createEvalContext({ cacheFile: tempLedger(), budgetUsd: 10, concurrency: 1, offline: true })
    await expect(ctx.call(luna, 's', schema, 'prompt')).rejects.toThrow(/offline/)
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

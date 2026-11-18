import { describe, expect, it } from 'vitest'
import { promptMessage } from '../../lib/promptCache.js'
import { fakeEvalContext } from '../../test/fakeEvalContext.js'
import { apiCheck, CACHE_PROBE_STABLE } from './apiCheck.js'
import { arm, estimateInputTokens } from './models.js'

describe('apiCheck', () => {
  it('calls each arm once, then probes each model with the cache controls once with a split prompt over the minimum', async () => {
    const ctx = fakeEvalContext(() => ({ ok: true }))
    const lines: string[] = []
    const ok = await apiCheck([arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'none'), arm('gpt-5-mini', 'low')], ctx, l =>
      lines.push(l),
    )

    expect(ok).toBe(true)
    expect(ctx.calls.filter(c => c.schemaName === 'api-check').map(c => `${c.arm.model}@${c.arm.effort}`)).toEqual([
      'gpt-6-luna@low',
      'gpt-6-luna@none',
      'gpt-5-mini@low',
    ])
    const probes = ctx.calls.filter(c => c.schemaName === 'api-check-cache')
    expect(probes.map(c => c.arm.model)).toEqual(['gpt-6-luna'])
    // Sent with its breakpoint after the fixed block, the ask after it
    expect(promptMessage(probes[0]!.sent, 'gpt-6-luna').content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Rule 150'), prompt_cache_breakpoint: expect.anything() }),
      expect.objectContaining({ text: expect.stringContaining('"ok" field is true') }),
    ])
    // The fake reports nothing written: the line says so, and the check still passes
    expect(lines.some(l => l.includes('gpt-6-luna@low') && l.includes('warning: nothing written or read'))).toBe(true)
  })

  it('fails when a call does not answer', async () => {
    const ctx = fakeEvalContext(name => (name === 'api-check-cache' ? null : { ok: true }))
    expect(await apiCheck([arm('gpt-6-luna', 'low')], ctx, () => {})).toBe(false)
  })

  it('makes no probe for a model without the cache controls', async () => {
    const ctx = fakeEvalContext(() => ({ ok: true }))
    await apiCheck([arm('gpt-5-mini', 'low')], ctx, () => {})
    expect(ctx.calls.map(c => c.schemaName)).toEqual(['api-check'])
  })

  it("keeps the probe's fixed block well over the cache's 1,024-token minimum", () => {
    expect(estimateInputTokens(CACHE_PROBE_STABLE)).toBeGreaterThan(1500)
  })
})

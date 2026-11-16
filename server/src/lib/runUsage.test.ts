import { describe, it, expect } from 'vitest'
import { config } from '../config.js'
import {
  createRunScope,
  currentRun,
  flexNow,
  recordCall,
  recordOtherCost,
  runDeadlinePassed,
  runInScope,
  settleRun,
  standardCallUsd,
  track,
} from './runUsage.js'

const luna = config.llm.modelPrices['gpt-6-luna']!
const call = (tier: 'flex' | 'standard', extra: Partial<Parameters<typeof recordCall>[1]> = {}) => ({
  model: 'gpt-6-luna',
  tier,
  input: 1_000_000,
  cached: 0,
  output: 1_000_000,
  fellBack: false,
  ...extra,
})

describe('run usage', () => {
  it('prices a call at standard rates, cached input at its own rate; null for a model without a price', () => {
    expect(standardCallUsd('gpt-6-luna', { input: 1_000_000, cached: 400_000, output: 2_000_000 })).toBeCloseTo(
      0.6 * luna.input + 0.4 * luna.cached + 2 * luna.output,
    )
    expect(standardCallUsd('model-without-price', { input: 1, cached: 0, output: 1 })).toBeNull()
  })

  it('bills a flex call at the flex factor and counts what it would have cost at standard', () => {
    const scope = createRunScope({ jobName: 'assess_stories', flex: true })
    recordCall(scope, call('flex'))
    recordCall(scope, call('standard', { fellBack: true }))
    const standard = luna.input + luna.output
    expect(scope.usage).toMatchObject({ calls: 2, flexCalls: 1, flexFallbacks: 1, inputTokens: 2_000_000, outputTokens: 2_000_000, unpricedCalls: 0 })
    expect(scope.usage.costUsd).toBeCloseTo(standard * config.llm.flex.priceFactor + standard)
    expect(scope.usage.standardCostUsd).toBeCloseTo(2 * standard)
  })

  it('counts an unpriced call without adding to the sums', () => {
    const scope = createRunScope({ jobName: 'x', flex: false })
    recordCall(scope, call('standard', { model: 'model-without-price' }))
    expect(scope.usage).toMatchObject({ calls: 1, unpricedCalls: 1, costUsd: 0, standardCostUsd: 0 })
  })

  it("a step's scope inside its chain's takes the chain's cut-off and deadline and counts for the chain too", async () => {
    const flexUntil = new Date('2026-11-17T03:30:00Z')
    const deadline = new Date('2026-11-17T05:00:00Z')
    const chain = createRunScope({ jobName: 'daily_edition_chain', flex: false, flexUntil, deadline })
    await runInScope(chain, async () => {
      const step = createRunScope({ jobName: 'research_stories', flex: true })
      expect(step).toMatchObject({ parent: chain, flexUntil, deadline })
      await runInScope(step, async () => {
        expect(currentRun()).toBe(step)
        recordCall(step, call('flex'))
        recordOtherCost(0.25)
      })
    })
    expect(chain.usage.calls).toBe(1)
    expect(chain.usage.otherUsd).toBe(0.25)
    expect(currentRun()).toBeUndefined()
  })

  it('goes at flex only with the switch on and before the cut-off', () => {
    const until = new Date('2026-11-17T03:30:00Z')
    expect(flexNow(createRunScope({ jobName: 'x', flex: false }))).toBe(false)
    expect(flexNow(createRunScope({ jobName: 'x', flex: true }))).toBe(true)
    const cut = createRunScope({ jobName: 'x', flex: true, flexUntil: until })
    expect(flexNow(cut, until.getTime() - 1)).toBe(true)
    expect(flexNow(cut, until.getTime())).toBe(false)
  })

  it('passes the deadline only inside a run that has one', async () => {
    const deadline = new Date('2026-11-17T05:00:00Z')
    expect(runDeadlinePassed(deadline.getTime() + 1)).toBe(false)
    await runInScope(createRunScope({ jobName: 'x', flex: false, deadline }), async () => {
      expect(runDeadlinePassed(deadline.getTime() - 1)).toBe(false)
      expect(runDeadlinePassed(deadline.getTime())).toBe(true)
    })
  })

  it('records other spending only inside a run', () => {
    expect(() => recordOtherCost(1)).not.toThrow()
  })

  it('settles once every usage record still being read has landed', async () => {
    const scope = createRunScope({ jobName: 'x', flex: false })
    let land!: () => void
    track(
      scope,
      new Promise<void>(resolve => {
        land = resolve
      }).then(() => recordCall(scope, call('standard'))),
    )
    const settled = settleRun(scope)
    land()
    expect((await settled).calls).toBe(1)
  })
})

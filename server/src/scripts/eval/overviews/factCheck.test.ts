import { describe, it, expect } from 'vitest'
import type { FactCheck } from '../../../schemas/research.js'
import { publishedFact } from '../../../services/researchChecks.js'
import { arm } from '../models.js'
import type { Arm, CallRecord, PlannedCall } from '../types.js'
import type { FactFixture } from './factFixtures.js'
import {
  batchesOf,
  batchPrompt,
  checkedItem,
  estimateFactCheck,
  FACT_CHECK_SCHEMA_NAME,
  ITEMS_PER_CALL,
  judgeItems,
  LABEL_ARM,
  labelFacts,
  plannedArmCalls,
  plannedLabelCalls,
  readVerdicts,
  runArms,
  runFactCheck,
  variantItems,
  type BudgetedContext,
  type CheckItem,
} from './factCheck.js'

const fact = (n: number, statement = `Congo reported ${n},887 deaths.`, sentence = `Le Congo a signalé ${n} 887 décès.`): FactFixture => ({
  key: `run${n}:S0F1`,
  runId: `run${n}`,
  storyId: `story${n}`,
  sourceId: 'S0',
  outlet: 'Outlet',
  url: `https://example.org/${n}`,
  language: 'fr',
  date: '2026-11-12T08:00:00Z',
  statement,
  measures: 'deaths in North Kivu since August',
  sentence,
})

const item = (f: FactFixture, text = f.statement): CheckItem => ({ id: `${f.key}#faithful`, fact: f, kind: 'faithful', text, change: '' })

interface FakeCall {
  arm: Arm
  schemaName: string
  prompt: string
}

interface FakeLedger {
  /** Whether the cache answers a planned call; by default none. */
  cached?: (call: PlannedCall) => boolean
  spentUsd?: number
}

/** Answers each item of a prompt with `judge(text)`; `'fail'` makes the whole call a parse failure. */
function fakeContext(judge: (text: string) => boolean | 'fail', ledger: FakeLedger = {}): BudgetedContext & { calls: FakeCall[] } {
  const calls: FakeCall[] = []
  return {
    calls,
    isCached: ledger.cached ?? (() => false),
    spentUsd: () => ledger.spentUsd ?? 0,
    async call<T>(a: Arm, schemaName: string, _schema: unknown, prompt: string): Promise<CallRecord<T>> {
      calls.push({ arm: a, schemaName, prompt })
      const texts = [...prompt.matchAll(/<ITEM number="(\d+)"[^>]*>\n<TEXT>([^<]*)<\/TEXT>/g)].map(m => ({ number: Number(m[1]), text: m[2] ?? '' }))
      const verdicts = texts.map(t => ({ ...t, verdict: judge(t.text) }))
      const failed = verdicts.some(v => v.verdict === 'fail')
      const parsed: FactCheck = {
        items: verdicts.map(v => ({
          number: v.number,
          supported: v.verdict === true,
          problem: v.verdict === true ? '' : 'not stated',
          key: false,
          copiedSentence: '',
          followsSource: '',
        })),
      }
      return {
        key: String(calls.length),
        arm: `${a.model}@${a.effort}`,
        schema: schemaName,
        outcome: failed ? 'parse_failure' : 'ok',
        parsed: failed ? null : (parsed as T),
        content: '',
        finishReason: 'stop',
        usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
        costUsd: 0,
        latencyMs: 0,
        at: '',
      }
    },
  }
}

describe('checkedItem', () => {
  it("gives the judge the source's sentence and what the fact measures, never the extraction's statement, then the source's date, with production's number hints", () => {
    const f = fact(4)
    expect(checkedItem(item(f, 'Congo reported 7,331 deaths.'), 3)).toEqual({
      label: 'Fact 3',
      text: 'Congo reported 7,331 deaths.',
      facts: [{ id: 'S3F1', statement: f.sentence, supportingSentence: f.sentence, measures: f.measures }, ...publishedFact('S3', f.outlet, f.date)],
      numbersNotFound: ['7,331'],
    })
    expect(checkedItem(item(f), 1).numbersNotFound).toEqual([])
  })

  it("reads a number the source's date states as found, as production does", () => {
    const f = fact(4)
    const text = 'Congo reported 4,887 deaths by November 12, 2026.'
    expect(checkedItem(item(f, text), 1).numbersNotFound).toEqual([])
    expect(checkedItem(item({ ...f, date: null }, text), 1).numbersNotFound).not.toEqual([])
  })

  it('gives an undated source no date fact', () => {
    expect(checkedItem(item({ ...fact(4), date: null }), 2).facts.map(x => x.id)).toEqual(['S2F1'])
  })

  it("keeps the extraction's statement out of the prompt when the item is a variant of it", () => {
    const f = fact(4)
    const prompt = batchPrompt([item(f, 'Congo reported 7,331 deaths.')])
    expect(prompt).toContain('Congo reported 7,331 deaths.')
    expect(prompt).toContain(f.sentence)
    expect(prompt).not.toContain(f.statement)
  })
})

describe('batchesOf', () => {
  it('shuffles with a fixed seed and holds at most ITEMS_PER_CALL items a call', () => {
    const items = Array.from({ length: 25 }, (_, i) => item(fact(i + 1)))
    const batches = batchesOf(items)
    expect(batches.map(b => b.length)).toEqual([ITEMS_PER_CALL, ITEMS_PER_CALL, 5])
    expect(batches.flat().map(i => i.id)).not.toEqual(items.map(i => i.id))
    expect(new Set(batches.flat().map(i => i.id))).toEqual(new Set(items.map(i => i.id)))
    expect(batchesOf([...items].reverse())).toEqual(batches)
  })
})

describe('readVerdicts', () => {
  const batch = [item(fact(1)), item(fact(2)), item(fact(3))]
  const entry = (number: number, supported: boolean, problem = '') => ({ number, supported, problem, key: false, copiedSentence: '', followsSource: '' })

  it("reads each item's verdict by its number, the first answer for a number counting", () => {
    const verdicts = readVerdicts(batch, { items: [entry(2, false, 'p'), entry(1, true), entry(2, true), entry(9, false)] })
    expect(verdicts.map(v => [v.supported, v.problem])).toEqual([
      [true, ''],
      [false, 'p'],
      [null, ''],
    ])
  })

  it('leaves every item unjudged when the call gave no answer', () => {
    expect(readVerdicts(batch, null).map(v => v.supported)).toEqual([null, null, null])
  })
})

describe('judgeItems', () => {
  it("returns the verdicts in the items' order, a failed call's items unjudged", async () => {
    const items = Array.from({ length: 12 }, (_, i) => item(fact(i + 1)))
    const ctx = fakeContext(text => (text === fact(1).statement ? 'fail' : text !== fact(2).statement))
    const verdicts = await judgeItems(ctx, arm('gpt-6-luna', 'low'), items, 'name')
    expect(verdicts.map(v => v.item.id)).toEqual(items.map(i => i.id))
    const failedBatch = new Set(
      batchesOf(items)
        .find(b => b.some(i => i.fact.key === 'run1:S0F1'))
        ?.map(i => i.id),
    )
    expect(verdicts.filter(v => v.supported === null).map(v => v.item.id)).toEqual(items.filter(i => failedBatch.has(i.id)).map(i => i.id))
    expect(verdicts.find(v => v.item.fact.key === 'run2:S0F1')?.supported).toBe(failedBatch.has('run2:S0F1#faithful') ? null : false)
    expect(ctx.calls).toHaveLength(2)
  })
})

describe('labelFacts', () => {
  it('keeps the facts the strong judge accepts and reports the others as unsupported by their evidence, or unlabeled', async () => {
    const facts = [fact(1), fact(2, 'Congo reported 9,999 deaths.'), fact(3)]
    const ctx = fakeContext(text => !text.includes('9,999'))
    const labels = await labelFacts(ctx, facts)
    expect(labels.accepted.map(f => f.key)).toEqual(['run1:S0F1', 'run3:S0F1'])
    expect(labels.unsupported.map(v => [v.item.fact.key, v.problem])).toEqual([['run2:S0F1', 'not stated']])
    expect(labels.unlabeled).toEqual([])
    expect(ctx.calls.map(c => [c.arm, c.schemaName])).toEqual([[LABEL_ARM, FACT_CHECK_SCHEMA_NAME]])
  })
})

describe('runArms', () => {
  it('runs every arm `repeat` times, run k ≥ 2 under its own cache key', async () => {
    const items = variantItems([fact(1)])
    expect(items.map(i => i.kind)).toEqual(['faithful', 'reworded', 'wrong-number'])
    const ctx = fakeContext(() => true)
    const arms = [arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'medium')]
    const runs = await runArms(ctx, items, arms, 2)
    expect(runs.map(r => [r.arm, r.runs.length, r.runs[0]?.length])).toEqual([
      ['gpt-6-luna@low', 2, 3],
      ['gpt-6-luna@medium', 2, 3],
    ])
    expect(ctx.calls.map(c => c.schemaName)).toEqual([
      FACT_CHECK_SCHEMA_NAME,
      `${FACT_CHECK_SCHEMA_NAME}~run2`,
      FACT_CHECK_SCHEMA_NAME,
      `${FACT_CHECK_SCHEMA_NAME}~run2`,
    ])
  })
})

describe('plannedLabelCalls and plannedArmCalls', () => {
  it('plan exactly the calls the label pass and the arms make, so a cached re-run finds every one', async () => {
    const facts = Array.from({ length: 11 }, (_, i) => fact(i + 1))
    const arms = [arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'medium')]
    const ctx = fakeContext(() => true)
    await labelFacts(ctx, facts)
    const variants = variantItems(facts)
    await runArms(ctx, variants, arms, 2)
    const key = (c: { arm: Arm; schemaName: string; prompt: string }) => `${c.arm.model}@${c.arm.effort}|${c.schemaName}|${c.prompt}`
    const planned = [...plannedLabelCalls(facts), ...plannedArmCalls(variants, arms, 2)]
    expect(new Set(planned.map(key))).toEqual(new Set(ctx.calls.map(key)))
    expect(planned).toHaveLength(ctx.calls.length)
    expect(plannedLabelCalls(facts)).toHaveLength(2)
    expect(plannedArmCalls(variants, arms, 2)).toHaveLength(2 * 2 * Math.ceil(variants.length / ITEMS_PER_CALL))
  })
})

describe('estimateFactCheck', () => {
  const facts = [fact(1), fact(2, 'Congo reported 9,999 deaths.')]
  const arms = [arm('gpt-6-luna', 'low')]
  const judge = (text: string) => !text.includes('9,999')

  it("plans the arms on the accepted facts' variants once the cache holds every label", async () => {
    const ctx = fakeContext(judge, { cached: () => true })
    const estimate = await estimateFactCheck(ctx, facts, arms, 1)
    expect(estimate.armsUpperBound).toBe(false)
    expect(estimate.arms.calls).toBe(plannedArmCalls(variantItems([fact(1)]), arms, 1).length)
    expect(estimate.labels).toMatchObject({ calls: 1, uncached: 0, usd: 0 })
  })

  it("plans them on every fact's variants, an upper bound, while a label is uncached, and makes no call", async () => {
    const ctx = fakeContext(judge)
    const estimate = await estimateFactCheck(ctx, facts, arms, 1)
    expect(estimate.armsUpperBound).toBe(true)
    expect(estimate.arms.calls).toBe(plannedArmCalls(variantItems(facts), arms, 1).length)
    expect(estimate.labels.uncached).toBe(1)
    expect(ctx.calls).toEqual([])
  })
})

describe('runFactCheck', () => {
  const facts = [fact(1), fact(2, 'Congo reported 9,999 deaths.')]
  const arms = [arm('gpt-6-luna', 'low')]
  const judge = (text: string) => !text.includes('9,999')
  const gate = { budgetUsd: 3, canCall: true }

  it('labels every fact, builds variants from the accepted facts only, and runs every arm on them', async () => {
    const ctx = fakeContext(judge)
    const result = await runFactCheck(ctx, facts, arms, 1, gate)
    expect(result.stopped).toBeNull()
    expect(result.labels?.accepted.map(f => f.key)).toEqual(['run1:S0F1'])
    expect([...new Set(result.variants.map(v => v.fact.key))]).toEqual(['run1:S0F1'])
    expect(result.runs.map(r => [r.arm, r.runs[0]?.map(v => v.item.id)])).toEqual([['gpt-6-luna@low', result.variants.map(v => v.id)]])
  })

  it('runs a fully cached step with the budget spent and no API key', async () => {
    const ctx = fakeContext(judge, { cached: () => true, spentUsd: 3 })
    const result = await runFactCheck(ctx, facts, arms, 1, { budgetUsd: 3, canCall: false })
    expect(result.stopped).toBeNull()
    expect(result.runs).toHaveLength(1)
  })

  it('stops before the label pass when its own estimate does not fit, and makes no call', async () => {
    const ctx = fakeContext(judge, { spentUsd: 3 })
    const result = await runFactCheck(ctx, facts, arms, 1, gate)
    expect(result).toMatchObject({ labels: null, runs: [], stopped: { pass: 'labels' } })
    expect(ctx.calls).toEqual([])
  })

  it("checks the arms again once the labels are known, and stops before them when the accepted facts' calls do not fit", async () => {
    const ctx = fakeContext(judge, { cached: c => c.arm === LABEL_ARM, spentUsd: 3 })
    const result = await runFactCheck(ctx, facts, arms, 1, gate)
    expect(result.labels?.accepted).toHaveLength(1)
    expect(result).toMatchObject({ runs: [], stopped: { pass: 'arms' } })
    expect(ctx.calls.every(c => c.arm === LABEL_ARM)).toBe(true)
  })
})

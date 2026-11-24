import { describe, it, expect } from 'vitest'
import type { Prompt } from '../../../lib/promptCache.js'
import type { ContextFactData } from '../../../services/storyContextChecks.js'
import { contextFact } from '../../../test/contextFixtures.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import type { Arm } from '../types.js'
import { LABEL_ARM, type Verdict } from './factCheck.js'
import type { FactFixture } from './factFixtures.js'
import { DRIFT_FACTS_PER_CALL, DRIFT_SCHEMA_NAME, driftBatches, driftFact, judgeDrift, plannedDriftCalls, readDrift, runDriftPass } from './factDrift.js'
import { buildDriftJudgePrompt, type DriftJudgeAnswer } from './factDriftPrompt.js'

/** A sampled module-1 fact of story `n`, shown to writers as `Rendering of fact <n>`. */
const fixture = (n: number, fact: Partial<ContextFactData> = {}, title = `Story ${n}`): FactFixture => {
  const f = contextFact(`S${n}F1`, fact)
  return {
    key: `story-${n}:S${n}F1`,
    runId: `context:story-${n}`,
    storyId: `story-${n}`,
    sourceId: f.source.id,
    outlet: f.source.outlet,
    url: f.source.url,
    language: null,
    date: f.source.date,
    statement: `Rendering of fact ${n}`,
    measures: f.counted,
    sentence: f.supportingSentence,
    context: { fact: f, peers: { places: [], credits: [] }, title },
  }
}

/** The label pass's rejection of a fact, shown as `text`. */
const rejection = (fx: FactFixture, text = fx.statement): Verdict => ({
  item: { id: `${fx.key}#faithful`, fact: fx, kind: 'faithful', text, change: '' },
  supported: false,
  problem: `label reason of ${fx.key}`,
})

const rejections = (count: number) => Array.from({ length: count }, (_, i) => rejection(fixture(i + 1)))

type Answered = Omit<DriftJudgeAnswer['facts'][number], 'number'>

/** Answers each fact of a drift prompt by its rendering; `decide` giving null for any fact fails the whole call. */
const answering =
  (decide: (rendering: string) => Answered | null) =>
  (_schemaName: string, prompt: string): DriftJudgeAnswer | null => {
    const facts = [...prompt.matchAll(/<FACT number="(\d+)"[^>]*>[\s\S]*?<RENDERING>([^<]*)<\/RENDERING>/g)]
    const out: DriftJudgeAnswer['facts'] = []
    for (const m of facts) {
      const answer = decide(m[2] ?? '')
      if (!answer) return null
      out.push({ number: Number(m[1]), ...answer })
    }
    return { facts: out }
  }

/** Fact n's number in its rendering. */
const numberOf = (rendering: string) => Number(/(\d+)$/.exec(rendering)?.[1])

/** Odd facts changed in their period, even facts lacking context only. */
const oddChanged = answering(r =>
  numberOf(r) % 2 === 1
    ? { category: 'changed', kind: 'period', reason: `drops the period of ${r}` }
    : { category: 'context', kind: null, reason: `names ${r}` },
)

const entry = (number: number, category: 'context' | 'changed', kind: DriftJudgeAnswer['facts'][number]['kind'], reason = '') => ({
  number,
  category,
  kind,
  reason,
})

describe('driftFact', () => {
  /** A source of fact 1 under another headline. */
  const headlined = (title: string): ContextFactData['source'] => ({ ...contextFact('S1F1').source, title })

  it("shows the judge the rendering, the source's sentence, date and headline and the story's title, and no statement beside the rendering", () => {
    const fx = fixture(
      1,
      { supportingSentence: 'Cases rose to 100 in the province.', statement: 'Ebola cases in Ituri rose to 100.', source: headlined('Ituri counts 100 cases') },
      'Ebola spreads in Ituri',
    )
    expect(driftFact(rejection(fx, 'Ebola cases in Ituri rose to 100. [Record: figure: 100 people; counts: Ebola cases; place: Ituri]'))).toEqual({
      sourceTitle: 'Ituri counts 100 cases',
      storyTitle: 'Ebola spreads in Ituri',
      source: 'Cases rose to 100 in the province.',
      date: '2026-11-10',
      rendering: 'Ebola cases in Ituri rose to 100. [Record: figure: 100 people; counts: Ebola cases; place: Ituri]',
    })
  })

  it("passes the fixture's sentence as the source, so a search fact's passage reaches the judge as its fixture holds it", () => {
    const fx = { ...fixture(1), sentence: 'A passage around the sentence.' }
    expect(driftFact(rejection(fx)).source).toBe('A passage around the sentence.')
  })

  it("trims the source's headline, and leaves out an empty one", () => {
    expect(driftFact(rejection(fixture(1, { source: headlined('  Ituri counts 100 cases ') }))).sourceTitle).toBe('Ituri counts 100 cases')
    expect(driftFact(rejection(fixture(1, { source: headlined('  ') }))).sourceTitle).toBeNull()
  })

  it('gives a fact with no module-1 record no headline or title, and an undated source no date', () => {
    const fx = { ...fixture(1), context: undefined, date: null }
    expect(driftFact(rejection(fx))).toEqual({
      sourceTitle: null,
      storyTitle: '',
      source: fx.sentence,
      date: null,
      rendering: fx.statement,
    })
  })
})

describe('driftBatches', () => {
  it("keeps the rejected facts' order, at most DRIFT_FACTS_PER_CALL a call, and makes no call of no facts", () => {
    const rejected = rejections(2 * DRIFT_FACTS_PER_CALL + 5)
    const batches = driftBatches(rejected)
    expect(batches.map(b => b.length)).toEqual([DRIFT_FACTS_PER_CALL, DRIFT_FACTS_PER_CALL, 5])
    expect(batches.flat().map(v => v.item.id)).toEqual(rejected.map(v => v.item.id))
    expect(driftBatches([])).toEqual([])
  })
})

describe('readDrift', () => {
  const batch = rejections(3)

  it("reads each fact's answer by its number, the first answer for a number counting and a number outside the call ignored", () => {
    const readings = readDrift(batch, {
      facts: [
        entry(2, 'changed', 'period', 'drops since March'),
        entry(1, 'context', null, 'names Ebola'),
        entry(2, 'context', null, 'late'),
        entry(9, 'changed', 'figure'),
      ],
    })
    expect(readings.map(r => [r.rejection, r.category, r.kind, r.reason])).toEqual([
      [batch[0], 'context', null, 'names Ebola'],
      [batch[1], 'changed', 'period', 'drops since March'],
      [batch[2], null, null, ''],
    ])
  })

  it('reads a changed answer with no kind as other, and a context answer as having no kind whatever it carried', () => {
    const readings = readDrift(batch, { facts: [entry(1, 'changed', null), entry(2, 'context', 'figure'), entry(3, 'changed', 'scope')] })
    expect(readings.map(r => [r.category, r.kind])).toEqual([
      ['changed', 'other'],
      ['context', null],
      ['changed', 'scope'],
    ])
  })

  it('leaves every fact unjudged when the call gave no answer', () => {
    expect(readDrift(batch, null)).toEqual(batch.map(rejection => ({ rejection, category: null, kind: null, reason: '' })))
  })
})

describe('judgeDrift', () => {
  it("puts each call's facts to the label pass's arm under the pass's schema, and reads them back in the rejected facts' order", async () => {
    const rejected = rejections(DRIFT_FACTS_PER_CALL + 2)
    const ctx = fakeEvalContext(oddChanged)
    const readings = await judgeDrift(ctx, rejected)
    expect(ctx.calls.map(c => [c.arm, c.schemaName])).toEqual([
      [LABEL_ARM, DRIFT_SCHEMA_NAME],
      [LABEL_ARM, DRIFT_SCHEMA_NAME],
    ])
    expect(ctx.calls[0]?.prompt).toBe(buildDriftJudgePrompt(rejected.slice(0, DRIFT_FACTS_PER_CALL).map(driftFact)))
    expect(readings.map(r => r.rejection.item.id)).toEqual(rejected.map(v => v.item.id))
    expect(readings.map(r => r.category)).toEqual(rejected.map((_, i) => (i % 2 === 0 ? 'changed' : 'context')))
    expect(readings[0]).toMatchObject({ kind: 'period', reason: 'drops the period of Rendering of fact 1' })
  })

  it("leaves a failed call's facts unjudged and reads the other calls' facts", async () => {
    const rejected = rejections(DRIFT_FACTS_PER_CALL + 2)
    const last = rejected[rejected.length - 1]!.item.text
    const ctx = fakeEvalContext(answering(r => (r === last ? null : { category: 'context', kind: null, reason: 'names it' })))
    const readings = await judgeDrift(ctx, rejected)
    expect(readings).toHaveLength(rejected.length)
    expect(readings.map(r => r.category)).toEqual([...Array<string>(DRIFT_FACTS_PER_CALL).fill('context'), null, null])
  })

  it('makes no call when the label pass rejected nothing', async () => {
    const ctx = fakeEvalContext(oddChanged)
    expect(await judgeDrift(ctx, [])).toEqual([])
    expect(ctx.calls).toEqual([])
    expect(await judgeDrift(ctx, rejections(1))).toHaveLength(1)
    expect(ctx.calls).toHaveLength(1)
  })
})

describe('plannedDriftCalls', () => {
  it('plans exactly the calls judgeDrift makes, so a cached re-run finds every one', async () => {
    const rejected = rejections(DRIFT_FACTS_PER_CALL + 1)
    const ctx = fakeEvalContext(oddChanged)
    await judgeDrift(ctx, rejected)
    const key = (c: { arm: Arm; schemaName: string; prompt: Prompt }) => `${c.arm.model}@${c.arm.effort}|${c.schemaName}|${JSON.stringify(c.prompt)}`
    const planned = plannedDriftCalls(rejected)
    expect(new Set(planned.map(key))).toEqual(new Set(ctx.calls.map(c => key({ ...c, prompt: c.sent }))))
    expect(planned).toHaveLength(ctx.calls.length)
    expect(planned).toHaveLength(2)
  })

  it('expects output in proportion to the facts a call holds', () => {
    const [full, one] = plannedDriftCalls(rejections(DRIFT_FACTS_PER_CALL + 1))
    expect(one!.baseOutputTokens).toBeGreaterThan(0)
    expect(full!.baseOutputTokens).toBe(DRIFT_FACTS_PER_CALL * one!.baseOutputTokens)
  })
})

describe('runDriftPass', () => {
  const gate = { budgetUsd: 3, canCall: true }

  it('reads every rejected fact when its calls fit the budget', async () => {
    const rejected = rejections(3)
    const run = await runDriftPass(fakeEvalContext(oddChanged), rejected, gate)
    expect(run.stopped).toBeNull()
    expect(run.readings?.map(r => [r.rejection.item.id, r.category])).toEqual([
      [rejected[0]!.item.id, 'changed'],
      [rejected[1]!.item.id, 'context'],
      [rejected[2]!.item.id, 'changed'],
    ])
  })

  it('stops before any call when its uncached calls do not fit what is left of the budget', async () => {
    const ctx = fakeEvalContext(oddChanged, { spentUsd: 3 })
    const run = await runDriftPass(ctx, rejections(3), gate)
    expect(run.readings).toBeNull()
    expect(run.stopped).toMatch(/remaining budget/)
    expect(run.estimate).toMatchObject({ calls: 1, uncached: 1 })
    expect(ctx.calls).toEqual([])
  })

  it('stops before any call without the API key while a call is uncached', async () => {
    const ctx = fakeEvalContext(oddChanged)
    const run = await runDriftPass(ctx, rejections(3), { budgetUsd: 3, canCall: false })
    expect(run).toMatchObject({ readings: null, stopped: expect.stringMatching(/OPENAI_API_KEY/) })
    expect(ctx.calls).toEqual([])
  })

  it('runs a fully cached pass with the budget spent and no API key', async () => {
    const ctx = fakeEvalContext(oddChanged, { cached: () => true, spentUsd: 3 })
    const run = await runDriftPass(ctx, rejections(3), { budgetUsd: 3, canCall: false })
    expect(run.stopped).toBeNull()
    expect(run.estimate).toEqual({ calls: 1, uncached: 0, usd: 0 })
    expect(run.readings).toHaveLength(3)
  })

  it('runs with nothing rejected, and makes no call', async () => {
    const ctx = fakeEvalContext(oddChanged, { spentUsd: 3 })
    expect(await runDriftPass(ctx, [], { budgetUsd: 3, canCall: false })).toEqual({ estimate: { calls: 0, uncached: 0, usd: 0 }, readings: [], stopped: null })
    expect(ctx.calls).toEqual([])
  })
})

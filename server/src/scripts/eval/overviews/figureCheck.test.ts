import { describe, it, expect } from 'vitest'
import type { Prompt } from '../../../lib/promptCache.js'
import { buildFigureCheckPrompt } from '../../../prompts/storyContext.js'
import type { FigureAnswer, FigureCheck } from '../../../schemas/storyContext.js'
import type { ContextFactData } from '../../../services/storyContextChecks.js'
import type { RemovedFigure } from '../../../services/storyContextFigures.js'
import { contextFact } from '../../../test/contextFixtures.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import { arm } from '../models.js'
import type { Arm } from '../types.js'
import type { StoryFacts } from './contextFacts.js'
import { LABEL_ARM } from './factCheck.js'
import {
  estimateFigureCheck,
  FIGURE_CHECK_SCHEMA_NAME,
  FIGURES_PER_CALL,
  figureBatches,
  figureFixtures,
  figurePrompt,
  figureVariants,
  labelFigures,
  plannedFigureArmCalls,
  plannedFigureLabelCalls,
  readFigureAnswers,
  runFigureArms,
  runFigureCheck,
  type FigureFixture,
  type KeptFigure,
} from './figureCheck.js'

const story = (slug: string, facts: ContextFactData[], removed: RemovedFigure[] = []): StoryFacts => ({ slug, title: `Title of ${slug}`, facts, removed })

const removal = (ref: string, answer: RemovedFigure['answer'] = 'not-stated'): RemovedFigure => ({
  ref,
  figure: `figure of ${ref}`,
  counted: `thing of ${ref}`,
  answer,
})

/** A removed figure's fact as the run keeps it: its figure gone. */
const figureless = (ref: string, extra: Partial<ContextFactData> = {}) => contextFact(ref, { value: null, unit: '', counted: '', ...extra })

/** One story's kept figures S<n>F1 …, each counting a thing of its own, from one source sentence each. */
const keptFigures = (slug: string, count: number): KeptFigure[] =>
  figureFixtures(
    [
      story(
        slug,
        Array.from({ length: count }, (_, i) => contextFact(`S${i + 1}F1`, { value: 100 + i, counted: `people evacuated from camp ${i + 1}` })),
      ),
    ],
    count,
  ).figures.filter((f): f is KeptFigure => f.kept)

describe('figureFixtures', () => {
  it('takes the figures production kept and those it removed in turn from each story, in fact order', () => {
    const sample = figureFixtures(
      [
        story('a', [contextFact('S1F1'), figureless('S1F2'), contextFact('S1F3')], [removal('S1F2')]),
        story('b', [figureless('S2F1')], [removal('S2F1', 'computed')]),
      ],
      10,
    )
    expect(sample.figures.map(f => [f.id, f.kept])).toEqual([
      ['a:S1F1', true],
      ['b:S2F1', false],
      ['a:S1F2', false],
      ['a:S1F3', true],
    ])
    expect(sample.stories).toBe(2)
    expect(sample.shortfalls).toHaveLength(1)
  })

  it('shows a kept figure as production shows it to the check, and keeps its fact to plant in', () => {
    const fact = contextFact('S1F1', { value: 2_880_000, unit: 'hectares', approx: 'about', counted: 'area burned', passage: 'The passage around it.' })
    const [kept] = figureFixtures([story('a', [fact])], 10).figures
    expect(kept).toMatchObject({
      id: 'a:S1F1',
      kept: true,
      shown: { number: 'about 2.88 million hectares', counts: 'area burned', source: 'The passage around it.' },
      fact,
      outlet: fact.source.outlet,
    })
  })

  it("shows a removed figure as production recorded it, with its fact's source words, and production's answer", () => {
    const sample = figureFixtures(
      [story('a', [figureless('S1F1', { passage: 'Kenya, Uganda and Rwanda signed.' }), figureless('S1F2')], [removal('S1F1', 'computed'), removal('S1F2')])],
      10,
    )
    expect(sample.figures).toEqual([
      expect.objectContaining({
        id: 'a:S1F1',
        kept: false,
        answer: 'computed',
        shown: { number: 'figure of S1F1', counts: 'thing of S1F1', source: 'Kenya, Uganda and Rwanda signed.' },
      }),
      expect.objectContaining({ id: 'a:S1F2', shown: expect.objectContaining({ source: 'Sentence of S1F2.' }) }),
    ])
  })

  it('takes the kept figures of facts the fact check judged, supported or rejected, and leaves out unjudged and reused facts, facts without a figure, and a removal whose fact is missing', () => {
    const sample = figureFixtures(
      [
        story(
          'a',
          [
            contextFact('S1F1', { verdict: 'rejected' }),
            contextFact('S1F2', { verdict: 'unjudged' }),
            contextFact('S1F3', { reusedFromId: 'earlier' }),
            figureless('S1F4'),
          ],
          [removal('S9F9')],
        ),
      ],
      10,
    )
    expect(sample.figures.map(f => f.id)).toEqual(['a:S1F1'])
  })

  it('stops at the size asked for', () => {
    const sample = figureFixtures([story('a', [contextFact('S1F1'), contextFact('S1F2')]), story('b', [contextFact('S2F1')])], 2)
    expect(sample.figures.map(f => f.id)).toEqual(['a:S1F1', 'b:S2F1'])
    expect(sample.shortfalls).toEqual([])
  })

  it("gives each kept figure the story's counted phrases as peers, each once", () => {
    const [kept] = figureFixtures(
      [
        story('a', [
          contextFact('S1F1', { counted: 'people evacuated' }),
          contextFact('S1F2', { counted: 'Homes destroyed' }),
          contextFact('S1F3', { counted: 'homes destroyed' }),
          figureless('S1F4'),
        ]),
      ],
      10,
    ).figures
    expect(kept?.kept && kept.peers).toEqual(['people evacuated', 'Homes destroyed'])
  })
})

describe('figureVariants', () => {
  const kept = (fact: Partial<ContextFactData>, peers: string[] = []): KeptFigure => {
    const [fx] = figureFixtures([story('a', [contextFact('S1F1', fact)])], 1).figures
    if (!fx?.kept) throw new Error('expected a kept figure')
    return { ...fx, peers }
  }

  it('always gives the figure as it is, expected given', () => {
    const fx = kept({ value: 0 })
    expect(figureVariants(fx)).toEqual([{ id: 'a:S1F1#faithful', figure: fx, kind: 'faithful', shown: fx.shown, change: '' }])
  })

  it('plants a wrong number, the figure spelled again', () => {
    const wrong = figureVariants(kept({ value: 100, unit: 'people' })).find(v => v.kind === 'wrong-number')
    expect(wrong).toMatchObject({ id: 'a:S1F1#wrong-number', shown: { number: '150 people', counts: 'people evacuated' }, change: '100 people → 150 people' })
  })

  it('plants a range wrong at both ends', () => {
    const wrong = figureVariants(kept({ value: 5000, valueHigh: 5400, unit: 'people' })).find(v => v.kind === 'wrong-number')
    expect(wrong?.shown.number).toBe('7,500 to 8,100 people')
  })

  it("plants no wrong number where none changes the figure or the source's words state it", () => {
    expect(figureVariants(kept({ value: 0 })).map(v => v.kind)).toEqual(['faithful'])
    expect(figureVariants(kept({ value: 100, supportingSentence: 'Of 100 evacuated, 150 have returned.' })).map(v => v.kind)).toEqual(['faithful'])
  })

  it('counts another thing of the story, never one the source or the figure names, nor one inside or around its own', () => {
    const fx = kept({ counted: 'people evacuated', supportingSentence: 'Three deaths, and 100 people evacuated.' }, [
      'people evacuated',
      'people',
      'people evacuated from Riau',
      'deaths',
      'homes destroyed',
    ])
    expect(figureVariants(fx).find(v => v.kind === 'other-thing')).toMatchObject({
      shown: { number: '100 people', counts: 'homes destroyed', source: 'Three deaths, and 100 people evacuated.' },
      change: 'people evacuated → homes destroyed',
    })
    const hectares = kept({ value: 2_880_000, unit: 'hectares', counted: 'area burned', supportingSentence: 'Fires burned a vast area.' }, ['hectares'])
    expect(figureVariants(hectares).map(v => v.kind)).not.toContain('other-thing')
  })
})

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

type Decide = (figure: { number: string; counts: string; source: string }) => FigureAnswer | 'omit' | 'fail'

/** Answers each figure of a figure-check prompt by what it shows; `fail` for any figure fails the whole call, `omit` leaves it out. */
const answering =
  (decide: Decide) =>
  (_schemaName: string, prompt: string): FigureCheck | null => {
    const figures: FigureCheck['figures'] = []
    for (const m of prompt.matchAll(/<FIGURE id="([^"]+)">\n<NUMBER>([^<]*)<\/NUMBER>\n<COUNTS>([^<]*)<\/COUNTS>\n<SOURCE>([^<]*)<\/SOURCE>/g)) {
      const answer = decide({ number: m[2] ?? '', counts: m[3] ?? '', source: m[4] ?? '' })
      if (answer === 'fail') return null
      if (answer !== 'omit') figures.push({ id: m[1] ?? '', inSource: answer })
    }
    return { figures }
  }

/** The judge finds a figure given unless its number was planted (150 and up) or it counts another thing; a removed figure is not stated. */
const truthful: Decide = f =>
  f.number.startsWith('figure of')
    ? 'not-stated'
    : Number(f.number.replace(/\D/g, '')) >= 150
      ? 'not-stated'
      : f.counts.startsWith('homes')
        ? 'other-thing'
        : 'given'

describe('readFigureAnswers', () => {
  const batch = keptFigures('a', 3)

  it("reads each figure's answer by its place in the call, the first answer for an id counting and an id outside the call ignored", () => {
    const answers = readFigureAnswers(batch, {
      figures: [
        { id: 'S2F1', inSource: 'computed' },
        { id: 'S1F1', inSource: 'given' },
        { id: 'S2F1', inSource: 'given' },
        { id: 'S9F1', inSource: 'given' },
      ],
    })
    expect(answers.map(a => [a.item.id, a.answer])).toEqual([
      ['a:S1F1', 'given'],
      ['a:S2F1', 'computed'],
      ['a:S3F1', null],
    ])
  })

  it('leaves every figure unanswered when the call gave no answer', () => {
    expect(readFigureAnswers(batch, null).map(a => a.answer)).toEqual([null, null, null])
  })
})

describe('figurePrompt', () => {
  it("is production's prompt on the figures as shown, each named by its place in the call, so two stories' refs never clash", () => {
    const [a] = keptFigures('a', 1)
    const [b] = keptFigures('b', 1)
    expect(figurePrompt([a!, b!])).toBe(
      buildFigureCheckPrompt([
        { id: 'S1F1', ...a!.shown },
        { id: 'S2F1', ...b!.shown },
      ]),
    )
  })
})

describe('figureBatches', () => {
  it('shuffles with a fixed seed and holds at most FIGURES_PER_CALL figures a call', () => {
    const figures = keptFigures('a', FIGURES_PER_CALL + 3)
    const batches = figureBatches(figures)
    expect(batches.map(b => b.length)).toEqual([FIGURES_PER_CALL, 3])
    expect(new Set(batches.flat().map(f => f.id))).toEqual(new Set(figures.map(f => f.id)))
    expect(figureBatches([...figures].reverse())).toEqual(batches)
  })
})

describe('labelFigures', () => {
  it("puts each figure to the strong judge once under the figure schema, and reads the answers back in sample order, a failed call's figures unlabeled", async () => {
    const figures = keptFigures('a', FIGURES_PER_CALL + 2)
    const failing = figureBatches(figures)[1]![0]!.shown.number
    const ctx = fakeEvalContext(answering(f => (f.number === failing ? 'fail' : 'given')))
    const labels = await labelFigures(ctx, figures)
    expect(ctx.calls.map(c => [c.arm, c.schemaName])).toEqual([
      [LABEL_ARM, FIGURE_CHECK_SCHEMA_NAME],
      [LABEL_ARM, FIGURE_CHECK_SCHEMA_NAME],
    ])
    expect(labels.map(l => l.item.id)).toEqual(figures.map(f => f.id))
    const unlabeled = new Set(figureBatches(figures)[1]!.map(f => f.id))
    expect(labels.filter(l => l.answer === null).map(l => l.item.id)).toEqual(figures.filter(f => unlabeled.has(f.id)).map(f => f.id))
    expect(labels.filter(l => l.answer === 'given')).toHaveLength(FIGURES_PER_CALL)
  })

  it('leaves a figure the answer leaves out unlabeled', async () => {
    const figures = keptFigures('a', 2)
    const ctx = fakeEvalContext(answering(f => (f.number === '100 people' ? 'omit' : 'given')))
    expect((await labelFigures(ctx, figures)).map(l => l.answer)).toEqual([null, 'given'])
  })
})

describe('runFigureArms', () => {
  it('runs every arm `repeat` times, run k ≥ 2 under its own cache key', async () => {
    const variants = keptFigures('a', 2).flatMap(figureVariants)
    const ctx = fakeEvalContext(answering(truthful))
    const arms = [arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'medium')]
    const runs = await runFigureArms(ctx, variants, arms, 2)
    expect(runs.map(r => [r.arm, r.runs.length, r.runs[0]?.map(a => a.item.id)])).toEqual([
      ['gpt-6-luna@low', 2, variants.map(v => v.id)],
      ['gpt-6-luna@medium', 2, variants.map(v => v.id)],
    ])
    expect(ctx.calls.map(c => c.schemaName)).toEqual([
      FIGURE_CHECK_SCHEMA_NAME,
      `${FIGURE_CHECK_SCHEMA_NAME}~run2`,
      FIGURE_CHECK_SCHEMA_NAME,
      `${FIGURE_CHECK_SCHEMA_NAME}~run2`,
    ])
  })
})

describe('plannedFigureLabelCalls and plannedFigureArmCalls', () => {
  it('plan exactly the calls the label pass and the arms make, so a cached re-run finds every one', async () => {
    const figures = keptFigures('a', FIGURES_PER_CALL + 1)
    const variants = figures.flatMap(figureVariants)
    const arms = [arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'medium')]
    const ctx = fakeEvalContext(answering(truthful))
    await labelFigures(ctx, figures)
    await runFigureArms(ctx, variants, arms, 2)
    const key = (c: { arm: Arm; schemaName: string; prompt: Prompt }) => `${c.arm.model}@${c.arm.effort}|${c.schemaName}|${JSON.stringify(c.prompt)}`
    const planned = [...plannedFigureLabelCalls(figures), ...plannedFigureArmCalls(variants, arms, 2)]
    expect(new Set(planned.map(key))).toEqual(new Set(ctx.calls.map(c => key({ ...c, prompt: c.sent }))))
    expect(planned).toHaveLength(ctx.calls.length)
    expect(plannedFigureLabelCalls(figures)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// The step's passes and the budget
// ---------------------------------------------------------------------------

/** Kept figures 100 and 101 (the judge finds both given), and one figure production removed. */
const sampled = (): FigureFixture[] =>
  figureFixtures(
    [
      story(
        'a',
        [contextFact('S1F1', { value: 100 }), contextFact('S1F2', { value: 101, counted: 'people sheltered' }), figureless('S1F3')],
        [removal('S1F3')],
      ),
    ],
    10,
  ).figures

describe('estimateFigureCheck', () => {
  const arms = [arm('gpt-6-luna', 'low')]

  it('plans the arms on the variants of the kept figures the judge found given, once the cache holds every label', async () => {
    const figures = sampled()
    const ctx = fakeEvalContext(
      answering(f => (f.number === '101 people' ? 'computed' : truthful(f))),
      { cached: () => true },
    )
    const estimate = await estimateFigureCheck(ctx, figures, arms, 1)
    expect(estimate.armsUpperBound).toBe(false)
    expect(estimate.labels).toMatchObject({ calls: 1, uncached: 0, usd: 0 })
    const given = figures.filter((f): f is KeptFigure => f.id === 'a:S1F1' && f.kept)
    expect(estimate.arms.calls).toBe(plannedFigureArmCalls(given.flatMap(figureVariants), arms, 1).length)
  })

  it("plans them on every kept figure's variants, an upper bound, while a label is uncached, and makes no call", async () => {
    const figures = sampled()
    const ctx = fakeEvalContext(answering(truthful))
    const estimate = await estimateFigureCheck(ctx, figures, arms, 3)
    expect(estimate.armsUpperBound).toBe(true)
    expect(estimate.labels.uncached).toBe(1)
    const kept = figures.filter((f): f is KeptFigure => f.kept)
    expect(estimate.arms.calls).toBe(plannedFigureArmCalls(kept.flatMap(figureVariants), arms, 3).length)
    expect(ctx.calls).toEqual([])
  })
})

describe('runFigureCheck', () => {
  const arms = [arm('gpt-6-luna', 'low')]
  const gate = { budgetUsd: 3, canCall: true }

  it('labels every figure, plants errors only in the kept figures the judge found given, and runs every arm on them', async () => {
    const figures = sampled()
    const ctx = fakeEvalContext(answering(f => (f.number === '101 people' ? 'computed' : truthful(f))))
    const run = await runFigureCheck(ctx, figures, arms, 1, gate)
    expect(run.stopped).toBeNull()
    expect(run.labels?.map(l => [l.item.id, l.answer])).toEqual([
      ['a:S1F1', 'given'],
      ['a:S1F2', 'computed'],
      ['a:S1F3', 'not-stated'],
    ])
    expect([...new Set(run.variants.map(v => v.figure.id))]).toEqual(['a:S1F1'])
    expect(run.runs.map(r => [r.arm, r.runs[0]?.map(a => a.item.id)])).toEqual([['gpt-6-luna@low', run.variants.map(v => v.id)]])
  })

  it('stops before the label pass when its estimate does not fit what is left of the budget, and makes no call', async () => {
    const ctx = fakeEvalContext(answering(truthful), { spentUsd: 3 })
    const run = await runFigureCheck(ctx, sampled(), arms, 1, gate)
    expect(run).toMatchObject({ labels: null, variants: [], runs: [], stopped: { pass: 'labels', reason: expect.stringMatching(/remaining budget/) } })
    expect(ctx.calls).toEqual([])
  })

  it('stops before any call without the API key while a label is uncached', async () => {
    const ctx = fakeEvalContext(answering(truthful))
    const run = await runFigureCheck(ctx, sampled(), arms, 1, { budgetUsd: 3, canCall: false })
    expect(run.stopped).toEqual({ pass: 'labels', reason: expect.stringMatching(/OPENAI_API_KEY/) })
    expect(ctx.calls).toEqual([])
  })

  it('checks the arms again once the labels are known, and stops before them when their calls do not fit', async () => {
    const ctx = fakeEvalContext(answering(truthful), { cached: c => c.arm === LABEL_ARM, spentUsd: 3 })
    const run = await runFigureCheck(ctx, sampled(), arms, 1, gate)
    expect(run.labels).toHaveLength(3)
    expect(run.variants.length).toBeGreaterThan(0)
    expect(run).toMatchObject({ runs: [], stopped: { pass: 'arms' } })
    expect(ctx.calls.every(c => c.arm === LABEL_ARM)).toBe(true)
  })

  it('runs a fully cached step with the budget spent and no API key', async () => {
    const ctx = fakeEvalContext(answering(truthful), { cached: () => true, spentUsd: 3 })
    const run = await runFigureCheck(ctx, sampled(), arms, 1, { budgetUsd: 3, canCall: false })
    expect(run.stopped).toBeNull()
    expect(run.runs).toHaveLength(1)
  })
})

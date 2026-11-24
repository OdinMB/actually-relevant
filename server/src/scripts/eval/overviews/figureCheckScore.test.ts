import { describe, it, expect } from 'vitest'
import type { FigureAnswer } from '../../../schemas/storyContext.js'
import { contextFact } from '../../../test/contextFixtures.js'
import { CATCH_BAR, FALSE_REJECTION_BAR, MAX_LISTED } from './factCheckScore.js'
import { figureFixtures, figureVariants, type Answered, type FigureFixture, type FigureVariant, type KeptFigure } from './figureCheck.js'
import { scoreFigureCheck } from './figureCheckScore.js'

/** Kept figures 100, 101, … of one story; each has a faithful, a wrong-number and an other-thing variant. */
const sample = (count: number): FigureFixture[] =>
  figureFixtures(
    [
      {
        slug: 'a',
        title: 'A',
        facts: [
          ...Array.from({ length: count }, (_, i) => contextFact(`S${i + 1}F1`, { value: 100 + i, counted: `people evacuated from camp ${i + 1}` })),
          contextFact('S99F1', { value: null, unit: '', counted: '' }),
        ],
        removed: [{ ref: 'S99F1', figure: '3 villages', counted: 'villages', answer: 'not-stated' }],
      },
    ],
    count + 1,
  ).figures

const keptOf = (figures: FigureFixture[]) => figures.filter((f): f is KeptFigure => f.kept)
const removedOf = (figures: FigureFixture[]) => figures.filter(f => !f.kept)

/** One run's answers: `answer(variant)` for each. */
const run = (variants: FigureVariant[], answer: (v: FigureVariant) => FigureAnswer | null): Answered<FigureVariant>[] =>
  variants.map(item => ({ item, answer: answer(item) }))

/** A correct arm: given for the figure as it is, not stated for every planted error. */
const correct = (v: FigureVariant): FigureAnswer => (v.kind === 'faithful' ? 'given' : 'not-stated')

describe('scoreFigureCheck: the arms', () => {
  const variants = keptOf(sample(2)).flatMap(figureVariants)

  it('gives each arm the share of planted errors caught and of faithful figures removed, every run pooled', () => {
    expect(variants.map(v => v.kind)).toEqual(['faithful', 'wrong-number', 'other-thing', 'faithful', 'wrong-number', 'other-thing'])
    // Run 1 misses the first figure's other thing; run 2 removes the second figure as it is
    const first = run(variants, v => (v.id === 'a:S1F1#other-thing' ? 'given' : correct(v)))
    const second = run(variants, v => (v.id === 'a:S2F1#faithful' ? 'computed' : correct(v)))
    const [s] = scoreFigureCheck(null, [{ arm: 'gpt-6-luna@low', runs: [first, second] }]).arms
    expect(s).toMatchObject({ arm: 'gpt-6-luna@low', runs: 2, caught: 7 / 8, removed: 1 / 4, unjudged: 0 })
    expect(s?.perKind.map(k => [k.kind, k.expected, k.items, k.answered, k.notGiven])).toEqual([
      ['faithful', 'given', 2, 4, 1],
      ['wrong-number', 'not given', 2, 4, 4],
      ['other-thing', 'not given', 2, 4, 3],
    ])
  })

  it('counts an unanswered variant in no share, and reports how many answers are missing', () => {
    const answers = run(variants, v => (v.kind === 'wrong-number' ? null : v.kind === 'other-thing' ? 'given' : correct(v)))
    const [s] = scoreFigureCheck(null, [{ arm: 'x', runs: [answers] }]).arms
    expect(s).toMatchObject({ caught: 0, removed: 0, unjudged: 2 })
    const none = scoreFigureCheck(null, [{ arm: 'x', runs: [run(variants, () => null)] }]).arms[0]
    expect(none).toMatchObject({ caught: null, removed: null, unjudged: 6 })
  })

  it("lists the planted errors answered given and the faithful figures removed, with each run's answer, the most often wrong first", () => {
    const first = run(variants, v => (v.kind === 'other-thing' ? 'given' : v.id === 'a:S2F1#faithful' ? 'computed' : correct(v)))
    const second = run(variants, v => (v.id === 'a:S2F1#other-thing' ? 'given' : correct(v)))
    const [s] = scoreFigureCheck(null, [{ arm: 'x', runs: [first, second] }]).arms
    expect(s?.misses.map(m => [m.variant.id, m.answers, m.times])).toEqual([
      ['a:S2F1#other-thing', ['given', 'given'], 2],
      ['a:S1F1#other-thing', ['given', 'not-stated'], 1],
    ])
    expect(s?.falseRemovals.map(m => [m.variant.id, m.answers, m.times])).toEqual([['a:S2F1#faithful', ['computed', 'given'], 1]])
    expect([s?.missCount, s?.falseRemovalCount]).toEqual([2, 1])
  })

  it(`keeps at most ${MAX_LISTED} of each list, and counts them all`, () => {
    const many = keptOf(sample(MAX_LISTED + 5)).flatMap(figureVariants)
    const [s] = scoreFigureCheck(null, [{ arm: 'x', runs: [run(many, v => (v.kind === 'faithful' ? 'other-thing' : 'given'))] }]).arms
    expect([s?.misses.length, s?.missCount]).toEqual([MAX_LISTED, 2 * (MAX_LISTED + 5)])
    expect([s?.falseRemovals.length, s?.falseRemovalCount]).toEqual([MAX_LISTED, MAX_LISTED + 5])
  })

  it("holds each arm's two shares against the fact check's bars, report only, and gives no value for an empty group", () => {
    const { arms, bars } = scoreFigureCheck(null, [
      { arm: 'a@low', runs: [run(variants, correct)] },
      { arm: 'b@low', runs: [[]] },
    ])
    expect(bars).toEqual([...arms[0]!.bars, ...arms[1]!.bars])
    expect(arms[0]!.bars.map(b => [b.value, b.target, b.direction, b.met])).toEqual([
      [1, CATCH_BAR, 'atLeast', null],
      [0, FALSE_REJECTION_BAR, 'atMost', null],
    ])
    expect(arms[0]!.bars.every(b => b.forOwner)).toBe(true)
    expect(arms[1]!.bars.map(b => b.value)).toEqual([null, null])
  })
})

describe('scoreFigureCheck: production against the labels', () => {
  const figures = sample(3)
  const [k1, k2, k3] = keptOf(figures)
  const [r1] = removedOf(figures)

  it('gives the share of kept figures the judge finds not given, and of removed ones it finds given, each with its counts', () => {
    const labels: Answered<FigureFixture>[] = [
      { item: k1!, answer: 'given' },
      { item: k2!, answer: 'computed' },
      { item: k3!, answer: null },
      { item: r1!, answer: 'given' },
    ]
    const { agreement } = scoreFigureCheck(labels, [])
    expect(agreement?.kept).toMatchObject({ labeled: 2, disagreed: 1, unlabeled: 1, share: 0.5 })
    expect(agreement?.kept.listed).toEqual([{ item: k2, answer: 'computed' }])
    expect(agreement?.removed).toMatchObject({ labeled: 1, disagreed: 1, unlabeled: 0, share: 1 })
    expect(agreement?.removed.listed).toEqual([{ item: r1, answer: 'given' }])
  })

  it('gives no share for a group with no figure labeled, and no agreement where the label pass did not run', () => {
    const { agreement } = scoreFigureCheck([{ item: k1!, answer: 'given' }], [])
    expect(agreement?.kept.share).toBe(0)
    expect(agreement?.removed).toMatchObject({ labeled: 0, disagreed: 0, share: null, listed: [] })
    expect(scoreFigureCheck(null, []).agreement).toBeNull()
  })
})

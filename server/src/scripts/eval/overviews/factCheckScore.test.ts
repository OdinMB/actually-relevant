import { describe, it, expect } from 'vitest'
import { contextFact } from '../../../test/contextFixtures.js'
import type { CheckItem, Labels, Verdict } from './factCheck.js'
import type { FactFixture } from './factFixtures.js'
import { CATCH_BAR, FALSE_REJECTION_BAR, MAX_LISTED, scoreArm, scoreFidelity } from './factCheckScore.js'
import type { VariantKind } from './plant.js'

const fact: FactFixture = {
  key: 'r:S0F1',
  runId: 'r',
  storyId: 's',
  sourceId: 'S0',
  outlet: 'Outlet',
  url: 'u',
  language: null,
  statement: 's',
  measures: '',
  sentence: 'The sentence.',
}

const item = (n: number, kind: VariantKind): CheckItem => ({ id: `${n}#${kind}`, fact, kind, text: `text ${n}`, change: `change ${n}` })

/** One run's verdicts: `supported[i]` for `items[i]`. */
const run = (items: CheckItem[], supported: (boolean | null)[]): Verdict[] => items.map((it, i) => ({ item: it, supported: supported[i] ?? null, problem: '' }))

describe('scoreArm', () => {
  const items = [item(1, 'faithful'), item(2, 'reworded'), item(3, 'wrong-number'), item(4, 'wrong-number'), item(5, 'wrong-year'), item(6, 'faithful')]

  it('rates catches on the planted kinds and false rejections on the faithful ones, unjudged items left out', () => {
    const s = scoreArm({ arm: 'gpt-6-luna@low', runs: [run(items, [true, false, false, true, null, true])] })
    expect(s.catchRate).toBe(1 / 2)
    expect(s.falseRejection).toBe(1 / 3)
    expect(s.unjudged).toBe(1)
    expect(s.perKind.find(k => k.kind === 'wrong-number')).toEqual({
      kind: 'wrong-number',
      expected: 'unsupported',
      items: 2,
      judged: 2,
      unsupported: 1,
      rate: 0.5,
    })
    expect(s.perKind.find(k => k.kind === 'wrong-year')).toMatchObject({ items: 1, judged: 0, rate: null })
    expect(s.perKind.find(k => k.kind === 'dropped-qualifier')).toMatchObject({ items: 0, rate: null })
    expect(s.spread).toBeNull()
    expect(s.flips).toBeNull()
  })

  it('holds the rates against the bars, met or not, never as a gate', () => {
    const all = scoreArm({ arm: 'a', runs: [run(items, [true, true, false, false, false, true])] })
    expect(all).toMatchObject({ catchRate: 1, falseRejection: 0, catchMet: true, falseRejectionMet: true })
    expect(CATCH_BAR).toBeGreaterThan(FALSE_REJECTION_BAR)
    const none = scoreArm({ arm: 'a', runs: [run(items, [null, null, null, null, null, null])] })
    expect(none).toMatchObject({ catchRate: null, falseRejection: null, catchMet: null, falseRejectionMet: null, unjudged: 6 })
  })

  it('lists misses and false rejections with the sentence, how often each went wrong over the runs', () => {
    const s = scoreArm({ arm: 'a', runs: [run(items, [true, false, true, false, false, true]), run(items, [true, true, true, true, false, false])] })
    expect(s.misses.map(m => [m.text, m.times, m.runs, m.sentence])).toEqual([
      ['text 3', 2, 2, 'The sentence.'],
      ['text 4', 1, 2, 'The sentence.'],
    ])
    expect(s.falseRejections.map(m => [m.text, m.times])).toEqual([
      ['text 2', 1],
      ['text 6', 1],
    ])
    expect(s).toMatchObject({ missCount: 2, falseRejectionCount: 2 })
  })

  it('caps each list', () => {
    const many = Array.from({ length: MAX_LISTED + 5 }, (_, i) => item(i, 'wrong-scale'))
    const s = scoreArm({
      arm: 'a',
      runs: [
        run(
          many,
          many.map(() => true),
        ),
      ],
    })
    expect(s.misses).toHaveLength(MAX_LISTED)
    expect(s.missCount).toBe(MAX_LISTED + 5)
  })

  it('with repeated runs, pools the rates and shows their spread and how often a verdict flips', () => {
    const s = scoreArm({ arm: 'a', runs: [run(items, [true, true, false, false, false, true]), run(items, [true, true, true, false, false, false])] })
    expect(s.catchRate).toBe(5 / 6)
    expect(s.perRun.map(r => r.catchRate)).toEqual([1, 2 / 3])
    expect(s.spread?.catchRate).toMatchObject({ n: 2, min: 2 / 3, max: 1 })
    expect(s.spread?.falseRejection).toMatchObject({ n: 2, min: 0, max: 1 / 3 })
    expect(s.flips).toEqual({ stories: 6, differing: 2, share: 2 / 6 })
  })
})

describe('scoreFidelity', () => {
  /** A sampled module-1 fact; `value` null is a fact without a figure. */
  const rendered = (n: number, value: number | null): FactFixture => ({
    ...fact,
    key: `story:S${n}F1`,
    context: { fact: contextFact(`S${n}F1`, { value }), peers: { places: [], credits: [] } },
  })
  const rejectedBy = (fx: FactFixture): Verdict => ({
    item: { id: `${fx.key}#faithful`, fact: fx, kind: 'faithful', text: fx.statement, change: '' },
    supported: false,
    problem: 'p',
  })
  const labels = (accepted: FactFixture[], unsupported: FactFixture[], unlabeled: FactFixture[] = []): Labels => ({
    accepted,
    unsupported: unsupported.map(rejectedBy),
    unlabeled,
  })

  it('splits the judged facts by whether they carry a figure, a fact with no structured record counted without one', () => {
    const f = scoreFidelity(labels([rendered(1, 100), rendered(2, 7), rendered(3, null)], [rendered(4, 100), rendered(5, null), fact]))
    expect(f.withFigure).toMatchObject({ judged: 3, accepted: 2, unlabeled: 0, share: 2 / 3 })
    expect(f.withoutFigure).toMatchObject({ judged: 3, accepted: 1, unlabeled: 0, share: 1 / 3 })
    expect(f.bars.map(b => b.value)).toEqual([2 / 3, 1 / 3])
  })

  it("keeps each group's rejected facts with the judge's reason, in the labels' order", () => {
    const f = scoreFidelity(labels([rendered(1, 100)], [rendered(4, 100), rendered(5, null), rendered(6, 100), fact]))
    expect(f.withFigure.rejected.map(v => [v.item.fact.key, v.problem])).toEqual([
      ['story:S4F1', 'p'],
      ['story:S6F1', 'p'],
    ])
    expect(f.withoutFigure.rejected.map(v => v.item.fact.key)).toEqual(['story:S5F1', 'r:S0F1'])
  })

  it("counts the facts the judge gave no verdict for in their group, in neither share's denominator", () => {
    const f = scoreFidelity(labels([rendered(1, 100)], [rendered(2, null)], [rendered(3, 100), rendered(4, 100), rendered(5, null)]))
    expect(f.withFigure).toMatchObject({ judged: 1, accepted: 1, unlabeled: 2, share: 1 })
    expect(f.withoutFigure).toMatchObject({ judged: 1, accepted: 0, unlabeled: 1, share: 0 })
  })

  it('gives a group with nothing judged no share, and its bar no value', () => {
    const f = scoreFidelity(labels([rendered(1, null)], [], [rendered(2, 100)]))
    expect(f.withFigure).toEqual({ judged: 0, accepted: 0, rejected: [], unlabeled: 1, share: null })
    expect(f.bars[0]).toMatchObject({ value: null, met: null })
  })

  it('leaves both bars to the owner whatever the shares, until the owner sets them', () => {
    const all = scoreFidelity(labels([rendered(1, 100), rendered(2, null)], []))
    const none = scoreFidelity(labels([], [rendered(1, 100), rendered(2, null)]))
    for (const f of [all, none]) {
      expect(f.bars).toHaveLength(2)
      for (const b of f.bars) {
        expect(b.met).toBeNull()
        expect(b.forOwner).toBeTruthy()
      }
    }
    expect(all.bars.map(b => b.value)).toEqual([1, 1])
    expect(none.bars.map(b => b.value)).toEqual([0, 0])
  })
})

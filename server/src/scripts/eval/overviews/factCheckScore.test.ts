import { describe, it, expect } from 'vitest'
import type { CheckItem, Verdict } from './factCheck.js'
import type { FactFixture } from './factFixtures.js'
import { CATCH_BAR, FALSE_REJECTION_BAR, MAX_LISTED, scoreArm } from './factCheckScore.js'
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

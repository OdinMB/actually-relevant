import { describe, it, expect } from 'vitest'
import { contextFact } from '../../../test/contextFixtures.js'
import type { CheckItem, Labels, Verdict } from './factCheck.js'
import type { DriftReading } from './factDrift.js'
import type { FactFixture } from './factFixtures.js'
import { CATCH_BAR, FALSE_REJECTION_BAR, MAX_LISTED, scoreArm, scoreFidelity } from './factCheckScore.js'
import type { VariantKind } from './plant.js'
import { DRIFT_KINDS, type DriftCategory, type DriftKind } from './factDriftPrompt.js'

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
    context: { fact: contextFact(`S${n}F1`, { value }), peers: { places: [], credits: [] }, title: 'Story' },
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
  /** The second pass's reading of a rejected fact: built afresh, so it meets the labels' verdict by its id only. */
  const read = (fx: FactFixture, category: DriftCategory | null, kind: DriftKind | null = null, reason = ''): DriftReading => ({
    rejection: rejectedBy(fx),
    category,
    kind,
    reason,
  })
  const keys = (readings: DriftReading[]) => readings.map(r => r.rejection.item.fact.key)

  it('splits the judged facts by whether they carry a figure, a fact with no structured record counted without one', () => {
    const f = scoreFidelity(labels([rendered(1, 100), rendered(2, 7), rendered(3, null)], [rendered(4, 100), rendered(5, null), fact]), null)
    expect(f.withFigure).toMatchObject({ judged: 3, accepted: 2, unlabeled: 0, acceptedShare: 2 / 3 })
    expect(f.withoutFigure).toMatchObject({ judged: 3, accepted: 1, unlabeled: 0, acceptedShare: 1 / 3 })
  })

  it('counts as faithful the facts the label pass accepted and those the second pass found to lack only context, each group on its own', () => {
    const [fig4, plain5] = [rendered(4, 100), rendered(5, null)]
    const l = labels([rendered(1, 100), rendered(2, 7), rendered(3, null)], [fig4, plain5, fact])
    const f = scoreFidelity(l, [read(fact, 'context'), read(plain5, 'changed', 'period'), read(fig4, 'context')])
    expect(f.withFigure).toMatchObject({ judged: 3, accepted: 2, context: 1, faithful: 3, share: 1, acceptedShare: 2 / 3 })
    expect(f.withoutFigure).toMatchObject({ judged: 3, accepted: 1, context: 1, faithful: 2, share: 2 / 3, acceptedShare: 1 / 3 })
    expect(f.bars.map(b => b.value)).toEqual([1, 2 / 3])
  })

  it("keeps each group's rejected facts with the label pass's reason, in the labels' order", () => {
    const f = scoreFidelity(labels([rendered(1, 100)], [rendered(4, 100), rendered(5, null), rendered(6, 100), fact]), null)
    expect(f.withFigure.rejected.map(v => [v.item.fact.key, v.problem])).toEqual([
      ['story:S4F1', 'p'],
      ['story:S6F1', 'p'],
    ])
    expect(f.withoutFigure.rejected.map(v => v.item.fact.key)).toEqual(['story:S5F1', 'r:S0F1'])
  })

  it("keeps the facts the second pass found changed in their group, with the kind and its reason, in the labels' order", () => {
    const [fig4, plain5, fig6, fig7] = [rendered(4, 100), rendered(5, null), rendered(6, 100), rendered(7, 3)]
    const f = scoreFidelity(labels([], [fig4, plain5, fig6, fig7]), [
      read(fig7, 'changed', 'period', 'drops since March'),
      read(fig6, 'context', null, 'names Ebola'),
      read(plain5, 'changed', 'scope', 'drops during El Niño years'),
      read(fig4, 'changed', 'figure', 'a year as a quantity'),
    ])
    expect(f.withFigure.changed.map(r => [r.rejection.item.fact.key, r.kind, r.reason])).toEqual([
      ['story:S4F1', 'figure', 'a year as a quantity'],
      ['story:S7F1', 'period', 'drops since March'],
    ])
    expect(f.withoutFigure.changed.map(r => [r.rejection.item.fact.key, r.kind, r.reason])).toEqual([['story:S5F1', 'scope', 'drops during El Niño years']])
    expect([f.withFigure.context, f.withoutFigure.context]).toEqual([1, 0])
    expect([f.withFigure.faithful, f.withoutFigure.faithful]).toEqual([1, 0])
  })

  it('lists a rejected fact the second pass left unanswered, or gave no reading for, as unjudged and never faithful', () => {
    const [fig2, fig3, plain4] = [rendered(2, 100), rendered(3, 100), rendered(4, null)]
    const l = labels([rendered(1, 100)], [fig2, fig3, plain4])
    const f = scoreFidelity(l, [read(plain4, 'context'), read(fig2, null)])
    expect(keys(f.withFigure.unjudged)).toEqual(['story:S2F1', 'story:S3F1'])
    expect(f.withFigure.unjudged[1]).toEqual({ rejection: l.unsupported[1], category: null, kind: null, reason: '' })
    expect(f.withFigure).toMatchObject({ judged: 3, context: 0, faithful: 1, share: 1 / 3 })
    expect(f.withoutFigure).toMatchObject({ judged: 1, context: 1, faithful: 1, share: 1, unjudged: [] })
    for (const g of [f.withFigure, f.withoutFigure]) expect((g.context ?? 0) + g.changed.length + g.unjudged.length).toBe(g.rejected.length)
  })

  it("counts each group's changed facts by kind, every kind in its order, context facts in none", () => {
    const [fig1, fig2, fig3, plain4, plain5] = [rendered(1, 100), rendered(2, 100), rendered(3, 100), rendered(4, null), rendered(5, null)]
    const f = scoreFidelity(labels([], [fig1, fig2, fig3, plain4, plain5]), [
      read(fig1, 'changed', 'figure'),
      read(fig2, 'changed', 'figure'),
      read(fig3, 'context'),
      read(plain4, 'changed', 'figure'),
      read(plain5, 'changed', 'period'),
    ])
    expect(f.changedByKind).toEqual(
      DRIFT_KINDS.map(kind => ({ kind, withFigure: kind === 'figure' ? 2 : 0, withoutFigure: kind === 'figure' || kind === 'period' ? 1 : 0 })),
    )
  })

  it("without the second pass, knows no faithful share but still gives the label pass's own, and the bars no value", () => {
    const f = scoreFidelity(labels([rendered(1, 100)], [rendered(2, 100), rendered(3, null)]), null)
    for (const g of [f.withFigure, f.withoutFigure]) expect(g).toMatchObject({ context: null, faithful: null, share: null, changed: [], unjudged: [] })
    expect([f.withFigure.acceptedShare, f.withoutFigure.acceptedShare]).toEqual([1 / 2, 0])
    expect(f.bars.map(b => [b.value, b.met])).toEqual([
      [null, null],
      [null, null],
    ])
    expect(f.changedByKind).toEqual([])
  })

  it("counts the facts the label pass gave no verdict for in their group, in neither share's denominator", () => {
    const plain2 = rendered(2, null)
    const f = scoreFidelity(labels([rendered(1, 100)], [plain2], [rendered(3, 100), rendered(4, 100), rendered(5, null)]), [read(plain2, 'context')])
    expect(f.withFigure).toMatchObject({ judged: 1, accepted: 1, unlabeled: 2, acceptedShare: 1, share: 1 })
    expect(f.withoutFigure).toMatchObject({ judged: 1, accepted: 0, unlabeled: 1, acceptedShare: 0, share: 1 })
  })

  it('gives a group with nothing judged no share, and its bar no value', () => {
    const f = scoreFidelity(labels([rendered(1, null)], [], [rendered(2, 100)]), [])
    expect(f.withFigure).toEqual({
      judged: 0,
      accepted: 0,
      rejected: [],
      unlabeled: 1,
      acceptedShare: null,
      context: 0,
      changed: [],
      unjudged: [],
      faithful: 0,
      share: null,
    })
    expect(f.bars[0]).toMatchObject({ value: null, met: null })
  })

  it('leaves both bars to the owner whatever the shares, until the owner sets them', () => {
    const [fig, plain] = [rendered(1, 100), rendered(2, null)]
    const all = scoreFidelity(labels([fig, plain], []), [])
    const context = scoreFidelity(labels([], [fig, plain]), [read(fig, 'context'), read(plain, 'context')])
    const none = scoreFidelity(labels([], [fig, plain]), [read(fig, 'changed', 'figure'), read(plain, 'changed', 'scope')])
    for (const f of [all, context, none]) {
      expect(f.bars).toHaveLength(2)
      for (const b of f.bars) {
        expect(b.met).toBeNull()
        expect(b.forOwner).toBeTruthy()
      }
    }
    expect(all.bars.map(b => b.value)).toEqual([1, 1])
    expect(context.bars.map(b => b.value)).toEqual([1, 1])
    expect(none.bars.map(b => b.value)).toEqual([0, 0])
  })
})

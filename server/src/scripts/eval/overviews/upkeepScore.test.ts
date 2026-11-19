import { describe, expect, it } from 'vitest'
import type { AnswerKey } from './keySchema.js'
import { checkpointsOf, scoreClosures, scoreReplay, type CheckpointState, type ReplayRunResult } from './replayScore.js'
import { scoreReviewRun, scoreReviews, type ReviewCaseRun } from './reviewScore.js'
import { latestValues, numbersIn, scoreStands, statesValue, type StandsCheckpointRun } from './standsScore.js'
import { passPoolLines, replayLines, reviewLines, standsLines } from './upkeepReport.js'

type Entry = AnswerKey['entries'][number]
type Value = Entry['values'][number]

const value = (figure: string, v: number, asOf: string, matches = true): Value => ({
  figure,
  value: v,
  approx: 'exact',
  asOf,
  matches,
  countedAs: null,
  quote: String(v),
})

const entry = (slug: string, date: string, over: Partial<Entry> = {}): Entry => ({
  slug,
  date,
  title: slug,
  join: 'must',
  role: 'routine',
  kind: null,
  values: [],
  statuses: [],
  why: 'belongs',
  ...over,
})

const key = (id: string, entries: Entry[], over: Partial<AnswerKey> = {}): AnswerKey => ({
  schemaVersion: 2,
  id,
  title: id,
  charter: { in: 'In.', out: [], endEvent: 'End.' },
  closed: null,
  figures: [],
  entries,
  nearMisses: [],
  responses: [],
  notes: '',
  ...over,
})

describe('checkpointsOf', () => {
  it('looks at a development at a third, two thirds and the last of its must entries, each day once', () => {
    const k = key('ebola', [
      entry('e1', '2026-05-01'),
      entry('e2', '2026-05-03'),
      entry('o1', '2026-05-04', { join: 'optional' }),
      entry('e3', '2026-05-05'),
      entry('e4', '2026-05-09'),
      entry('e5', '2026-05-10'),
      entry('e6', '2026-05-12'),
    ])
    expect(checkpointsOf(k)).toEqual([
      { at: 'third', day: '2026-05-03' },
      { at: 'two-thirds', day: '2026-05-09' },
      { at: 'end', day: '2026-05-12' },
    ])
    expect(checkpointsOf(key('pair', [entry('a', '2026-05-01'), entry('b', '2026-05-02')]))).toEqual([
      { at: 'third', day: '2026-05-01' },
      { at: 'two-thirds', day: '2026-05-02' },
    ])
    expect(checkpointsOf(key('none', [entry('a', '2026-05-01', { join: 'optional' })]))).toEqual([])
  })
})

const replayRun = (closures: ReplayRunResult['closures'], over: Partial<ReplayRunResult> = {}): ReplayRunResult => ({
  run: 1,
  overviews: [],
  roles: new Map(),
  checkpoints: [],
  closures,
  safeguards: {},
  costUsd: 0,
  founded: 0,
  ...over,
})

describe('the closure bars', () => {
  const KEYS = [
    key('ended', [entry('a', '2026-05-01')], { closed: { slug: 'a', date: '2026-05-10' } }),
    key('unreported', [entry('b', '2026-05-01')], { closed: { slug: null, date: '2026-05-10' } }),
    key('open', [entry('c', '2026-05-01')]),
  ]

  it('counts a closure at an end event before the end, or of a development still open, as premature', () => {
    const s = scoreClosures(
      KEYS,
      replayRun([
        { overviewId: 'o1', development: 'ended', reason: 'end_event', day: '2026-05-08' },
        { overviewId: 'o2', development: 'open', reason: 'end_event', day: '2026-05-12' },
        { overviewId: 'o3', development: 'open', reason: 'faded', day: '2026-09-12' },
        { overviewId: 'o4', development: null, reason: 'end_event', day: '2026-05-12' },
      ]),
    )
    expect(s.premature).toEqual(['ended closed on 2026-05-08, before its end on 2026-05-10', 'open closed on 2026-05-12, still open in the key'])
    // Only a development whose end our stories report can be closed in time
    expect(s).toMatchObject({ closable: 1, closedInTime: 0 })
  })

  it(`counts a development closed at its end event within 14 days of the end as in time, not one closed later or faded`, () => {
    const at = (day: string, reason: 'end_event' | 'faded' = 'end_event') =>
      scoreClosures(KEYS, replayRun([{ overviewId: 'o1', development: 'ended', reason, day }]))
    expect(at('2026-05-24').closedInTime).toBe(1)
    expect(at('2026-05-25').closedInTime).toBe(0)
    expect(at('2026-05-12', 'faded').closedInTime).toBe(0)
  })

  it('scores the replay: the closure bars, the evidence share, safeguards and cost as means over runs', () => {
    const point = (offerable: number): CheckpointState => ({
      key: 'ended',
      at: 'end',
      day: '2026-05-01',
      overview: null,
      mustByThen: 1,
      mustFound: 0,
      wrongMembers: 0,
      offerable,
      stands: null,
    })
    const s = scoreReplay(
      KEYS,
      [
        replayRun([{ overviewId: 'o1', development: 'ended', reason: 'end_event', day: '2026-05-11' }], {
          checkpoints: [point(5), point(1)],
          safeguards: { 'burst froze an overview': 2 },
          costUsd: 1,
          founded: 2,
        }),
        replayRun([], { run: 2, checkpoints: [point(3), point(3)], costUsd: 3, founded: 2 }),
      ],
      3,
      4,
    )
    // One closable development a run: two judgments are too few to decide, so the owner reads them
    expect(s.closure.map(b => [b.name, b.value, b.met])).toEqual([
      ['premature closures', 0, true],
      ['closed within 14 days of the end', 0.5, null],
    ])
    expect(s.closure[1]!.forOwner).toMatch(/2 judgments/)
    expect(s.closure[0]!.forOwner).toBeUndefined()
    expect(s.evidenceShare).toBe(0.75)
    expect(s.safeguards).toEqual({ 'burst froze an overview': 1 })
    expect(s.costPerStoryUsd).toBe(0.5)
    expect(s.costPerOverviewUsd).toBe(1)
  })
})

describe('the stands bars', () => {
  it("takes each figure's latest matching value as of the day, from entries published by then", () => {
    const k = key('ebola', [
      entry('e1', '2026-05-01', { values: [value('cases', 100, '2026-05-01'), value('deaths', 10, '2026-05-01')] }),
      entry('e2', '2026-05-05', { values: [value('cases', 140, '2026-05-04'), value('cases', 30, '2026-05-05', false)] }),
      entry('e3', '2026-05-09', { values: [value('cases', 200, '2026-05-09')] }),
    ])
    expect(latestValues(k, '2026-05-06')).toEqual([
      { figure: 'cases', value: 140 },
      { figure: 'deaths', value: 10 },
    ])
  })

  it('finds a value stated exactly, or within 5% under a scale word, and never a part of a longer number', () => {
    expect(numbersIn('2.9 million people and 1,200 cases in 2026')).toEqual([
      { value: 2_900_000, scaled: true },
      { value: 1200, scaled: false },
      { value: 2026, scaled: false },
    ])
    expect(statesValue('about 2.9 million displaced', 2_880_000)).toBe(true)
    expect(statesValue('1,250 cases', 1200)).toBe(false)
    expect(statesValue('12000 cases', 1200)).toBe(false)
    expect(statesValue('1,200 cases', 1200)).toBe(true)
  })

  const point = (key: string, run: number, over: Partial<StandsCheckpointRun> = {}): StandsCheckpointRun => ({
    key,
    at: 'end',
    day: '2026-05-01',
    run,
    offered: 5,
    enough: true,
    outcome: 'written',
    lines: [],
    latest: [],
    responseDue: false,
    doingPresent: false,
    costUsd: 0,
    ...over,
  })

  it('scores only checkpoints with enough evidence, and meets no bar below the checkpoints it needs', () => {
    const runs = [
      point('a', 1, {
        lines: [
          { part: 'sentence', text: 'x', supported: true },
          { part: 'sentence', text: 'y', supported: false },
        ],
        latest: [
          { figure: 'cases', value: 1, stated: true },
          { figure: 'deaths', value: 2, stated: false },
        ],
        responseDue: true,
        doingPresent: true,
      }),
      point('b', 1, { offered: 1, enough: false, outcome: null, lines: [{ part: 'sentence', text: 'z', supported: false }] }),
    ]
    const short = scoreStands(runs, 2)
    expect(short).toMatchObject({ checkpoints: 2, enough: 1 })
    expect(short.note).toMatch(/not enough evidence: 1 of the 2 checkpoints/)
    expect(short.bars.every(b => b.met === null)).toBe(true)
    const full = scoreStands(runs, 1)
    expect(full.note).toBeNull()
    // The counts decide on any sample; the two rates rest on 2 and 1 judgments, too few, so the owner reads them
    expect(full.bars.map(b => [b.name, b.value, b.met])).toEqual([
      ['unsupported sentences', 1, false],
      ['latest value stated', 0.5, null],
      ["what's being done present", 1, null],
      ["what's being done unsupported", 0, true],
    ])
    expect(full.bars.map(b => b.forOwner ?? null)).toEqual([null, expect.stringMatching(/2 judgments/), expect.stringMatching(/1 judgment/), null])
  })

  it('decides a rate on its own once it rests on enough judgments across the runs', () => {
    const latest = (stated: number) => Array.from({ length: 5 }, (_, i) => ({ figure: `f${i}`, value: i, stated: i < stated }))
    // 2 checkpoints × 2 runs × 5 values: 20 judgments, 19 stated
    const runs = [1, 2].flatMap(run => [
      point('a', run, { day: '2026-05-01', latest: latest(5) }),
      point('a', run, { day: '2026-05-09', latest: latest(run === 1 ? 4 : 5) }),
    ])
    const bar = scoreStands(runs, 1).bars.find(b => b.name === 'latest value stated')!
    expect(bar).toMatchObject({ value: 0.95, met: true })
    expect(bar.forOwner).toBeUndefined()
  })
})

describe('the review bars', () => {
  const routine = { role: 'routine' as const, roleKind: null }
  const turning = { role: 'turning_point' as const, roleKind: 'milestone' as const }
  const reviewCase = (actions: ReviewCaseRun['actions'], over: Partial<ReviewCaseRun> = {}): ReviewCaseRun => ({
    key: 'ebola',
    run: 1,
    plantedJoins: ['planted:n1', 'planted:n2'],
    plantedRole: { entryId: 'key:e2', keyRole: turning },
    correct: [
      { entryId: 'key:e1', keyRole: routine },
      { entryId: 'key:e3', keyRole: routine },
    ],
    outcome: 'reviewed',
    actions,
    costUsd: 0,
    ...over,
  })

  it('counts wrong joins detached, a flipped role set back and the charter narrowed as caught, and correct entries detached or relabeled as demoted', () => {
    const s = scoreReviewRun([
      reviewCase([
        { kind: 'detach', entryId: 'planted:n1', storyId: 'n1', reason: 'no' },
        { kind: 'relabel', entryId: 'key:e2', storyId: 'e2', from: routine, to: turning },
        { kind: 'narrow', added: ['Uganda'], charter: { in: 'In.', out: ['Uganda'], endEvent: 'End.' } },
        { kind: 'detach', entryId: 'key:e3', storyId: 'e3', reason: 'no' },
      ]),
      // A failed review is not scored
      reviewCase([], { outcome: 'failed' }),
    ])
    expect(s).toEqual({ planted: 4, caught: 3, correct: 2, demoted: 1 })
  })

  it('scores the bars as means over runs', () => {
    const s = scoreReviews([reviewCase([]), reviewCase([{ kind: 'detach', entryId: 'planted:n1', storyId: 'n1', reason: 'no' }], { run: 2 })])
    expect(s.runs.map(r => [r.run, r.caught, r.planted])).toEqual([
      [1, 0, 4],
      [2, 1, 4],
    ])
    expect(s.bars.map(b => [b.name, b.value, b.met])).toEqual([
      ['planted errors caught', 0.125, false],
      ['correct items demoted', 0, true],
    ])
  })
})

describe('the upkeep report sections', () => {
  it('renders the stands, review and replay sections with their bars and the reason a gate stays closed', () => {
    const stands = standsLines({
      half: 'judge',
      repeat: 1,
      keys: ['ebola'],
      runs: [
        {
          key: 'ebola',
          at: 'end',
          day: '2026-05-01',
          run: 1,
          offered: 2,
          enough: false,
          outcome: null,
          lines: [],
          latest: [],
          responseDue: false,
          doingPresent: false,
          costUsd: 0,
        },
      ],
      kept: [],
      score: scoreStands([], 15),
      costUsd: 0,
      stopped: 'the budget ran out in run 1',
    }).join('\n')
    expect(stands).toContain('1 developments (half judge)')
    expect(stands).toContain('the gate stays closed for the stands')
    expect(stands).toContain('Stopped: the budget ran out in run 1')
    expect(stands).toContain('| ebola | 2026-05-01 | 1 | 2 (too few) | not written |')
    const read: StandsCheckpointRun = {
      key: 'ebola',
      at: 'end',
      day: '2026-05-09',
      run: 1,
      offered: 6,
      enough: true,
      outcome: 'written',
      lines: [{ part: 'sentence', text: 'Cases passed 300.', supported: false }],
      latest: [
        { figure: 'cases', value: 320, stated: false },
        { figure: 'deaths', value: 12, stated: true },
      ],
      responseDue: false,
      doingPresent: false,
      costUsd: 0,
    }
    const forOwner = standsLines({ half: 'judge', repeat: 1, keys: ['ebola'], runs: [read], kept: [], score: scoreStands([read], 1), costUsd: 0 }).join('\n')
    expect(forOwner).toContain('| latest value stated | at least 90% | 50.0% | for the owner: 2 judgments')
    expect(forOwner).toContain('- ebola 2026-05-09 run 1: cases 320 not stated')
    expect(forOwner).toContain('- ebola 2026-05-09 run 1: unsupported: Cases passed 300.')
    // A story's cost is over the stories run, never the ones the budget left
    const pool = passPoolLines({
      mustEntries: 121,
      stories: 38,
      withFacts: 30,
      facts: 400,
      skipped: Array.from({ length: 8 }, (_, i) => ({ storyId: `s${i}`, reason: 'budget' })),
      left: [],
      costUsd: 4.5,
    }).join('\n')
    expect(pool).toContain("on 38 of the half's 121 must entries")
    expect(pool).toContain('Spend this run $4.50, $0.1500 a story')
    const review = reviewLines({ half: 'all', repeat: 1, keys: ['ebola'], cases: [], score: scoreReviews([]), costUsd: 0 }).join('\n')
    expect(review).toContain('| planted errors caught | at least 80% | n/a | no data |')
    const replay = replayLines({ half: 'all', repeat: 1, keys: ['ebola'], stories: 0, runs: [], score: scoreReplay([], [], 3, 0), costUsd: 0, left: [] }, [
      'closure',
    ]).join('\n')
    expect(replay).toContain('| premature closures | at most 0 |')
    expect(replay).not.toContain('### Checkpoints')
  })
})

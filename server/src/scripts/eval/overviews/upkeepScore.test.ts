import { describe, expect, it } from 'vitest'
import type { AnswerKey } from './keySchema.js'
import { linkKeys } from './linkScore.js'
import { checkpointsOf, developmentBefore, scoreReplay, splitsOf, type CheckpointState, type ReplayRunResult } from './replayScore.js'
import { scoreReviewRun, scoreReviews, type ReviewCaseRun } from './reviewScore.js'
import { checkCopying } from '../../../services/researchCopying.js'
import { doingAbsence, doingAbsences, dropAbsence, latestValues, numbersIn, scoreStands, statesValue, type StandsCheckpointRun } from './standsScore.js'
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
  figures: [],
  entries,
  nearMisses: [],
  responses: [],
  centers: [],
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

const replayRun = (over: Partial<ReplayRunResult> = {}): ReplayRunResult => ({
  run: 1,
  overviews: [],
  roles: new Map(),
  checkpoints: [],
  recenters: [],
  splits: [],
  safeguards: {},
  costUsd: 0,
  founded: 0,
  ...over,
})

describe('the replay score', () => {
  it('scores the replay: the evidence share, safeguards and cost as means over runs', () => {
    const point = (offerable: number): CheckpointState => ({
      key: 'ended',
      at: 'end',
      day: '2026-05-01',
      overview: null,
      mustByThen: 1,
      mustFound: 0,
      wrongMembers: [],
      offerable,
      stands: null,
    })
    const s = scoreReplay(
      [key('ended', [entry('a', '2026-05-01')])],
      [
        replayRun({
          checkpoints: [point(5), point(1)],
          safeguards: { 'burst froze an overview': 2 },
          costUsd: 1,
          founded: 2,
        }),
        replayRun({ run: 2, checkpoints: [point(3), point(3)], costUsd: 3, founded: 2 }),
      ],
      3,
      4,
    )
    expect(s.evidenceShare).toBe(0.75)
    expect(s.safeguards).toEqual({ 'burst froze an overview': 1 })
    expect(s.costPerStoryUsd).toBe(0.5)
    expect(s.costPerOverviewUsd).toBe(1)
  })
})

describe("the replay's re-centers", () => {
  const center = (entries: Entry[]): AnswerKey['centers'][number] => ({
    from: '2026-05-05',
    title: 'Wider',
    charter: { in: 'Wider.', out: [], endEvent: null },
    why: 'It spread',
    entries,
    nearMisses: [],
    responses: [],
    reviewed: true,
  })
  const KEYS = [
    key('moved', [entry('a', '2026-05-01')], { centers: [center([entry('w1', '2026-05-06'), entry('w2', '2026-05-07')])] }),
    key('kept', [entry('b', '2026-05-01')]),
  ]
  const recenter = (overviewId: string, development: string | null, day: string, nearMissesJoined: string[] = []) => ({
    overviewId,
    day,
    development,
    title: 'T',
    joined: ['w1', ...nearMissesJoined],
    nearMissesJoined,
  })

  it("counts a re-center of a development whose key has no center as false, near misses joined, the most on one overview, and each one's day against its center's from", () => {
    const s = scoreReplay(
      KEYS,
      [
        replayRun({ recenters: [recenter('o1', 'moved', '2026-05-08'), recenter('o1', 'moved', '2026-05-20')], splits: ['o3'] }),
        replayRun({ run: 2, recenters: [recenter('o2', 'kept', '2026-05-09', ['n1'])] }),
      ],
      3,
      4,
    ).recentering
    expect(s.bars.map(b => [b.name, b.value, b.met])).toEqual([
      // Shares pooled over the runs: 1 of 3 re-centers false, 1 near miss of the 4 stories they took in; at most 10% each
      ['false re-centers', 1 / 3, false],
      ['near misses joined by a re-center', 0.25, false],
    ])
    expect(s.bars.every(b => b.share && b.target === 0.1)).toBe(true)
    // A replay that re-centered nothing made no mistake
    expect(scoreReplay(KEYS, [replayRun({ recenters: [] })], 3, 4).recentering.bars.map(b => [b.value, b.met])).toEqual([
      [0, true],
      [0, true],
    ])
    expect(s).toMatchObject({ applied: 1.5, splits: 0.5, mostPerOverview: 2 })
    expect(s.timing).toEqual([
      { run: 1, key: 'moved', day: '2026-05-08', from: '2026-05-05' },
      { run: 1, key: 'moved', day: '2026-05-20', from: '2026-05-05' },
    ])
  })

  it("leaves a re-center of a development the half's keys do not score out of both bars and their applied count, counting it apart, and still holds every overview to the limit", () => {
    const s = scoreReplay(
      KEYS,
      [
        replayRun({ recenters: [recenter('o1', 'moved', '2026-05-08'), recenter('o9', 'iran-war-2026', '2026-05-09', ['n1'])] }),
        replayRun({ run: 2, recenters: [recenter('o9', 'iran-war-2026', '2026-05-09'), recenter('o9', 'iran-war-2026', '2026-05-20')] }),
      ],
      3,
      4,
    ).recentering
    // Only moved's re-center is scored: of a key with a center, and none of the stories it took in a near miss
    expect(s.bars.map(b => [b.name, b.value])).toEqual([
      ['false re-centers', 0],
      ['near misses joined by a re-center', 0],
    ])
    expect(s).toMatchObject({ applied: 0.5, unscored: 1.5, mostPerOverview: 2 })
    // An overview standing for no development is still scored: a false re-center
    const none = scoreReplay(KEYS, [replayRun({ recenters: [recenter('o2', null, '2026-05-09')] })], 3, 4).recentering
    expect(none).toMatchObject({ applied: 1, unscored: 0 })
    expect(none.bars[0]!.value).toBe(1)
  })

  it("reads a re-center's development from the members it had before the stories it took in, so one that swallows a neighbour's stories is still its own", () => {
    const war = key('war', [entry('i1', '2026-05-02'), entry('i2', '2026-05-03'), entry('i3', '2026-05-04')])
    const { standsFor } = linkKeys([KEYS[1]!], [war])
    // The kept development's overview, one must entry, took in three of the war's: by its members now it would stand for the war
    const members = ['b', 'i1', 'i2', 'i3']
    expect(standsFor(members)).toBe('war')
    const development = developmentBefore(members, ['i1', 'i2', 'i3'], standsFor)
    expect(development).toBe('kept')
    // So the bars score it, as a false re-center, where the war's own would be unscored
    const s = scoreReplay([KEYS[1]!], [replayRun({ recenters: [recenter('o1', development, '2026-05-05')] })], 3, 4, [war]).recentering
    expect(s).toMatchObject({ applied: 1, unscored: 0 })
    expect(s.bars[0]!.value).toBe(1)
    // An overview made only of the stories taken in stood for nothing before
    expect(developmentBefore(['i1', 'i2'], ['i1', 'i2'], standsFor)).toBeNull()
  })

  it('takes a founding by two center entries of one key for a split, and one with a base entry for none', () => {
    expect(
      splitsOf(KEYS, [
        { id: 'o1', foundedFrom: ['w1', 'w2'] },
        { id: 'o2', foundedFrom: ['a', 'w1'] },
        { id: 'o3', foundedFrom: ['b', 'w2'] },
      ]),
    ).toEqual(['o1'])
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
    // The unsupported shares (at most 5%) decide on any sample; the two rates rest on 2 and 1 judgments, too few, so the owner reads them
    expect(full.bars.map(b => [b.name, b.value, b.met])).toEqual([
      ['unsupported sentences', 0.5, false],
      ['latest value stated', 0.5, null],
      ["what's being done present", 1, null],
      ["what's being done unsupported", 0, true],
    ])
    expect(full.bars.map(b => b.forOwner ?? null)).toEqual([null, expect.stringMatching(/^report only/), expect.stringMatching(/1 judgment/), null])
  })

  it("tells apart the copying drops as checkCopying words them: against a fact's statement, the source's wording, a quoted span", () => {
    const words = 'the health ministry began vaccinating front line workers in Bunia on September 18 this year'
    const source = { id: 'S1', title: '', facts: [{ id: 'S1F1', statement: words, supportingSentence: `Officials said ${words}` }], voices: [] }
    const item = (label: string, text: string) => ({ part: 'story' as const, label, text, cited: true, factIds: ['S1F1'] })
    const problems = checkCopying([item('Doing 1', words), item('Doing 2', 'Aid "reached the camps by boat on Monday"')], [source], 12).problems
    expect(problems.map(p => dropAbsence({ cause: 'copying', problem: p.problem }))).toEqual([
      'copying: code, source wording',
      'copying: code, fact statement',
      'copying: code, quoted span',
    ])
    expect(dropAbsence({ cause: 'copying', problem: 'renders S1F1 ("…") closely' })).toBe('copying: judge')
    expect(dropAbsence({ cause: 'check' })).toBe('fact check')
    expect(dropAbsence({ cause: 'expired' })).toBe('not current')
  })

  it("says why What's being done is missing where a response is due, and only there", () => {
    const due = (over: Partial<StandsCheckpointRun>) => point('a', 1, { responseDue: true, ...over })
    expect(doingAbsence(due({ doingPresent: true, doingWritten: 1 }))).toBeNull()
    expect(doingAbsence(point('a', 1, { doingWritten: 0 }))).toBeNull()
    expect(doingAbsence(due({ doingWritten: 0 }))).toEqual(['no line written'])
    expect(doingAbsence(due({ outcome: 'failed' }))).toEqual(['a call failed'])
    const copied = { label: 'Doing 1', cause: 'copying', problem: 'repeats 13 words in a row from the fact statements of S2: "…"', text: 'x' }
    expect(doingAbsence(due({ doingWritten: 1, dropped: [copied, { label: 'Sentence 1', cause: 'check', text: 'y' }] }))).toEqual([
      'copying: code, fact statement',
    ])
    // A kept line of what is being done goes with a summary whose every sentence was dropped
    expect(doingAbsence(due({ outcome: 'none_kept', doingWritten: 2, dropped: [copied] }))).toEqual(['copying: code, fact statement', 'every sentence dropped'])
    const tally = doingAbsences([
      due({ doingWritten: 0 }),
      due({ doingWritten: 1, dropped: [copied] }),
      due({ doingPresent: true, doingWritten: 1 }),
      point('b', 1),
    ])
    expect(tally).toEqual({
      due: 3,
      missing: 2,
      byCause: [
        ['no line written', 1],
        ['copying: code, fact statement', 1],
      ],
    })
    const missing = due({ doingWritten: 1, dropped: [copied] })
    const text = standsLines({ half: 'judge', repeat: 1, keys: ['a'], runs: [missing], kept: [], score: scoreStands([missing], 1), costUsd: 0 }).join('\n')
    expect(text).toContain('1 of the 1 checkpoints with a response due show none (over all runs). copying: code, fact statement: 1.')
    expect(text).toContain('- a 2026-05-01 run 1: copying: code, fact statement')
  })

  it('reports the latest values and never decides on them, however many judgments it rests on', () => {
    const latest = (stated: number) => Array.from({ length: 5 }, (_, i) => ({ figure: `f${i}`, value: i, stated: i < stated }))
    // 2 checkpoints × 2 runs × 5 values: 20 judgments, 19 stated
    const runs = [1, 2].flatMap(run => [
      point('a', run, { day: '2026-05-01', latest: latest(5) }),
      point('a', run, { day: '2026-05-09', latest: latest(run === 1 ? 4 : 5) }),
    ])
    const bar = scoreStands(runs, 1).bars.find(b => b.name === 'latest value stated')!
    expect(bar).toMatchObject({ value: 0.95, met: null })
    expect(bar.forOwner).toMatch(/^report only/)
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

  it('counts wrong joins detached, a flipped role set back and the charter narrowed as caught, and correct entries taken out apart from those relabeled', () => {
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
    expect(s).toEqual({ planted: 4, caught: 3, correct: 2, removed: 1, relabeled: 0 })
  })

  it('never counts a relabel of an entry that accepts either role', () => {
    const relabel = { kind: 'relabel' as const, entryId: 'key:e1', storyId: 'e1', from: routine, to: turning }
    expect(scoreReviewRun([reviewCase([relabel])])).toMatchObject({ correct: 2, removed: 0, relabeled: 1 })
    const either = reviewCase([relabel], { correct: [{ entryId: 'key:e1', keyRole: routine, eitherRole: true }] })
    expect(scoreReviewRun([either])).toMatchObject({ correct: 1, removed: 0, relabeled: 0 })
  })

  it('holds removals to 3% and the roles kept to the role bar, so relabels alone do not fail the review', () => {
    const relabel = { kind: 'relabel' as const, entryId: 'key:e1', storyId: 'e1', from: routine, to: turning }
    const bars = (actions: ReviewCaseRun['actions']) => Object.fromEntries(scoreReviews([reviewCase(actions)]).bars.map(b => [b.name, [b.value, b.met]]))
    // One of two correct entries relabeled: half the roles kept, below 65%
    expect(bars([relabel])).toMatchObject({ 'correct items taken out': [0, true], 'correct roles kept': [0.5, false] })
    expect(bars([])).toMatchObject({ 'correct items taken out': [0, true], 'correct roles kept': [1, true] })
    expect(bars([{ kind: 'detach', entryId: 'key:e1', storyId: 'e1', reason: 'no' }])).toMatchObject({
      'correct items taken out': [0.5, false],
      'correct roles kept': [1, true],
    })
  })

  it('scores the bars as means over runs', () => {
    const s = scoreReviews([reviewCase([]), reviewCase([{ kind: 'detach', entryId: 'planted:n1', storyId: 'n1', reason: 'no' }], { run: 2 })])
    expect(s.runs.map(r => [r.run, r.caught, r.planted])).toEqual([
      [1, 0, 4],
      [2, 1, 4],
    ])
    expect(s.bars.map(b => [b.name, b.value, b.met])).toEqual([
      ['planted errors caught', 0.125, false],
      ['correct items taken out', 0, true],
      ['correct roles kept', 1, true],
    ])
  })

  it('names each correct entry taken out or relabeled and each plant left standing, and the report lists them', () => {
    const s = scoreReviews([
      reviewCase([
        { kind: 'detach', entryId: 'planted:n1', storyId: 'n1', reason: 'no' },
        { kind: 'detach', entryId: 'key:e3', storyId: 'e3', reason: 'Another outbreak.' },
        { kind: 'relabel', entryId: 'key:e1', storyId: 'e1', from: routine, to: turning },
      ]),
      reviewCase([], { outcome: 'failed', run: 2 }),
    ])
    expect(s.demotions).toEqual([
      { key: 'ebola', run: 1, entryId: 'key:e1', how: 'relabeled', keyRole: routine, to: turning },
      { key: 'ebola', run: 1, entryId: 'key:e3', how: 'removed', keyRole: routine, reason: 'Another outbreak.' },
    ])
    expect(s.misses).toEqual([
      { key: 'ebola', run: 1, what: 'wrong join kept', entryId: 'planted:n2' },
      { key: 'ebola', run: 1, what: 'flipped role kept', entryId: 'key:e2' },
      { key: 'ebola', run: 1, what: 'charter not narrowed' },
    ])
    const report = reviewLines({ half: 'judge', repeat: 1, keys: ['ebola'], cases: [], score: s, costUsd: 0 }).join('\n')
    expect(report).toContain('**Correct items changed:** 1 taken out, 1 relabeled.')
    expect(report).toContain('- ebola run 1: e1: relabeled, the key says routine, the review turning point (milestone)')
    expect(report).toContain('- ebola run 1: e3: taken out: Another outbreak.')
    expect(report).toContain('- ebola run 1: wrong join kept: n2')
    expect(report).toContain('- ebola run 1: charter not narrowed')
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
    expect(forOwner).toContain('| latest value stated | at least 90% | 50.0% | for the owner: report only')
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
    expect(review).toContain('| planted errors caught | at least 90% | n/a | no data |')
    const replay = replayLines({
      half: 'all',
      repeat: 1,
      keys: ['ebola'],
      stories: 0,
      background: { keys: [], stories: 0 },
      runs: [],
      score: scoreReplay([], [], 3, 0),
      diagnostics: [],
      costUsd: 0,
      left: [],
    }).join('\n')
    expect(replay).toContain('| wrong foundings (share) | at most 10% |')
  })
})

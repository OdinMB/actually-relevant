import { describe, expect, it } from 'vitest'
import { parseOverviewOptions } from '../options.js'
import type { AnswerKey } from './keySchema.js'
import { linkLines } from './linkReport.js'
import { keyIndex, scoreLinking, scoreLinkRun, scoreSignals, type EndEventVerdict, type ReplayRun } from './linkScore.js'
import { createSandbox, owedOf } from './overviewSandbox.js'
import type { LinkResult } from '../../../services/overviewLink.js'
import { owedStanding } from '../../../services/overviewOwed.js'

const key = (id: string, entries: [string, 'must' | 'optional', 'turning_point' | 'routine'][], nearMisses: string[] = []): AnswerKey => ({
  schemaVersion: 1,
  id,
  title: id,
  charter: { in: 'In.', out: [], endEvent: 'End.' },
  closed: null,
  figures: [],
  entries: entries.map(
    ([slug, join, role]) => ({ slug, date: '2026-05-01', title: slug, join, role, kind: null, values: [], status: null }) as AnswerKey['entries'][number],
  ),
  nearMisses: nearMisses.map(slug => ({ slug, date: '2026-05-01', title: slug, why: 'looks alike' })),
  responses: [],
  centers: [],
  notes: '',
})

/** A key with one reviewed center holding these entries and near misses. */
const centered = (k: AnswerKey, entries: string[], nearMisses: string[] = []): AnswerKey => ({
  ...k,
  centers: [
    {
      from: '2026-05-02',
      title: `${k.title}, wider`,
      charter: { in: 'Wider.', out: [], endEvent: null },
      why: 'It spread',
      entries: entries.map(slug => ({ ...k.entries[0]!, slug, join: 'must' })),
      nearMisses: nearMisses.map(slug => ({ slug, date: '2026-05-03', title: slug, why: 'elsewhere' })),
      responses: [],
      closed: null,
      reviewed: true,
    },
  ],
})

const role = (r: 'turning_point' | 'routine') => ({ role: r, roleKind: null })

const KEYS = [
  key(
    'ebola',
    [
      ['e1', 'must', 'turning_point'],
      ['e2', 'must', 'routine'],
      ['e3', 'must', 'routine'],
      ['e4', 'optional', 'routine'],
    ],
    ['uganda'],
  ),
  key('cholera', [
    ['c1', 'must', 'routine'],
    ['c2', 'must', 'routine'],
  ]),
]

const run = (overviews: ReplayRun['overviews'], roles: [string, 'turning_point' | 'routine'][] = []): ReplayRun => ({
  run: 1,
  overviews,
  roles: new Map(roles.map(([slug, r]) => [slug, role(r)])),
})

describe('scoreLinkRun', () => {
  it('counts must entries in their development as right, ignores optional ones, and finds the must entries', () => {
    const s = scoreLinkRun(KEYS, run([{ id: 'o1', members: ['e1', 'e2', 'e4'], foundedFrom: ['e1', 'e2'], endEvent: 'End.' }]))
    expect(s).toMatchObject({ right: 2, wrong: 0, found: 2, must: 5, foundings: 1, wrongFoundings: 0 })
    expect(s.developments.get('ebola')).toBe('o1')
  })

  it("counts a near miss in its development's overview, and an entry in another's, as wrong", () => {
    const s = scoreLinkRun(
      KEYS,
      run([
        { id: 'o1', members: ['e1', 'e2', 'uganda', 'c1'], foundedFrom: ['e1', 'e2'], endEvent: 'End.' },
        { id: 'o2', members: ['c2', 'e3'], foundedFrom: ['c2', 'e3'], endEvent: 'End.' },
      ]),
    )
    // o2 is a tie between the two keys: it stands for the first counted, cholera
    expect(s.right).toBe(3)
    expect(s.wrong).toBe(3)
    expect(s.wrongFoundings).toBe(1)
    expect(s.mistakes).toEqual(expect.arrayContaining(['near miss uganda joined ebola', 'c1 (cholera) joined ebola']))
  })

  it("skips a center's entries as optional, a base entry of any key taking precedence, and counts its near misses as the key's", () => {
    const keys = [centered(KEYS[0]!, ['w1', 'c2'], ['far']), KEYS[1]!]
    const { entry, nearMiss } = keyIndex(keys)
    expect(entry.get('w1')).toMatchObject({ key: 'ebola', join: 'optional' })
    expect(entry.get('c2')).toMatchObject({ key: 'cholera', join: 'must' })
    expect(nearMiss.get('far')).toEqual(['ebola'])
    const s = scoreLinkRun(keys, run([{ id: 'o1', members: ['e1', 'e2', 'w1', 'far'], foundedFrom: ['e1', 'e2'], endEvent: 'End.' }]))
    expect(s).toMatchObject({ right: 2, wrong: 1, must: 5 })
  })

  it('judges roles of the must entries found in their development, never of a story left alone or placed elsewhere', () => {
    const roles: [string, 'turning_point' | 'routine'][] = [
      ['e1', 'turning_point'],
      ['e2', 'turning_point'],
      ['e3', 'turning_point'],
      ['e4', 'routine'],
      ['c1', 'routine'],
    ]
    // e3 is left alone and c1 sits in Ebola's overview: neither role is judged
    const s = scoreLinkRun(KEYS, run([{ id: 'o1', members: ['e1', 'e2', 'e4', 'c1'], foundedFrom: ['e1', 'e2'], endEvent: 'End.' }], roles))
    expect(s).toMatchObject({ rolesAgreeing: 1, rolesJudged: 2 })
    expect(scoreLinkRun(KEYS, run([], roles))).toMatchObject({ rolesAgreeing: 0, rolesJudged: 0 })
  })

  it("judges a founding pair against the other half's keys too: two entries of a development the half does not score found it rightly", () => {
    const strait = key('strait', [
      ['s1', 'must', 'routine'],
      ['deal', 'must', 'turning_point'],
    ])
    // `deal` is also an optional entry of Ebola's here, as a deal story is of Lebanon's and of the strait's
    const keys = [
      key('ebola', [
        ...KEYS[0]!.entries.map(e => [e.slug, e.join, e.role] as [string, 'must' | 'optional', 'turning_point' | 'routine']),
        ['deal', 'optional', 'routine'],
      ]),
    ]
    const founded = run([{ id: 'o1', members: ['s1', 'deal'], foundedFrom: ['s1', 'deal'], endEvent: null }])
    expect(scoreLinkRun(keys, founded).wrongFoundings).toBe(1)
    expect(scoreLinkRun(keys, founded, [strait])).toMatchObject({ wrongFoundings: 0, mistakes: [] })
    const mixed = run([{ id: 'o1', members: ['e1', 's1'], foundedFrom: ['e1', 's1'], endEvent: null }])
    expect(scoreLinkRun(keys, mixed, [strait]).wrongFoundings).toBe(1)
  })
})

describe('scoreLinking', () => {
  it('meets the bars only on a clean replay, with the end event right for every development', () => {
    const clean = run(
      [
        { id: 'o1', members: ['e1', 'e2', 'e3'], foundedFrom: ['e1', 'e2'], endEvent: 'End.' },
        { id: 'o2', members: ['c1', 'c2'], foundedFrom: ['c1', 'c2'], endEvent: 'End.' },
      ],
      [
        ['e1', 'turning_point'],
        ['e2', 'routine'],
        ['e3', 'routine'],
        ['c1', 'routine'],
        ['c2', 'routine'],
      ],
    )
    const verdicts = new Map<string, EndEventVerdict[]>([
      ['ebola', ['right']],
      ['cholera', ['right']],
    ])
    const s = scoreLinking(KEYS, [clean], verdicts)
    expect([...s.link, ...s.found, ...s.role].map(b => b.met)).toEqual([true, true, true, true, true])
    const wrongEnd = scoreLinking(
      KEYS,
      [clean],
      new Map<string, EndEventVerdict[]>([
        ['ebola', ['right']],
        ['cholera', ['wrong']],
      ]),
    )
    expect(wrongEnd.found[1]!.met).toBe(false)
  })

  it('counts a development founded with no end event, or not founded, as no wrong end event, and decides nothing while a named one is unjudged', () => {
    const verdicts = (cholera: EndEventVerdict) =>
      new Map<string, EndEventVerdict[]>([
        ['ebola', ['none']],
        ['cholera', [cholera]],
      ])
    const ends = (cholera: EndEventVerdict) => scoreLinking(KEYS, [run([])], verdicts(cholera)).found[1]!
    expect(ends(null)).toMatchObject({ value: 0, met: true })
    expect(ends('right')).toMatchObject({ value: 0, met: true })
    expect(ends('unjudged')).toMatchObject({ value: null, met: null })
  })

  it('has no data without runs', () => {
    expect(scoreLinking(KEYS, []).link.map(b => b.met)).toEqual([null, null])
  })

  it('reports the bars of the steps named', () => {
    const score = scoreLinking(KEYS, [run([])])
    const signals = [{ run: 1, centerEntries: 3, centerFlagged: 2, nearMisses: 10, nearMissesWider: 1, falseShifts: ['c1'] }]
    const report = {
      half: 'judge' as const,
      repeat: 1,
      keys: ['ebola'],
      stories: 3,
      left: [],
      score,
      endEvents: [],
      signals,
      diagnostics: [],
      unanswered: 0,
      costUsd: 0.01,
      perStoryUsd: 0.003,
    }
    const text = linkLines(report, ['link']).join('\n')
    expect(text).toContain('joins right')
    expect(text).not.toContain('roles agreeing |')
    expect(text).toContain('| 1 | 2 of 3 | 1 of 10 | 1: c1 |')
    expect(linkLines(report, ['role']).join('\n')).toContain('roles agreeing')
  })
})

describe('scoreSignals', () => {
  it("counts center entries flagged for their development's overview, near misses flagged wider, and center flags where no center is keyed", () => {
    const keys = [centered(KEYS[0]!, ['w1', 'w2', 'w3']), KEYS[1]!]
    const replayed = new Set(['e1', 'e2', 'w1', 'w2', 'uganda', 'c1', 'c2'])
    const s = scoreSignals(
      keys,
      replayed,
      [
        { slug: 'w1', overviewId: 'o1', kind: 'wider' },
        { slug: 'w2', overviewId: 'o2', kind: 'center_moved' },
        { slug: 'uganda', overviewId: 'o1', kind: 'wider' },
        { slug: 'c1', overviewId: 'o2', kind: 'center_moved' },
      ],
      new Map([
        ['ebola', 'o1'],
        ['cholera', 'o2'],
      ]),
      2,
    )
    expect(s).toEqual({ run: 2, centerEntries: 2, centerFlagged: 1, nearMisses: 1, nearMissesWider: 1, falseShifts: ['c1'] })
  })
})

describe('the sandbox', () => {
  const story = (id: string, day: number) => ({
    id,
    title: id,
    label: '',
    summary: '',
    datePublished: new Date(Date.UTC(2026, 4, day)),
    date: `2026-05-${String(day).padStart(2, '0')}`,
    issueId: null,
    facts: [],
  })
  const base = (s: ReturnType<typeof story>): LinkResult => ({
    story: s,
    outcome: 'none',
    role: { role: 'routine', roleKind: null },
    join: null,
    founding: null,
    shown: { overviews: [], partners: [] },
    answer: null,
    proposed: 0,
    refusals: [],
    signals: [],
    heldBy: null,
    model: null,
    promptVersion: null,
    costUsd: 0,
  })

  it('founds and joins by the lifecycle rules, and skips a story linked meanwhile', async () => {
    const sandbox = createSandbox()
    const [a, b, c] = [story('a', 1), story('b', 2), story('c', 3)]
    const draft = { title: 'T', charter: { in: 'In.', out: [], endEvent: 'End.' }, roles: { a: role('turning_point'), b: role('routine') } }
    const founding = {
      partner: a,
      outcome: 'founded' as const,
      draft,
      answers: { draft: null, check: null },
      shared: { cause: { story: 'x', other: 'y' }, place: { story: 'x', other: 'y' }, end: { story: '', other: '' } } as never,
      confidence: 0.9,
      costUsd: 0,
      model: null,
    }
    expect(
      await sandbox.apply({ ...base(b), outcome: 'founded', founding, shown: { overviews: [], partners: [{ ref: 'F1', id: 'a', distance: 0.1 }] } }, false),
    ).toEqual({
      kind: 'written',
      outcome: 'founded',
    })
    const [id] = [...sandbox.overviews.keys()]
    expect(sandbox.overviews.get(id!)!.foundedFrom).toEqual(['a', 'b'])
    expect(await sandbox.apply(base(a), false)).toEqual({ kind: 'skipped' })
    const join = {
      candidate: { id: id!, title: 'T', charter: draft.charter, entries: [], ref: 'O1', distance: 0.1, frozen: false },
      answer: {} as never,
      shared: {} as never,
      reportsEndEvent: false,
    }
    expect(await sandbox.apply({ ...base(c), outcome: 'joined', join }, false)).toEqual({ kind: 'written', outcome: 'joined' })
    expect((await sandbox.candidateOverviews([id!]))[0]!.entries.map(e => e.title)).toEqual(['c', 'b', 'a'])
    expect(sandbox.results.get('a')).toEqual({ outcome: 'founded', role: role('turning_point') })
  })

  it('keeps a story held at its link waiting on the frozen overview that holds it, as production does', async () => {
    const sandbox = createSandbox()
    const [a, b, d] = [story('a', 1), story('b', 2), story('d', 4)]
    const draft = { title: 'T', charter: { in: 'In.', out: [], endEvent: null }, roles: { a: role('turning_point'), b: role('routine') } }
    const shared = { cause: { story: 'x', other: 'y' }, place: { story: 'x', other: 'y' }, end: { story: '', other: '' } } as never
    const founding = { partner: a, outcome: 'founded' as const, draft, answers: { draft: null, check: null }, shared, confidence: 0.9, costUsd: 0, model: null }
    await sandbox.apply({ ...base(b), outcome: 'founded', founding, shown: { overviews: [], partners: [{ ref: 'F1', id: 'a', distance: 0.1 }] } }, false)
    const [id] = [...sandbox.overviews.keys()]
    sandbox.overviews.get(id!)!.frozen = true
    expect(await sandbox.apply({ ...base(d), outcome: 'held', heldBy: id! }, false)).toEqual({ kind: 'written', outcome: 'held' })
    const [owed] = owedOf(sandbox, [{ id: 'd', datePublished: d.datePublished }])
    expect(owedStanding(owed!.attempts, new Date(Date.UTC(2026, 4, 9)))).toEqual({ kind: 'frozen' })
  })
})

describe('the option parser', () => {
  it('takes the linking steps by name, and runs none of them by default', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'link,found,role']).steps).toEqual(['link', 'found', 'role'])
    expect(parseOverviewOptions(['--out', 'x']).steps).not.toContain('link')
  })
})

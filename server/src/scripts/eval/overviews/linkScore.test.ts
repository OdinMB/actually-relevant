import { describe, expect, it } from 'vitest'
import { parseOverviewOptions } from '../options.js'
import type { AnswerKey } from './keySchema.js'
import { linkLines } from './linkReport.js'
import { scoreLinking, scoreLinkRun, type EndEventVerdict, type ReplayRun } from './linkScore.js'
import { createSandbox } from './overviewSandbox.js'
import type { LinkResult } from '../../../services/overviewLink.js'

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
  notes: '',
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

  it('judges roles of must entries against the key', () => {
    const s = scoreLinkRun(
      KEYS,
      run(
        [],
        [
          ['e1', 'turning_point'],
          ['e2', 'turning_point'],
          ['e4', 'routine'],
        ],
      ),
    )
    expect(s).toMatchObject({ rolesAgreeing: 1, rolesJudged: 2 })
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
    const report = { half: 'judge' as const, repeat: 1, keys: ['ebola'], stories: 3, left: [], score, endEvents: [], costUsd: 0.01, perStoryUsd: 0.003 }
    const text = linkLines(report, ['link']).join('\n')
    expect(text).toContain('joins right')
    expect(text).not.toContain('roles agreeing |')
    expect(linkLines(report, ['role']).join('\n')).toContain('roles agreeing')
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
})

describe('the option parser', () => {
  it('takes the linking steps by name, and runs none of them by default', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'link,found,role']).steps).toEqual(['link', 'found', 'role'])
    expect(parseOverviewOptions(['--out', 'x']).steps).not.toContain('link')
  })
})

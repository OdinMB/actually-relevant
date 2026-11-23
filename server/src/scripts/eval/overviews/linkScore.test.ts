import { describe, expect, it } from 'vitest'
import { parseOverviewOptions } from '../options.js'
import type { AnswerKey } from './keySchema.js'
import { linkLines } from './linkReport.js'
import { keyIndex, linkKeys, scoreLinking, scoreLinkRun, scoreSignals, sharedMusts, type EndEventVerdict, type ReplayRun } from './linkScore.js'
import { createSandbox, owedOf } from './overviewSandbox.js'
import type { LinkResult } from '../../../services/overviewLink.js'
import { owedStanding } from '../../../services/overviewOwed.js'

const key = (id: string, entries: [string, 'must' | 'optional', 'turning_point' | 'routine'][], nearMisses: string[] = []): AnswerKey => ({
  schemaVersion: 1,
  id,
  title: id,
  charter: { in: 'In.', out: [], endEvent: 'End.' },
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
    expect(s).toMatchObject({ rolesAgreeing: 1, rolesJudged: 2, rolesEither: 0 })
    expect(scoreLinkRun(KEYS, run([], roles))).toMatchObject({ rolesAgreeing: 0, rolesJudged: 0 })
  })

  it('counts an entry that accepts either role as agreeing with a turning point of any kind or routine, and counts those entries apart', () => {
    const ebola = KEYS[0]!
    const either: AnswerKey = { ...ebola, entries: ebola.entries.map(e => (e.slug === 'e2' || e.slug === 'e3' ? { ...e, eitherRole: true } : e)) }
    expect(keyIndex([either]).entry.get('e2')).toMatchObject({ role: 'either', musts: new Map([['ebola', 'either']]) })
    const overview = [{ id: 'o1', members: ['e1', 'e2', 'e3'], foundedFrom: ['e1', 'e2'] as [string, string], endEvent: 'End.' }]
    const given: ReplayRun = {
      run: 1,
      overviews: overview,
      roles: new Map([
        ['e1', role('routine')],
        ['e2', { role: 'turning_point', roleKind: 'setback' }],
        ['e3', role('routine')],
      ]),
    }
    expect(scoreLinkRun([either, KEYS[1]!], given)).toMatchObject({ rolesJudged: 3, rolesAgreeing: 2, rolesEither: 2 })
    // the key's lean still decides where no entry accepts either
    expect(scoreLinkRun(KEYS, given)).toMatchObject({ rolesJudged: 3, rolesAgreeing: 1, rolesEither: 0 })
    const text = linkLines(
      {
        half: 'judge',
        repeat: 1,
        keys: ['ebola', 'cholera'],
        stories: 4,
        background: { keys: [], stories: 0 },
        merged: [],
        left: [],
        score: scoreLinking([either, KEYS[1]!], [given]),
        endEvents: [],
        signals: [],
        diagnostics: [],
        unanswered: 0,
        errored: 0,
        costUsd: 0,
        perStoryUsd: 0,
      },
      ['role'],
    ).join('\n')
    expect(text).toContain('| 2 of 3 (2) |')
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

  describe('a must entry of two keys', () => {
    // `deal` ends the war and reopens the strait: a must of both, a turning point of the war's only
    const war = key('war', [
      ['w1', 'must', 'routine'],
      ['w2', 'must', 'routine'],
      ['deal', 'must', 'turning_point'],
    ])
    const strait = key('strait', [
      ['s1', 'must', 'routine'],
      ['s2', 'must', 'routine'],
      ['deal', 'must', 'routine'],
    ])
    const both = [war, strait]

    it("is right in either development's overview, found once, its role judged against the key of the overview it joined", () => {
      for (const [members, dev] of [
        [['w1', 'w2', 'deal'], 'war'],
        [['s1', 's2', 'deal'], 'strait'],
      ] as const) {
        const s = scoreLinkRun(
          both,
          run([{ id: 'o1', members: [...members], foundedFrom: [members[0], members[1]], endEvent: null }], [['deal', 'turning_point']]),
        )
        expect(s).toMatchObject({ right: 3, wrong: 0, found: 3, must: 5, rolesJudged: 1, rolesAgreeing: dev === 'war' ? 1 : 0 })
        expect(s.developments.get(dev)).toBe('o1')
      }
    })

    it("is wrong in a third development's overview, naming both its keys", () => {
      const s = scoreLinkRun([...both, KEYS[1]!], run([{ id: 'o1', members: ['c1', 'c2', 'deal'], foundedFrom: ['c1', 'c2'], endEvent: null }]))
      expect(s).toMatchObject({ right: 2, wrong: 1 })
      expect(s.mistakes).toEqual(['deal (war or strait) joined cholera'])
    })

    it('counts for both developments when deciding which one an overview stands for', () => {
      const s = scoreLinkRun(both, run([{ id: 'o1', members: ['deal', 's1'], foundedFrom: ['deal', 's1'], endEvent: null }]))
      expect(s.developments.get('strait')).toBe('o1')
    })
  })

  describe('with the keys outside the half (background, label keys)', () => {
    const iran = key('iran', [
      ['i1', 'must', 'routine'],
      ['i2', 'must', 'routine'],
      ['i3', 'must', 'routine'],
      ['e3', 'must', 'turning_point'],
    ])
    const strait = key('strait', [['s1', 'must', 'routine']])

    it('checks a founding only when one of its stories is a story of the half, so two background stories never found wrongly', () => {
      const s = scoreLinkRun(
        KEYS,
        run([
          { id: 'o1', members: ['i1', 's1'], foundedFrom: ['i1', 's1'], endEvent: null },
          { id: 'o2', members: ['i2', 'c1'], foundedFrom: ['i2', 'c1'], endEvent: null },
        ]),
        [iran, strait],
      )
      expect(s).toMatchObject({ foundings: 2, wrongFoundings: 1 })
      expect(s.mistakes).toContain('founded from i2 and c1, not two entries of one development')
    })

    it("counts a background story in a judged development's overview as a wrong join, and keeps the developments to the half's keys", () => {
      const s = scoreLinkRun(
        KEYS,
        run([
          { id: 'o1', members: ['e1', 'e2', 'i3'], foundedFrom: ['e1', 'e2'], endEvent: null },
          { id: 'o2', members: ['i1', 'i2'], foundedFrom: ['i1', 'i2'], endEvent: null },
        ]),
        [iran],
      )
      expect(s).toMatchObject({ right: 2, wrong: 1 })
      expect(s.mistakes).toEqual(['i3 (background: entry of iran) joined ebola'])
      expect([...s.developments.keys()]).toEqual(['ebola'])
    })

    it("finds a must entry of the half in an outside key's overview that holds it as must too, its role judged against that key", () => {
      const s = scoreLinkRun(KEYS, run([{ id: 'o1', members: ['i1', 'i2', 'e3'], foundedFrom: ['i1', 'i2'], endEvent: null }], [['e3', 'turning_point']]), [
        iran,
      ])
      expect(s).toMatchObject({ right: 1, wrong: 0, found: 1, rolesJudged: 1, rolesAgreeing: 1 })
      expect(s.developments.size).toBe(0)
    })
  })

  it("keeps a must over another key's optional, whichever loads last: right in the must's overview, neither right nor wrong in the optional's", () => {
    const war = key('war', [
      ['w1', 'must', 'routine'],
      ['w2', 'must', 'routine'],
      ['deal', 'optional', 'routine'],
    ])
    const strait = key('strait', [
      ['s1', 'must', 'routine'],
      ['s2', 'must', 'routine'],
      ['deal', 'must', 'turning_point'],
    ])
    for (const keys of [
      [war, strait],
      [strait, war],
    ]) {
      expect(keyIndex(keys).entry.get('deal')).toMatchObject({ key: 'strait', join: 'must', role: 'turning_point' })
      const inWar = scoreLinkRun(keys, run([{ id: 'o1', members: ['w1', 'w2', 'deal'], foundedFrom: ['w1', 'w2'], endEvent: null }]))
      expect(inWar).toMatchObject({ right: 2, wrong: 0, found: 2 })
      const inStrait = scoreLinkRun(keys, run([{ id: 'o1', members: ['s1', 's2', 'deal'], foundedFrom: ['s1', 's2'], endEvent: null }]))
      expect(inStrait).toMatchObject({ right: 3, wrong: 0, found: 3 })
    }
  })
})

describe('linkKeys', () => {
  const ebola = centered(KEYS[0]!, ['w1'])
  const cholera = centered(
    key(
      'cholera',
      [
        ['c1', 'must', 'routine'],
        ['c2', 'must', 'routine'],
        ['c3', 'optional', 'routine'],
      ],
      ['cnm'],
    ),
    ['cw'],
  )
  const iran = key('iran', [
    ['i1', 'must', 'routine'],
    ['i2', 'must', 'routine'],
    ['e3', 'must', 'turning_point'],
    ['e2', 'optional', 'routine'],
  ])
  const k = linkKeys([ebola, cholera], [iran])

  it("in a judged development's overview, counts its must entry right, its optional and center entries as ignored, and every other member wrong", () => {
    const table = ['e1', 'e4', 'w1', 'uganda', 'i1', 'c1', 'c3', 'cnm', 'cw'].map(slug => [slug, k.verdict(slug, 'ebola')])
    expect(table).toEqual([
      ['e1', 'right'],
      ['e4', 'ignored'],
      ['w1', 'ignored'],
      ['uganda', 'wrong'],
      ['i1', 'wrong'],
      ['c1', 'wrong'],
      ['c3', 'wrong'],
      ['cnm', 'wrong'],
      ['cw', 'wrong'],
    ])
  })

  it("in any other overview, scores only the half's must entries: right where its key holds one as must too, ignored as optional, wrong otherwise", () => {
    const table = ['e3', 'e2', 'e1', 'uganda', 'i1', 'e4'].map(slug => [slug, k.verdict(slug, 'iran')])
    expect(table).toEqual([
      ['e3', 'right'],
      ['e2', 'ignored'],
      ['e1', 'wrong'],
      ['uganda', null],
      ['i1', null],
      ['e4', null],
    ])
    expect(k.verdict('e1', null)).toBe('wrong')
    expect(k.verdict('i1', null)).toBeNull()
  })

  it("reads an overview as standing for the key of either half most of whose must entries it holds, and knows the half's stories", () => {
    expect(k.standsFor(['e1', 'i1', 'i2', 'e3'])).toBe('iran')
    expect(k.standsFor(['e1', 'e2', 'i1'])).toBe('ebola')
    expect(['e1', 'e4', 'w1', 'uganda', 'cnm', 'i1'].map(k.judged)).toEqual([true, true, true, true, true, false])
  })
})

describe('sharedMusts', () => {
  it('lists the stories two keys hold as must, never one that is a must of one key and optional in another', () => {
    const war = key('war', [
      ['deal', 'must', 'turning_point'],
      ['talks', 'optional', 'routine'],
    ])
    const strait = key('strait', [
      ['deal', 'must', 'routine'],
      ['talks', 'must', 'routine'],
    ])
    expect(sharedMusts([war, strait])).toEqual([{ slug: 'deal', keys: ['war', 'strait'] }])
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

  it('holds roles agreeing to 65% (the owner lowered it from 85% on 2026-11-23)', () => {
    const roles = (wrong: number): ReplayRun =>
      run(
        [
          { id: 'o1', members: ['e1', 'e2', 'e3'], foundedFrom: ['e1', 'e2'], endEvent: 'End.' },
          { id: 'o2', members: ['c1', 'c2'], foundedFrom: ['c1', 'c2'], endEvent: 'End.' },
        ],
        [
          ['e1', wrong > 0 ? 'routine' : 'turning_point'],
          ['e2', 'routine'],
          ['e3', wrong > 1 ? 'turning_point' : 'routine'],
          ['c1', 'routine'],
          ['c2', 'routine'],
        ],
      )
    expect(scoreLinking(KEYS, [roles(1)]).role[0]).toMatchObject({ value: 0.8, target: 0.65, met: true })
    expect(scoreLinking(KEYS, [roles(2)]).role[0]).toMatchObject({ value: 0.6, target: 0.65, met: false })
  })

  describe('wrong foundings (share)', () => {
    // Developments d0…d39 of two must entries each, so a run can found many overviews with no repeat
    const devs = Array.from({ length: 40 }, (_, i) =>
      key(`d${i}`, [
        [`d${i}a`, 'must', 'routine'],
        [`d${i}b`, 'must', 'routine'],
      ]),
    )
    /** `right` rightful foundings of distinct developments, then `wrong` ones from two developments' entries, none a repeat. */
    const foundings = (right: number, wrong: number): ReplayRun => {
      const overviews: ReplayRun['overviews'] = []
      for (let i = 0; i < right; i++) overviews.push({ id: `o${i}`, members: [`d${i}a`, `d${i}b`], foundedFrom: [`d${i}a`, `d${i}b`], endEvent: null })
      for (let j = 0; j < wrong; j++) {
        const [a, b] = [`d${right + 2 * j}a`, `d${right + 2 * j + 1}a`]
        overviews.push({ id: `w${j}`, members: [a, b], foundedFrom: [a, b], endEvent: null })
      }
      return run(overviews)
    }
    const share = (...runs: ReplayRun[]) => scoreLinking(devs, runs).found[0]!

    it('holds the share to at most 10%, met at exactly 10% and not above', () => {
      expect(share(foundings(9, 1))).toMatchObject({ name: 'wrong foundings (share)', value: 0.1, target: 0.1, direction: 'atMost', met: true })
      expect(share(foundings(17, 2))).toMatchObject({ value: 2 / 19, met: false })
      expect(share(foundings(10, 0))).toMatchObject({ value: 0, met: true })
    })

    it('pools the runs: every founding weighs the same, so a run with few foundings does not swing the bar', () => {
      // run 1: 1 of 2 wrong (50%), run 2: 0 of 18: pooled 1 of 20 (5%), where a mean over runs would read 25%
      expect(share(foundings(1, 1), foundings(18, 0))).toMatchObject({ value: 0.05, met: true })
      expect(share(foundings(8, 2), foundings(10, 0))).toMatchObject({ value: 0.1, met: true })
      expect(share(foundings(8, 2), foundings(9, 1))).toMatchObject({ value: 0.15, met: false })
    })

    it('has no verdict with no founding of a judged story, and leaves background foundings out of the share', () => {
      expect(share()).toMatchObject({ value: null, met: null })
      expect(share(run([]))).toMatchObject({ value: null, met: null })
      const iran = key('iran', [
        ['i1', 'must', 'routine'],
        ['i2', 'must', 'routine'],
      ])
      const background = run([{ id: 'o1', members: ['i1', 'i2'], foundedFrom: ['i1', 'i2'], endEvent: null }])
      expect(scoreLinking(KEYS, [background], new Map(), [iran]).found[0]).toMatchObject({ value: null, met: null })
    })

    it('counts a founding of a development that already has an open overview as a wrong repeat, naming the overview it repeats', () => {
      const repeated: ReplayRun = run([
        { id: 'o1', title: 'Ebola in DRC', foundedOn: '2026-05-23', members: ['e1', 'e2'], foundedFrom: ['e1', 'e2'], endEvent: null },
        { id: 'o2', members: ['c1', 'c2'], foundedFrom: ['c1', 'c2'], endEvent: null },
        { id: 'o3', title: 'Ebola again', foundedOn: '2026-07-16', members: ['e3', 'e4'], foundedFrom: ['e3', 'e4'], endEvent: null },
      ])
      const s = scoreLinkRun(KEYS, repeated)
      expect(s).toMatchObject({ foundings: 3, judgedFoundings: 3, wrongFoundings: 0, repeatFoundings: 1, foundingsWrong: 1, backgroundRepeats: [] })
      expect(s.mistakes).toEqual([
        'founded ebola again from e3 and e4 on 2026-07-16 ("Ebola again", o3), repeating "Ebola in DRC" (o1, founded 2026-05-23 from e1 and e2)',
      ])
      expect(s.developments.get('ebola')).toBe('o1')
      expect(scoreLinking(KEYS, [repeated]).found[0]).toMatchObject({ value: 1 / 3, met: false })
      const text = linkLines(
        {
          half: 'judge',
          repeat: 1,
          keys: ['ebola', 'cholera'],
          stories: 6,
          background: { keys: [], stories: 0 },
          merged: [],
          left: [],
          score: scoreLinking(KEYS, [repeated]),
          endEvents: [],
          signals: [],
          diagnostics: [],
          unanswered: 0,
          errored: 0,
          costUsd: 0,
          perStoryUsd: 0,
        },
        ['found'],
      ).join('\n')
      expect(text).toContain('| wrong foundings (share) | at most 10% | 33.3% | not met |')
      expect(text).toContain('| 1 | 5 / 0 | 5 of 5 | 3 (3) | 0 / 1 (33.3%) |')
      expect(text).toContain('- Run 1: founded ebola again from e3 and e4')
    })

    it('counts a founding that is both not one development and a repeat once in the share', () => {
      const both = run([
        { id: 'o1', members: ['e1', 'e2'], foundedFrom: ['e1', 'e2'], endEvent: null },
        { id: 'o2', members: ['e3', 'c1'], foundedFrom: ['e3', 'c1'], endEvent: null },
      ])
      expect(scoreLinkRun(KEYS, both)).toMatchObject({ judgedFoundings: 2, wrongFoundings: 1, repeatFoundings: 1, foundingsWrong: 1 })
    })

    it('leaves a repeat of two background stories unscored, listing it as a diagnostic', () => {
      const iran = key('iran', [
        ['i1', 'must', 'routine'],
        ['i2', 'must', 'routine'],
        ['i3', 'must', 'routine'],
        ['i4', 'must', 'routine'],
      ])
      const twice = run([
        { id: 'o1', members: ['i1', 'i2'], foundedFrom: ['i1', 'i2'], endEvent: null },
        { id: 'o2', members: ['i3', 'i4'], foundedFrom: ['i3', 'i4'], endEvent: null },
      ])
      const s = scoreLinkRun(KEYS, twice, [iran])
      expect(s).toMatchObject({ foundings: 2, judgedFoundings: 0, repeatFoundings: 0, foundingsWrong: 0, mistakes: [] })
      expect(s.backgroundRepeats).toEqual(['founded iran again from i3 and i4 (o2), repeating o1 (founded from i1 and i2)'])
      const text = linkLines(
        {
          half: 'judge',
          repeat: 1,
          keys: ['ebola', 'cholera'],
          stories: 4,
          background: { keys: ['iran'], stories: 4 },
          merged: [],
          left: [],
          score: scoreLinking(KEYS, [twice], new Map(), [iran]),
          endEvents: [],
          signals: [],
          diagnostics: [],
          unanswered: 0,
          errored: 0,
          costUsd: 0,
          perStoryUsd: 0,
        },
        ['found'],
      ).join('\n')
      expect(text).toContain('### Background repeat foundings (unscored; diagnostics)')
      expect(text).toContain('- Run 1: founded iran again from i3 and i4 (o2), repeating o1 (founded from i1 and i2)')
      expect(text).toContain('| wrong foundings (share) | at most 10% | n/a | no data |')
    })
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
      background: { keys: [], stories: 0 },
      merged: [],
      left: [],
      score,
      endEvents: [],
      signals,
      diagnostics: [],
      unanswered: 0,
      errored: 0,
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
    refusedFoundings: [],
    excludedPartners: [],
    foundingBlockedBy: null,
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

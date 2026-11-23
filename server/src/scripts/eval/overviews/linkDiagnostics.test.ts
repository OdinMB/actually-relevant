import { describe, expect, it } from 'vitest'
import type { LinkResult } from '../../../services/overviewLink.js'
import type { LinkAnswer } from '../../../schemas/overviews.js'
import { LABEL_DEVELOPMENTS } from './developmentHalves.js'
import type { AnswerKey } from './keySchema.js'
import { diagnoseRun, missesByDevelopment, traceOf, type DiagnoseInput, type FoundedOverview, type StoryTrace } from './linkDiagnostics.js'
import { linkLines } from './linkReport.js'
import { scoreLinking } from './linkScore.js'

const key = (id: string, entries: [string, 'must' | 'optional', 'turning_point' | 'routine', string][], nearMisses: string[] = []): AnswerKey => ({
  schemaVersion: 1,
  id,
  title: id,
  charter: { in: 'In.', out: [], endEvent: 'End.' },
  figures: [],
  entries: entries.map(([slug, join, role, date]) => ({ slug, date, title: slug, join, role, kind: null, values: [], statuses: [], why: 'w' })),
  nearMisses: nearMisses.map(slug => ({ slug, date: '2026-05-01', title: slug, why: 'looks alike' })),
  responses: [],
  centers: [],
  notes: '',
})

const EBOLA = key(
  'ebola',
  [
    ['e1', 'must', 'turning_point', '2026-05-01'],
    ['e2', 'must', 'routine', '2026-05-02'],
    ['e3', 'must', 'routine', '2026-05-03'],
    ['e4', 'must', 'turning_point', '2026-05-04'],
    ['e5', 'must', 'routine', '2026-05-05'],
    ['e6', 'must', 'routine', '2026-05-06'],
    ['e7', 'must', 'routine', '2026-05-07'],
    ['e8', 'must', 'routine', '2026-05-08'],
    ['e0', 'must', 'routine', '2026-04-20'],
    ['gone', 'must', 'routine', '2026-05-09'],
  ],
  ['uganda'],
)
const CHOLERA = key('cholera', [
  ['c1', 'must', 'routine', '2026-05-01'],
  ['c2', 'must', 'routine', '2026-05-02'],
])
const STRAIT = key('strait', [['s1', 'must', 'routine', '2026-05-01']])

const charter = { in: 'The Ebola outbreak.', out: ['cholera'], endEvent: null }
const OVERVIEWS: FoundedOverview[] = [
  { id: 'o1', title: 'Ebola in DRC', charter, foundedFrom: ['e1', 'e2'], foundedOn: '2026-05-02', members: ['e1', 'e2', 'e4', 'uganda'] },
  {
    id: 'o2',
    title: 'Cholera',
    charter: { in: 'Cholera.', out: [], endEvent: 'Over.' },
    foundedFrom: ['c1', 'c2'],
    foundedOn: '2026-05-02',
    members: ['c1', 'c2', 'e5'],
  },
  {
    id: 'o3',
    title: 'The strait',
    charter: { in: 'Strait.', out: [], endEvent: null },
    foundedFrom: ['s1', 'uganda'],
    foundedOn: '2026-05-03',
    members: ['s1', 'uganda'],
  },
]

const trace = (slug: string, date: string, over: Partial<StoryTrace> = {}): StoryTrace => ({
  slug,
  date,
  outcome: 'none',
  called: true,
  neighbours: { read: 10, near: 10, kept: 3 },
  overviews: [],
  partners: [],
  founding: null,
  ...over,
})
const candidate = (ref: string, id: string, belongs: 'yes' | 'no' | 'unsure', refusal: string | null = null) => ({
  ref,
  id,
  distance: 0.3,
  belongs,
  confidence: 0.4,
  scope: 'unrelated' as const,
  refusal,
})

const TRACES = new Map<string, StoryTrace>([
  ['e0', trace('e0', '2026-04-20', { called: false, neighbours: { read: 40, near: 40, kept: 0 } })],
  ['e3', trace('e3', '2026-05-03', { outcome: 'rejected', overviews: [candidate('O1', 'o1', 'yes', "end: the story's quote is not in its text")] })],
  ['e6', trace('e6', '2026-05-06', { overviews: [candidate('O1', 'o2', 'no')] })],
  ['e7', trace('e7', '2026-05-07', { overviews: [candidate('O1', 'o1', 'unsure')] })],
  [
    'e8',
    trace('e8', '2026-05-08', {
      partners: [candidate('F1', 'e3', 'yes')],
      founding: { partner: 'e3', outcome: 'disagreed', why: 'A does not fit: a study' },
    }),
  ],
])

const diagnoseInput = (): DiagnoseInput => ({
  keys: [EBOLA, CHOLERA],
  others: [STRAIT],
  run: 2,
  overviews: OVERVIEWS,
  traces: TRACES,
  roles: new Map([
    ['e1', { role: 'turning_point', roleKind: 'spread' }],
    ['e2', { role: 'turning_point', roleKind: 'setback' }],
    ['e4', { role: 'routine', roleKind: null }],
    ['e6', { role: 'turning_point', roleKind: 'spread' }],
  ]),
  replayed: new Set([...TRACES.keys(), 'e1', 'e2', 'e4', 'e5', 'c1', 'c2']),
  neighbourLimit: 40,
})
const diagnose = () => diagnoseRun(diagnoseInput())

describe('diagnoseRun', () => {
  it('says why each must entry was not found in its development, and skips those found', () => {
    const d = diagnose()
    const by = new Map(d.missed.map(m => [m.slug, m]))
    expect([...by.keys()].sort()).toEqual(['e0', 'e3', 'e5', 'e6', 'e7', 'e8', 'gone'])
    expect(by.get('gone')).toMatchObject({ cause: 'not replayed', date: '2026-05-09' })
    expect(by.get('e5')).toMatchObject({ cause: 'in another overview' })
    expect(by.get('e5')!.detail).toContain('"Cholera" (cholera)')
    expect(by.get('e0')).toMatchObject({ cause: 'no candidate' })
    expect(by.get('e0')!.detail).toContain('cut at the limit of 40), 0 replayed')
    expect(by.get('e0')!.detail).toContain("before ebola's overview was founded (2026-05-02)")
    expect(by.get('e3')).toMatchObject({ cause: 'refused by code' })
    expect(by.get('e3')!.detail).toContain("end: the story's quote is not in its text")
    expect(by.get('e6')).toMatchObject({ cause: 'not offered' })
    expect(by.get('e7')).toMatchObject({ cause: 'model unsure' })
    expect(by.get('e8')).toMatchObject({ cause: 'founding not agreed' })
    expect(by.get('e8')!.detail).toContain('A does not fit: a study')
  })

  it("names a founding a refused yes to another development's overview blocked, with that overview", () => {
    const blocked = trace('e6', '2026-05-06', {
      outcome: 'rejected',
      overviews: [candidate('O1', 'o2', 'yes', 'no place on both sides')],
      partners: [candidate('F1', 'e3', 'yes')],
      blockedBy: 'o2',
    })
    const d = diagnoseRun({ ...diagnoseInput(), traces: new Map([...TRACES, ['e6', blocked]]) })
    expect(d.missed.find(m => m.slug === 'e6')).toMatchObject({ cause: 'founding blocked' })
    expect(d.missed.find(m => m.slug === 'e6')!.detail).toContain('a refused yes to "Cholera" (cholera)')
  })

  it("gives each run's first founding of each development, and the joins whose quotes passed only by the near match, right or wrong", () => {
    const near = new Map([
      ...TRACES,
      ['e4', trace('e4', '2026-05-04', { outcome: 'joined', overviews: [{ ...candidate('O1', 'o1', 'yes'), nearMatch: true }] })],
      ['uganda', trace('uganda', '2026-05-01', { outcome: 'joined', overviews: [{ ...candidate('O1', 'o1', 'yes'), nearMatch: true }] })],
    ])
    const d = diagnoseRun({ ...diagnoseInput(), traces: near })
    expect(d.firstFoundings).toEqual([
      { key: 'cholera', foundedOn: '2026-05-02', title: 'Cholera' },
      { key: 'ebola', foundedOn: '2026-05-02', title: 'Ebola in DRC' },
      { key: 'strait', foundedOn: '2026-05-03', title: 'The strait' },
    ])
    expect(d.nearMatches).toEqual([
      { slug: 'e4', overview: 'Ebola in DRC', verdict: 'right' },
      { slug: 'uganda', overview: 'Ebola in DRC', verdict: 'wrong' },
    ])
  })

  it('gives a must entry not replayed the reason the replay was given for it, and with none, that it is not published', () => {
    expect(diagnose().missed.find(m => m.slug === 'gone')!.detail).toBe('not published in this database')
    const reason = 'not in the saved replay: the keys name it since the run'
    const d = diagnoseRun({ ...diagnoseInput(), absent: new Map([['gone', reason]]) })
    expect(d.missed.find(m => m.slug === 'gone')).toMatchObject({ cause: 'not replayed', detail: reason })
  })

  it('lists the roles of found must entries that disagree with the key, and judges only those', () => {
    const d = diagnose()
    expect(d.rolesJudged).toBe(3)
    expect(d.roleMisses.map(m => [m.slug, m.expected, m.given.role])).toEqual([
      ['e2', 'routine', 'turning_point'],
      ['e4', 'turning_point', 'routine'],
    ])
    expect(d.rolesEither).toBe(0)
  })

  it('never lists an entry that accepts either role as a disagreement, and counts it apart', () => {
    const either: AnswerKey = { ...EBOLA, entries: EBOLA.entries.map(e => (e.slug === 'e2' ? { ...e, eitherRole: true } : e)) }
    const d = diagnoseRun({ ...diagnoseInput(), keys: [either, CHOLERA] })
    expect(d).toMatchObject({ rolesJudged: 3, rolesEither: 1 })
    expect(d.roleMisses.map(m => m.slug)).toEqual(['e4'])
    const report = {
      half: 'judge' as const,
      repeat: 1,
      keys: ['ebola', 'cholera'],
      stories: 9,
      background: { keys: [], stories: 0 },
      merged: [],
      left: [],
      score: scoreLinking([either, CHOLERA], []),
      endEvents: [],
      signals: [],
      diagnostics: [d],
      unanswered: 0,
      errored: 0,
      costUsd: 0,
      perStoryUsd: 0,
    }
    // run 2: 3 judged, 2 agreeing, 1 accepting either, 1 key turning point given routine, 0 the other way
    expect(linkLines(report, ['role']).join('\n')).toContain('| 2 | 3 | 2 | 1 | 1 | 0 |')
  })

  it("gives each founded charter with what the keys make of its pair and members, the other half's keys included", () => {
    const [ebola, , strait] = diagnose().charters
    expect(ebola).toMatchObject({ development: 'ebola', members: { right: 3, wrong: 1, ignored: 0, unscored: 0 } })
    expect(strait!.foundedFrom).toEqual([
      { slug: 's1', as: 'entry of strait (other half)' },
      { slug: 'uganda', as: 'near miss of ebola' },
    ])
    expect(strait).toMatchObject({ development: 'strait', members: { right: 0, wrong: 0, ignored: 0, unscored: 2 } })
  })

  it("reads an overview mostly of a label key's must entries as that key's, counts its members as the joins bar does, and names the label key", () => {
    const [label] = LABEL_DEVELOPMENTS
    const LABEL = key(label!, [
      ['l1', 'must', 'turning_point', '2026-05-01'],
      ['l2', 'must', 'routine', '2026-05-02'],
    ])
    const members = ['l1', 'l2', 'e1', 'uganda']
    const d = diagnoseRun({
      keys: [EBOLA],
      others: [LABEL],
      run: 1,
      overviews: [{ id: 'o9', title: 'The declaration', charter, foundedFrom: ['l1', 'l2'], foundedOn: '2026-05-02', members }],
      traces: new Map(),
      roles: new Map(),
      replayed: new Set(members),
      neighbourLimit: 40,
    })
    expect(d.charters[0]).toMatchObject({
      development: label,
      members: { right: 0, wrong: 1, ignored: 0, unscored: 3 },
      foundedFrom: [
        { slug: 'l1', as: `entry of ${label} (label key)` },
        { slug: 'l2', as: `entry of ${label} (label key)` },
      ],
    })
    expect(d.missed.find(m => m.slug === 'e1')).toMatchObject({ cause: 'in another overview' })
  })

  it('sums the misses by development and cause over the runs', () => {
    const d = diagnose()
    const [ebola] = missesByDevelopment([d, d])
    expect(ebola).toMatchObject({ key: 'ebola', total: 14 })
    expect(ebola!.causes.get('model unsure')).toBe(2)
  })

  it('renders the diagnostics in the report, under the steps that read them', () => {
    const d = diagnose()
    const report = {
      half: 'judge' as const,
      repeat: 1,
      keys: ['ebola', 'cholera'],
      stories: 9,
      background: { keys: [], stories: 0 },
      merged: [],
      left: [],
      score: scoreLinking([EBOLA, CHOLERA], []),
      endEvents: [],
      signals: [],
      diagnostics: [d],
      unanswered: 2,
      errored: 0,
      costUsd: 0,
      perStoryUsd: 0,
    }
    const text = linkLines(report, ['link', 'found', 'role']).join('\n')
    expect(text).toContain('Calls not made: 2')
    expect(text).toContain('### Missed must entries')
    expect(text).toContain('- Run 2, e7 (ebola, 2026-05-07): **model unsure**: O1 0.30: unsure 0.40, unrelated')
    expect(text).toContain('| 2 | 3 | 1 | 0 | 1 | 1 |')
    expect(text).toContain('**Ebola in DRC**, standing for ebola; founded 2026-05-02 from e1 (must entry of ebola) and e2 (must entry of ebola)')
    expect(text).toContain('  - OUT: cholera')
    expect(linkLines(report, ['role']).join('\n')).not.toContain('### Missed must entries')
  })
})

describe('traceOf', () => {
  const story = (id: string) => ({
    id,
    title: id,
    label: '',
    summary: '',
    datePublished: new Date('2026-05-03T00:00:00Z'),
    date: '2026-05-03',
    issueId: null,
    facts: [],
  })
  const blank = { cause: { story: '', other: '' }, place: { story: '', other: '' }, end: { story: '', other: '' } }
  const answer: LinkAnswer = {
    candidates: [
      { id: 'O1', belongs: 'yes', ...blank, reportsEndEvent: false, scope: 'inside', centerMoved: false, signalQuote: '', confidence: 0.8 },
      { id: 'F1', belongs: 'no', ...blank, reportsEndEvent: false, scope: 'unrelated', centerMoved: false, signalQuote: '', confidence: 0.1 },
    ],
    role: 'routine',
    roleKind: null,
  }

  it("keeps each candidate shown with the model's answer and code's refusal, and the founding's reasons", () => {
    const result: LinkResult = {
      story: story('id-e3'),
      outcome: 'rejected',
      role: { role: 'routine', roleKind: null },
      join: null,
      heldBy: null,
      foundingBlockedBy: null,
      founding: {
        partner: story('id-e2'),
        outcome: 'disagreed',
        draft: null,
        answers: { draft: null, check: { a: { fits: 'yes', reason: 'ok' }, b: { fits: 'no', reason: 'one study' }, endEventConcrete: 'none' } },
        shared: blank,
        confidence: 0.5,
        costUsd: 0,
        model: null,
      },
      shown: { overviews: [{ ref: 'O1', id: 'o1', distance: 0.2 }], partners: [{ ref: 'F1', id: 'id-e2', distance: 0.3 }] },
      answer,
      proposed: 1,
      refusals: [{ id: 'O1', reason: 'no cause on both sides' }],
      signals: [],
      model: 'm',
      promptVersion: 'v',
      costUsd: 0,
    }
    const t = traceOf(result, 'rejected', { read: 5, near: 5, kept: 2 }, id => id.replace('id-', ''))
    expect(t).toMatchObject({
      slug: 'e3',
      outcome: 'rejected',
      called: true,
      founding: { partner: 'e2', outcome: 'disagreed', why: 'B does not fit: one study' },
    })
    expect(t.overviews).toEqual([{ ref: 'O1', id: 'o1', distance: 0.2, belongs: 'yes', confidence: 0.8, scope: 'inside', refusal: 'no cause on both sides' }])
    expect(t.partners[0]).toMatchObject({ id: 'e2', belongs: 'no', refusal: null })
  })
})

import { describe, expect, it } from 'vitest'
import type { CloseDeps } from '../../../services/overviewClose.js'
import type { ReviewDeps } from '../../../services/overviewReview.js'
import { standsFacts, type MemberFact, type StandsDeps } from '../../../services/overviewStands.js'
import type { LinkStory, Role } from '../../../services/overviewTypes.js'
import { runUpkeep } from '../../../services/overviewUpkeep.js'
import type { PoolFact, PoolSource } from '../../../services/researchPool.js'
import type { AnswerKey } from './keySchema.js'
import { createSandbox, type SandboxEntry, type SandboxOverview } from './overviewSandbox.js'
import { poolMemberFacts } from './passPool.js'
import { PLANTED_JOINS, plantedCase } from './review.js'
import { keyRole, standsFactFixtures } from './stands.js'
import { sandboxUpkeep } from './upkeepSandbox.js'

type Entry = AnswerKey['entries'][number]

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

const story = (id: string, date: string, over: Partial<LinkStory> = {}): LinkStory => ({
  id,
  title: `Title ${id}`,
  label: `Label ${id}`,
  summary: `Summary ${id}.`,
  datePublished: new Date(`${date}T08:00:00Z`),
  date,
  issueId: null,
  facts: [],
  ...over,
})

const source = (ref: string, over: Partial<PoolSource> = {}): PoolSource => ({
  id: `src-${ref}`,
  ref,
  origin: 'search',
  earlierStoryId: null,
  url: `https://example.org/${ref}`,
  outlet: 'Outlet',
  title: `Page ${ref}`,
  date: '2026-05-01',
  kind: 'news-report',
  country: 'DR Congo',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: 'pass-1',
  ...over,
})

const fact = (id: string | null, ref: string, sourceRef: string, statement: string): PoolFact => ({
  id,
  ref,
  sourceRef,
  reusedFromId: null,
  supportingSentence: `${statement} (as reported)`,
  passage: null,
  supportFound: true,
  statement,
  measures: '',
  slot: null,
  structured: {
    value: 120,
    valueHigh: null,
    unit: 'cases',
    approx: 'exact',
    provisional: false,
    counted: 'confirmed cases',
    place: 'North Kivu',
    asOf: '2026-05-01',
    credited: '',
    creditedKind: null,
    validity: 'fast',
    by: { model: 'm', promptVersion: 'v' },
  },
  extractedBy: { model: 'm', promptVersion: 'v' },
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: { model: 'm', promptVersion: 'v', passId: 'pass-1' },
  status: 'unreviewed',
  firstPassId: 'pass-1',
  drop: null,
})

describe('keyRole', () => {
  it("takes a turning point's kind when it is one of production's, and none for a routine entry", () => {
    expect(keyRole(entry('a', '2026-05-01', { role: 'turning_point', kind: 'spread' }))).toEqual({ role: 'turning_point', roleKind: 'spread' })
    expect(keyRole(entry('a', '2026-05-01', { role: 'turning_point', kind: 'surprise' }))).toEqual({ role: 'turning_point', roleKind: null })
    expect(keyRole(entry('a', '2026-05-01', { kind: 'spread' }))).toEqual({ role: 'routine', roleKind: null })
  })
})

describe('plantedCase', () => {
  const key: AnswerKey = {
    schemaVersion: 2,
    id: 'ebola',
    title: 'Ebola in eastern DR Congo',
    charter: { in: 'The outbreak.', out: ['Uganda'], endEvent: 'Declared over.' },
    closed: null,
    figures: [],
    entries: [
      entry('e1', '2026-05-01', { role: 'turning_point', kind: 'milestone' }),
      entry('e2', '2026-05-03'),
      entry('e3', '2026-05-05'),
      entry('e4', '2026-05-07'),
      entry('o1', '2026-05-08', { join: 'optional' }),
    ],
    nearMisses: ['n1', 'n2', 'n3'].map(slug => ({ slug, date: '2026-05-04', title: slug, why: 'same place' })),
    responses: [],
    notes: '',
  }
  const stories = new Map<string, LinkStory | null>([
    ...['e1', 'e2', 'e3', 'e4', 'o1'].map((s, i) => [s, story(`id-${s}`, `2026-05-0${i + 1}`)] as const),
    ['n1', story('id-n1', '2026-05-04')],
    ['n2', null],
    ['n3', story('id-n3', '2026-05-04')],
  ])

  it("plants near misses as joins, flips one must entry's role and empties OUT, and scores the other must entries as correct", () => {
    const p = plantedCase(key, stories)!
    expect(p.plantedJoins).toEqual(['planted:n1', 'planted:n3'].slice(0, PLANTED_JOINS))
    expect(p.plantedRole).toEqual({ entryId: 'key:e3', keyRole: { role: 'routine', roleKind: null } })
    expect(p.correct.map(c => c.entryId)).toEqual(['key:e1', 'key:e2', 'key:e4'])
    expect(p.review.charter).toEqual({ ...key.charter, out: [] })
    const flipped = p.review.entries.find(e => e.entryId === 'key:e3')!
    expect(flipped.role).toEqual({ role: 'turning_point', roleKind: 'milestone' })
    // The optional entry is neither planted nor scored, and the entries are shown in date order (e4 and the plants share a day)
    expect(p.review.entries.map(e => e.entryId)).toEqual(['key:e1', 'key:e2', 'key:e3', 'key:e4', 'planted:n1', 'planted:n3'])
  })

  it('plants nothing in a development with fewer than 3 must entries published here', () => {
    expect(plantedCase(key, new Map([...stories, ['e3', null], ['e4', null]]))).toBeNull()
  })
})

describe('poolMemberFacts', () => {
  it("gives a pass's page facts to the stands with an id each, never an earlier story's", () => {
    const pool = {
      sources: [source('S1'), source('E1', { origin: 'earlier', earlierStoryId: 'old' })],
      facts: [
        fact(null, 'S1F1', 'S1', 'Cases rose to 120.'),
        fact('row-2', 'S1F2', 'S1', 'Deaths rose.'),
        fact(null, 'E1F1', 'E1', 'Old.'),
        fact(null, 'S9F1', 'S9', 'No source.'),
      ],
    }
    const facts = poolMemberFacts('story-1', pool)
    expect(facts.map(f => [f.storyId, f.published, f.fact.id, f.source.ref])).toEqual([
      ['story-1', true, 'story-1:S1F1', 'S1'],
      ['story-1', true, 'row-2', 'S1'],
    ])
  })
})

describe('standsFactFixtures', () => {
  it("samples the kept lines with their cited facts' sentences as evidence, and says when fewer were kept", () => {
    const offered = standsFacts([{ storyId: 's', published: true, fact: fact('f1', 'S1F1', 'S1', 'Cases rose to 120.'), source: source('S1') }], '2026-05-02')
    const fixtures = standsFactFixtures(
      [
        { key: 'ebola', day: '2026-05-02', text: 'Cases stand at 120 (as of May 1).', facts: offered.map(o => o.fact) },
        { key: 'ebola', day: '2026-05-09', text: 'Second line.', facts: [] },
      ],
      3,
    )
    expect(fixtures.stories).toBe(1)
    expect(fixtures.facts.map(f => [f.key, f.statement, f.sentence, f.measures])).toEqual([
      ['stands:ebola:2026-05-02:1', 'Cases stand at 120 (as of May 1).', 'Cases rose to 120. (as reported)', 'confirmed cases'],
      ['stands:ebola:2026-05-09:2', 'Second line.', '', ''],
    ])
    expect(fixtures.shortfalls).toEqual(['2 of 3 lines: the stands step kept no more'])
  })
})

describe('the upkeep over the sandbox', () => {
  const routine: Role = { role: 'routine', roleKind: null }
  const sEntry = (s: LinkStory, n: number, reportsEndEvent = false): SandboxEntry => ({
    entryId: `entry-${n}`,
    storyId: s.id,
    title: s.title,
    date: s.date,
    datePublished: s.datePublished,
    role: routine,
    status: 'active',
    joinedAt: s.datePublished,
    reportsEndEvent,
    closeChecked: false,
  })

  it("runs production's upkeep on the sandbox: a closing begun, cancelled by the review that detaches its story, and a stands attempt recorded", async () => {
    const sandbox = createSandbox()
    const members = [
      story('a', '2026-05-01'),
      story('b', '2026-05-03'),
      story('c', '2026-05-05'),
      story('d', '2026-05-07', { title: 'The outbreak is declared over' }),
    ]
    for (const s of members) sandbox.stories.set(s.id, s)
    const overview: SandboxOverview = {
      id: 'o1',
      title: 'Ebola in eastern DR Congo',
      charter: { in: 'The outbreak.', out: [], endEvent: 'Declared over.' },
      scope: 'forming',
      status: 'open',
      closedReason: null,
      frozen: false,
      lastEntryAt: members[3]!.datePublished,
      closingSince: null,
      closingStoryId: null,
      closedAt: null,
      entriesAtLastReview: 0,
      reviewedAt: null,
      burstAt: null,
      closureReviewedFor: null,
      entries: members.map((s, i) => sEntry(s, i + 1, s.id === 'd')),
      foundedFrom: ['a', 'b'],
      stands: null,
      lastSignature: null,
    }
    sandbox.overviews.set(overview.id, overview)
    const now = new Date('2026-05-07T12:00:00Z')
    const io = sandboxUpkeep(
      sandbox,
      () => [] as MemberFact[],
      () => now,
    )
    const close: CloseDeps = {
      close: async () => ({ parsed: { happened: 'yes', quote: 'declared over', reason: 'It says so.' }, costUsd: 0.01, model: 'large' }),
      closeCheck: async () => ({ parsed: { happened: 'yes', reason: 'It says so.' }, costUsd: 0.01, model: 'large' }),
    }
    const review: ReviewDeps = {
      review: async input => ({
        parsed: {
          entries: input.entries.map((e, i) => ({ id: e.ref, belongs: i < 3 ? 'yes' : 'no', reason: 'Why.', role: 'routine', roleKind: null })),
          charter: overview.charter,
          title: '',
          clearFreeze: false,
        },
        costUsd: 0.02,
        model: 'large',
      }),
    }
    const stands: StandsDeps = {
      write: async () => {
        throw new Error('no stands are written from no facts')
      },
      check: async () => {
        throw new Error('no stands are checked from no facts')
      },
    }
    const tally = await runUpkeep({ ...io, close, review, stands }, { clock: members[3]!.datePublished, now, today: '2026-05-07' })
    expect(tally.errors).toEqual([])
    expect(tally).toMatchObject({ closingsChecked: 1, closingsBegun: 1, reviews: 1, standsRefreshes: 1, standsWritten: 0, failed: 0 })
    expect(overview.entries.map(e => e.status)).toEqual(['active', 'active', 'active', 'detached'])
    expect(overview).toMatchObject({ status: 'open', closingSince: null, scope: 'ongoing', entriesAtLastReview: 3, reviewedAt: now, stands: null })
    expect(overview.lastSignature).not.toBeNull()
    expect(Object.fromEntries(io.safeguards)).toEqual({ 'review detached an entry': 1, 'closing cancelled by its review': 1 })
  })

  it("applies each upkeep write by the lifecycle's rules and counts the safeguards that fired", async () => {
    const sandbox = createSandbox()
    const members = [story('a', '2026-05-01'), story('b', '2026-05-01'), story('c', '2026-05-02')]
    for (const s of members) sandbox.stories.set(s.id, s)
    const o: SandboxOverview = {
      id: 'o1',
      title: 'Old title',
      charter: { in: 'In.', out: [], endEvent: 'End.' },
      scope: 'forming',
      status: 'open',
      closedReason: null,
      frozen: false,
      lastEntryAt: members[2]!.datePublished,
      closingSince: null,
      closingStoryId: null,
      closedAt: null,
      entriesAtLastReview: 0,
      reviewedAt: null,
      burstAt: null,
      closureReviewedFor: null,
      entries: members.map((s, i) => ({ ...sEntry(s, i + 1), joinedAt: new Date('2026-05-02T10:00:00Z') })),
      foundedFrom: ['a', 'b'],
      stands: null,
      lastSignature: null,
    }
    sandbox.overviews.set(o.id, o)
    const now = new Date('2026-05-02T12:00:00Z')
    const io = sandboxUpkeep(
      sandbox,
      () => [],
      () => now,
    )
    const [state] = await io.states()
    // Two stories of one publication day joined within the night
    expect(state).toMatchObject({ id: 'o1', activeEntries: 3, burstJoins: 2, burstAt: null, closureReviewed: false, unpublished: [] })

    const closeCase = (await io.closings())[0]
    expect(closeCase).toBeUndefined()
    const c = { overviewId: 'o1', charter: o.charter, story: members[2]!, entries: [] }
    await io.applyClosing(c, { outcome: 'failed' } as never)
    expect(o.entries[2]!.closeChecked).toBe(false)
    await io.applyClosing(c, { outcome: 'disagreed' } as never)
    expect(o.entries[2]!.closeChecked).toBe(true)
    await io.applyClosing(c, { outcome: 'closing' } as never)
    expect(o).toMatchObject({ status: 'closing', closingSince: members[2]!.datePublished, closingStoryId: 'c' })

    await io.applyStatus(state!, [{ kind: 'status', from: 'closing', to: 'open', reason: 'closing_cancelled' }], now)
    expect(o).toMatchObject({ status: 'open', closingSince: null })
    await io.applyStatus(state!, [{ kind: 'status', from: 'open', to: 'quiet', reason: 'quiet' }], now)
    expect(o.status).toBe('quiet')
    await io.applyStatus(state!, [{ kind: 'status', from: 'quiet', to: 'closed', reason: 'faded' }], now)
    expect(o).toMatchObject({ status: 'closed', closedReason: 'faded', closedAt: now })
    // A move computed from another state is not applied
    await io.applyStatus(state!, [{ kind: 'scope', from: 'ongoing', to: 'single' }], now)
    expect(o.scope).toBe('forming')

    await io.applyBurst(state!)
    await io.applyBurst(state!)
    expect(o).toMatchObject({ frozen: true, burstAt: now })
    const review = await io.reviewCase('o1')
    expect(review).toMatchObject({ frozen: true, closingStoryId: null })
    expect(review!.entries.map(e => [e.entryId, e.label, e.locked])).toEqual([
      ['entry-1', 'Label a', false],
      ['entry-2', 'Label b', false],
      ['entry-3', 'Label c', false],
    ])
    expect(await io.reviewCase('gone')).toBeNull()

    const turning: Role = { role: 'turning_point', roleKind: 'spread' }
    await io.applyReview(
      review!,
      {
        trigger: 'burst',
        outcome: 'reviewed',
        actions: [
          { kind: 'relabel', entryId: 'entry-1', storyId: 'a', from: routine, to: turning },
          { kind: 'narrow', added: ['Uganda'], charter: { ...o.charter, out: ['Uganda'] } },
          { kind: 'retitle', from: 'Old title', to: 'New title' },
          { kind: 'unfreeze' },
        ],
        refusals: [{ what: 'charter', reason: 'rewrites IN' }],
        kept: 3,
        scope: 'ongoing',
        cancelsClosing: false,
      } as never,
      now,
    )
    expect(o).toMatchObject({ title: 'New title', frozen: false, scope: 'ongoing', burstAt: null, entriesAtLastReview: 3, reviewedAt: now })
    expect(o.charter.out).toEqual(['Uganda'])
    expect(o.entries[0]!.role).toEqual(turning)
    await io.applyReview(review!, { outcome: 'failed' } as never, new Date('2026-06-01T00:00:00Z'))
    expect(o.reviewedAt).toEqual(now)

    const [stands] = await io.standsCases()
    expect(stands).toMatchObject({ overviewId: 'o1', title: 'New title', members: [], lastSignature: null })
    await io.applyStands(stands!, { outcome: 'written', sentences: [{ text: 'S.', facts: ['f1'] }], doing: [] } as never, 'sig-1', '2026-05-02')
    expect(o).toMatchObject({ lastSignature: 'sig-1', stands: { sentences: [{ text: 'S.', facts: ['f1'] }], doing: [], asOf: '2026-05-02' } })
    await io.applyStands(stands!, { outcome: 'failed' } as never, null, '2026-05-03')
    expect(o.lastSignature).toBe('sig-1')
    await io.applyStands(stands!, { outcome: 'too_few_facts' } as never, 'sig-2', '2026-05-04')
    expect(o).toMatchObject({ lastSignature: 'sig-2', stands: null })
    expect(await io.auditPicks(now)).toEqual([])
    await io.applyAudit(review!, {} as never)

    expect(Object.fromEntries(io.safeguards)).toEqual({
      'closing refused (disagreed)': 1,
      'closing cancelled by a new entry': 1,
      'burst froze an overview': 1,
      'review relabeled a role': 1,
      'review narrowed the charter': 1,
      'review answers refused': 1,
    })
  })
})

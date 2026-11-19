import { describe, expect, it } from 'vitest'
import type { CloseDeps } from '../../../services/overviewClose.js'
import type { ReviewDeps } from '../../../services/overviewReview.js'
import { standsFacts, type MemberFact, type StandsDeps } from '../../../services/overviewStands.js'
import { newOverviewRow } from '../../../services/overviewChanges.js'
import type { Charter, LinkStory, Role } from '../../../services/overviewTypes.js'
import { runUpkeep } from '../../../services/overviewUpkeep.js'
import type { PoolFact, PoolSource } from '../../../services/researchPool.js'
import type { AnswerKey } from './keySchema.js'
import { createSandbox, type Sandbox, type SandboxEntry, type SandboxOverview } from './overviewSandbox.js'
import { checkpointStories, poolMemberFacts } from './passPool.js'
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

describe('checkpointStories', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`)
  const key = (id: string, entries: Entry[]): AnswerKey => ({
    schemaVersion: 1,
    id,
    title: id,
    charter: { in: 'In.', out: [], endEvent: 'End.' },
    closed: null,
    figures: [],
    entries,
    nearMisses: [],
    responses: [],
    notes: '',
  })

  it('takes the newest must entries on or before each checkpoint, once each, in key order', () => {
    // Checkpoints at e4, e8 and e12; e1, e5 and e9 are read by none and never researched
    const k = key(
      'ebola',
      days(12).map((d, i) => entry(`e${i + 1}`, d)),
    )
    expect(checkpointStories(k)).toEqual(['e2', 'e3', 'e4', 'e6', 'e7', 'e8', 'e10', 'e11', 'e12'])
  })

  it("counts a story of the checkpoint's day after the checkpoint's own entry, and never an optional entry", () => {
    const k = key('ebola', [
      entry('e1', '2026-05-01'),
      entry('e2', '2026-05-02'),
      entry('e3', '2026-05-03'),
      entry('e4', '2026-05-04'),
      entry('e5', '2026-05-04'),
      entry('o1', '2026-05-04', { join: 'optional' }),
      entry('e6', '2026-05-08'),
    ])
    // Checkpoints on 2026-05-02, 2026-05-04 (e4's day, which e5 shares) and 2026-05-08
    expect(checkpointStories(k, 1)).toEqual(['e2', 'e5', 'e6'])
    expect(checkpointStories(k, 2)).toEqual(['e1', 'e2', 'e4', 'e5', 'e6'])
  })

  it('takes every must entry of a development too small to leave any out', () => {
    const k = key(
      'pabs',
      days(4).map((d, i) => entry(`p${i + 1}`, d)),
    )
    expect(checkpointStories(k)).toEqual(['p1', 'p2', 'p3', 'p4'])
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
  /** An overview forming from these stories, as production's row and entries hold it. */
  const seed = (
    sandbox: Sandbox,
    title: string,
    charter: Charter,
    members: LinkStory[],
    joinedAt: (s: LinkStory) => Date = s => s.datePublished,
  ): SandboxOverview => {
    for (const s of members) sandbox.stories.set(s.id, s)
    const id = 'o1'
    const o: SandboxOverview = {
      ...newOverviewRow({ id, title, issueId: null, charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: members[0]!.datePublished }),
      scope: 'forming',
      lastEntryAt: members.at(-1)!.datePublished,
      entries: members.map((s, i): SandboxEntry => ({
        id: `entry-${i + 1}`,
        overviewId: id,
        storyId: s.id,
        joinedBy: 'pipeline',
        joinedAt: joinedAt(s),
        status: 'active',
        detachedBy: null,
        detachReason: null,
        detachedAt: null,
        locked: false,
        role: 'routine',
        roleKind: null,
        published: true,
        datePublished: s.datePublished,
        title: s.title,
        date: s.date,
      })),
      foundedFrom: [members[0]!.id, members[1]!.id],
      stands: null,
      lastSignature: null,
      lastMarker: null,
      lastUntil: null,
    }
    sandbox.overviews.set(id, o)
    return o
  }
  /** A join's link decision flagging its story as reporting the end event. */
  const flag = (sandbox: Sandbox, storyId: string) =>
    sandbox.decisions.push({
      id: `link-${storyId}`,
      kind: 'link',
      outcome: 'joined',
      overviewId: 'o1',
      storyId,
      inputs: { reportsEndEvent: true },
      answer: null,
      model: null,
      promptVersion: null,
      confidence: null,
      costUsd: 0,
      actor: 'pipeline',
      undone: false,
    })

  it("runs production's upkeep on the sandbox: a closing begun, cancelled by the review that detaches its story, and a stands attempt recorded", async () => {
    const sandbox = createSandbox()
    const members = [
      story('a', '2026-05-01'),
      story('b', '2026-05-03'),
      story('c', '2026-05-05'),
      story('d', '2026-05-07', { title: 'The outbreak is declared over' }),
    ]
    const overview = seed(sandbox, 'Ebola in eastern DR Congo', { in: 'The outbreak.', out: [], endEvent: 'Declared over.' }, members)
    flag(sandbox, 'd')
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
    expect(overview).toMatchObject({
      status: 'open',
      closingSince: null,
      closingStoryId: null,
      scope: 'ongoing',
      entriesAtLastReview: 3,
      reviewedAt: now,
      stands: null,
    })
    // Public now, so given its slug, and its last entry follows the entries left
    expect([overview.slug, overview.lastEntryAt]).toEqual(['ebola-in-eastern-dr-congo', members[2]!.datePublished])
    expect(overview.lastSignature).not.toBeNull()
    expect(Object.fromEntries(io.safeguards())).toEqual({ 'review detached an entry': 1, 'closing cancelled by its review': 1 })
    expect(sandbox.decisions.map(d => `${d.kind}:${d.outcome}`)).toEqual(['link:joined', 'close:closing', 'review:reviewed', 'status:open'])
  })

  it("applies each upkeep write by the lifecycle's rules and counts the safeguards that fired", async () => {
    const sandbox = createSandbox()
    // a was published two days before the run, b and c within its night
    const members = [story('a', '2026-05-01'), story('b', '2026-05-02'), story('c', '2026-05-02')]
    const o = seed(sandbox, 'Old title', { in: 'In.', out: [], endEvent: 'End.' }, members, () => new Date('2026-05-02T10:00:00Z'))
    const now = new Date('2026-05-02T12:00:00Z')
    const io = sandboxUpkeep(
      sandbox,
      () => [],
      () => now,
    )
    const [state] = await io.states()
    // Only the joins of stories published within the night count toward a burst
    expect(state).toMatchObject({ id: 'o1', activeEntries: 3, burstJoins: 2, burstAt: null, closureReviewed: false, unpublished: [] })

    expect(await io.closings()).toEqual([])
    flag(sandbox, 'c')
    expect((await io.closings()).map(x => x.story.id)).toEqual(['c'])
    const c = { overviewId: 'o1', charter: o.charter, story: members[2]!, entries: [] }
    await io.applyClosing(c, { outcome: 'failed' } as never)
    expect((await io.closings()).map(x => x.story.id)).toEqual(['c'])
    await io.applyClosing(c, { outcome: 'disagreed' } as never)
    expect(await io.closings()).toEqual([])
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
    expect(o).toMatchObject({ frozen: true, frozenBy: 'burst', frozenAt: now, joinsCountedFrom: now })
    const review = await io.reviewCase('o1')
    expect(review).toMatchObject({ frozen: true, closingStoryId: null })
    expect(review!.entries.map(e => [e.entryId, e.label, e.locked])).toEqual([
      ['entry-1', 'Label a', false],
      ['entry-2', 'Label b', false],
      ['entry-3', 'Label c', false],
    ])
    expect(await io.reviewCase('gone')).toBeNull()

    const turning: Role = { role: 'turning_point', roleKind: 'spread' }
    await io.applyReview(review!, {
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
      brake: null,
    } as never)
    expect(o).toMatchObject({ title: 'New title', frozen: false, frozenBy: null, scope: 'ongoing', entriesAtLastReview: 3, reviewedAt: now, slug: 'new-title' })
    expect(o.charter.out).toEqual(['Uganda'])
    expect([o.entries[0]!.role, o.entries[0]!.roleKind]).toEqual(['turning_point', 'spread'])
    await io.applyReview(review!, { outcome: 'failed' } as never)
    expect(o.reviewedAt).toEqual(now)

    const [stands] = await io.standsCases('2026-05-02')
    expect(stands).toMatchObject({ overviewId: 'o1', title: 'New title', members: [], lastSignature: null, unchanged: false })
    const record = (signature: string | null) => ({ signature, marker: stands!.marker, until: null })
    await io.applyStands(stands!, { outcome: 'written', sentences: [{ text: 'S.', facts: ['f1'] }], doing: [] } as never, record('sig-1'), '2026-05-02')
    expect(o).toMatchObject({ lastSignature: 'sig-1', stands: { sentences: [{ text: 'S.', facts: ['f1'] }], doing: [], asOf: '2026-05-02' } })
    // Nothing it is made of changed: the next run reads no facts for it
    expect((await io.standsCases('2026-05-03'))[0]!.unchanged).toBe(true)
    await io.applyStands(stands!, { outcome: 'failed' } as never, record(null), '2026-05-03')
    expect(o.lastSignature).toBe('sig-1')
    await io.applyStands(stands!, { outcome: 'too_few_facts' } as never, record('sig-2'), '2026-05-04')
    expect(o).toMatchObject({ lastSignature: 'sig-2', stands: null })
    expect(await io.auditPicks(now)).toEqual([])
    await io.applyAudit(review!, {} as never)

    expect(Object.fromEntries(io.safeguards())).toEqual({
      'closing refused (disagreed)': 1,
      'closing cancelled by a new entry': 1,
      'burst froze an overview': 1,
      'review relabeled a role': 1,
      'review narrowed the charter': 1,
      'review answers refused': 1,
    })
  })
})

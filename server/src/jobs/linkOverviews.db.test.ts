/**
 * The overview step end to end, and the eval sandbox's parity with it (`.context/model-eval.md`,
 * "Overview evals"): scripted nights of stories run through the job (`runLinkOverviewsJob`: the real
 * queue, reads and lifecycle writes) with scripted model calls, and through the sandbox
 * (`overviewSandbox.ts`, `upkeepSandbox.ts`, as the `replay` step drives it: the same night,
 * `runNight`, over the stories the sandbox owes by its own decisions) with the same calls and
 * production's neighbours; after every run both hold the same overviews, entries and decisions, each
 * decision with the same change set. The nights cover a founding, joins, the first review making it
 * public, a story reporting the end event joined and then unpublished (its entry detached, the last
 * entry recomputed), a burst frozen and cleared by its review and not counted
 * again an hour later, a review detaching the newest entry, a review whose overview is retitled
 * during its call, recorded stale and asked again, and an automated re-center fired by two stories
 * linked as wider than the charter, joining both and not tried again without a new signal.
 */
import { beforeEach, expect, it, vi } from 'vitest'
import prisma from '../lib/prisma.js'
import { utcDay } from '../lib/days.js'
import type { Sandbox } from '../scripts/eval/overviews/overviewSandbox.js'
import type { OverviewCalls } from '../services/overviewSteps.js'
import { createFeed, createIssue, createStory, describeDb, setEmbedding, useTestDatabase } from '../test/db/harness.js'

// One link call in flight at a time, in the job and the sandbox alike. With more, whether a result goes
// stale (its partner joined meanwhile) depends on whether its reads land before or after the write
// before it, which memory reaches sooner than the tables: both write by the same rules and end alike,
// but in another order, so their change sets differ
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  Object.defineProperty(actual.config.overviews, 'concurrency', { value: 1 })
  return actual
})
vi.mock('../services/overviewGate.js', () => ({ OVERVIEW_EVAL_GATE: null }))
vi.mock('../services/researchPassGate.js', () => ({ PASS_EVAL_GATE: null }))
const notices = vi.hoisted(() => [] as { title: string; dedupeKey?: string; link?: string }[])
vi.mock('../lib/notify.js', () => ({
  notify: vi.fn(async (n: { title: string; dedupeKey?: string; link?: string }) => {
    notices.push(n)
  }),
}))

const { config } = await import('../config.js')
const { runLinkOverviewsJob } = await import('./linkOverviews.js')
const { nearestPublished } = await import('../services/overviewCandidates.js')
const { linkStories } = await import('../services/overviewInput.js')
const { runNight } = await import('../services/overviewNight.js')
const { owedSlices } = await import('../services/overviewOwed.js')
const { forgetOverviewStep } = await import('../services/overviewQueue.js')
const { createSandbox, owedOf } = await import('../scripts/eval/overviews/overviewSandbox.js')
const { sandboxUpkeep } = await import('../scripts/eval/overviews/upkeepSandbox.js')

const call = <T>(parsed: T, model = 'scripted') => Promise.resolve({ parsed, costUsd: 0.001, model })
const both = (s: string) => ({ story: s, other: s })
const belongs = (title: string) => title.includes('Ebola') && title.includes('Ituri')
const offTopic = (title: string) => title.includes('trial')
/** A story of the wider development: the regional response, outside the charter's IN. */
const wider = (title: string) => title.includes('eastern Congo')
/** What happens to the overview while a review's call runs, one per review call: the sandbox's review is asked first, then the job's. */
const duringReview: (() => unknown)[] = []

/** The model as the scenario scripts it: Ebola-in-Ituri stories belong together, a vaccine trial does not, "declares … over" reports the end event. */
const calls: OverviewCalls = {
  link: {
    link: ({ story, overviews, partners }) =>
      call({
        candidates: [...overviews, ...partners].map(c => ({
          id: c.ref,
          belongs: belongs(story.title) && belongs(c.title) ? ('yes' as const) : ('no' as const),
          cause: both('Ebola'),
          place: both('Ituri'),
          end: both('Ebola'),
          reportsEndEvent: story.title.includes('declares'),
          scope:
            belongs(story.title) && belongs(c.title)
              ? ('inside' as const)
              : wider(story.title) && c.ref.startsWith('O')
                ? ('wider' as const)
                : ('unrelated' as const),
          centerMoved: false,
          signalQuote: wider(story.title) && c.ref.startsWith('O') ? story.title : '',
          confidence: 0.9,
        })),
        role: 'routine' as const,
        roleKind: null,
      }),
    found: () =>
      call({
        title: 'Ebola in Ituri',
        charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares the outbreak over' },
        roles: { a: { role: 'turning_point' as const, roleKind: 'spread' }, b: { role: 'routine' as const, roleKind: null } },
      }),
    foundCheck: () =>
      call({ a: { fits: 'yes' as const, reason: 'It does.' }, b: { fits: 'yes' as const, reason: 'It does.' }, endEventConcrete: 'yes' as const }),
  },
  review: {
    review: async (input, { audit }) => {
      if (!audit) await duringReview.shift()?.()
      return call({
        entries: input.entries.map(e => ({
          id: e.ref,
          belongs: offTopic(e.title) ? ('no' as const) : ('yes' as const),
          reason: 'From what it reports.',
          role: e.role.role,
          roleKind: e.role.roleKind,
        })),
        charter: input.charter,
        title: '',
        clearFreeze: input.frozen && input.entries.every(e => !offTopic(e.title)),
      })
    },
  },
  // No member has pool facts: every refresh has too few, and neither call is made
  stands: {
    write: () => call({ sentences: [], doing: [] }),
    check: () => call({ items: [] }),
  },
  // The draft widens to the regional development, keeping every entry and taking in its stories but the trial; the blind check agrees
  recenter: {
    draft: ({ charter, entries, stories }) =>
      call({
        decision: 'recenter' as const,
        title: 'Ebola in eastern DR Congo',
        charter: {
          in: 'The Ebola outbreak in eastern DR Congo and the regional response.',
          out: [...charter.out, 'Cholera in eastern DR Congo'],
          endEvent: charter.endEvent ?? '',
        },
        entries: entries.map(e => ({ id: e.ref, belongs: 'yes' as const })),
        stories: stories.map(s => ({ id: s.ref, belongs: offTopic(s.title) ? ('no' as const) : ('yes' as const), role: 'routine' as const, roleKind: null })),
        reason: 'The response spans the region.',
      }),
    check: ({ entries, stories }) =>
      call({
        entries: entries.map(e => ({ id: e.ref, belongs: 'yes' as const, reason: 'It does.' })),
        stories: stories.map(s => ({ id: s.ref, belongs: offTopic(s.title) ? ('no' as const) : ('yes' as const), reason: 'It does.' })),
        endEventConcrete: 'yes' as const,
        neighbours: [],
      }),
  },
}

const HOUR = 3_600_000
const at = (day: number, hour: number) => new Date(Date.UTC(2026, 5, day, hour))

const OVERVIEW_KEYS = [
  'title',
  'slug',
  'scope',
  'status',
  'closedAt',
  'closedReason',
  'frozen',
  'frozenBy',
  'frozenAt',
  'hidden',
  'charter',
  'entriesAtLastReview',
  'reviewedAt',
  'reopenedAt',
  'joinsCountedFrom',
  'lockedOut',
  'lastEntryAt',
  'foundedAt',
  'charterModel',
  'charterPromptVersion',
  'recenteredAt',
  'recenteredBy',
  'recenterUndoneAt',
  'recenterTriedAt',
  'automatedRecenters',
] as const
const ENTRY_KEYS = ['status', 'detachedBy', 'detachReason', 'detachedAt', 'locked', 'role', 'roleKind', 'joinedBy', 'joinedAt'] as const

type View = Record<string, unknown>

describeDb('the overview step, end to end and against the eval sandbox', () => {
  useTestDatabase()

  beforeEach(async () => {
    notices.length = 0
    forgetOverviewStep()
    await prisma.jobRun.create({ data: { jobName: 'link_overviews', cronExpression: '30 1 * * *', enabled: true } })
  })

  it('leaves the tables and the sandbox alike after every run, and does what each night asks', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const names = new Map<string, string>()
    const name = (id: string | null) => (id === null ? null : (names.get(id) ?? id))
    const story = async (label: string, title: string, published: Date, axis = 0) => {
      const s = await createStory({ feedId: feed.id, issueId: issue.id, status: 'published', title, summary: `${title}.`, datePublished: published })
      await setEmbedding(s.id, axis)
      names.set(s.id, label)
      return s
    }

    const sandbox = createSandbox()
    let clock = new Date(0)
    const upkeep = sandboxUpkeep(
      sandbox,
      () => [],
      () => clock,
      (id, asOf) => nearestPublished(prisma, id, asOf),
    )
    const { link: linkCalls, ...upkeepCalls } = calls

    /** One run at `now`: the night through the sandbox as the replay runs it (the stories it owes by its own decisions), then through the job. */
    async function run(now: Date) {
      clock = now
      sandbox.setClock(now)
      const published = await prisma.story.findMany({ where: { status: 'published', datePublished: { not: null } }, select: { id: true, datePublished: true } })
      await runNight(
        {
          owed: async () =>
            owedSlices(
              owedOf(
                sandbox,
                published.map(s => ({ id: s.id, datePublished: s.datePublished! })),
              ),
              now,
            ),
          stories: ids => linkStories(prisma, ids),
          link: {
            neighbours: s => nearestPublished(prisma, s.id, s.datePublished),
            memberships: sandbox.memberships,
            overviews: sandbox.candidateOverviews,
            stories: ids => linkStories(prisma, ids),
            ...linkCalls,
          },
          apply: sandbox.apply,
          upkeep: { ...upkeep, ...upkeepCalls },
        },
        { now, today: utcDay(now) },
        { concurrency: config.overviews.concurrency, keepGoing: async () => true },
      )
      await runLinkOverviewsJob(now, calls)
      const [db, sb] = [await tablesView(), sandboxView(sandbox)]
      expect(db).toEqual(sb)
      return db
    }

    const pick = (row: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, row[k]]))
    const entriesView = (entries: (Record<string, unknown> & { storyId: string | null })[]) =>
      Object.fromEntries(entries.map(e => [name(e.storyId), pick(e, ENTRY_KEYS)]).sort(([a], [b]) => String(a).localeCompare(String(b))))
    const overviewView = (o: Record<string, unknown>, entries: (Record<string, unknown> & { storyId: string | null })[]) => ({
      ...pick(o, OVERVIEW_KEYS),
      entries: entriesView(entries),
    })
    /**
     * A decision's change set as both keep it, its rows named rather than by id (an entry by its story,
     * the one overview as `overview`) and its dates as JSON writes them.
     */
    type StoredSet = { changes?: { table: string; id: string; before: View; after: View }[]; created?: { table: string; id: string }[] }
    const changeSetView = (inputs: unknown, storyOf: ReadonlyMap<string, string | null>) => {
      const { changes = [], created = [] } = JSON.parse(JSON.stringify(inputs ?? {})) as StoredSet
      const row = (table: string, id: string) => (table === 'entry' ? `entry:${name(storyOf.get(id) ?? null)}` : 'overview')
      return {
        changes: changes.map(c => ({ table: c.table, row: row(c.table, c.id), before: c.before, after: c.after })),
        created: created.map(c => row(c.table, c.id)),
      }
    }
    /** Sorting by JSON with keys sorted: jsonb hands objects back in its own key order. */
    const sortedJson = (v: unknown) =>
      JSON.stringify(v, (_k, x: unknown) =>
        x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as View).sort(([a], [b]) => a.localeCompare(b))) : x,
      )
    /** Decisions as `kind:outcome:story`, undone ones marked, each with its change set, sorted; the monthly audit and the stands refreshes, which the sandbox does not keep as decisions, left out. */
    const decisionsView = (
      ds: { kind: string; outcome: string; storyId: string | null; undone: boolean; inputs: unknown }[],
      storyOf: ReadonlyMap<string, string | null>,
    ) =>
      ds
        .filter(d => d.kind !== 'stands' && !d.outcome.startsWith('audit'))
        .map(d => ({ decision: `${d.kind}:${d.outcome}:${name(d.storyId) ?? '-'}${d.undone ? ':undone' : ''}`, ...changeSetView(d.inputs, storyOf) }))
        .sort((a, b) => sortedJson(a).localeCompare(sortedJson(b)))
    const storiesOf = (entries: { id: string; storyId: string | null }[]) => new Map(entries.map(e => [e.id, e.storyId]))

    async function tablesView(): Promise<View> {
      const overviews = await prisma.overview.findMany({ include: { entries: true } })
      const decisions = await prisma.overviewDecision.findMany()
      return {
        overviews: overviews.map(o => overviewView(o as unknown as Record<string, unknown>, o.entries)),
        decisions: decisionsView(
          decisions.map(d => ({ ...d, undone: d.undoneAt !== null })),
          storiesOf(overviews.flatMap(o => o.entries)),
        ),
      }
    }
    function sandboxView(sb: Sandbox): View {
      return {
        overviews: [...sb.overviews.values()].map(o => overviewView(o as unknown as Record<string, unknown>, o.entries)),
        decisions: decisionsView(sb.decisions, storiesOf([...sb.overviews.values()].flatMap(o => o.entries))),
      }
    }
    type OverviewView = Record<string, unknown> & { entries: Record<string, Record<string, unknown>> }
    const only = (v: View) => {
      const list = v.overviews as OverviewView[]
      expect(list).toHaveLength(1)
      return list[0]!
    }
    const active = (o: OverviewView) =>
      Object.entries(o.entries)
        .filter(([, e]) => e.status === 'active')
        .map(([n]) => n)

    // Night 1: A has no neighbour before it and stays alone; B founds the overview with it
    const a = await story('A', 'Ebola cases rise in Ituri', at(1, 8))
    await story('B', 'Ebola reaches a second town in Ituri', at(1, 10))
    let o = only(await run(at(2, 2)))
    expect(o).toMatchObject({ scope: 'forming', status: 'open', slug: null, foundedAt: a.datePublished })
    expect(active(o)).toEqual(['A', 'B'])

    // Night 2: C joins; at three entries the review makes it public; X, far from everything, stays alone
    const c = await story('C', 'Ebola clinics open across Ituri', at(2, 9))
    await story('X', 'A bridge opens in Lisbon', at(2, 11), 5)
    o = only(await run(at(3, 2)))
    expect(o).toMatchObject({ scope: 'ongoing', slug: 'ebola-in-ituri', entriesAtLastReview: 3, reviewedAt: at(3, 2) })
    expect(await prisma.overviewDecision.count({ where: { kind: 'review', outcome: 'audited' } })).toBe(1)

    // Night 3: D, which reports the end event, joins
    const d = await story('D', 'The ministry declares the Ebola outbreak in Ituri over', at(3, 9))
    o = only(await run(at(4, 2)))
    expect(o).toMatchObject({ lastEntryAt: d.datePublished })

    // Night 4: D is unpublished: its entry leaves, the last entry is C's again
    await prisma.story.update({ where: { id: d.id }, data: { status: 'rejected' } })
    for (const ov of sandbox.overviews.values()) for (const e of ov.entries) if (e.storyId === d.id) e.published = false
    o = only(await run(at(5, 2)))
    expect(o).toMatchObject({ status: 'open', lastEntryAt: c.datePublished })
    expect(o.entries.D).toMatchObject({ status: 'detached' })
    expect(active(o)).toEqual(['A', 'B', 'C'])

    // Night 5: six stories join in one night: the burst freezes it, its review clears the freeze, and the owner is told
    for (let i = 1; i <= 6; i++) await story(`E${i}`, `Ebola update ${i} from Ituri`, at(5, 2 + i))
    o = only(await run(at(6, 2)))
    expect(o).toMatchObject({ frozen: false, frozenBy: null, joinsCountedFrom: at(6, 2), entriesAtLastReview: 9 })
    const id = (await prisma.overview.findFirstOrThrow()).id
    expect(await prisma.overviewDecision.count({ where: { kind: 'status', outcome: 'frozen' } })).toBe(1)
    expect(notices.filter(n => n.dedupeKey === `overview-frozen:${id}`)).toEqual([
      expect.objectContaining({ title: expect.stringContaining('6 stories joined "Ebola in Ituri" in a day'), link: `/admin/overviews/${id}` }),
    ])

    // An hour later, the same night's joins are not counted again: nothing freezes
    notices.length = 0
    o = only(await run(new Date(at(6, 2).getTime() + HOUR)))
    expect(o.frozen).toBe(false)
    expect(await prisma.overviewDecision.count({ where: { kind: 'status', outcome: 'frozen' } })).toBe(1)
    expect(notices).toEqual([])

    // Night 6: three more join; at twelve the review detaches the newest, off topic, and the last entry is the one before it
    await story('E7', 'Ebola update 7 from Ituri', at(7, 5))
    const e8 = await story('E8', 'Ebola update 8 from Ituri', at(7, 6))
    await story('E9', 'Ebola vaccine trial results from Ituri', at(7, 7))
    o = only(await run(at(8, 2)))
    expect(o.entries.E9).toMatchObject({ status: 'detached', detachedBy: 'review' })
    expect(o).toMatchObject({ lastEntryAt: e8.datePublished, entriesAtLastReview: 11 })
    expect(notices).toEqual([])

    // Night 7: E10 makes twelve and a review is due, but the overview is retitled while its call runs: it is recorded stale and applies nothing
    await story('E10', 'Ebola update 10 from Ituri', at(8, 9))
    const retitled = 'Ebola in Ituri and North Kivu'
    duringReview.push(
      () => {
        for (const ov of sandbox.overviews.values()) ov.title = retitled
      },
      () => prisma.overview.updateMany({ data: { title: retitled } }),
    )
    o = only(await run(at(9, 2)))
    expect(duringReview).toEqual([])
    expect(o).toMatchObject({ title: retitled, entriesAtLastReview: 11, reviewedAt: at(8, 2) })
    expect(await prisma.overviewDecision.count({ where: { kind: 'review', outcome: 'stale' } })).toBe(1)

    // An hour later the review is asked again on the overview as it stands, and the title stays
    const later = new Date(at(9, 2).getTime() + HOUR)
    o = only(await run(later))
    expect(o).toMatchObject({ title: retitled, entriesAtLastReview: 12, reviewedAt: later })

    // Night 8: two stories of the regional response are turned away as wider than the charter: the signal fires, both calls agree,
    // and the re-center widens the charter, joins both and leaves the trial the review detached out; the owner is told
    notices.length = 0
    await story('W1', 'Ebola response funding reaches eastern Congo', at(9, 8))
    await story('W2', 'Ebola vaccination teams spread across eastern Congo', at(9, 9))
    o = only(await run(at(10, 2)))
    expect(o).toMatchObject({
      title: 'Ebola in eastern DR Congo',
      automatedRecenters: 1,
      recenteredBy: 'recenter',
      recenterTriedAt: at(10, 2),
      charter: { in: 'The Ebola outbreak in eastern DR Congo and the regional response.', out: ['Ebola in Uganda', 'Cholera in eastern DR Congo'] },
      slug: 'ebola-in-ituri',
    })
    expect(o.entries.W1).toMatchObject({ status: 'active', joinedBy: 'recenter' })
    expect(o.entries.W2).toMatchObject({ status: 'active', joinedBy: 'recenter' })
    expect(o.entries.E9).toMatchObject({ status: 'detached', detachedBy: 'review' })
    expect(await prisma.overviewDecision.count({ where: { kind: 'recenter', outcome: 'recentered' } })).toBe(1)
    expect(notices.filter(n => n.dedupeKey === `overview-recentered:${id}`)).toHaveLength(1)

    // An hour later no signal came since the attempt: nothing is tried again
    expect(only(await run(new Date(at(10, 2).getTime() + HOUR)))).toMatchObject({ automatedRecenters: 1, recenterTriedAt: at(10, 2) })
    expect(await prisma.overviewDecision.count({ where: { kind: 'recenter' } })).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { joinResult, linkResult, linkStory, reviewCaseOf } from '../test/db/overviewFixtures.js'
import { applied, newOverviewRow, settle, type EntryRow, type OverviewRow, type Rows } from './overviewChanges.js'
import { planAlone, planBurst, planClosing, planConflict, planJoin, planRecenter, planReview, planStatus } from './overviewPlans.js'
import type { OfferedStory, RecenterCase, RecenterResult } from './overviewRecenter.js'
import type { ReviewResult } from './overviewReview.js'

const NOW = new Date('2026-11-18T03:00:00Z')
let n = 0
const ctx = { now: NOW, newId: () => `id-${++n}` }
const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }
const day = (d: number) => new Date(Date.UTC(2026, 10, d, 8))

const overview = (over: Partial<OverviewRow> = {}): OverviewRow => ({
  ...newOverviewRow({ id: 'o1', title: 'Ebola in Ituri', issueId: null, charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: day(1) }),
  scope: 'forming',
  lastEntryAt: day(3),
  ...over,
})
const entry = (i: number, over: Partial<EntryRow> = {}): EntryRow => ({
  id: `e${i}`,
  overviewId: 'o1',
  storyId: `s${i}`,
  joinedBy: 'pipeline',
  joinedAt: day(i),
  status: 'active',
  detachedBy: null,
  detachReason: null,
  detachedAt: null,
  locked: false,
  role: 'routine',
  roleKind: null,
  published: true,
  datePublished: day(i),
  ...over,
})
const rows = (over: Partial<OverviewRow> = {}, entries = [entry(1), entry(2), entry(3)]): Rows => ({ overview: overview(over), entries })
const after = (r: Rows, plans: ReturnType<typeof planStatus>) => plans.reduce((at, p) => applied(at, p), r)

describe('planJoin', () => {
  const story = linkStory({ id: 's9', datePublished: day(9) })

  it('joins an active entry and leaves the status to the status machine: a quiet overview is not reopened by the join itself', () => {
    const r = rows({ status: 'quiet' })
    const { plan, outcome } = planJoin(r.overview, joinResult(story, 'o1'), ctx)
    expect(outcome).toBe('joined')
    const done = applied(r, settle(r, plan))
    expect(done.overview).toMatchObject({ status: 'quiet', lastEntryAt: day(9), scope: 'forming' })
    expect(done.entries.at(-1)).toMatchObject({ storyId: 's9', status: 'active', joinedAt: NOW, locked: false })
  })

  it('is a conflict for an overview gone or closed (but faded), and held by a frozen one, with no entry', () => {
    const result = joinResult(story, 'o1')
    expect(planJoin(null, result, ctx).outcome).toBe('conflict')
    expect(planJoin(overview({ status: 'closed', closedReason: 'end_event' }), result, ctx).outcome).toBe('conflict')
    expect(planJoin(overview({ status: 'closed', closedReason: 'faded' }), result, ctx).outcome).toBe('joined')
    const held = planJoin(overview({ frozen: true, frozenBy: 'editor' }), result, ctx)
    expect(held.outcome).toBe('held')
    expect(held.plan.newEntries).toEqual([])
  })

  it('keeps the end-event flag only for an overview that names an end event, so one with none never starts a closing', () => {
    const flagged = joinResult(story, 'o1', true)
    expect(planJoin(overview(), flagged, ctx).plan.decision.inputs).toMatchObject({ reportsEndEvent: true })
    expect(planJoin(overview({ charter: { ...charter, endEvent: null } }), flagged, ctx).plan.decision.inputs).toMatchObject({ reportsEndEvent: false })
  })
})

describe('planRecenter', () => {
  const wider = { in: 'The Ebola outbreak in Ituri and its regional response.', out: ['Ebola in Uganda', 'Cholera in Ituri'], endEvent: null }
  const at = () =>
    rows({ scope: 'ongoing', status: 'open', slug: 'ebola-in-ituri' }, [
      entry(1),
      entry(2),
      entry(3),
      entry(4),
      entry(7, { status: 'detached', detachedBy: 'review', detachReason: 'review', detachedAt: day(8) }),
    ])
  const caseOf = (r: Rows): RecenterCase => ({
    ...reviewCaseOf(r),
    lockedOut: r.overview.lockedOut,
    status: r.overview.status,
    automatedRecenters: r.overview.automatedRecenters,
    anchor: { founding: ['e1', 'e2'], standIns: false, turningPoints: [] },
    stories: [],
    neighbours: [],
    fired: { wider: 2, centerMoved: 0 },
  })
  /** The stories as they are when the re-center is written: those active in an overview, those published (every story by default). */
  const storiesNow = (active: string[] = [], published: string[] = ['s7', 's8', 's9']) => ({ active: new Set(active), published: new Set(published) })
  const offered = (storyId: string): OfferedStory => ({
    storyId,
    title: storyId,
    label: 'Label',
    summary: 'Summary.',
    date: '2026-11-09',
    datePublished: day(9),
    entryId: null,
    quotes: [storyId],
  })
  const result = (over: Partial<RecenterResult> = {}): RecenterResult => ({
    outcome: 'recentered',
    rule: null,
    refusals: [],
    title: 'Ebola in Ituri and the region',
    charter: wider,
    outAdded: ['Cholera in Ituri'],
    detaches: [{ entryId: 'e4', storyId: 's4' }],
    joins: [
      { storyId: 's7', entryId: 'e7', datePublished: day(7), role: { role: 'turning_point', roleKind: 'response' } },
      { storyId: 's9', entryId: null, datePublished: day(9), role: { role: 'routine', roleKind: null } },
    ],
    anchor: [],
    kept: 3,
    fired: { wider: 2, centerMoved: 0 },
    answer: { draft: null, check: null },
    costUsd: 0.12,
    model: 'large-model',
    promptVersion: 'rv',
    ...over,
  })

  it('writes the new title and charter as the re-center’s, detaches what both rejected, joins what both accepted, and counts it', () => {
    const r = at()
    const p = planRecenter(r, caseOf(r), result(), storiesNow(), ctx)
    expect(p.decision).toMatchObject({ kind: 'recenter', outcome: 'recentered', actor: 'recenter', model: 'large-model', promptVersion: 'rv', costUsd: 0.12 })
    expect(p.decision.inputs).toMatchObject({ outAdded: ['Cholera in Ituri'], joined: ['s7', 's9'], detached: ['e4'], kept: 3 })
    const done = applied(r, settle(r, p))
    expect(done.overview).toMatchObject({
      title: 'Ebola in Ituri and the region',
      charter: wider,
      charterModel: 'large-model',
      charterPromptVersion: 'rv',
      recenteredAt: NOW,
      recenteredBy: 'recenter',
      recenterTriedAt: NOW,
      automatedRecenters: 1,
      slug: 'ebola-in-ituri',
      lastEntryAt: day(9),
    })
    expect(done.entries.find(e => e.id === 'e4')).toMatchObject({ status: 'detached', detachedBy: 'recenter', detachReason: 'recenter' })
    // The review-detached row is reused, unlocked, with the draft's role; any other story gets a new row
    expect(done.entries.find(e => e.id === 'e7')).toMatchObject({
      status: 'active',
      locked: false,
      role: 'turning_point',
      roleKind: 'response',
      detachedBy: null,
    })
    expect(p.newEntries).toEqual([
      expect.objectContaining({ storyId: 's9', joinedBy: 'recenter', decisionId: p.decision.id, shared: null, confidence: null, model: 'large-model' }),
    ])
    expect(done.entries.filter(e => e.status === 'active').map(e => e.storyId)).toEqual(['s1', 's2', 's3', 's7', 's9'])
  })

  it('only marks the attempt when kept or refused, and writes nothing for a failed call', () => {
    const r = at()
    for (const outcome of ['kept', 'refused'] as const) {
      const p = planRecenter(r, caseOf(r), result({ outcome, joins: [], detaches: [], rule: outcome === 'refused' ? 'anchor' : null }), storiesNow(), ctx)
      expect(p.decision.outcome).toBe(outcome)
      expect(p.changes).toEqual([expect.objectContaining({ table: 'overview', after: { recenterTriedAt: NOW } })])
      expect(p.decision.inputs).toMatchObject({ outAdded: [] })
    }
    const failed = planRecenter(r, caseOf(r), result({ outcome: 'failed', joins: [], detaches: [] }), storiesNow(), ctx)
    expect(failed.changes).toEqual([])
    expect(failed.decision.inputs).toMatchObject({ kept: null })
  })

  it('is stale, applying nothing, when the overview changed during the calls, a story to join is taken, or a story it was offered is unpublished', () => {
    const r = at()
    const c = { ...caseOf(r), stories: ['s7', 's8', 's9'].map(offered) }
    const stale = (rowsNow: Rows | null, taken: string[] = [], published?: string[]) => planRecenter(rowsNow, c, result(), storiesNow(taken, published), ctx)
    expect(stale(r).decision.outcome).toBe('recentered')
    // s8 was offered and judged, though not joined: the calls read a story no longer published
    expect(stale(r, [], ['s7', 's9']).decision.outcome).toBe('stale')
    expect(stale(null).decision.outcome).toBe('stale')
    expect(stale({ ...r, overview: { ...r.overview, title: 'Retitled' } }).decision.outcome).toBe('stale')
    expect(stale({ ...r, overview: { ...r.overview, lockedOut: ['x'] } }).decision.outcome).toBe('stale')
    expect(stale({ ...r, overview: { ...r.overview, automatedRecenters: 1 } }).decision.outcome).toBe('stale')
    expect(stale({ ...r, overview: { ...r.overview, status: 'quiet' } }).decision.outcome).toBe('stale')
    expect(stale(r, ['s9']).decision.outcome).toBe('stale')
    expect(stale({ ...r, entries: r.entries.map(e => (e.id === 'e7' ? { ...e, status: 'active' as const } : e)) }).decision.outcome).toBe('stale')
    expect(stale(r, ['s9']).changes).toEqual([])
  })
})

describe('planClosing', () => {
  const story = linkStory({ id: 's9', datePublished: day(9) })
  const agreed = { outcome: 'closing' as const, answers: { close: null, check: null }, model: 'large', promptVersion: 'v', costUsd: 0.01 }
  const check = (o: OverviewRow) => planClosing(o, { overviewId: 'o1', charter: { ...charter, endEvent: charter.endEvent }, story, entries: [] }, agreed, ctx)

  it('begins the closing on the end event the calls judged', () => {
    expect(check(overview()).decision.outcome).toBe('closing')
    expect(check(overview()).changes[0]!.after).toMatchObject({ status: 'closing', closingStoryId: 's9' })
  })

  it('is stale, beginning nothing, when the end event changed during the calls (an editor re-centered it)', () => {
    for (const endEvent of ['The WHO declares it over', null]) {
      const p = check(overview({ charter: { ...charter, endEvent } }))
      expect([p.decision.outcome, p.changes]).toEqual(['stale', []])
    }
  })
})

describe('the link record: which re-center signals count', () => {
  const story = linkStory({ id: 's9', datePublished: day(9) })
  const signals = [
    { overviewId: 'o1', kind: 'center_moved' as const, quote: 'now national' },
    { overviewId: 'o2', kind: 'wider' as const, quote: 'Goma' },
    { overviewId: 'o2', kind: 'center_moved' as const, quote: 'now national' },
  ]

  it('keeps every flag of a story left alone, with the run time it was linked at', () => {
    const none = planAlone(linkResult(story, { outcome: 'none', signals }), ctx).plan.decision.inputs
    expect(none).toMatchObject({ signals, linkedAt: NOW })
    expect(planAlone(linkResult(story, { outcome: 'rejected', signals }), ctx).plan.decision.inputs).toMatchObject({ signals })
  })

  it('keeps of a joined story only its centerMoved for the overview it joins: it is active in no other after its link', () => {
    const joined = { ...joinResult(story, 'o1'), signals }
    expect(planJoin(overview(), joined, ctx).plan.decision.inputs).toMatchObject({ signals: [signals[0]] })
  })

  it('keeps nothing of a story held, in conflict or failed, which is linked again, nor of a founding', () => {
    for (const outcome of ['held', 'failed'] as const)
      expect(planAlone(linkResult(story, { outcome, signals }), ctx).plan.decision.inputs).toMatchObject({ signals: [] })
    expect(planConflict(linkResult(story, { outcome: 'none', signals }), ctx).plan.decision.inputs).toMatchObject({ signals: [] })
    expect(planJoin(overview({ frozen: true, frozenBy: 'editor' }), { ...joinResult(story, 'o1'), signals }, ctx).plan.decision.inputs).toMatchObject({
      signals: [],
    })
  })
})

describe('planStatus', () => {
  it('detaches an unpublished member, undoes its links, settles the last entry and cancels the closing it began', () => {
    const r = rows({ status: 'closing', closingSince: day(3), closingStoryId: 's3' }, [entry(1), entry(2), entry(3, { published: false })])
    const plans = planStatus(
      r,
      [
        { kind: 'detach', entryId: 'e3', storyId: 's3' },
        { kind: 'cancel_closing', storyId: 's3' },
      ],
      day(10),
      ctx,
    )
    expect(plans.map(p => [p.decision.outcome, p.undoesLinksOf])).toEqual([
      ['detached', 's3'],
      ['open', null],
    ])
    expect(after(r, plans).overview).toMatchObject({ status: 'open', closingStoryId: null, closingSince: null, lastEntryAt: day(2) })
    expect(after(r, plans).entries[2]).toMatchObject({ status: 'detached', detachedBy: 'pipeline', detachReason: 'unpublished', detachedAt: NOW })
  })

  it('drops a move whose from no longer holds, and logs a scope move an entry leaving already settled', () => {
    const r = rows({ scope: 'ongoing', status: 'open' }, [entry(1), entry(2, { published: false })])
    const plans = planStatus(
      r,
      [
        { kind: 'detach', entryId: 'e2', storyId: 's2' },
        { kind: 'scope', from: 'ongoing', to: 'single' },
        { kind: 'status', from: 'quiet', to: 'open', reason: 'active' },
      ],
      day(10),
      ctx,
    )
    expect(plans.map(p => p.decision.outcome)).toEqual(['detached', 'single'])
    // The detach settled the scope: the scope move is logged with nothing left to change
    expect(plans[1]!.changes).toEqual([])
    expect(after(r, plans).overview.scope).toBe('single')
  })

  it('closes at the development clock, and opening again clears a closure', () => {
    const r = rows({ status: 'quiet' })
    const [closed] = planStatus(r, [{ kind: 'status', from: 'quiet', to: 'closed', reason: 'faded' }], day(30), ctx)
    expect(applied(r, closed!).overview).toMatchObject({ status: 'closed', closedAt: day(30), closedReason: 'faded' })
    const c = rows({ status: 'closed', closedAt: day(30), closedReason: 'faded' })
    const [open] = planStatus(c, [{ kind: 'status', from: 'closed', to: 'open', reason: 'active' }], day(31), ctx)
    expect(applied(c, open!).overview).toMatchObject({ status: 'open', closedAt: null, closedReason: null })
  })
})

describe('planBurst', () => {
  it('freezes by the burst and counts joins from now, and does nothing to a frozen overview', () => {
    const p = planBurst(overview(), { burstJoins: 7 }, ctx)!
    expect(p.decision).toMatchObject({ kind: 'status', outcome: 'frozen', inputs: { reason: 'burst', joins: 7 } })
    expect(applied(rows(), p).overview).toMatchObject({ frozen: true, frozenBy: 'burst', frozenAt: NOW, joinsCountedFrom: NOW })
    expect(planBurst(overview({ frozen: true, frozenBy: 'editor' }), { burstJoins: 7 }, ctx)).toBeNull()
  })
})

describe('planReview', () => {
  const result = (over: Partial<ReviewResult> = {}): ReviewResult => ({
    trigger: 'entries',
    outcome: 'reviewed',
    actions: [],
    refusals: [],
    kept: 3,
    scope: 'ongoing',
    cancelsClosing: false,
    brake: null,
    answer: null,
    costUsd: 0.01,
    model: 'large-model',
    promptVersion: 'v1',
    ...over,
  })

  it('makes it public the first time with its slug to come, and records the review’s time and the entries kept', () => {
    const r = rows()
    const p = planReview(r, reviewCaseOf(r), result(), ctx)
    expect(p.needsSlug).toBe(true)
    expect(applied(r, p).overview).toMatchObject({ scope: 'ongoing', reviewedAt: NOW, entriesAtLastReview: 3, joinsCountedFrom: NOW })
    expect(planReview(rows({ slug: 'ebola' }), reviewCaseOf(r), result(), ctx).needsSlug).toBe(false)
  })

  it('cancels the closing whose story it detached, logging the cancellation, and settles the last entry', () => {
    const r = rows({ scope: 'ongoing', slug: 'ebola', status: 'closing', closingSince: day(3), closingStoryId: 's3' })
    const p = planReview(
      r,
      reviewCaseOf(r),
      result({ actions: [{ kind: 'detach', entryId: 'e3', storyId: 's3', reason: 'Off topic.' }], kept: 2, scope: 'forming' }),
      ctx,
    )
    expect(p.also.map(d => [d.kind, d.outcome, d.storyId])).toEqual([['status', 'open', 's3']])
    const done = applied(r, settle(r, p))
    expect(done.overview).toMatchObject({ status: 'open', closingStoryId: null, scope: 'forming', lastEntryAt: day(2) })
    expect(done.entries[2]).toMatchObject({ status: 'detached', detachedBy: 'review', detachReason: 'review' })
  })

  it('freezes for an editor when the brake tripped, and changes nothing for a failed review', () => {
    const r = rows({ scope: 'ongoing', slug: 'ebola' })
    const braked = planReview(r, reviewCaseOf(r), result({ brake: { asked: 3, unlocked: 3 } }), ctx)
    expect(applied(r, braked).overview).toMatchObject({ frozen: true, frozenBy: 'review', frozenAt: NOW })
    expect(applied(r, braked).entries.every(e => e.status === 'active')).toBe(true)
    const failed = planReview(r, reviewCaseOf(r), result({ outcome: 'failed' }), ctx)
    expect(failed.changes).toEqual([])
    expect(failed.decision.outcome).toBe('failed')
  })

  it('records a review stale, changing nothing, when what its call read changed meanwhile: title, charter, scope, freeze, entries or their locks', () => {
    // An unpublished member is in neither the case nor the comparison
    const r = rows({ scope: 'ongoing', slug: 'ebola' }, [entry(1), entry(2), entry(3), entry(4, { published: false })])
    const asked = reviewCaseOf(r)
    const detach = result({ actions: [{ kind: 'detach', entryId: 'e3', storyId: 's3', reason: 'Off topic.' }], kept: 2, scope: 'forming' })
    expect(planReview(r, asked, detach, ctx).decision.outcome).toBe('reviewed')

    const meanwhile: Record<string, Rows> = {
      retitled: { ...r, overview: { ...r.overview, title: 'Mine' } },
      narrowed: { ...r, overview: { ...r.overview, charter: { ...charter, out: [...charter.out, 'cholera'] } } },
      'scope moved': { ...r, overview: { ...r.overview, scope: 'forming' } },
      frozen: { ...r, overview: { ...r.overview, frozen: true, frozenBy: 'editor', frozenAt: NOW } },
      'a story joined': { ...r, entries: [...r.entries, entry(5)] },
      'an entry left': { ...r, entries: r.entries.map(e => (e.id === 'e2' ? { ...e, status: 'detached' as const } : e)) },
      'an entry locked': { ...r, entries: r.entries.map(e => (e.id === 'e3' ? { ...e, locked: true } : e)) },
      'a member published again': { ...r, entries: r.entries.map(e => (e.id === 'e4' ? { ...e, published: true } : e)) },
    }
    for (const [what, now] of Object.entries(meanwhile)) {
      const p = planReview(now, asked, detach, ctx)
      expect([what, p.decision.outcome, p.changes, p.also, p.needsSlug]).toEqual([what, 'stale', [], [], false])
      // Its record keeps what it asked and what it cost
      expect(p.decision).toMatchObject({ costUsd: 0.01, inputs: { actions: detach.actions } })
    }
    // A tripped brake freezes nothing on a stale review; a failed one stays failed
    const braked = planReview(meanwhile.retitled!, asked, result({ brake: { asked: 3, unlocked: 3 } }), ctx)
    expect([braked.decision.outcome, braked.changes]).toEqual(['stale', []])
    expect(planReview(meanwhile.retitled!, asked, result({ outcome: 'failed' }), ctx).decision.outcome).toBe('failed')
  })
})

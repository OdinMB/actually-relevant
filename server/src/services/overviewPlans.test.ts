import { describe, expect, it } from 'vitest'
import { joinResult, linkStory } from '../test/db/overviewFixtures.js'
import { applied, newOverviewRow, settle, type EntryRow, type OverviewRow, type Rows } from './overviewChanges.js'
import { planBurst, planJoin, planReview, planStatus } from './overviewPlans.js'
import type { ReviewCase, ReviewResult } from './overviewReview.js'

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
  const reviewCase = (r: Rows): ReviewCase => ({
    overviewId: 'o1',
    title: r.overview.title,
    charter,
    scope: r.overview.scope,
    frozen: r.overview.frozen,
    entries: r.entries.map(e => ({
      entryId: e.id,
      storyId: e.storyId!,
      title: 'T',
      label: '',
      summary: 'S.',
      date: '2026-11-01',
      role: { role: 'routine', roleKind: null },
      locked: e.locked,
    })),
    closingStoryId: r.overview.closingStoryId,
    lockedOut: [],
  })
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
    const p = planReview(r, reviewCase(r), result(), ctx)
    expect(p.needsSlug).toBe(true)
    expect(applied(r, p).overview).toMatchObject({ scope: 'ongoing', reviewedAt: NOW, entriesAtLastReview: 3, joinsCountedFrom: NOW })
    expect(planReview(rows({ slug: 'ebola' }), reviewCase(r), result(), ctx).needsSlug).toBe(false)
  })

  it('cancels the closing whose story it detached, logging the cancellation, and settles the last entry', () => {
    const r = rows({ scope: 'ongoing', slug: 'ebola', status: 'closing', closingSince: day(3), closingStoryId: 's3' })
    const p = planReview(
      r,
      reviewCase(r),
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
    const braked = planReview(r, reviewCase(r), result({ brake: { asked: 3, unlocked: 3 } }), ctx)
    expect(applied(r, braked).overview).toMatchObject({ frozen: true, frozenBy: 'review', frozenAt: NOW })
    expect(applied(r, braked).entries.every(e => e.status === 'active')).toBe(true)
    const failed = planReview(r, reviewCase(r), result({ outcome: 'failed' }), ctx)
    expect(failed.changes).toEqual([])
    expect(failed.decision.outcome).toBe('failed')
  })
})

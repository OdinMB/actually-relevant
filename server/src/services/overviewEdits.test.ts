import { describe, expect, it } from 'vitest'
import { joinResult, linkStory, reviewCaseOf } from '../test/db/overviewFixtures.js'
import { ConflictError } from '../utils/errors.js'
import {
  ACTIVE,
  applied,
  draft,
  entryChange,
  merged,
  newOverviewRow,
  overviewChange,
  plan,
  removesLink,
  settle,
  type EntryRow,
  type OverviewRow,
  type Plan,
  type Rows,
} from './overviewChanges.js'
import { planEdit, planUndo, undoable, type AttachStory, type UndoTarget } from './overviewEdits.js'
import type { Charter } from './overviewTypes.js'
import { planBurst, planClosing, planJoin, planReview, planStatus } from './overviewPlans.js'
import type { ReviewResult } from './overviewReview.js'

const NOW = new Date('2026-11-18T12:00:00Z')
const LATER = new Date('2026-11-19T12:00:00Z')
let n = 0
const ctx = (now = NOW) => ({ editorId: 'ed-1', now, newId: () => `id-${++n}` })
const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }
const day = (d: number) => new Date(Date.UTC(2026, 10, d, 8))

const overview = (over: Partial<OverviewRow> = {}): OverviewRow => ({
  ...newOverviewRow({ id: 'o1', title: 'Ebola in Ituri', issueId: null, charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: day(1) }),
  slug: 'ebola-in-ituri',
  scope: 'ongoing',
  entriesAtLastReview: 3,
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

/** A plan applied in memory as the applier applies it, and its decision as stored (dates as strings), for Undo to read. */
function run(at: Rows, p: Plan): { rows: Rows; decision: UndoTarget } {
  const settled = settle(at, p)
  const stored = JSON.parse(JSON.stringify({ ...settled.decision.inputs, changes: merged(settled.changes) })) as unknown
  return {
    rows: applied(at, settled),
    decision: {
      id: settled.decision.id,
      kind: settled.decision.kind,
      outcome: settled.decision.outcome,
      storyId: settled.decision.storyId,
      inputs: stored,
      undoneAt: null,
    },
  }
}

const refusal = (f: () => unknown): string => {
  try {
    f()
  } catch (e) {
    expect(e).toBeInstanceOf(ConflictError)
    return (e as Error).message
  }
  throw new Error('not refused')
}

const story = (over: Partial<AttachStory> = {}): AttachStory => ({ id: 's9', published: true, datePublished: day(9), activeIn: null, rowHere: null, ...over })
const review = (over: Partial<ReviewResult> = {}): ReviewResult => ({
  trigger: 'burst',
  outcome: 'reviewed',
  actions: [],
  refusals: [],
  kept: 3,
  scope: 'ongoing',
  cancelsClosing: false,
  brake: null,
  answer: null,
  model: 'm',
  promptVersion: 'v',
  costUsd: 0,
  ...over,
})
const turning = { role: 'turning_point' as const, roleKind: 'spread' as const }

describe('planEdit', () => {
  it('attaches a published story in no overview as the editor’s, creating its row in the state an undo leaves', () => {
    const at = rows()
    const p = planEdit({ kind: 'attach', overviewId: 'o1', storyId: 's9', role: turning }, at, story(), null, ctx())
    expect(p.decision).toMatchObject({ kind: 'editor_attach', outcome: 'attached', storyId: 's9', actor: 'ed-1' })
    expect(p.newEntries[0]).toMatchObject({
      storyId: 's9',
      joinedBy: 'editor',
      decisionId: p.decision.id,
      fields: { status: 'detached', detachReason: 'undone', locked: false },
    })
    const after = applied(at, settle(at, p))
    expect(after.entries.at(-1)).toMatchObject({ status: 'active', locked: true, role: 'turning_point', roleKind: 'spread' })
    // The last entry follows the entries
    expect(after.overview.lastEntryAt).toEqual(day(9))
  })

  it('reuses a detached row of the story, and refuses a story unpublished, in an overview, or an overview closed', () => {
    const old = entry(9, { status: 'detached', detachedBy: 'review', detachReason: 'review', detachedAt: day(5) })
    const at = rows({}, [entry(1), entry(2), old])
    const p = planEdit({ kind: 'attach', overviewId: 'o1', storyId: 's9', role: { role: 'routine', roleKind: null } }, at, story({ rowHere: old }), null, ctx())
    expect(p.newEntries).toEqual([])
    expect(p.changes[0]).toMatchObject({ table: 'entry', id: 'e9', after: { status: 'active', locked: true } })
    const attach =
      (s: AttachStory, r = at) =>
      () =>
        planEdit({ kind: 'attach', overviewId: 'o1', storyId: 's9', role: turning }, r, s, null, ctx())
    expect(refusal(attach(story({ published: false })))).toMatch(/Only a published story/)
    expect(refusal(attach(story({ activeIn: { overviewId: 'o2', title: 'Mpox' } })))).toMatch(/"Mpox": detach it there first/)
    expect(refusal(attach(story({ activeIn: { overviewId: 'o1', title: 'Ebola' } })))).toMatch(/already in this overview/)
    expect(refusal(attach(story(), rows({ status: 'closed', closedReason: 'editor' })))).toMatch(/closed: reopen it first/)
  })

  it('detaches an entry as locked, settles the scope and cancels a closing its story began', () => {
    const at = rows({ scope: 'forming', status: 'closing', closingSince: day(2), closingStoryId: 's2' }, [entry(1), entry(2)])
    const p = planEdit({ kind: 'detach', overviewId: 'o1', entryId: 'e2' }, at, null, 'e2', ctx())
    const after = applied(at, settle(at, p))
    expect(after.entries[1]).toMatchObject({ status: 'detached', detachedBy: 'ed-1', detachReason: 'editor', detachedAt: NOW, locked: true })
    expect(after.overview).toMatchObject({ scope: 'single', status: 'open', closingSince: null, closingStoryId: null, lastEntryAt: day(1) })
    expect(refusal(() => planEdit({ kind: 'detach', overviewId: 'o1', entryId: 'e2' }, after, null, 'e2', ctx()))).toMatch(/already detached/)
    expect(refusal(() => planEdit({ kind: 'detach', overviewId: 'o1', entryId: 'x' }, after, null, 'x', ctx()))).toMatch(/not in this overview/)
  })

  it('sets a role as locked, a routine one without a kind, and refuses the role it has', () => {
    const at = rows({}, [entry(1, { role: 'turning_point', roleKind: 'spread' })])
    const p = planEdit({ kind: 'role', overviewId: 'o1', entryId: 'e1', role: { role: 'routine', roleKind: 'spread' } as never }, at, null, 'e1', ctx())
    expect(p.changes).toEqual([
      {
        table: 'entry',
        id: 'e1',
        before: { role: 'turning_point', roleKind: 'spread', locked: false },
        after: { role: 'routine', roleKind: null, locked: true },
      },
    ])
    expect(refusal(() => planEdit({ kind: 'role', overviewId: 'o1', entryId: 'e1', role: turning }, at, null, 'e1', ctx()))).toMatch(/already has that role/)
  })

  it('retitles, freezes as the editor’s, unfreezes, hides, closes and reopens, refusing what would change nothing', () => {
    const at = rows()
    const edit = (action: Parameters<typeof planEdit>[0], r = at) => planEdit(action, r, null, null, ctx())
    expect(edit({ kind: 'retitle', overviewId: 'o1', title: 'New' }).changes[0]!.after).toEqual({ title: 'New' })
    expect(edit({ kind: 'freeze', overviewId: 'o1', frozen: true }).changes[0]!.after).toEqual({
      frozen: true,
      frozenBy: 'editor',
      frozenAt: NOW,
      joinsCountedFrom: NOW,
    })
    const frozen = rows({ frozen: true, frozenBy: 'burst', frozenAt: day(4) })
    expect(edit({ kind: 'freeze', overviewId: 'o1', frozen: false }, frozen).changes[0]!.after).toEqual({
      frozen: false,
      frozenBy: null,
      frozenAt: null,
      joinsCountedFrom: NOW,
    })
    expect(edit({ kind: 'hide', overviewId: 'o1', hidden: true }).changes[0]!.after).toEqual({ hidden: true })
    const closing = rows({ status: 'closing', closingSince: day(3), closingStoryId: 's3', closureReviewedAt: day(4) })
    expect(edit({ kind: 'close', overviewId: 'o1', closed: true }, closing).changes[0]!.after).toEqual({
      status: 'closed',
      closedAt: NOW,
      closedReason: 'editor',
      closingSince: null,
      closingStoryId: null,
      closureReviewedAt: null,
    })
    const closed = rows({ status: 'closed', closedAt: day(5), closedReason: 'faded' })
    expect(edit({ kind: 'close', overviewId: 'o1', closed: false }, closed).changes[0]!.after).toEqual({
      status: 'open',
      closedAt: null,
      closedReason: null,
      reopenedAt: NOW,
    })
    expect(refusal(() => edit({ kind: 'retitle', overviewId: 'o1', title: 'Ebola in Ituri' }))).toMatch(/already has that title/)
    expect(refusal(() => edit({ kind: 'freeze', overviewId: 'o1', frozen: false }))).toMatch(/not frozen/)
    expect(refusal(() => edit({ kind: 'hide', overviewId: 'o1', hidden: false }))).toMatch(/not hidden/)
    expect(refusal(() => edit({ kind: 'close', overviewId: 'o1', closed: false }))).toMatch(/not closed/)
    expect(refusal(() => edit({ kind: 'close', overviewId: 'o1', closed: true }, closed))).toMatch(/already closed/)
  })
})

const wider: Charter = { in: 'The Ebola outbreak in eastern Congo.', out: ['Mpox'], endEvent: null }
const recenter = (to: Charter, r: Rows, over: { title?: string; anchorConfirmed?: boolean } = {}, at = ctx()) =>
  planEdit(
    { kind: 'recenter', overviewId: 'o1', title: over.title ?? 'Ebola in eastern Congo', charter: to, anchorConfirmed: over.anchorConfirmed ?? true },
    r,
    null,
    null,
    at,
  )

describe("planEdit: an editor's re-center", () => {
  it('takes the whole new charter and title: drops an OUT entry, re-admits a locked-out one, names no end event; past the limit, quiet and frozen', () => {
    const at = rows({ lockedOut: ['mpox'], automatedRecenters: 2, status: 'quiet', frozen: true, frozenBy: 'burst', frozenAt: day(4) })
    const p = recenter(wider, at)
    expect(p.decision).toMatchObject({
      kind: 'editor_recenter',
      outcome: 'recentered',
      storyId: null,
      inputs: { target: null, anchorConfirmed: true },
      actor: 'ed-1',
    })
    expect(p.changes).toEqual([
      {
        table: 'overview',
        id: 'o1',
        before: { title: 'Ebola in Ituri', charter, lockedOut: ['mpox'], recenteredAt: null, recenteredBy: null },
        after: { title: 'Ebola in eastern Congo', charter: wider, lockedOut: [], recenteredAt: NOW, recenteredBy: 'editor' },
      },
    ])
    // The AI marker's model fields and the count of automated re-centers stay as they are; nothing else moves
    expect(p.also).toEqual([])
    expect(applied(at, p).overview).toMatchObject({ charterModel: 'm', charterPromptVersion: 'v', automatedRecenters: 2, frozen: true, status: 'quiet' })
  })

  it('cancels a closing when the end event changes, to none too, logged as an open status decision; an IN-only change keeps it', () => {
    const closing = rows({ status: 'closing', closingSince: day(3), closingStoryId: 's3', closureReviewedAt: day(4) })
    const p = recenter(wider, closing)
    expect(p.changes[0]!.after).toMatchObject({ status: 'open', closingSince: null, closingStoryId: null, closureReviewedAt: null })
    expect(p.also).toEqual([
      expect.objectContaining({
        kind: 'status',
        outcome: 'open',
        overviewId: 'o1',
        storyId: 's3',
        inputs: { from: 'closing', to: 'open', reason: 'recentered', by: 'editor' },
        actor: 'ed-1',
      }),
    ])
    const renamed = recenter({ ...charter, endEvent: 'The WHO declares it over' }, closing)
    expect(renamed.changes[0]!.after).toMatchObject({ status: 'open' })
    const kept = recenter({ ...charter, in: wider.in }, closing, { title: 'Ebola in Ituri' })
    expect(kept.changes[0]!.after).toEqual({ charter: { ...charter, in: wider.in }, recenteredAt: NOW, recenteredBy: 'editor' })
    expect(kept.also).toEqual([])
  })

  it('refuses a closed overview, a charter saved without the anchor confirmed, and one that changes nothing', () => {
    const closed = rows({ status: 'closed', closedAt: day(5), closedReason: 'faded' })
    expect(refusal(() => recenter(wider, closed))).toMatch(/The overview is closed: reopen it first/)
    expect(refusal(() => recenter(wider, rows(), { anchorConfirmed: false }))).toMatch(/Confirm the anchor first/)
    expect(refusal(() => recenter(charter, rows(), { title: 'Ebola in Ituri' }))).toMatch(/already has that title and charter/)
    // A retitle alone is a re-center too
    expect(recenter(charter, rows(), { title: 'Ebola' }).changes[0]!.after).toMatchObject({ title: 'Ebola', recenteredBy: 'editor' })
  })
})

describe('planUndo', () => {
  it("undoes an editor's action by its changes the other way round, and an undo of that undo restores it again", () => {
    const first = run(rows(), planEdit({ kind: 'detach', overviewId: 'o1', entryId: 'e3' }, rows(), null, 'e3', ctx()))
    const undo = run(first.rows, planUndo(first.decision, first.rows, [], ctx(LATER)))
    expect(undo.rows.entries[2]).toMatchObject({ status: 'active', detachedBy: null, locked: false })
    expect(undo.rows.overview.lastEntryAt).toEqual(day(3))
    const p = planUndo(undo.decision, undo.rows, [undo.decision], ctx(LATER))
    expect(p.chain).toEqual([{ decisionId: first.decision.id, undone: false }])
    expect(applied(undo.rows, settle(undo.rows, p)).entries[2]).toMatchObject({ status: 'detached', detachReason: 'editor', locked: true })
  })

  /** Undo upon undo as the lifecycle writes them: the decision undone marked so, and the chain below it as the plan says. */
  function chainFrom(first: { rows: Rows; decision: UndoTarget }) {
    let at = first.rows
    const decisions: UndoTarget[] = [first.decision]
    const byId = (id: string) => decisions.find(x => x.id === id)!
    return {
      undo(id: string): string {
        const d = byId(id)
        const p = planUndo(d, at, decisions, ctx(LATER))
        const next = run(at, p)
        d.undoneAt = LATER
        for (const m of p.chain) byId(m.decisionId).undoneAt = m.undone ? LATER : null
        decisions.push(next.decision)
        at = next.rows
        return next.decision.id
      },
      /** Whether each decision is undone, oldest first. */
      undone: () => decisions.map(d => d.undoneAt !== null),
      rows: () => at,
      decision: byId,
    }
  }

  it('keeps a chain of undos consistent at depth 3 and 4, for a join and a review: each undo’s target is undone exactly while the undo is live', () => {
    const at = rows({ scope: 'forming' }, [entry(1), entry(2)])
    const joined = run(at, planJoin(at.overview, joinResult(linkStory({ id: 's3', datePublished: day(3) }), 'o1'), { now: NOW, newId: () => `id-${++n}` }).plan)
    const join = chainFrom(joined)
    const u3 = join.undo(join.undo(join.undo(joined.decision.id)))
    expect(join.undone()).toEqual([true, false, true, false])
    expect(join.rows().entries[2]).toMatchObject({ status: 'detached', detachReason: 'undone', locked: true })
    expect(refusal(() => planUndo(join.decision(joined.decision.id), join.rows(), [], ctx(LATER)))).toMatch(/already undone/)
    join.undo(u3)
    expect(join.undone()).toEqual([false, true, false, true, false])
    expect(join.rows().entries[2]).toMatchObject({ status: 'active', locked: false })

    const four = rows({}, [entry(1), entry(2), entry(3), entry(4)])
    const narrow = { ...charter, out: [...charter.out, 'Mpox'] }
    const result = review({
      actions: [
        { kind: 'detach', entryId: 'e4', storyId: 's4', reason: 'Elsewhere.' },
        { kind: 'narrow', added: ['Mpox'], charter: narrow },
      ],
    })
    const reviewed = run(four, planReview(four, reviewCaseOf(four), result, ctx()))
    const chain = chainFrom(reviewed)
    const r3 = chain.undo(chain.undo(chain.undo(reviewed.decision.id)))
    expect(chain.undone()).toEqual([true, false, true, false])
    expect(chain.rows().entries[3]).toMatchObject({ status: 'active', locked: true })
    expect(chain.rows().overview).toMatchObject({ charter, lockedOut: ['Mpox'] })
    chain.undo(r3)
    expect(chain.undone()).toEqual([false, true, false, true, false])
    expect(chain.rows().entries[3]).toMatchObject({ status: 'detached', detachReason: 'review', locked: false })
    expect(chain.rows().overview).toMatchObject({ charter: narrow, lockedOut: [] })
  })

  it('undoes a join by detaching its entry, undone and locked as the editor’s, and settles what follows the entries', () => {
    const at = rows({ scope: 'forming' }, [entry(1), entry(2)])
    const result = {
      story: { id: 's3', datePublished: day(3) },
      join: { candidate: { id: 'o1' }, answer: { confidence: 0.8 }, shared: {}, reportsEndEvent: false },
      role: null,
      shown: { overviews: [], partners: [] },
      proposed: 1,
      refusals: [],
      answer: null,
      model: 'm',
      promptVersion: 'v',
      costUsd: 0,
    } as never
    const joined = run(at, planJoin(at.overview, result, { now: NOW, newId: () => `id-${++n}` }).plan)
    expect(joined.rows.entries).toHaveLength(3)
    const undo = run(joined.rows, planUndo(joined.decision, joined.rows, [], ctx(LATER)))
    expect(undo.rows.entries[2]).toMatchObject({ status: 'detached', detachedBy: 'ed-1', detachReason: 'undone', detachedAt: LATER, locked: true })
    expect(undo.rows.overview).toMatchObject({ scope: 'forming', lastEntryAt: day(2) })
  })

  it('reopens a closure while it stands, quiet counted from now, and refuses it once it changed', () => {
    const at = rows({ status: 'quiet' })
    const [close] = planStatus(at, [{ kind: 'status', from: 'quiet', to: 'closed', reason: 'faded' }], day(30), ctx())
    const closed = run(at, close!)
    expect(closed.rows.overview).toMatchObject({ status: 'closed', closedReason: 'faded', closedAt: day(30) })
    expect(undoable({ kind: 'status', outcome: 'closed', undoneAt: null })).toBe(true)
    const undo = run(closed.rows, planUndo(closed.decision, closed.rows, [], ctx(LATER)))
    expect(undo.rows.overview).toMatchObject({ status: 'open', closedAt: null, closedReason: null, reopenedAt: LATER })
    // An editor reopened it and closed it again since: that closure is not this one
    const again = { ...closed.rows, overview: { ...closed.rows.overview, closedAt: LATER, closedReason: 'editor' } }
    expect(refusal(() => planUndo(closed.decision, again, [], ctx(LATER)))).toMatch(/its closure changed after it\. Undo the later change first/)
  })

  it('opens a closing again only while it is the closing the overview is in, and clears a burst freeze only while it stands', () => {
    const at = rows()
    const c = { overviewId: 'o1', charter, story: { id: 's3', datePublished: day(3) }, entries: [] } as never
    const closing = run(at, planClosing(at.overview, c, { outcome: 'closing', answers: {}, model: 'm', promptVersion: 'v', costUsd: 0 } as never, ctx()))
    expect(closing.rows.overview).toMatchObject({ status: 'closing', closingStoryId: 's3', closingSince: day(3) })
    const undone = run(closing.rows, planUndo(closing.decision, closing.rows, [], ctx(LATER)))
    expect(undone.rows.overview).toMatchObject({ status: 'open', closingSince: null, closingStoryId: null })

    const burst = run(at, planBurst(at.overview, { burstJoins: 7 }, ctx())!)
    expect(burst.rows.overview).toMatchObject({ frozen: true, frozenBy: 'burst', frozenAt: NOW })
    const cleared = run(burst.rows, planUndo(burst.decision, burst.rows, [], ctx(LATER)))
    expect(cleared.rows.overview).toMatchObject({ frozen: false, frozenBy: null, frozenAt: null, joinsCountedFrom: NOW })
    const refrozen = { ...burst.rows, overview: { ...burst.rows.overview, frozenBy: 'editor', frozenAt: LATER } }
    expect(refusal(() => planUndo(burst.decision, refrozen, [], ctx(LATER)))).toMatch(/its freeze changed after it/)
  })

  it('undoes a review whole: its detaches back and locked, its relabel, narrowing and title restored, a freeze it cleared the editor’s again', () => {
    const at = rows({ frozen: true, frozenBy: 'burst', frozenAt: day(4) }, [entry(1), entry(2), entry(3), entry(4)])
    const result = review({
      actions: [
        { kind: 'detach', entryId: 'e4', storyId: 's4', reason: 'Elsewhere.' },
        { kind: 'relabel', entryId: 'e1', storyId: 's1', from: { role: 'routine', roleKind: null }, to: turning },
        { kind: 'narrow', added: ['Mpox'], charter: { ...charter, out: [...charter.out, 'Mpox'] } },
        { kind: 'retitle', from: 'Ebola in Ituri', to: 'Ebola in eastern Congo' },
        { kind: 'unfreeze' },
      ],
    })
    const reviewed = run(at, planReview(at, reviewCaseOf(at), result, ctx()))
    expect(reviewed.rows.overview).toMatchObject({ title: 'Ebola in eastern Congo', frozen: false, reviewedAt: NOW, entriesAtLastReview: 3 })
    const undo = run(reviewed.rows, planUndo(reviewed.decision, reviewed.rows, [], ctx(LATER)))
    expect(undo.rows.entries[3]).toMatchObject({ status: 'active', locked: true })
    expect(undo.rows.entries[0]).toMatchObject({ role: 'routine', locked: true })
    expect(undo.rows.overview).toMatchObject({ title: 'Ebola in Ituri', charter, lockedOut: ['Mpox'], frozen: true, frozenBy: 'editor', frozenAt: LATER })
    // What the review ran stays run, counted at the entries the undo leaves, so the count trigger does not review it again at once
    expect(undo.rows.overview).toMatchObject({ reviewedAt: NOW, entriesAtLastReview: 4 })
    // A forming overview keeps its count: only a review makes it public
    const forming = rows({ scope: 'forming' }, [entry(1), entry(2)])
    const cut = run(
      forming,
      planReview(
        forming,
        reviewCaseOf(forming),
        review({ actions: [{ kind: 'detach', entryId: 'e2', storyId: 's2', reason: 'No.' }], kept: 1, scope: 'single' }),
        ctx(),
      ),
    )
    const restored = run(cut.rows, planUndo(cut.decision, cut.rows, [], ctx(LATER)))
    expect(restored.rows.overview).toMatchObject({ scope: 'forming', entriesAtLastReview: 1 })

    // An editor retitled it since: the review is undone whole or not at all
    const retitled = { ...reviewed.rows, overview: { ...reviewed.rows.overview, title: 'Mine' } }
    expect(refusal(() => planUndo(reviewed.decision, retitled, [], ctx(LATER)))).toMatch(
      /its title changed after it, and a review is undone whole or not at all/,
    )
  })

  it("undoes an editor's re-center whole, lifting its lock and its closing cancel; refused once its review narrowed or retitled", () => {
    const at = rows({ status: 'closing', closingSince: day(3), closingStoryId: 's3' }, [entry(1), entry(2), entry(3), entry(4)])
    const done = run(at, recenter(wider, at))
    expect(done.rows.overview).toMatchObject({ recenteredBy: 'editor', recenteredAt: NOW, status: 'open', charter: wider })
    const undo = run(done.rows, planUndo(done.decision, done.rows, [], ctx(LATER)))
    expect(undo.rows.overview).toMatchObject({
      title: 'Ebola in Ituri',
      charter,
      recenteredAt: null,
      recenteredBy: null,
      status: 'closing',
      closingSince: day(3),
      closingStoryId: 's3',
    })

    // The queued review detaching an entry leaves it undoable; narrowing or retitling does not
    const detached = run(
      done.rows,
      planReview(
        done.rows,
        reviewCaseOf(done.rows),
        review({ trigger: 'recenter', actions: [{ kind: 'detach', entryId: 'e4', storyId: 's4', reason: 'Elsewhere.' }] }),
        ctx(LATER),
      ),
    )
    expect(planUndo(done.decision, detached.rows, [], ctx(LATER)).changes.length).toBeGreaterThan(0)
    const narrowed = run(
      done.rows,
      planReview(
        done.rows,
        reviewCaseOf(done.rows),
        review({ trigger: 'recenter', actions: [{ kind: 'narrow', added: ['Cholera'], charter: { ...wider, out: [...wider.out, 'Cholera'] } }] }),
        ctx(LATER),
      ),
    )
    expect(refusal(() => planUndo(done.decision, narrowed.rows, [], ctx(LATER)))).toMatch(
      /its charter changed after it, and a re-center is undone whole or not at all/,
    )
    const retitled = run(
      done.rows,
      planReview(done.rows, reviewCaseOf(done.rows), review({ trigger: 'recenter', actions: [{ kind: 'retitle', from: 'x', to: 'Ebola' }] }), ctx(LATER)),
    )
    expect(refusal(() => planUndo(done.decision, retitled.rows, [], ctx(LATER)))).toMatch(/its title changed after it/)
  })

  it('undoes an automated re-center whole: moves back and locked, OUT additions locked out, model fields back, the count down, the lock the Undo’s', () => {
    const at = rows({ automatedRecenters: 1 }, [
      entry(1),
      entry(2),
      entry(3),
      entry(4, { status: 'detached', detachedBy: 'review', detachReason: 'review', detachedAt: day(5) }),
    ])
    const moved = { in: wider.in, out: ['Ebola in Uganda', 'Mpox'], endEvent: null }
    const recentered = plan(
      draft({
        id: 'r1',
        kind: 'recenter',
        outcome: 'recentered',
        overviewId: 'o1',
        storyId: null,
        inputs: { rule: null, outAdded: ['Mpox'], anchor: [] },
        actor: 'pipeline',
        model: 'm2',
        promptVersion: 'v2',
      }),
      {
        changes: [
          ...overviewChange(at.overview, {
            title: 'Ebola in eastern Congo',
            charter: moved,
            charterModel: 'm2',
            charterPromptVersion: 'v2',
            recenteredAt: NOW,
            recenteredBy: 'recenter',
            recenterTriedAt: NOW,
            automatedRecenters: 2,
          }),
          ...entryChange(at.entries[2]!, { status: 'detached', detachedBy: 'recenter', detachReason: 'recenter', detachedAt: NOW }),
          ...entryChange(at.entries[3]!, ACTIVE),
        ],
      },
    )
    const done = run(at, recentered)
    expect(undoable(done.decision)).toBe(true)
    const undo = run(done.rows, planUndo(done.decision, done.rows, [], ctx(LATER)))
    expect(undo.rows.overview).toMatchObject({
      title: 'Ebola in Ituri',
      charter,
      charterModel: 'm',
      charterPromptVersion: 'v',
      automatedRecenters: 1,
      lockedOut: ['Mpox'],
      recenteredAt: LATER,
      recenteredBy: 'undo',
      // The attempt stays tried: a later one never blocks an Undo
      recenterTriedAt: NOW,
    })
    expect(undo.rows.entries[2]).toMatchObject({ status: 'active', locked: true })
    expect(undo.rows.entries[3]).toMatchObject({ status: 'detached', detachedBy: 'ed-1', detachReason: 'undone', locked: true })
    const triedSince = { ...done.rows, overview: { ...done.rows.overview, recenterTriedAt: LATER } }
    expect(planUndo(done.decision, triedSince, [], ctx(LATER)).changes.length).toBeGreaterThan(0)

    // An undo of that undo raises the count again and the re-center is automation's once more
    const again = run(undo.rows, planUndo(undo.decision, undo.rows, [undo.decision], ctx(LATER)))
    expect(again.rows.overview).toMatchObject({ automatedRecenters: 2, recenteredBy: 'recenter', recenteredAt: NOW, charter: moved, lockedOut: [] })
  })

  it('refuses a decision undone already, one it cannot reverse, a founding’s link and one that recorded no change set', () => {
    const d = (over: Partial<UndoTarget>): UndoTarget => ({ id: 'd', kind: 'status', outcome: 'quiet', storyId: null, inputs: {}, undoneAt: null, ...over })
    expect(refusal(() => planUndo(d({ undoneAt: NOW }), rows(), [], ctx()))).toMatch(/already undone/)
    expect(refusal(() => planUndo(d({}), rows(), [], ctx()))).toMatch(/cannot be undone/)
    expect(refusal(() => planUndo(d({ kind: 'link', outcome: 'founded' }), rows(), [], ctx()))).toMatch(/Undo the founding instead/)
    expect(refusal(() => planUndo(d({ kind: 'editor_hide', outcome: 'hidden', inputs: { target: null } }), rows(), [], ctx()))).toMatch(
      /did not record what it changed/,
    )
  })

  it('offers Undo on editor decisions, undos and the automated decisions it reverses, while not undone', () => {
    expect(undoable({ kind: 'editor_detach', outcome: 'detached', undoneAt: null })).toBe(true)
    expect(undoable({ kind: 'undo', outcome: 'undone', undoneAt: null })).toBe(true)
    expect(undoable({ kind: 'review', outcome: 'reviewed', undoneAt: null })).toBe(true)
    expect(undoable({ kind: 'review', outcome: 'audited', undoneAt: null })).toBe(false)
    expect(undoable({ kind: 'status', outcome: 'quiet', undoneAt: null })).toBe(false)
    expect(undoable({ kind: 'link', outcome: 'joined', undoneAt: NOW })).toBe(false)
    expect(undoable({ kind: 'editor_recenter', outcome: 'recentered', undoneAt: null })).toBe(true)
    expect(undoable({ kind: 'recenter', outcome: 'recentered', undoneAt: null })).toBe(true)
    expect(undoable({ kind: 'recenter', outcome: 'kept', undoneAt: null })).toBe(false)
  })
})

describe('removesLink', () => {
  it('is true on a public overview for a hide, a detach, or a scope off ongoing; false for a retitle or on a non-public one', () => {
    const o = { table: 'overview' as const, id: 'o1' }
    expect(removesLink(true, [{ ...o, before: { hidden: false }, after: { hidden: true } }])).toBe(true)
    expect(removesLink(true, [{ table: 'entry', id: 'e1', before: { status: 'active' }, after: { status: 'detached' } }])).toBe(true)
    expect(removesLink(true, [{ ...o, before: { scope: 'ongoing' }, after: { scope: 'forming' } }])).toBe(true)
    expect(removesLink(true, [{ ...o, before: { title: 'A' }, after: { title: 'B' } }])).toBe(false)
    expect(removesLink(false, [{ ...o, before: { hidden: false }, after: { hidden: true } }])).toBe(false)
  })
})

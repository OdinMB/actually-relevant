import { describe, expect, it } from 'vitest'
import { ConflictError } from '../utils/errors.js'
import { applied, merged, newOverviewRow, removesLink, settle, type EntryRow, type OverviewRow, type Plan, type Rows } from './overviewChanges.js'
import { planEdit, planUndo, undoable, type AttachStory, type UndoTarget } from './overviewEdits.js'
import { planBurst, planClosing, planJoin, planReview, planStatus } from './overviewPlans.js'

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

describe('planUndo', () => {
  it("undoes an editor's action by its changes the other way round, and an undo of that undo restores it again", () => {
    const first = run(rows(), planEdit({ kind: 'detach', overviewId: 'o1', entryId: 'e3' }, rows(), null, 'e3', ctx()))
    const undo = run(first.rows, planUndo(first.decision, first.rows, ctx(LATER)))
    expect(undo.rows.entries[2]).toMatchObject({ status: 'active', detachedBy: null, locked: false })
    expect(undo.rows.overview.lastEntryAt).toEqual(day(3))
    const p = planUndo(undo.decision, undo.rows, ctx(LATER))
    expect(p.relive).toBe(first.decision.id)
    expect(applied(undo.rows, settle(undo.rows, p)).entries[2]).toMatchObject({ status: 'detached', detachReason: 'editor', locked: true })
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
    const undo = run(joined.rows, planUndo(joined.decision, joined.rows, ctx(LATER)))
    expect(undo.rows.entries[2]).toMatchObject({ status: 'detached', detachedBy: 'ed-1', detachReason: 'undone', detachedAt: LATER, locked: true })
    expect(undo.rows.overview).toMatchObject({ scope: 'forming', lastEntryAt: day(2) })
  })

  it('reopens a closure while it stands, quiet counted from now, and refuses it once it changed', () => {
    const at = rows({ status: 'quiet' })
    const [close] = planStatus(at, [{ kind: 'status', from: 'quiet', to: 'closed', reason: 'faded' }], day(30), ctx())
    const closed = run(at, close!)
    expect(closed.rows.overview).toMatchObject({ status: 'closed', closedReason: 'faded', closedAt: day(30) })
    expect(undoable({ kind: 'status', outcome: 'closed', undoneAt: null })).toBe(true)
    const undo = run(closed.rows, planUndo(closed.decision, closed.rows, ctx(LATER)))
    expect(undo.rows.overview).toMatchObject({ status: 'open', closedAt: null, closedReason: null, reopenedAt: LATER })
    // An editor reopened it and closed it again since: that closure is not this one
    const again = { ...closed.rows, overview: { ...closed.rows.overview, closedAt: LATER, closedReason: 'editor' } }
    expect(refusal(() => planUndo(closed.decision, again, ctx(LATER)))).toMatch(/its closure changed after it\. Undo the later change first/)
  })

  it('opens a closing again only while it is the closing the overview is in, and clears a burst freeze only while it stands', () => {
    const at = rows()
    const c = { overviewId: 'o1', charter, story: { id: 's3', datePublished: day(3) }, entries: [] } as never
    const closing = run(at, planClosing(at.overview, c, { outcome: 'closing', answers: {}, model: 'm', promptVersion: 'v', costUsd: 0 } as never, ctx()))
    expect(closing.rows.overview).toMatchObject({ status: 'closing', closingStoryId: 's3', closingSince: day(3) })
    const undone = run(closing.rows, planUndo(closing.decision, closing.rows, ctx(LATER)))
    expect(undone.rows.overview).toMatchObject({ status: 'open', closingSince: null, closingStoryId: null })

    const burst = run(at, planBurst(at.overview, { burstJoins: 7 }, ctx())!)
    expect(burst.rows.overview).toMatchObject({ frozen: true, frozenBy: 'burst', frozenAt: NOW })
    const cleared = run(burst.rows, planUndo(burst.decision, burst.rows, ctx(LATER)))
    expect(cleared.rows.overview).toMatchObject({ frozen: false, frozenBy: null, frozenAt: null, joinsCountedFrom: NOW })
    const refrozen = { ...burst.rows, overview: { ...burst.rows.overview, frozenBy: 'editor', frozenAt: LATER } }
    expect(refusal(() => planUndo(burst.decision, refrozen, ctx(LATER)))).toMatch(/its freeze changed after it/)
  })

  it('undoes a review whole: its detaches back and locked, its relabel, narrowing and title restored, a freeze it cleared the editor’s again', () => {
    const at = rows({ frozen: true, frozenBy: 'burst', frozenAt: day(4) }, [entry(1), entry(2), entry(3), entry(4)])
    const c = { overviewId: 'o1', title: 'Ebola in Ituri', charter, scope: 'ongoing', frozen: true, entries: [], closingStoryId: null, lockedOut: [] } as never
    const result = {
      trigger: 'burst',
      outcome: 'reviewed',
      actions: [
        { kind: 'detach', entryId: 'e4', storyId: 's4', reason: 'Elsewhere.' },
        { kind: 'relabel', entryId: 'e1', storyId: 's1', from: { role: 'routine', roleKind: null }, to: turning },
        { kind: 'narrow', added: ['Mpox'], charter: { ...charter, out: [...charter.out, 'Mpox'] } },
        { kind: 'retitle', from: 'Ebola in Ituri', to: 'Ebola in eastern Congo' },
        { kind: 'unfreeze' },
      ],
      refusals: [],
      kept: 3,
      scope: 'ongoing',
      brake: null,
      answer: null,
      model: 'm',
      promptVersion: 'v',
      costUsd: 0,
    } as never
    const reviewed = run(at, planReview(at, c, result, ctx()))
    expect(reviewed.rows.overview).toMatchObject({ title: 'Ebola in eastern Congo', frozen: false, reviewedAt: NOW, entriesAtLastReview: 3 })
    const undo = run(reviewed.rows, planUndo(reviewed.decision, reviewed.rows, ctx(LATER)))
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
        c,
        { ...(result as object), actions: [{ kind: 'detach', entryId: 'e2', storyId: 's2', reason: 'No.' }], kept: 1, scope: 'single' } as never,
        ctx(),
      ),
    )
    const restored = run(cut.rows, planUndo(cut.decision, cut.rows, ctx(LATER)))
    expect(restored.rows.overview).toMatchObject({ scope: 'forming', entriesAtLastReview: 1 })

    // An editor retitled it since: the review is undone whole or not at all
    const retitled = { ...reviewed.rows, overview: { ...reviewed.rows.overview, title: 'Mine' } }
    expect(refusal(() => planUndo(reviewed.decision, retitled, ctx(LATER)))).toMatch(/its title changed after it, and a review is undone whole or not at all/)
  })

  it('refuses a decision undone already, one it cannot reverse, a founding’s link and one that recorded no change set', () => {
    const d = (over: Partial<UndoTarget>): UndoTarget => ({ id: 'd', kind: 'status', outcome: 'quiet', storyId: null, inputs: {}, undoneAt: null, ...over })
    expect(refusal(() => planUndo(d({ undoneAt: NOW }), rows(), ctx()))).toMatch(/already undone/)
    expect(refusal(() => planUndo(d({}), rows(), ctx()))).toMatch(/cannot be undone/)
    expect(refusal(() => planUndo(d({ kind: 'link', outcome: 'founded' }), rows(), ctx()))).toMatch(/Undo the founding instead/)
    expect(refusal(() => planUndo(d({ kind: 'editor_hide', outcome: 'hidden', inputs: { target: null } }), rows(), ctx()))).toMatch(
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

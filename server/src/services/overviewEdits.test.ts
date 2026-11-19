import { describe, expect, it } from 'vitest'
import { ConflictError } from '../utils/errors.js'
import { planEdit, planUndo, undoable, type EditEntry, type EditOverview, type UndoTarget } from './overviewEdits.js'

const NOW = new Date('2026-11-18T12:00:00Z')
const ctx = { editorId: 'ed-1', now: NOW }
const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }

const overview = (over: Partial<EditOverview> = {}): EditOverview => ({
  id: 'o1',
  title: 'Ebola in Ituri',
  scope: 'ongoing',
  status: 'open',
  closedAt: null,
  closedReason: null,
  closingSince: null,
  frozen: false,
  hidden: false,
  charter,
  entriesAtLastReview: 3,
  activeEntries: 3,
  closingStoryId: null,
  lastFreezeId: null,
  ...over,
})

const entry = (over: Partial<EditEntry> = {}): EditEntry => ({
  id: 'e1',
  storyId: 's1',
  published: true,
  status: 'active',
  detachedBy: null,
  detachReason: null,
  detachedAt: null,
  locked: false,
  role: 'routine',
  roleKind: null,
  ...over,
})

const decision = (over: Partial<UndoTarget> = {}): UndoTarget => ({
  id: 'd1',
  kind: 'link',
  outcome: 'joined',
  storyId: 's1',
  inputs: {},
  undoneAt: null,
  ...over,
})

/** The decision an editor's plan is logged as, so its undo reads its changes back as JSON does. */
const logged = (kind: string, changes: unknown, extra: object = {}): UndoTarget =>
  decision({ kind, outcome: 'x', inputs: JSON.parse(JSON.stringify({ changes, ...extra })) as unknown })

describe('planEdit', () => {
  it('attaches a published story in no overview as the editor’s, creating its row in the state an undo leaves', () => {
    const story = { id: 's9', published: true, activeIn: null, rowHere: null }
    const plan = planEdit(
      { kind: 'attach', overviewId: 'o1', storyId: 's9', role: { role: 'routine', roleKind: 'spread' } },
      overview({ scope: 'single', activeEntries: 1 }),
      { story, newEntryId: 'new' },
      ctx,
    )
    expect(plan.create).toEqual({
      id: 'new',
      storyId: 's9',
      fields: { status: 'detached', detachedBy: 'ed-1', detachReason: 'undone', detachedAt: NOW, locked: false, role: 'routine', roleKind: null },
    })
    expect(plan.changes).toEqual([
      {
        table: 'entry',
        id: 'new',
        before: { status: 'detached', detachedBy: 'ed-1', detachReason: 'undone', detachedAt: NOW, locked: false },
        after: { status: 'active', detachedBy: null, detachReason: null, detachedAt: null, locked: true },
      },
      { table: 'overview', id: 'o1', before: { scope: 'single' }, after: { scope: 'forming' } },
    ])
    expect(plan).toMatchObject({ kind: 'editor_attach', outcome: 'attached', storyId: 's9' })
  })

  it('reuses a detached row of the story, and refuses a story unpublished or in an overview', () => {
    const rowHere = entry({ id: 'e7', storyId: 's9', status: 'detached', detachedBy: 'ed-0', detachReason: 'editor', detachedAt: NOW, locked: true })
    const plan = planEdit(
      { kind: 'attach', overviewId: 'o1', storyId: 's9', role: { role: 'routine', roleKind: null } },
      overview(),
      { story: { id: 's9', published: true, activeIn: null, rowHere } },
      ctx,
    )
    expect(plan.create).toBeNull()
    expect(plan.changes[0]).toMatchObject({ table: 'entry', id: 'e7', after: { status: 'active', detachReason: null } })

    const attach = (story: { published: boolean; activeIn: { overviewId: string; title: string } | null }) => () =>
      planEdit(
        { kind: 'attach', overviewId: 'o1', storyId: 's9', role: { role: 'routine', roleKind: null } },
        overview(),
        { story: { id: 's9', rowHere: null, ...story }, newEntryId: 'n' },
        ctx,
      )
    expect(attach({ published: false, activeIn: null })).toThrow(ConflictError)
    expect(attach({ published: true, activeIn: { overviewId: 'o1', title: 'Ebola in Ituri' } })).toThrow('already in this overview')
    expect(attach({ published: true, activeIn: { overviewId: 'o2', title: 'Cholera' } })).toThrow('The story is in "Cholera": detach it there first')
  })

  it('detaches an entry as locked, recomputes the scope and cancels a closing its story began', () => {
    const plan = planEdit(
      { kind: 'detach', overviewId: 'o1', entryId: 'e1' },
      overview({ scope: 'forming', activeEntries: 2, status: 'closing', closingSince: NOW, closingStoryId: 's1' }),
      { entry: entry() },
      ctx,
    )
    expect(plan.changes).toEqual([
      {
        table: 'entry',
        id: 'e1',
        before: { status: 'active', detachedBy: null, detachReason: null, detachedAt: null, locked: false },
        after: { status: 'detached', detachedBy: 'ed-1', detachReason: 'editor', detachedAt: NOW, locked: true },
      },
      {
        table: 'overview',
        id: 'o1',
        before: { scope: 'forming', status: 'closing', closingSince: NOW },
        after: { scope: 'single', status: 'open', closingSince: null },
      },
    ])
    expect(() => planEdit({ kind: 'detach', overviewId: 'o1', entryId: 'e1' }, overview(), { entry: entry({ status: 'detached' }) }, ctx)).toThrow(
      'already detached',
    )
  })

  it('sets a role as locked, a routine one without a kind, and refuses the role it has', () => {
    const plan = planEdit(
      { kind: 'role', overviewId: 'o1', entryId: 'e1', role: { role: 'turning_point', roleKind: 'response' } },
      overview(),
      { entry: entry() },
      ctx,
    )
    expect(plan.changes).toEqual([
      {
        table: 'entry',
        id: 'e1',
        before: { role: 'routine', roleKind: null, locked: false },
        after: { role: 'turning_point', roleKind: 'response', locked: true },
      },
    ])
    expect(() =>
      planEdit({ kind: 'role', overviewId: 'o1', entryId: 'e1', role: { role: 'routine', roleKind: 'spread' } }, overview(), { entry: entry() }, ctx),
    ).toThrow('already has that role')
  })

  it('retitles, freezes, hides, closes and reopens, refusing what would change nothing', () => {
    const o = overview()
    expect(planEdit({ kind: 'retitle', overviewId: 'o1', title: 'Ebola' }, o, {}, ctx).changes).toEqual([
      { table: 'overview', id: 'o1', before: { title: 'Ebola in Ituri' }, after: { title: 'Ebola' } },
    ])
    expect(planEdit({ kind: 'freeze', overviewId: 'o1', frozen: true }, o, {}, ctx).outcome).toBe('frozen')
    expect(planEdit({ kind: 'hide', overviewId: 'o1', hidden: true }, o, {}, ctx).outcome).toBe('hidden')
    expect(planEdit({ kind: 'close', overviewId: 'o1', closed: true }, o, {}, ctx).changes[0]).toMatchObject({
      after: { status: 'closed', closedAt: NOW, closedReason: 'editor' },
    })
    const reopen = planEdit({ kind: 'close', overviewId: 'o1', closed: false }, overview({ status: 'closed', closedReason: 'faded', closedAt: NOW }), {}, ctx)
    expect(reopen).toMatchObject({ outcome: 'reopened', reopens: true })
    expect(reopen.changes[0]).toMatchObject({ after: { status: 'open', closedAt: null, closedReason: null } })
    for (const action of [
      { kind: 'retitle', overviewId: 'o1', title: 'Ebola in Ituri' },
      { kind: 'freeze', overviewId: 'o1', frozen: false },
      { kind: 'hide', overviewId: 'o1', hidden: false },
      { kind: 'close', overviewId: 'o1', closed: false },
    ] as const)
      expect(() => planEdit(action, o, {}, ctx)).toThrow(ConflictError)
  })
})

describe('planUndo', () => {
  it("undoes an editor's action by its changes the other way round, and an undo of that undo restores it again", () => {
    const edit = planEdit({ kind: 'detach', overviewId: 'o1', entryId: 'e1' }, overview(), { entry: entry() }, ctx)
    const undo = planUndo(logged('editor_detach', edit.changes), overview(), [], ctx)
    expect(undo.changes.map(c => [c.before, c.after])).toEqual(edit.changes.map(c => [c.after, c.before]))
    expect(undo.relive).toBeNull()
    const redo = planUndo(logged('undo', undo.changes, { target: 'd-edit' }), overview(), [], ctx)
    expect(redo.changes.map(c => [c.before, c.after])).toEqual(edit.changes.map(c => [c.before, c.after]))
    expect(redo.relive).toBe('d-edit')
  })

  it('undoes a join by detaching its entry, undone and locked, and a founding by detaching both its entries', () => {
    const join = planUndo(decision(), overview({ activeEntries: 3 }), [entry(), entry({ id: 'e2', storyId: 's2' })], ctx)
    expect(join.changes[0]).toEqual({
      table: 'entry',
      id: 'e1',
      before: { status: 'active', detachedBy: null, detachReason: null, detachedAt: null, locked: false },
      after: { status: 'detached', detachedBy: 'ed-1', detachReason: 'undone', detachedAt: NOW, locked: true },
    })
    const founding = planUndo(
      decision({ kind: 'found', outcome: 'founded', inputs: { partnerId: 's2' } }),
      overview({ scope: 'forming', activeEntries: 2 }),
      [entry(), entry({ id: 'e2', storyId: 's2' })],
      ctx,
    )
    expect(founding.changes.map(c => c.id)).toEqual(['e1', 'e2', 'o1'])
    expect(founding.changes[2]).toMatchObject({ after: { scope: 'single' } })
    expect(() => planUndo(decision(), overview(), [entry({ status: 'detached' })], ctx)).toThrow('no longer in this overview')
  })

  it('reopens a closure while it stands, opens a closing again and clears a burst freeze', () => {
    const closure = decision({
      kind: 'status',
      outcome: 'closed',
      inputs: JSON.parse(JSON.stringify({ from: 'quiet', to: 'closed', reason: 'faded', clock: NOW })) as unknown,
    })
    const undone = planUndo(closure, overview({ status: 'closed', closedReason: 'faded', closedAt: NOW }), [], ctx)
    expect(undone).toMatchObject({ reopens: true, changes: [{ after: { status: 'open', closedAt: null, closedReason: null } }] })
    expect(() => planUndo(closure, overview({ status: 'closed', closedReason: 'editor' }), [], ctx)).toThrow('no longer closed')
    expect(
      planUndo(decision({ kind: 'close', outcome: 'closing' }), overview({ status: 'closing', closingSince: NOW, closingStoryId: 's1' }), [], ctx).changes[0],
    ).toMatchObject({
      after: { status: 'open', closingSince: null },
    })
    expect(planUndo(decision({ kind: 'status', outcome: 'frozen' }), overview({ frozen: true, lastFreezeId: 'd1' }), [], ctx).changes).toEqual([
      { table: 'overview', id: 'o1', before: { frozen: true }, after: { frozen: false } },
    ])
  })

  it('undoes an old closing, closure or freeze only while it is the one the overview is in now', () => {
    // A closing begun by another story since: its own was cancelled
    const closing = decision({ kind: 'close', outcome: 'closing', storyId: 's1' })
    expect(() => planUndo(closing, overview({ status: 'closing', closingSince: NOW, closingStoryId: 's2' }), [], ctx)).toThrow('no longer closing')
    // Closed again by a later run, at another day
    const closure = decision({ kind: 'status', outcome: 'closed', inputs: { reason: 'faded', clock: '2026-10-01T00:00:00.000Z' } })
    expect(() => planUndo(closure, overview({ status: 'closed', closedReason: 'faded', closedAt: NOW }), [], ctx)).toThrow('no longer closed')
    expect(() =>
      planUndo(
        decision({ kind: 'status', outcome: 'closed', inputs: { reason: 'faded' } }),
        overview({ status: 'closed', closedReason: 'faded', closedAt: NOW }),
        [],
        ctx,
      ),
    ).toThrow('no longer closed')
    // Frozen again since, by an editor or a later burst
    expect(() => planUndo(decision({ kind: 'status', outcome: 'frozen' }), overview({ frozen: true, lastFreezeId: 'd-later' }), [], ctx)).toThrow(
      'frozen again since',
    )
  })

  it("restores what still stands of a review's demotions", () => {
    const narrowed = { ...charter, out: [...charter.out, 'cholera'] }
    const review = decision({
      kind: 'review',
      outcome: 'reviewed',
      storyId: null,
      inputs: {
        actions: [
          { kind: 'detach', entryId: 'e2', storyId: 's2', reason: 'Cholera.' },
          { kind: 'relabel', entryId: 'e1', storyId: 's1', from: { role: 'routine', roleKind: null }, to: { role: 'turning_point', roleKind: 'spread' } },
          { kind: 'narrow', added: ['cholera'], charter: narrowed },
          { kind: 'retitle', from: 'Ebola', to: 'Ebola in Ituri' },
          { kind: 'unfreeze' },
        ],
      },
    })
    const entries = [
      entry({ role: 'turning_point', roleKind: 'spread' }),
      entry({ id: 'e2', storyId: 's2', status: 'detached', detachReason: 'review', detachedBy: 'review', detachedAt: NOW }),
    ]
    const plan = planUndo(review, overview({ charter: narrowed, scope: 'ongoing', activeEntries: 5, entriesAtLastReview: 5 }), entries, ctx)
    // What it restores is the editor's now: locked, so the next review neither detaches nor relabels it again
    expect(plan.changes).toEqual([
      {
        table: 'entry',
        id: 'e2',
        before: { status: 'detached', detachedBy: 'review', detachReason: 'review', detachedAt: NOW, locked: false },
        after: { status: 'active', detachedBy: null, detachReason: null, detachedAt: null, locked: true },
      },
      {
        table: 'entry',
        id: 'e1',
        before: { role: 'turning_point', roleKind: 'spread', locked: false },
        after: { role: 'routine', roleKind: null, locked: true },
      },
      {
        table: 'overview',
        id: 'o1',
        before: { charter: narrowed, title: 'Ebola in Ituri', entriesAtLastReview: 5 },
        after: { charter, title: 'Ebola', entriesAtLastReview: 6 },
      },
    ])
    // The OUT entries it took back out are locked too, so no review adds them again
    expect(plan.lockedOut).toEqual(['cholera'])
    // Nothing of it stands any more
    expect(() => planUndo(review, overview({ title: 'Other' }), [entry(), entry({ id: 'e2', storyId: 's2' })], ctx)).toThrow('Nothing this decision changed')
  })

  it('leaves the review count of an overview still forming, so a review decides whether it goes public', () => {
    const review = decision({
      kind: 'review',
      outcome: 'reviewed',
      storyId: null,
      inputs: { actions: [{ kind: 'detach', entryId: 'e2', storyId: 's2', reason: 'No.' }] },
    })
    const entries = [entry(), entry({ id: 'e2', storyId: 's2', status: 'detached', detachReason: 'review', detachedBy: 'review', detachedAt: NOW })]
    const plan = planUndo(review, overview({ scope: 'forming', activeEntries: 2, entriesAtLastReview: 2 }), entries, ctx)
    expect(plan.changes.find(c => c.table === 'overview')).toBeUndefined()
    expect(plan.lockedOut).toEqual([])
  })

  it('refuses what cannot be undone or already is', () => {
    expect(() => planUndo(decision({ undoneAt: NOW }), overview(), [entry()], ctx)).toThrow('already undone')
    expect(() => planUndo(decision({ outcome: 'founded' }), overview(), [entry()], ctx)).toThrow('Undo the founding instead')
    expect(() => planUndo(decision({ kind: 'stands', outcome: 'written' }), overview(), [], ctx)).toThrow('cannot be undone')
    expect(() => planUndo(decision({ kind: 'editor_hide', inputs: {} }), overview(), [], ctx)).toThrow('did not record')
  })
})

describe('undoable', () => {
  it("offers Undo on an editor's action, an undo and the automated decisions it can reverse, never twice", () => {
    const offered = (kind: string, outcome: string, undoneAt: Date | null = null) => undoable({ kind, outcome, undoneAt })
    expect(['editor_attach', 'editor_close', 'undo'].map(k => offered(k, 'x'))).toEqual([true, true, true])
    expect([offered('link', 'joined'), offered('link', 'none'), offered('found', 'founded'), offered('found', 'disagreed')]).toEqual([true, false, true, false])
    expect([
      offered('status', 'closed'),
      offered('status', 'frozen'),
      offered('status', 'quiet'),
      offered('close', 'closing'),
      offered('review', 'reviewed'),
      offered('stands', 'written'),
    ]).toEqual([true, true, false, true, true, false])
    expect(offered('link', 'joined', NOW)).toBe(false)
  })
})

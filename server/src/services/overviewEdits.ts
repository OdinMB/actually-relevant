/**
 * An editor's corrections to an overview and Undo (`.context/overviews.md`, "Editor actions and
 * undo"), planned as change sets on the rows as they stand (`overviewChanges.ts`), like every
 * automated write. Undo of any decision is the change set it stored, the other way round, applied only
 * while every row still holds what that decision left: whole or not at all, never in part. Undoing an
 * automated decision also makes what it restores the editor's (`stamped`). A refusal is a
 * ConflictError with its reason in the editor's words. Pure.
 */
import { normalizeQuote } from '../lib/quoteMatch.js'
import { ConflictError } from '../utils/errors.js'
import {
  ACTIVE,
  CLOSING_CANCELLED,
  OPEN,
  UNFROZEN,
  applied,
  changesFrom,
  draft,
  entryChange,
  inverted,
  leaving,
  notHolding,
  overviewChange,
  plan,
  publicBefore,
  sameValue,
  type Change,
  type ChainMark,
  type DecisionDraft,
  type EntryFields,
  type EntryRow,
  type NewEntry,
  type OverviewFields,
  type OverviewRow,
  type Plan,
  type Rows,
} from './overviewChanges.js'
import { readInputs, recenterInputs, reviewInputs, storedChanges, type EditorRecenterInputs, type StatusInputs } from './overviewDecisions.js'
import { endEventOf, type Charter, type Role } from './overviewTypes.js'

/** An editor's action on an overview (For Odin 8: the full set, each logged and undoable). */
export type EditorAction =
  | { kind: 'attach'; overviewId: string; storyId: string; role: Role }
  | { kind: 'detach'; overviewId: string; entryId: string }
  | { kind: 'role'; overviewId: string; entryId: string; role: Role }
  | { kind: 'retitle'; overviewId: string; title: string }
  | { kind: 'freeze'; overviewId: string; frozen: boolean }
  | { kind: 'hide'; overviewId: string; hidden: boolean }
  | { kind: 'close'; overviewId: string; closed: boolean }
  /** A new title and whole charter (`.context/overviews.md`, "Re-centering"), with the editor's word that it still covers the anchor. */
  | { kind: 'recenter'; overviewId: string; title: string; charter: Charter; anchorConfirmed: boolean }

export const EDITOR_KINDS = [
  'editor_attach',
  'editor_detach',
  'editor_role',
  'editor_retitle',
  'editor_freeze',
  'editor_hide',
  'editor_close',
  'editor_recenter',
] as const
export type EditorKind = (typeof EDITOR_KINDS)[number]

const KIND_OF: Record<EditorAction['kind'], EditorKind> = {
  attach: 'editor_attach',
  detach: 'editor_detach',
  role: 'editor_role',
  retitle: 'editor_retitle',
  freeze: 'editor_freeze',
  hide: 'editor_hide',
  close: 'editor_close',
  recenter: 'editor_recenter',
}

/** What an attach reads of the story: whether it is published and when, the overview it is in now, and its newest row in this overview if it ever had one. */
export interface AttachStory {
  id: string
  published: boolean
  datePublished: Date | null
  activeIn: { overviewId: string; title: string } | null
  rowHere: EntryRow | null
}

export interface EditContext {
  editorId: string
  now: Date
  /** A fresh id for a decision or an entry. */
  newId: () => string
}

const roleFields = (r: Role) => ({ role: r.role, roleKind: r.role === 'routine' ? null : r.roleKind })

/**
 * The plan of an editor's action (`.context/overviews.md`, "Editor actions and undo"):
 * - attach: a published story that is in no overview joins this one, unless it is closed, as the
 *   editor's (`locked`, so no review detaches it or changes its role), reusing its row here if it had
 *   one;
 * - detach: the entry leaves, `locked`, so automation never links the story there again;
 * - role: the entry takes the role, `locked`;
 * - retitle, hide or show;
 * - freeze (the editor's, which only an editor lifts) or unfreeze (the burst check counting from now);
 * - close (`editor`, which automation never moves) or reopen (open again, quiet counted from now);
 * - re-center (`recentered`): see `editorRecenter`.
 * A closing whose end-event story leaves is cancelled (`leaving`); the scope and the last entry follow
 * the entries. An action that would change nothing is refused.
 */
export function planEdit(action: EditorAction, rows: Rows, attach: AttachStory | null, entryId: string | null, ctx: EditContext): Plan {
  const o = rows.overview
  const decisionId = ctx.newId()
  const inputs: EditorRecenterInputs = action.kind === 'recenter' ? { target: null, anchorConfirmed: action.anchorConfirmed } : { target: null }
  const decide = (outcome: string, storyId: string | null, changes: Change[], over: Partial<Plan> = {}): Plan =>
    plan(draft({ id: decisionId, kind: KIND_OF[action.kind], outcome, overviewId: o.id, storyId, inputs, actor: ctx.editorId }), {
      changes,
      wasPublic: publicBefore(o),
      ...over,
    })
  const activeEntry = () => {
    const e = rows.entries.find(x => x.id === entryId)
    if (!e) throw new ConflictError('That entry is not in this overview')
    if (e.status !== 'active') throw new ConflictError('That entry is already detached')
    return e
  }
  switch (action.kind) {
    case 'attach': {
      const s = attach!
      if (!s.published || !s.datePublished) throw new ConflictError('Only a published story can join an overview')
      if (s.activeIn?.overviewId === o.id) throw new ConflictError('The story is already in this overview')
      if (s.activeIn) throw new ConflictError(`The story is in "${s.activeIn.title}": detach it there first`)
      if (o.status === 'closed') throw new ConflictError('The overview is closed: reopen it first')
      const created: NewEntry | null = s.rowHere
        ? null
        : {
            id: ctx.newId(),
            overviewId: o.id,
            storyId: s.id,
            joinedBy: 'editor',
            joinedAt: ctx.now,
            decisionId,
            fields: { status: 'detached', detachedBy: ctx.editorId, detachReason: 'undone', detachedAt: ctx.now, locked: false, ...roleFields(action.role) },
            datePublished: s.datePublished,
            shared: null,
            confidence: null,
            model: null,
            promptVersion: null,
          }
      const row: EntryFields & { id: string } = s.rowHere ?? { ...created!.fields, id: created!.id }
      return decide('attached', s.id, entryChange(row, { ...ACTIVE, locked: true, ...roleFields(action.role) }), { newEntries: created ? [created] : [] })
    }
    case 'detach': {
      const e = activeEntry()
      const changes = [
        ...entryChange(e, { status: 'detached', detachedBy: ctx.editorId, detachReason: 'editor', detachedAt: ctx.now, locked: true }),
        ...overviewChange(o, leaving(o, [e.storyId])),
      ]
      return decide('detached', e.storyId, changes)
    }
    case 'role': {
      const e = activeEntry()
      const to = roleFields(action.role)
      if (e.role === to.role && e.roleKind === to.roleKind) throw new ConflictError('The entry already has that role')
      return decide('set', e.storyId, entryChange(e, { ...to, locked: true }))
    }
    case 'retitle':
      if (action.title === o.title) throw new ConflictError('The overview already has that title')
      return decide('retitled', null, overviewChange(o, { title: action.title }))
    case 'freeze':
      if (action.frozen === o.frozen) throw new ConflictError(o.frozen ? 'The overview is already frozen' : 'The overview is not frozen')
      return decide(
        action.frozen ? 'frozen' : 'unfrozen',
        null,
        overviewChange(
          o,
          action.frozen ? { frozen: true, frozenBy: 'editor', frozenAt: ctx.now, joinsCountedFrom: ctx.now } : { ...UNFROZEN, joinsCountedFrom: ctx.now },
        ),
      )
    case 'hide':
      if (action.hidden === o.hidden) throw new ConflictError(o.hidden ? 'The overview is already hidden' : 'The overview is not hidden')
      return decide(action.hidden ? 'hidden' : 'shown', null, overviewChange(o, { hidden: action.hidden }))
    case 'close':
      if (action.closed) {
        if (o.status === 'closed') throw new ConflictError('The overview is already closed')
        return decide('closed', null, overviewChange(o, { ...OPEN, status: 'closed', closedAt: ctx.now, closedReason: 'editor' }))
      }
      if (o.status !== 'closed') throw new ConflictError('The overview is not closed')
      return decide('reopened', null, overviewChange(o, { ...OPEN, reopenedAt: ctx.now }))
    case 'recenter': {
      const { changes, also } = editorRecenter(o, action, ctx)
      return decide('recentered', null, changes, { also })
    }
  }
}

const sameText = (a: string, b: string) => normalizeQuote(a).toLowerCase() === normalizeQuote(b).toLowerCase()

/**
 * An editor's re-center (`.context/overviews.md`, "Re-centering"; D-RC7, D-RC10, D-RC11, D-RC14): the
 * title and the whole charter as given, so an editor may also drop OUT entries, name no end event and
 * re-admit an OUT entry a review's undo locked out (which leaves `lockedOut`); on any overview not
 * closed, frozen or not, past the limit of automated re-centers (which it neither raises nor resets).
 * It needs the editor's confirmation that the charter still covers the anchor (recorded, never judged)
 * and is the editor's (`recenteredBy`), which keeps automation from re-centering it for
 * `editorRecenterLockDays` and queues a review (`reviewDue`). A changed END_EVENT, to none too, cancels
 * a closing, logged as an `open` status decision (`recentered`): the closing was begun on the old one.
 * The AI marker's model fields stay, as a retitle leaves them.
 */
function editorRecenter(o: OverviewRow, action: Extract<EditorAction, { kind: 'recenter' }>, ctx: EditContext): { changes: Change[]; also: DecisionDraft[] } {
  if (o.status === 'closed') throw new ConflictError('The overview is closed: reopen it first')
  if (!action.anchorConfirmed) throw new ConflictError('Confirm the anchor first')
  if (action.title === o.title && sameValue(action.charter, o.charter)) throw new ConflictError('The overview already has that title and charter')
  const fields: Partial<OverviewFields> = {
    title: action.title,
    charter: action.charter,
    lockedOut: o.lockedOut.filter(x => !action.charter.out.some(out => sameText(out, x))),
    recenteredAt: ctx.now,
    recenteredBy: 'editor',
  }
  const cancels = o.status === 'closing' && endEventOf(action.charter.endEvent) !== endEventOf(o.charter.endEvent)
  if (!cancels) return { changes: overviewChange(o, fields), also: [] }
  const move: StatusInputs = { from: 'closing', to: 'open', reason: 'recentered', by: 'editor' }
  return {
    changes: overviewChange(o, { ...fields, ...CLOSING_CANCELLED }),
    also: [draft({ id: ctx.newId(), kind: 'status', outcome: 'open', overviewId: o.id, storyId: o.closingStoryId, inputs: move, actor: ctx.editorId })],
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** A decision as Undo reads it. */
export interface UndoTarget {
  id: string
  kind: string
  outcome: string
  storyId: string | null
  inputs: unknown
  undoneAt: Date | null
}

const isEditorKind = (kind: string) => (EDITOR_KINDS as readonly string[]).includes(kind)

/** The automated decisions Undo reverses, by kind and outcome. */
const AUTOMATED: Record<string, readonly string[]> = {
  link: ['joined'],
  found: ['founded'],
  status: ['closed', 'frozen'],
  close: ['closing'],
  review: ['reviewed'],
  recenter: ['recentered'],
}

/** Whether the admin offers Undo on a decision: one not undone, of a kind and outcome `planUndo` can reverse. */
export function undoable(d: Pick<UndoTarget, 'kind' | 'outcome' | 'undoneAt'>): boolean {
  if (d.undoneAt) return false
  if (isEditorKind(d.kind) || d.kind === 'undo') return true
  return AUTOMATED[d.kind]?.includes(d.outcome) ?? false
}

/** The decisions of many changes, named in a refusal so the editor knows no part of one is undone. */
const WHOLE: Record<string, string> = { review: 'a review', recenter: 'a re-center', editor_recenter: 'a re-center' }

/** What a field that no longer holds is, in the editor's words. */
function what(change: Change, field: string): string {
  if (change.table === 'entry') {
    if (field === 'row') return 'a story it placed'
    return field === 'role' || field === 'roleKind' ? "an entry's role" : 'an entry it moved'
  }
  const words: Record<string, string> = {
    status: 'its status',
    closedAt: 'its closure',
    closedReason: 'its closure',
    closingSince: 'its closing',
    closingStoryId: 'its closing',
    frozen: 'its freeze',
    frozenBy: 'its freeze',
    frozenAt: 'its freeze',
    hidden: 'whether it is hidden',
    title: 'its title',
    charter: 'its charter',
    charterModel: 'its charter',
    charterPromptVersion: 'its charter',
    lockedOut: "its charter's locked-out entries",
    recenteredAt: 'its last re-center',
    recenteredBy: 'its last re-center',
    automatedRecenters: 'its count of automatic re-centers',
    reopenedAt: 'its reopening',
  }
  return words[field] ?? 'the overview'
}

/**
 * What undoing an automated decision makes the editor's, on top of its changes inverted: an entry it
 * moves `locked` (detached as `undone` by the editor, now), so automation never moves it back; a freeze
 * it puts back the editor's, which only an editor lifts; an overview it takes out of `closed` open
 * again, quiet counted from now; for a review or an automated re-center, the OUT entries it added
 * locked out (`lockedOut`), so no review or re-center adds them again while the undo stands; and for an
 * automated re-center, the re-center the Undo's (`recenteredBy` `undo`), which keeps automation from
 * re-centering it for `editorRecenterLockDays` and queues no review.
 */
function stamped(changes: readonly Change[], rows: Rows, d: UndoTarget, ctx: EditContext): Change[] {
  const o = rows.overview
  const lockedOut = outAdded(d)
  return changes.flatMap(c => {
    if (c.table === 'entry') {
      const e = rows.entries.find(x => x.id === c.id)!
      const detaches = c.after.status === 'detached'
      return entryChange(e, { ...c.after, locked: true, ...(detaches ? { detachedBy: ctx.editorId, detachReason: 'undone', detachedAt: ctx.now } : {}) })
    }
    const to: Partial<OverviewFields> = { ...c.after }
    if (c.before.status === 'closed' && to.status !== undefined && to.status !== 'closed') Object.assign(to, OPEN, { reopenedAt: ctx.now })
    if (to.frozen === true) Object.assign(to, { frozenBy: 'editor', frozenAt: ctx.now })
    if (lockedOut.length > 0) to.lockedOut = [...new Set([...o.lockedOut, ...lockedOut])]
    if (d.kind === 'recenter') Object.assign(to, { recenteredAt: ctx.now, recenteredBy: 'undo' })
    return overviewChange(o, to)
  })
}

/** The OUT entries an automated decision added: a review's narrowing, an automated re-center's (`outAdded`). */
function outAdded(d: UndoTarget): string[] {
  if (d.kind === 'review') return (readInputs(reviewInputs, d.inputs)?.actions ?? []).flatMap(a => (a.kind === 'narrow' ? a.added : []))
  if (d.kind === 'recenter') return readInputs(recenterInputs, d.inputs)?.outAdded ?? []
  return []
}

/** A decision as an undo chain is read: an `undo` names the decision it undid (`inputs.target`). */
export type UndoLink = Pick<UndoTarget, 'id' | 'kind' | 'inputs'>

/**
 * What undoing `d` does below it (`.context/overviews.md`, "Editor actions and undo"): each undo's
 * target is undone exactly while the undo is live, at any depth. So when `d` is an undo, the decision it
 * undid is live again; when that one was itself an undo, the decision it undid is undone again; and so
 * on down to the first decision that is not an undo. `undos` are the overview's undo decisions.
 */
export function undoChain(d: UndoLink, undos: readonly UndoLink[]): ChainMark[] {
  const byId = new Map(undos.map(u => [u.id, u]))
  const marks: ChainMark[] = []
  const seen = new Set([d.id])
  let at: UndoLink | undefined = d
  while (at?.kind === 'undo') {
    const target = readTarget(at.inputs)
    if (target === null || seen.has(target)) break
    seen.add(target)
    marks.push({ decisionId: target, undone: marks.length % 2 === 1 })
    at = byId.get(target)
  }
  return marks
}

/**
 * The plan undoing one decision (`.context/overviews.md`, "Editor actions and undo"): the change set it
 * stored the other way round (`inverted`), applied only while every row still holds what the decision
 * left; otherwise refused whole, naming what changed after it, so a later change is undone first. An
 * undo of an undo makes the decision it had undone live again, and the chain below it consistent
 * (`undoChain`, read from the overview's `undos`). Undoing an automated decision (a join, a founding, a
 * closure or a closing begun, a burst's freeze, a review, a re-center) also makes what it restores the
 * editor's (`stamped`). An Undo of a re-center, an editor's or automation's, puts back its count of
 * automated re-centers and the last re-center before it, so an editor's lock is lifted with it. The
 * fields that follow the entries, a given slug and a review's run are never put back (`inverted`). A join's undo makes its story owed again (the lifecycle marks the decision undone): it
 * may join another overview, never this one, where its entry is locked.
 */
export function planUndo(d: UndoTarget, rows: Rows, undos: readonly UndoLink[], ctx: EditContext): Plan {
  if (d.undoneAt) throw new ConflictError('This decision is already undone')
  if (!undoable(d)) throw new ConflictError(d.kind === 'link' && d.outcome === 'founded' ? 'Undo the founding instead' : 'This decision cannot be undone')
  const stored = storedChanges(d.kind, d.outcome, d.inputs)
  if (stored.length === 0) throw new ConflictError('This decision did not record what it changed, so it cannot be undone')
  const back = inverted(changesFrom(stored))
  if (back.length === 0) throw new ConflictError('Nothing this decision changed is left to undo')
  const stale = notHolding(back, rows)
  if (stale) {
    const whole = WHOLE[d.kind] ? `, and ${WHOLE[d.kind]} is undone whole or not at all` : ''
    throw new ConflictError(`This cannot be undone: ${what(stale.change, stale.field)} changed after it${whole}. Undo the later change first.`)
  }
  const automated = !isEditorKind(d.kind) && d.kind !== 'undo'
  const changes = automated ? stamped(back, rows, d, ctx) : back
  const p = plan(
    draft({
      id: ctx.newId(),
      kind: 'undo',
      outcome: 'undone',
      overviewId: rows.overview.id,
      storyId: d.storyId,
      inputs: { target: d.id },
      actor: ctx.editorId,
    }),
    {
      changes,
      chain: undoChain(d, undos),
      wasPublic: publicBefore(rows.overview),
    },
  )
  return d.kind === 'review' ? { ...p, changes: [...p.changes, ...recounted(rows, p)] } : p
}

/**
 * After a review's undo, an ongoing overview counts as reviewed at the active entries the undo leaves,
 * so the count trigger does not review it again at once for the entries it restored (which are locked
 * anyway). A forming one keeps its count: only a review makes an overview public (D-OV4), so it is
 * reviewed when its count is due.
 */
function recounted(rows: Rows, p: Plan): Change[] {
  const after = applied(rows, p)
  if (after.overview.scope !== 'ongoing') return []
  const active = after.entries.filter(e => e.status === 'active' && e.published).length
  return overviewChange(after.overview, { entriesAtLastReview: Math.max(active, after.overview.entriesAtLastReview) })
}

/** The decision an undo undid (`inputs.target`). */
function readTarget(inputs: unknown): string | null {
  const t = (inputs as { target?: unknown } | null)?.target
  return typeof t === 'string' ? t : null
}

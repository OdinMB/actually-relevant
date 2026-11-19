/**
 * An editor's corrections to an overview and Undo (`.context/overviews.md`, "Editor actions and
 * undo"), planned as change sets: each action and each undo is turned, from the rows as they stand,
 * into the fields it changes on the overview and its entries, before and after. The lifecycle applies
 * a plan only while the rows still hold `before` (a change made meanwhile is never overwritten) and
 * logs it with its changes, so undoing an editor's action, or an undo, is the same changes the other
 * way round. An automated decision's undo is planned from what that decision did: a join detached, a
 * founding's entries detached, a closure or a closing reopened, a burst's freeze cleared, a review's
 * detaches, relabels, narrowing and retitle restored. A refusal is a ConflictError with its reason in
 * the editor's words. Pure.
 */
import { z } from 'zod'
import { ConflictError } from '../utils/errors.js'
import { scopeAfter } from './overviewStatus.js'
import type { Charter, EntryRole, OverviewScope, OverviewStatus, Role } from './overviewTypes.js'

/** The overview fields an edit or an undo changes. */
export interface OverviewFields {
  title: string
  scope: OverviewScope
  status: OverviewStatus
  closedAt: Date | null
  closedReason: string | null
  closingSince: Date | null
  frozen: boolean
  hidden: boolean
  charter: Charter
  /** The active entries the last review kept (the count trigger, `reviewDue`). */
  entriesAtLastReview: number
}

/** The entry fields an edit or an undo changes. */
export interface EntryFields {
  status: 'active' | 'detached'
  detachedBy: string | null
  detachReason: string | null
  detachedAt: Date | null
  locked: boolean
  role: EntryRole
  roleKind: string | null
}

export type Change =
  | { table: 'overview'; id: string; before: Partial<OverviewFields>; after: Partial<OverviewFields> }
  | { table: 'entry'; id: string; before: Partial<EntryFields>; after: Partial<EntryFields> }

/** An editor's action on an overview (For Odin 8: the full set, each logged and undoable). */
export type EditorAction =
  | { kind: 'attach'; overviewId: string; storyId: string; role: Role }
  | { kind: 'detach'; overviewId: string; entryId: string }
  | { kind: 'role'; overviewId: string; entryId: string; role: Role }
  | { kind: 'retitle'; overviewId: string; title: string }
  | { kind: 'freeze'; overviewId: string; frozen: boolean }
  | { kind: 'hide'; overviewId: string; hidden: boolean }
  | { kind: 'close'; overviewId: string; closed: boolean }

export const EDITOR_KINDS = ['editor_attach', 'editor_detach', 'editor_role', 'editor_retitle', 'editor_freeze', 'editor_hide', 'editor_close'] as const
export type EditorKind = (typeof EDITOR_KINDS)[number]

const KIND_OF: Record<EditorAction['kind'], EditorKind> = {
  attach: 'editor_attach',
  detach: 'editor_detach',
  role: 'editor_role',
  retitle: 'editor_retitle',
  freeze: 'editor_freeze',
  hide: 'editor_hide',
  close: 'editor_close',
}

/**
 * An overview as an edit reads it: its fields, its active entries of published stories, while closing
 * the story that began it (the newest live `closing` decision's), and its newest live freeze decision,
 * a burst's or an editor's freeze or unfreeze.
 */
export interface EditOverview extends OverviewFields {
  id: string
  activeEntries: number
  closingStoryId: string | null
  lastFreezeId: string | null
}

export interface EditEntry extends EntryFields {
  id: string
  storyId: string | null
  /** Its story is published (only those count toward the scope). */
  published: boolean
}

/** What an attach reads of the story: whether it is published, the overview it is in now, and its row in this overview if it ever had one. */
export interface AttachStory {
  id: string
  published: boolean
  activeIn: { overviewId: string; title: string } | null
  rowHere: EditEntry | null
}

export interface EditContext {
  editorId: string
  now: Date
}

export interface EditPlan {
  kind: EditorKind | 'undo'
  outcome: string
  overviewId: string
  storyId: string | null
  changes: Change[]
  /** An attach of a story with no row in the overview yet: the row to create first, in the state an undo of the attach leaves; `changes` then activates it. */
  create: { id: string; storyId: string; fields: EntryFields } | null
  /** The plan reopens a closed overview: quiet and fading count from now (`OverviewState.reopenedAt`). */
  reopens: boolean
  /** An undo of an undo: the decision that undo had undone, live again. */
  relive: string | null
  /** An undo of a review: the OUT entries it took back out, which no review adds again while the undo stands (`ReviewCase.lockedOut`). */
  lockedOut: string[]
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function changed<F extends object>(from: F, to: Partial<F>): { before: Partial<F>; after: Partial<F> } {
  const keys = (Object.keys(to) as (keyof F)[]).filter(k => !sameValue(from[k], to[k]))
  const pick = (source: Partial<F>) => Object.fromEntries(keys.map(k => [k, source[k]])) as Partial<F>
  return { before: pick(from), after: pick(to) }
}

const overviewChange = (o: EditOverview, to: Partial<OverviewFields>): Change[] => {
  const c = changed<OverviewFields>(o, to)
  return Object.keys(c.after).length === 0 ? [] : [{ table: 'overview', id: o.id, ...c }]
}

const entryChange = (e: EntryFields & { id: string }, to: Partial<EntryFields>): Change[] => {
  const c = changed<EntryFields>(e, to)
  return Object.keys(c.after).length === 0 ? [] : [{ table: 'entry', id: e.id, ...c }]
}

/** What entries leaving does to the overview: the scope they leave, and a closing cancelled when its end-event story is among them. */
function leaving(o: EditOverview, entries: readonly EditEntry[]): Partial<OverviewFields> {
  const counted = entries.filter(e => e.published).length
  const cancels = o.status === 'closing' && o.closingStoryId !== null && entries.some(e => e.storyId === o.closingStoryId)
  return { scope: scopeAfter(o.scope, o.activeEntries - counted), ...(cancels ? { status: 'open' as const, closingSince: null } : {}) }
}

const ACTIVE = { status: 'active', detachedBy: null, detachReason: null, detachedAt: null } as const

const roleFields = (r: Role) => ({ role: r.role, roleKind: r.role === 'routine' ? null : r.roleKind })

const OPEN = { status: 'open', closedAt: null, closedReason: null, closingSince: null } as const

/**
 * The changes an editor's action makes (`.context/overviews.md`, "Editor actions and undo"):
 * - attach: a published story that is in no overview joins this one as the editor's (`locked`, so
 *   no review detaches it or changes its role), reusing its detached row here if it had one;
 * - detach: the entry leaves, `locked`, so automation never links the story there again;
 * - role: the entry takes the role, `locked`;
 * - retitle, freeze or unfreeze, hide or show;
 * - close (`editor`, which automation never moves) or reopen (open again, quiet counted from now).
 * Entries joining or leaving recompute the scope as the status machine does, and a closing whose
 * end-event story leaves is cancelled. An action that would change nothing is refused.
 */
export function planEdit(
  action: EditorAction,
  o: EditOverview,
  rows: { entry?: EditEntry | null; story?: AttachStory; newEntryId?: string },
  ctx: EditContext,
): EditPlan {
  const plan = (outcome: string, changes: Change[], over: Partial<EditPlan> = {}): EditPlan => ({
    kind: KIND_OF[action.kind],
    outcome,
    overviewId: o.id,
    storyId: null,
    changes,
    create: null,
    reopens: false,
    relive: null,
    lockedOut: [],
    ...over,
  })
  const activeEntry = () => {
    const e = rows.entry
    if (!e) throw new ConflictError('That entry is not in this overview')
    if (e.status !== 'active') throw new ConflictError('That entry is already detached')
    return e
  }
  switch (action.kind) {
    case 'attach': {
      const s = rows.story!
      if (!s.published) throw new ConflictError('Only a published story can join an overview')
      if (s.activeIn?.overviewId === o.id) throw new ConflictError('The story is already in this overview')
      if (s.activeIn) throw new ConflictError(`The story is in "${s.activeIn.title}": detach it there first`)
      const id = s.rowHere?.id ?? rows.newEntryId!
      const before: EntryFields = s.rowHere ?? {
        status: 'detached',
        detachedBy: ctx.editorId,
        detachReason: 'undone',
        detachedAt: ctx.now,
        locked: false,
        ...roleFields(action.role),
      }
      const changes = [
        ...entryChange({ ...before, id }, { ...ACTIVE, locked: true, ...roleFields(action.role) }),
        ...overviewChange(o, { scope: scopeAfter(o.scope, o.activeEntries + 1) }),
      ]
      return plan('attached', changes, { storyId: s.id, create: s.rowHere ? null : { id, storyId: s.id, fields: before } })
    }
    case 'detach': {
      const e = activeEntry()
      const changes = [
        ...entryChange(e, { status: 'detached', detachedBy: ctx.editorId, detachReason: 'editor', detachedAt: ctx.now, locked: true }),
        ...overviewChange(o, leaving(o, [e])),
      ]
      return plan('detached', changes, { storyId: e.storyId })
    }
    case 'role': {
      const e = activeEntry()
      const to = roleFields(action.role)
      if (e.role === to.role && e.roleKind === to.roleKind) throw new ConflictError('The entry already has that role')
      return plan('set', entryChange(e, { ...to, locked: true }), { storyId: e.storyId })
    }
    case 'retitle':
      if (action.title === o.title) throw new ConflictError('The overview already has that title')
      return plan('retitled', overviewChange(o, { title: action.title }))
    case 'freeze':
      if (action.frozen === o.frozen) throw new ConflictError(o.frozen ? 'The overview is already frozen' : 'The overview is not frozen')
      return plan(action.frozen ? 'frozen' : 'unfrozen', overviewChange(o, { frozen: action.frozen }))
    case 'hide':
      if (action.hidden === o.hidden) throw new ConflictError(o.hidden ? 'The overview is already hidden' : 'The overview is not hidden')
      return plan(action.hidden ? 'hidden' : 'shown', overviewChange(o, { hidden: action.hidden }))
    case 'close':
      if (action.closed) {
        if (o.status === 'closed') throw new ConflictError('The overview is already closed')
        return plan('closed', overviewChange(o, { status: 'closed', closedAt: ctx.now, closedReason: 'editor', closingSince: null }))
      }
      if (o.status !== 'closed') throw new ConflictError('The overview is not closed')
      return plan('reopened', overviewChange(o, OPEN), { reopens: true })
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

const DATE_FIELDS = new Set(['closedAt', 'closingSince', 'detachedAt'])
const revive = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, DATE_FIELDS.has(k) && typeof v === 'string' ? new Date(v) : v]))

const changesInput = z.object({
  changes: z.array(z.object({ table: z.enum(['overview', 'entry']), id: z.string(), before: z.record(z.unknown()), after: z.record(z.unknown()) })),
  target: z.string().nullish(),
})

/** The changes an editor's decision or an undo stored, the other way round. */
function inverted(inputs: unknown): { changes: Change[]; target: string | null } {
  const parsed = changesInput.safeParse(inputs)
  if (!parsed.success) throw new ConflictError('This decision did not record what it changed, so it cannot be undone')
  const changes = parsed.data.changes.map(c => ({ table: c.table, id: c.id, before: revive(c.after), after: revive(c.before) }) as Change)
  return { changes, target: parsed.data.target ?? null }
}

const roleSchema = z.object({ role: z.enum(['turning_point', 'routine']), roleKind: z.string().nullable() })
const reviewActions = z.object({
  actions: z.array(
    z.union([
      z.object({ kind: z.literal('detach'), entryId: z.string() }),
      z.object({ kind: z.literal('relabel'), entryId: z.string(), from: roleSchema, to: roleSchema }),
      z.object({
        kind: z.literal('narrow'),
        added: z.array(z.string()),
        charter: z.object({ in: z.string(), out: z.array(z.string()), endEvent: z.string() }),
      }),
      z.object({ kind: z.literal('retitle'), from: z.string(), to: z.string() }),
      z.object({ kind: z.literal('unfreeze') }),
    ]),
  ),
})

/**
 * Whether the changes may take a public link away (`.context/overviews.md`, "The public story field"):
 * the overview hidden, its scope leaving `ongoing`, or an entry leaving `active`. It does not ask
 * whether the overview was public, which costs at most a needless cache rebuild.
 */
export const removesLink = (changes: readonly Change[]): boolean =>
  changes.some(c =>
    c.table === 'overview'
      ? (c.after.hidden === true && c.before.hidden !== true) || (c.before.scope === 'ongoing' && c.after.scope !== undefined && c.after.scope !== 'ongoing')
      : c.before.status === 'active' && c.after.status === 'detached',
  )

/** Whether the admin offers Undo on a decision: one not undone, of a kind and outcome `planUndo` can reverse. */
export function undoable(d: Pick<UndoTarget, 'kind' | 'outcome' | 'undoneAt'>): boolean {
  if (d.undoneAt) return false
  if ((EDITOR_KINDS as readonly string[]).includes(d.kind) || d.kind === 'undo') return true
  const automated: Record<string, readonly string[]> = {
    link: ['joined'],
    found: ['founded'],
    status: ['closed', 'frozen'],
    close: ['closing'],
    review: ['reviewed'],
  }
  return automated[d.kind]?.includes(d.outcome) ?? false
}

/**
 * The changes undoing one decision makes (`.context/overviews.md`, "Editor actions and undo"):
 * - an editor's action or an undo: its stored changes the other way round (an undo of an undo makes
 *   the decision it had undone live again);
 * - a join (`link`, joined): the entry detached, `undone` and `locked`, and the decision undone, so the
 *   story is owed again and may join another overview, never this one;
 * - a founding (`found`, founded): both founding entries detached the same way; their stories' link
 *   decisions stay live, so the pair does not found it again the next night;
 * - a closure (`status`, closed), or a closing begun (`close`, closing): open again, quiet counted
 *   from now for a closure; only while it is the closure or closing the overview is in now (closed on
 *   the day it recorded; closing on its story's report), never an earlier one a later one replaced;
 * - a burst's freeze (`status`, frozen): cleared, only while no freeze or unfreeze came after it;
 * - a review: the entries it detached back, its relabels, its narrowing and its retitle restored,
 *   each only while it still stands (its unfreeze stays). What it restores becomes the editor's: the
 *   entries `locked` (so no review detaches or relabels them again) and the OUT entries locked out
 *   (`lockedOut`); an ongoing overview's review count becomes the entries it now has, so the count
 *   trigger does not review it again at once. A forming one keeps its count: only a review makes an
 *   overview public (D-OV4), so it is reviewed when its count is due, and that review cannot detach
 *   the locked entries.
 * The scope follows the entries as the status machine's does. Anything else, or a decision whose
 * work no longer stands, is refused.
 */
export function planUndo(d: UndoTarget, o: EditOverview, entries: readonly EditEntry[], ctx: EditContext): EditPlan {
  if (d.undoneAt) throw new ConflictError('This decision is already undone')
  if (!undoable(d)) throw new ConflictError(d.kind === 'link' && d.outcome === 'founded' ? 'Undo the founding instead' : 'This decision cannot be undone')
  const plan = (changes: Change[], over: Partial<EditPlan> = {}): EditPlan => {
    if (changes.length === 0) throw new ConflictError('Nothing this decision changed is left to undo')
    return {
      kind: 'undo',
      outcome: 'undone',
      overviewId: o.id,
      storyId: d.storyId,
      changes,
      create: null,
      reopens: false,
      relive: null,
      lockedOut: [],
      ...over,
    }
  }
  const detachAll = (left: EditEntry[]) => {
    if (left.length === 0) throw new ConflictError('Its stories are no longer in this overview')
    const undone = { status: 'detached', detachedBy: ctx.editorId, detachReason: 'undone', detachedAt: ctx.now, locked: true } as const
    return [...left.flatMap(e => entryChange(e, undone)), ...overviewChange(o, leaving(o, left))]
  }
  const activeOf = (storyIds: readonly (string | null)[]) => entries.filter(e => e.status === 'active' && e.storyId !== null && storyIds.includes(e.storyId))

  if ((EDITOR_KINDS as readonly string[]).includes(d.kind) || d.kind === 'undo') {
    const { changes, target } = inverted(d.inputs)
    return plan(changes, { relive: d.kind === 'undo' ? target : null })
  }
  if (d.kind === 'link') return plan(detachAll(activeOf([d.storyId])))
  if (d.kind === 'found') {
    const partner = z.object({ partnerId: z.string() }).safeParse(d.inputs)
    return plan(detachAll(activeOf([d.storyId, partner.success ? partner.data.partnerId : null])))
  }
  if (d.kind === 'status' && d.outcome === 'frozen') {
    if (!o.frozen) throw new ConflictError('The overview is not frozen')
    if (o.lastFreezeId !== d.id) throw new ConflictError('The overview was frozen again since: undo that freeze instead')
    return plan(overviewChange(o, { frozen: false }))
  }
  if (d.kind === 'status') {
    const closed = z.object({ reason: z.string().nullish(), clock: z.string().nullish() }).safeParse(d.inputs)
    const at = closed.success && closed.data.clock ? new Date(closed.data.clock).getTime() : NaN
    if (o.status !== 'closed' || o.closedReason !== (closed.success ? closed.data.reason : null) || o.closedAt?.getTime() !== at)
      throw new ConflictError('The overview is no longer closed as this decision closed it')
    return plan(overviewChange(o, OPEN), { reopens: true })
  }
  if (d.kind === 'close') {
    // Only the closing the overview is in now: an earlier one was cancelled, and a later story's replaced it
    if (o.status !== 'closing' || o.closingStoryId !== d.storyId) throw new ConflictError('The overview is no longer closing on this story')
    return plan(overviewChange(o, { status: 'open', closingSince: null }))
  }

  // A review: what still stands of its demotions, restored as the editor's
  const parsed = reviewActions.safeParse(d.inputs)
  const actions = parsed.success ? parsed.data.actions : []
  const byId = new Map(entries.map(e => [e.id, e]))
  const back: EditEntry[] = []
  const changes: Change[] = []
  const lockedOut: string[] = []
  let fields: Partial<OverviewFields> = {}
  for (const a of actions) {
    const e = 'entryId' in a ? byId.get(a.entryId) : undefined
    if (a.kind === 'detach' && e?.status === 'detached' && e.detachReason === 'review') {
      back.push(e)
      changes.push(...entryChange(e, { ...ACTIVE, locked: true }))
    } else if (a.kind === 'relabel' && e?.status === 'active' && e.role === a.to.role && e.roleKind === a.to.roleKind) {
      changes.push(...entryChange(e, { ...roleFields({ role: a.from.role, roleKind: a.from.roleKind as Role['roleKind'] }), locked: true }))
    } else if (a.kind === 'narrow' && sameValue(o.charter, a.charter)) {
      fields = { ...fields, charter: { ...a.charter, out: a.charter.out.filter(x => !a.added.includes(x)) } }
      lockedOut.push(...a.added)
    } else if (a.kind === 'retitle' && o.title === a.to) {
      fields = { ...fields, title: a.from }
    }
  }
  const active = o.activeEntries + back.filter(e => e.published).length
  const scope = active > o.activeEntries ? scopeAfter(o.scope, active) : o.scope
  const counted = scope === 'ongoing' ? { entriesAtLastReview: active } : {}
  return plan([...changes, ...overviewChange(o, { ...fields, scope, ...counted })], { lockedOut })
}

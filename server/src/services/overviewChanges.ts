/**
 * The overview write model (`.context/overviews.md`, "Records" and "Editor actions and undo"). Every
 * write the lifecycle makes, automated or an editor's, is planned by pure code as a `Plan`: the rows it
 * creates, in the state its undo leaves, and the fields it changes on the overview and its entries,
 * before and after. One applier writes a plan (the lifecycle's; the eval sandbox's over memory), each
 * change only while its row still holds `before`, and logs it as its decision with the change set, so
 * Undo of any decision is that change set inverted. What entries joining or leaving does to their
 * overview is decided here once: a closing whose end-event story leaves is cancelled (`leaving`), and
 * the last entry and the scope follow the entries (`settled`), added to every plan before it is applied
 * (`settle`) and never put back by an Undo, which settles them again. Pure.
 */
import { scopeAfter } from './overviewStatus.js'
import { isPublicOverview, type Charter, type EntryRole, type OverviewScope, type OverviewStatus } from './overviewTypes.js'
import type { StoredChange } from './overviewDecisions.js'

/** The overview fields a write changes. */
export interface OverviewFields {
  title: string
  /** Given when it first goes public, never taken back (a slug once given stays reserved). */
  slug: string | null
  scope: OverviewScope
  status: OverviewStatus
  closedAt: Date | null
  /** end_event, faded or editor; null unless closed. */
  closedReason: string | null
  /** While closing: the end-event story's publication date and the story. */
  closingSince: Date | null
  closingStoryId: string | null
  /** While closing: when its closure review ran. */
  closureReviewedAt: Date | null
  frozen: boolean
  /** While frozen: `burst`, `review` (the detach brake) or `editor`, and when. */
  frozenBy: string | null
  frozenAt: Date | null
  hidden: boolean
  charter: Charter
  /** The active entries the last review kept (the count trigger, `reviewDue`), and when it ran. */
  entriesAtLastReview: number
  reviewedAt: Date | null
  /** When a person last reopened it: quiet and fading count from then. */
  reopenedAt: Date | null
  /** The burst check counts the pipeline's joins after this. */
  joinsCountedFrom: Date | null
  /** OUT entries an editor's undo of a review took out: no review adds them again. */
  lockedOut: string[]
  /** The newest active published entry's publication date: follows the entries (`settled`). */
  lastEntryAt: Date | null
}

/** An overview as a write plans on it. */
export interface OverviewRow extends OverviewFields {
  id: string
  issueId: string | null
  foundedAt: Date
}

/** The entry fields a write changes. */
export interface EntryFields {
  status: 'active' | 'detached'
  detachedBy: string | null
  detachReason: string | null
  detachedAt: Date | null
  /** An editor or an Undo moved or set it: automation never reverses it. */
  locked: boolean
  role: EntryRole
  roleKind: string | null
}

export interface EntryRow extends EntryFields {
  id: string
  overviewId: string
  storyId: string | null
  /** `pipeline` or `editor`. */
  joinedBy: string
  joinedAt: Date
  /** Its story is published (only those count toward the scope and the last entry). */
  published: boolean
  datePublished: Date | null
}

export type Change =
  | { table: 'overview'; id: string; before: Partial<OverviewFields>; after: Partial<OverviewFields> }
  | { table: 'entry'; id: string; before: Partial<EntryFields>; after: Partial<EntryFields> }

export const DECISION_KINDS = [
  'link',
  'found',
  'role',
  'stands',
  'status',
  'close',
  'review',
  'editor_attach',
  'editor_detach',
  'editor_role',
  'editor_retitle',
  'editor_freeze',
  'editor_hide',
  'editor_close',
  'undo',
] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]

/** A decision row as a plan writes it; its `inputs` are its kind's record (`overviewDecisions.ts`), the change set added by the applier. */
export interface DecisionDraft {
  id: string
  kind: DecisionKind
  outcome: string
  overviewId: string | null
  storyId: string | null
  inputs: object
  answer: unknown
  model: string | null
  promptVersion: string | null
  confidence: number | null
  costUsd: number
  actor: string
}

/** A founding's overview, created single and open with no entry: what Undo of the founding leaves. */
export interface NewOverview {
  id: string
  title: string
  issueId: string | null
  charter: Charter
  charterModel: string
  charterPromptVersion: string
  foundedAt: Date
}

/** An entry created in the state its undo leaves (detached, `undone`); the plan's changes then make it active. */
export interface NewEntry {
  id: string
  overviewId: string
  storyId: string
  joinedBy: string
  joinedAt: Date
  decisionId: string
  fields: EntryFields
  /** Its story's publication date (a story joins only while published). */
  datePublished: Date
  shared: unknown
  confidence: number | null
  model: string | null
  promptVersion: string | null
}

export interface Plan {
  /** The decision that carries the change set: the one Undo reverses. */
  decision: DecisionDraft
  /** Decisions written with it that carry no change (a founding's two link decisions, a founding attempt's own). */
  also: DecisionDraft[]
  newOverview: NewOverview | null
  newEntries: NewEntry[]
  changes: Change[]
  /** The story whose live link decisions the write undoes (an unpublished member detached), so it is linked afresh once published again. */
  undoesLinksOf: string | null
  /** An undo of an undo: the decisions below it in the chain of undos, each live or undone again (`undoChain`). */
  chain: ChainMark[]
  /** The overview was public before the write: a write taking a link away then empties the caches holding links. */
  wasPublic: boolean
  /** The write makes the overview public for the first time: the applier gives it its slug (`freeSlug`). */
  needsSlug: boolean
}

/** A decision an undo makes live again (`undone` false) or undone again. */
export interface ChainMark {
  decisionId: string
  undone: boolean
}

/** A decision with no model call and nothing to undo but its change set. */
export const draft = (
  d: Pick<DecisionDraft, 'id' | 'kind' | 'outcome' | 'overviewId' | 'storyId' | 'actor' | 'inputs'> & Partial<DecisionDraft>,
): DecisionDraft => ({
  answer: null,
  model: null,
  promptVersion: null,
  confidence: null,
  costUsd: 0,
  ...d,
})

/** A plan of one decision; the rest empty unless given. */
export const plan = (decision: DecisionDraft, over: Partial<Omit<Plan, 'decision'>> = {}): Plan => ({
  decision,
  also: [],
  newOverview: null,
  newEntries: [],
  changes: [],
  undoesLinksOf: null,
  chain: [],
  wasPublic: false,
  needsSlug: false,
  ...over,
})

/** A value as JSON compares it, objects' keys sorted (a charter read back from jsonb has its own key order). */
const canonical = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  )

export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

function changed<F extends object>(from: F, to: Partial<F>): { before: Partial<F>; after: Partial<F> } {
  const keys = (Object.keys(to) as (keyof F)[]).filter(k => !sameValue(from[k], to[k]))
  const pick = (source: Partial<F>) => Object.fromEntries(keys.map(k => [k, source[k]])) as Partial<F>
  return { before: pick(from), after: pick(to) }
}

/** The change taking the overview to `to`; none when nothing would change. */
export const overviewChange = (o: OverviewRow, to: Partial<OverviewFields>): Change[] => {
  const c = changed<OverviewFields>(o, to)
  return Object.keys(c.after).length === 0 ? [] : [{ table: 'overview', id: o.id, ...c }]
}

/** The change taking the entry to `to`; none when nothing would change. */
export const entryChange = (e: EntryFields & { id: string }, to: Partial<EntryFields>): Change[] => {
  const c = changed<EntryFields>(e, to)
  return Object.keys(c.after).length === 0 ? [] : [{ table: 'entry', id: e.id, ...c }]
}

/** Open again: no closure and no closing. */
export const OPEN = { status: 'open', closedAt: null, closedReason: null, closingSince: null, closingStoryId: null, closureReviewedAt: null } as const

/** Not frozen, by anyone. */
export const UNFROZEN = { frozen: false, frozenBy: null, frozenAt: null } as const

/** An entry active again (its detach cleared). */
export const ACTIVE = { status: 'active', detachedBy: null, detachReason: null, detachedAt: null } as const

/** A closing ended without closing: open, its end-event story and its review forgotten. */
export const CLOSING_CANCELLED = { status: 'open', closingSince: null, closingStoryId: null, closureReviewedAt: null } as const

/**
 * What entries leaving does to their overview, the one rule every writer applies (the status machine's
 * unpublished detach, a review's, an editor's, an Undo's): a closing whose end-event story is among
 * them is cancelled. The scope and the last entry follow the entries (`settled`).
 */
export function leaving(o: Pick<OverviewRow, 'status' | 'closingStoryId'>, storyIds: readonly (string | null)[]): Partial<OverviewFields> {
  return o.status === 'closing' && o.closingStoryId !== null && storyIds.includes(o.closingStoryId) ? { ...CLOSING_CANCELLED } : {}
}

/**
 * The fields that follow the entries: the last entry, the newest active published entry's publication
 * date; and the scope as the status machine counts it (`scopeAfter`: one or none `single`, a single
 * one grown to two `forming`). Only the fields that differ.
 */
export function settled(o: Pick<OverviewRow, 'scope' | 'lastEntryAt'>, entries: readonly EntryRow[]): { scope?: OverviewScope; lastEntryAt?: Date | null } {
  const counted = entries.filter(e => e.status === 'active' && e.published)
  const newest = counted.reduce<Date | null>((a, e) => (e.datePublished && (!a || e.datePublished.getTime() > a.getTime()) ? e.datePublished : a), null)
  const scope = scopeAfter(o.scope, counted.length)
  return {
    ...(scope !== o.scope ? { scope } : {}),
    ...(!sameValue(newest, o.lastEntryAt) ? { lastEntryAt: newest } : {}),
  }
}

/** The rows a plan is made on and checked against: the overview and all its entries. */
export interface Rows {
  overview: OverviewRow
  entries: readonly EntryRow[]
}

/** A founding's overview as it is created: single and open, nothing else set. */
export const newOverviewRow = (n: NewOverview): OverviewRow => ({
  id: n.id,
  issueId: n.issueId,
  foundedAt: n.foundedAt,
  title: n.title,
  slug: null,
  scope: 'single',
  status: 'open',
  closedAt: null,
  closedReason: null,
  closingSince: null,
  closingStoryId: null,
  closureReviewedAt: null,
  frozen: false,
  frozenBy: null,
  frozenAt: null,
  hidden: false,
  charter: n.charter,
  entriesAtLastReview: 0,
  reviewedAt: null,
  reopenedAt: null,
  joinsCountedFrom: null,
  lockedOut: [],
  lastEntryAt: null,
})

/** A created entry as a row (its story published, as a story is when it joins). */
const newEntryRow = (e: NewEntry): EntryRow => ({
  ...e.fields,
  id: e.id,
  overviewId: e.overviewId,
  storyId: e.storyId,
  joinedBy: e.joinedBy,
  joinedAt: e.joinedAt,
  published: true,
  datePublished: e.datePublished,
})

/** The rows after a plan, in memory: the overview it creates, the entries it creates, then its changes in order. Null rows for a founding. */
export function applied(rows: Rows | null, p: Plan): Rows {
  const base = p.newOverview ? newOverviewRow(p.newOverview) : rows?.overview
  if (!base) throw new Error('A plan on no overview creates none')
  let overview = base
  let entries = [...(rows?.entries ?? []), ...p.newEntries.map(newEntryRow)]
  for (const c of p.changes) {
    if (c.table === 'overview') overview = { ...overview, ...c.after }
    else entries = entries.map(e => (e.id === c.id ? { ...e, ...c.after } : e))
  }
  return { overview, entries }
}

/** The plan with the fields that follow its entries (`settled`) changed after its own changes; the same plan when none moves. Idempotent. */
export function settle(rows: Rows | null, p: Plan): Plan {
  // A decision about no overview row (a story left alone, a conflict) moves nothing
  if (!rows && !p.newOverview) return p
  const after = applied(rows, p)
  const moved = overviewChange(after.overview, settled(after.overview, after.entries))
  return moved.length === 0 ? p : { ...p, changes: [...p.changes, ...moved] }
}

/**
 * Whether a write takes a public link away (`.context/overviews.md`, "Caches"): on an overview that was
 * public, it hid it, took its scope off `ongoing`, or moved an entry off `active`.
 */
export function removesLink(wasPublic: boolean, changes: readonly Change[]): boolean {
  if (!wasPublic) return false
  return changes.some(c =>
    c.table === 'overview'
      ? (c.after.hidden === true && c.before.hidden !== true) || (c.after.scope !== undefined && c.after.scope !== 'ongoing')
      : c.before.status === 'active' && c.after.status === 'detached',
  )
}

/** Public before the write: `isPublicOverview` on the row read. */
export const publicBefore = (o: Pick<OverviewRow, 'scope' | 'hidden' | 'slug'> | null): boolean => o !== null && isPublicOverview(o)

// ---------------------------------------------------------------------------
// Undo's side: the stored change set read back, inverted, and checked
// ---------------------------------------------------------------------------

/**
 * Fields an Undo never puts back, nor checks: a slug once given stays reserved; the burst count never
 * counts again the joins a write answered; the scope and the last entry follow the entries, settled
 * again after the undo; and a review that ran stays run (its time, the entries it kept, a closure's
 * review), so its triggers count from it.
 */
const ONE_WAY = new Set<string>(['slug', 'joinsCountedFrom', 'scope', 'lastEntryAt', 'reviewedAt', 'entriesAtLastReview', 'closureReviewedAt'])

const DATE_FIELDS = new Set([
  'closedAt',
  'closingSince',
  'closureReviewedAt',
  'frozenAt',
  'reviewedAt',
  'reopenedAt',
  'joinsCountedFrom',
  'lastEntryAt',
  'detachedAt',
])

const revive = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, DATE_FIELDS.has(k) && typeof v === 'string' ? new Date(v) : v]))

/** A stored change set as changes again, its dates revived. */
export const changesFrom = (stored: readonly StoredChange[]): Change[] =>
  stored.map(c => ({ table: c.table, id: c.id, before: revive(c.before), after: revive(c.after) }) as Change)

/** The changes the other way round, last first, without the one-way fields; a change left empty goes. */
export function inverted(changes: readonly Change[]): Change[] {
  return [...changes].reverse().flatMap(c => {
    const keep = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([k]) => !ONE_WAY.has(k)))
    const before = keep(c.after)
    if (Object.keys(before).length === 0) return []
    return [{ table: c.table, id: c.id, before, after: keep(c.before) } as Change]
  })
}

/** The first field whose row no longer holds a change's `before` (or whose row is gone), with its change; null when all hold. */
export function notHolding(changes: readonly Change[], rows: Rows): { change: Change; field: string } | null {
  const byId = new Map(rows.entries.map(e => [e.id, e]))
  for (const c of changes) {
    const row: Record<string, unknown> | undefined =
      c.table === 'overview'
        ? c.id === rows.overview.id
          ? (rows.overview as unknown as Record<string, unknown>)
          : undefined
        : (byId.get(c.id) as unknown as Record<string, unknown> | undefined)
    if (!row) return { change: c, field: 'row' }
    for (const [field, value] of Object.entries(c.before)) if (!sameValue(row[field], value)) return { change: c, field }
  }
  return null
}

/** Changes to one row merged into one: the first `before` of each field, the last `after`. */
export function merged(changes: readonly Change[]): Change[] {
  const out = new Map<string, Change>()
  for (const c of changes) {
    const key = `${c.table}:${c.id}`
    const had = out.get(key)
    out.set(key, had ? ({ ...had, before: { ...c.before, ...had.before }, after: { ...had.after, ...c.after } } as Change) : c)
  }
  return [...out.values()]
}

/** The change set a plan's decision keeps, which Undo inverts: its changes, one per row (`merged`), and the rows it created. */
export function changeSet(p: Plan): { changes: Change[]; created: { table: Change['table']; id: string }[] } {
  const created = [
    ...(p.newOverview ? [{ table: 'overview' as const, id: p.newOverview.id }] : []),
    ...p.newEntries.map(e => ({ table: 'entry' as const, id: e.id })),
  ]
  return { changes: merged(p.changes), created }
}

/**
 * The overview decision log's contract (`.context/overviews.md`, "Records"): one Zod schema per
 * decision kind for what its `inputs` keep, shared by the writer (the planners type each record as
 * its kind's input, so a key renamed here fails to type-check there), the readers that reach into
 * them (the upkeep's loaders, Undo, the admin's views) and, by a hand-written mirror, the client's
 * types (`shared/types`, `OverviewDecisionMove`). Every write that changes rows also keeps its change
 * set, `{ changes, created }`, which Undo inverts. Pure.
 */
import { z } from 'zod'
import { ENTRY_ROLES, OVERVIEW_SCOPES, REVIEW_TRIGGERS, ROLE_KINDS } from './overviewTypes.js'

/** A JSON date as stored (an ISO string), read back as a Date. */
const storedDate = z.preprocess(v => (typeof v === 'string' || v instanceof Date ? new Date(v) : v), z.date())

const roleSchema = z.object({ role: z.enum(ENTRY_ROLES), roleKind: z.enum(ROLE_KINDS).nullable() })
/** A charter as stored: a null end event is none (the development closes only by fading); older rows keep their strings. */
export const charterSchema = z.object({ in: z.string(), out: z.array(z.string()), endEvent: z.string().nullable() })

/** One row change as a write stored it: the fields it changed, before and after (dates as strings). */
export const storedChangeSchema = z.object({
  table: z.enum(['overview', 'entry']),
  id: z.string(),
  before: z.record(z.unknown()),
  after: z.record(z.unknown()),
})

/** What every write that changes rows keeps: its change set, and the rows it created (in the state its undo leaves). */
const changeSet = {
  changes: z.array(storedChangeSchema).default([]),
  created: z.array(z.object({ table: z.enum(['overview', 'entry']), id: z.string() })).default([]),
}

const shownSchema = z.object({ ref: z.string(), id: z.string(), distance: z.number() })

/** `link`: the candidates shown, the yeses code refused, and whether a join reports its overview's end event (what `pendingClosings` reads). */
export const linkInputs = z.object({
  shown: z.object({ overviews: z.array(shownSchema).default([]), partners: z.array(shownSchema).default([]) }).default({}),
  proposed: z.number().default(0),
  refusals: z.array(z.object({ id: z.string(), reason: z.string() })).default([]),
  reportsEndEvent: z.boolean().default(false),
  /** A founding partner's own link decision: the story it founded with. */
  foundedWith: z.string().nullable().default(null),
  ...changeSet,
})

/** The key `pendingClosings` reads in SQL, held to the schema's name. */
export const REPORTS_END_EVENT = 'reportsEndEvent' satisfies keyof z.infer<typeof linkInputs>

/** `found`: the founding partner; on agreement the change set that made the overview and both entries. */
export const foundInputs = z.object({ partnerId: z.string(), ...changeSet })

/** `status`: a move of the status machine or a burst's freeze. */
export const statusInputs = z.object({
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  /** The development time a closure is recorded at. */
  clock: storedDate.nullable().default(null),
  /** Who cancelled a closing: the unpublished-member rule, a review, or an editor's re-center (reason `recentered`). */
  by: z.string().nullable().default(null),
  /** A burst's freeze: the joins it counted. */
  joins: z.number().nullable().default(null),
  entryId: z.string().nullable().default(null),
  ...changeSet,
})

/** `close`: the end event judged (a closing is only ever judged against a named one). */
export const closeInputs = z.object({ endEvent: z.string(), ...changeSet })

const reviewActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('detach'), entryId: z.string(), storyId: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('relabel'), entryId: z.string(), storyId: z.string(), from: roleSchema, to: roleSchema }),
  z.object({ kind: z.literal('narrow'), added: z.array(z.string()), charter: charterSchema }),
  z.object({ kind: z.literal('retitle'), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal('unfreeze') }),
])

/** The detach brake: the review asked for more detaches than half of the unlocked entries, so none was applied and the overview froze. */
const brakeSchema = z.object({ asked: z.number(), unlocked: z.number() })

/** `review` (any trigger but the audit): its actions and refusals, the entries kept and the scope left, and for a closure's the closing it was for. */
export const reviewInputs = z.object({
  trigger: z.enum(REVIEW_TRIGGERS),
  closingSince: storedDate.nullable().default(null),
  actions: z.array(reviewActionSchema).default([]),
  refusals: z.array(z.object({ what: z.string(), reason: z.string() })).default([]),
  kept: z.number().default(0),
  scope: z.enum(OVERVIEW_SCOPES).nullable().default(null),
  brake: brakeSchema.nullable().default(null),
  ...changeSet,
})

/** `review` with outcome `audited` or `audit_failed`: what the monthly audit would have changed, never applied. */
export const auditInputs = z.object({
  trigger: z.literal('audit'),
  entries: z.number().default(0),
  wrongJoins: z.number().default(0),
  wrongRoles: z.number().default(0),
  errorRate: z.number().nullable().default(null),
  actions: z.array(reviewActionSchema).default([]),
  refusals: z.array(z.object({ what: z.string(), reason: z.string() })).default([]),
})

/**
 * `stands`: the signature it was made for (none for a failed one), the cheap marker of its inputs and
 * the day its facts' current flags next change (what lets the next run skip reading the pools), the
 * facts offered and the checks' record.
 */
export const standsInputs = z.object({
  signature: z.string().nullable().default(null),
  marker: z.string().nullable().default(null),
  until: z.string().nullable().default(null),
  offered: z.array(z.string()).default([]),
  drops: z.array(z.object({ label: z.string(), cause: z.string(), problem: z.string().optional() })).default([]),
  checked: z.number().default(0),
  failed: z.number().default(0),
})

/**
 * `recenter`, an automated re-center (`.context/overviews.md`, "Re-centering"): the rule a refused
 * attempt failed, the OUT entries an applied one added (an Undo locks them out, as it does a review's
 * narrowing), and the anchor entries with whether both calls judged each to belong.
 */
export const recenterInputs = z.object({
  rule: z.string().nullable().default(null),
  outAdded: z.array(z.string()).default([]),
  anchor: z.array(z.object({ entryId: z.string(), founding: z.boolean(), passed: z.boolean() })).default([]),
  ...changeSet,
})

/** An editor's action or an undo: its change set and, for an undo, the decision it undid. */
export const editInputs = z.object({ target: z.string().nullable().default(null), ...changeSet })

/** `editor_recenter`: an editor's new charter, with their confirmation that it still covers the anchor (the server records it and judges nothing). */
export const editorRecenterInputs = editInputs.extend({ anchorConfirmed: z.boolean().default(false) })

export type LinkInputs = z.input<typeof linkInputs>
export type FoundInputs = z.input<typeof foundInputs>
export type StatusInputs = z.input<typeof statusInputs>
export type CloseInputs = z.input<typeof closeInputs>
export type ReviewInputs = z.input<typeof reviewInputs>
export type AuditInputs = z.input<typeof auditInputs>
export type StandsInputs = z.input<typeof standsInputs>
export type EditInputs = z.input<typeof editInputs>
export type RecenterInputs = z.input<typeof recenterInputs>
export type EditorRecenterInputs = z.input<typeof editorRecenterInputs>
export type StoredChange = z.infer<typeof storedChangeSchema>

/** The schema of a kind's (and outcome's) inputs. */
export function inputsSchema(kind: string, outcome: string) {
  if (kind === 'link') return linkInputs
  if (kind === 'found') return foundInputs
  if (kind === 'status') return statusInputs
  if (kind === 'close') return closeInputs
  if (kind === 'review') return outcome === 'audited' || outcome === 'audit_failed' ? auditInputs : reviewInputs
  if (kind === 'stands') return standsInputs
  if (kind === 'recenter') return recenterInputs
  if (kind === 'editor_recenter') return editorRecenterInputs
  return editInputs
}

/** A decision's inputs read by its schema; null when they do not parse (a record from before a key was added, say). */
export function readInputs<S extends z.ZodTypeAny>(schema: S, inputs: unknown): z.infer<S> | null {
  const parsed = schema.safeParse(inputs)
  return parsed.success ? (parsed.data as z.infer<S>) : null
}

/** The change set a decision stored; empty for one that changed no row. */
export function storedChanges(kind: string, outcome: string, inputs: unknown): StoredChange[] {
  const read = readInputs(inputsSchema(kind, outcome), inputs) as { changes?: StoredChange[] } | null
  return read?.changes ?? []
}

/** A status-like move as the admin's history shows it: from, to and why. */
export interface DecisionMove {
  from: string | null
  to: string | null
  reason: string | null
}

/** The move a `status` decision recorded, for the admin's status history; null for other kinds. */
export function decisionMove(kind: string, inputs: unknown): DecisionMove | null {
  if (kind !== 'status') return null
  const read = readInputs(statusInputs, inputs)
  return read ? { from: read.from, to: read.to, reason: read.reason } : null
}

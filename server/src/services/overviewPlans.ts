/**
 * The automated writes as change sets (`overviewChanges.ts`; `.context/overviews.md`, "How a story is
 * linked" and "Status, closing and reviews"), each planned from the rows as they stand when it is
 * written: one story's linking (a join, a founding, the story left alone), an end-event closing begun,
 * the status machine's moves, a burst's freeze, a review's actions and the monthly audit's findings.
 * The lifecycle applies them in one transaction over the rows it locked; the eval sandbox applies the
 * same plans to its memory, so both write by one set of rules. Each applier settles a plan
 * (`settle`) before applying it; the status machine's moves are settled here, one after the other,
 * since each is planned on the rows the one before left. Pure.
 */
import { OVERVIEW_PROMPT_VERSIONS } from '../prompts/overviews.js'
import {
  ACTIVE,
  CLOSING_CANCELLED,
  OPEN,
  UNFROZEN,
  applied,
  draft,
  entryChange,
  leaving,
  overviewChange,
  plan,
  publicBefore,
  sameValue,
  settle,
  type Change,
  type DecisionDraft,
  type EntryFields,
  type NewEntry,
  type OverviewFields,
  type OverviewRow,
  type Plan,
  type Rows,
} from './overviewChanges.js'
import type { CloseCase, CloseResult } from './overviewClose.js'
import type { AuditInputs, CloseInputs, FoundInputs, LinkInputs, ReviewInputs, StatusInputs } from './overviewDecisions.js'
import type { LinkResult } from './overviewLink.js'
import type { AuditResult, ReviewCase, ReviewResult } from './overviewReview.js'
import type { StatusMove } from './overviewStatus.js'
import type { LinkOutcome, OverviewState, Role } from './overviewTypes.js'

/** Who an automated write names (`actor`, `joined_by`, `detached_by`). */
export const PIPELINE = 'pipeline'
/** Who a review's writes name. */
export const REVIEWER = 'review'
/** The outcome of a review whose overview changed while its call ran: recorded, nothing applied. */
export const STALE_REVIEW = 'stale'

/** What a plan is made with: the write's time and fresh row ids (`randomUUID` in production, a counter in the sandbox). */
export interface PlanContext {
  now: Date
  newId: () => string
}

const ROUTINE: Role = { role: 'routine', roleKind: null }

/** An entry as it is created: detached, `undone`, so its undo leaves it so; the plan's change makes it active. */
export const undoneEntry = (role: Role, actor: string, now: Date, locked = false): EntryFields => ({
  status: 'detached',
  detachedBy: actor,
  detachReason: 'undone',
  detachedAt: now,
  locked,
  role: role.role,
  roleKind: role.role === 'routine' ? null : role.roleKind,
})

/** The change that makes a created entry active. */
export const activated = (e: Pick<NewEntry, 'id' | 'fields'>): Change[] => entryChange({ ...e.fields, id: e.id }, ACTIVE)

// ---------------------------------------------------------------------------
// One story's linking
// ---------------------------------------------------------------------------

/**
 * The re-center signals a link decision keeps (`.context/overviews.md`, "Re-centering"): only a story
 * active in no overview after its link raises one, since a story that joined one overview and is wider
 * for another is the merge question, not a re-center's. So a story left alone (`none`, `rejected`) keeps
 * every flag; a joined one only its centerMoved for the overview it joined; a story held, in conflict
 * or failed keeps none, since it is linked again, and nor does a founding.
 */
export function countedSignals(result: LinkResult, outcome: LinkOutcome, overviewId: string | null): LinkResult['signals'] {
  if (outcome === 'none' || outcome === 'rejected') return result.signals
  if (outcome === 'joined') return result.signals.filter(s => s.kind === 'center_moved' && s.overviewId === overviewId)
  return []
}

/** A link decision's record; `endEventNamed` false (the overview joined names none) drops the end-event flag, so it never starts a closing. */
const linkRecord = (result: LinkResult, outcome: LinkOutcome, overviewId: string | null, endEventNamed: boolean, ctx: PlanContext): LinkInputs => ({
  shown: result.shown,
  proposed: result.proposed,
  refusals: result.refusals,
  reportsEndEvent: endEventNamed && (result.join?.reportsEndEvent ?? false),
  signals: countedSignals(result, outcome, overviewId),
  linkedAt: ctx.now,
})

const linkDecision = (
  result: LinkResult,
  outcome: LinkOutcome,
  overviewId: string | null,
  ctx: PlanContext,
  confidence: number | null = null,
  endEventNamed = true,
): DecisionDraft =>
  draft({
    id: ctx.newId(),
    kind: 'link',
    outcome,
    overviewId,
    storyId: result.story.id,
    inputs: linkRecord(result, outcome, overviewId, endEventNamed, ctx),
    answer: result.answer,
    model: result.model,
    promptVersion: result.promptVersion,
    confidence,
    costUsd: result.costUsd,
    actor: PIPELINE,
  })

/** The founding attempt's own decision, whatever its outcome; the overview's id once founded. */
const foundDecision = (result: LinkResult, overviewId: string | null, ctx: PlanContext): DecisionDraft => {
  const f = result.founding!
  const inputs: FoundInputs = { partnerId: f.partner.id }
  return draft({
    id: ctx.newId(),
    kind: 'found',
    outcome: f.outcome,
    overviewId,
    storyId: result.story.id,
    inputs,
    answer: f.answers,
    model: f.model,
    promptVersion: `${OVERVIEW_PROMPT_VERSIONS.found}+${OVERVIEW_PROMPT_VERSIONS.foundCheck}`,
    confidence: f.confidence,
    costUsd: f.costUsd,
    actor: PIPELINE,
  })
}

/** A link plan and the outcome the story is stored with. */
export interface LinkPlan {
  plan: Plan
  outcome: LinkOutcome
}

/** A story's result stored as a conflict: written stale on its last try, or refused by the one-active-entry index. */
export const planConflict = (result: LinkResult, ctx: PlanContext): LinkPlan => ({
  plan: plan(linkDecision(result, 'conflict', null, ctx)),
  outcome: 'conflict',
})

/**
 * A join (`.context/overviews.md`, "How a story is linked"): the story's entry, created in its undone
 * state and made active, and its `joined` link decision; a `conflict` when the overview is gone or
 * closed (but faded) since, `held` when frozen since. The last entry and the scope follow the entries;
 * a quiet or faded overview opens again at the same run's status machine. A join never changes a
 * charter or a title; its end-event flag counts only on an overview that names an end event, as its
 * row holds it at the write.
 */
export function planJoin(o: OverviewRow | null, result: LinkResult, ctx: PlanContext): LinkPlan {
  const j = result.join!
  if (!o || (o.status === 'closed' && o.closedReason !== 'faded'))
    return { plan: plan(linkDecision(result, 'conflict', j.candidate.id, ctx)), outcome: 'conflict' }
  if (o.frozen) return { plan: plan(linkDecision(result, 'held', o.id, ctx)), outcome: 'held' }
  const decision = linkDecision(result, 'joined', o.id, ctx, j.answer.confidence, o.charter.endEvent !== null)
  const entry: NewEntry = {
    id: ctx.newId(),
    overviewId: o.id,
    storyId: result.story.id,
    joinedBy: PIPELINE,
    joinedAt: ctx.now,
    decisionId: decision.id,
    fields: undoneEntry(result.role ?? ROUTINE, PIPELINE, ctx.now),
    datePublished: result.story.datePublished,
    shared: j.shared,
    confidence: j.answer.confidence,
    model: result.model,
    promptVersion: result.promptVersion,
  }
  return { plan: plan(decision, { newEntries: [entry], changes: activated(entry), wasPublic: publicBefore(o) }), outcome: 'joined' }
}

/**
 * A founding: the overview (single and open, until its two entries make it forming), both entries made
 * active, its `found` decision, which carries the change set an Undo reverses, and both stories'
 * `founded` link decisions, which settle them. The earlier story is A.
 */
export function planFounding(result: LinkResult, ctx: PlanContext): LinkPlan {
  const f = result.founding!
  const d = f.draft!
  const earlier = f.partner.datePublished.getTime() <= result.story.datePublished.getTime() ? f.partner : result.story
  const overviewId = ctx.newId()
  const found = foundDecision(result, overviewId, ctx)
  const storyLink = linkDecision(result, 'founded', overviewId, ctx, f.confidence)
  const partnerInputs: LinkInputs = { foundedWith: result.story.id }
  const partnerLink = draft({
    id: ctx.newId(),
    kind: 'link',
    outcome: 'founded',
    overviewId,
    storyId: f.partner.id,
    inputs: partnerInputs,
    confidence: f.confidence,
    actor: PIPELINE,
  })
  const storyIsA = earlier.id === result.story.id
  const entry = (story: { id: string; datePublished: Date }, role: Role, decisionId: string, shared: unknown): NewEntry => ({
    id: ctx.newId(),
    overviewId,
    storyId: story.id,
    joinedBy: PIPELINE,
    joinedAt: ctx.now,
    decisionId,
    fields: undoneEntry(role, PIPELINE, ctx.now),
    datePublished: story.datePublished,
    shared,
    confidence: f.confidence,
    model: f.model,
    promptVersion: OVERVIEW_PROMPT_VERSIONS.found,
  })
  const entries = [
    entry(result.story, storyIsA ? d.roles.a : d.roles.b, storyLink.id, f.shared),
    // The partner's side of the same shared fields: its quotes are the answer's `other`
    entry(f.partner, storyIsA ? d.roles.b : d.roles.a, partnerLink.id, {
      cause: { story: f.shared.cause.other, other: f.shared.cause.story },
      place: { story: f.shared.place.other, other: f.shared.place.story },
      end: { story: f.shared.end.other, other: f.shared.end.story },
    }),
  ]
  return {
    plan: plan(found, {
      also: [storyLink, partnerLink],
      newOverview: {
        id: overviewId,
        title: d.title,
        issueId: result.story.issueId ?? f.partner.issueId,
        charter: d.charter,
        charterModel: f.model ?? '',
        charterPromptVersion: OVERVIEW_PROMPT_VERSIONS.found,
        foundedAt: earlier.datePublished,
      },
      newEntries: entries,
      changes: entries.flatMap(activated),
    }),
    outcome: 'founded',
  }
}

/** The story left alone (`none`, `rejected`, `held` with no overview row read, `failed`), with its founding attempt's decision when it made one. */
export function planAlone(result: LinkResult, ctx: PlanContext): LinkPlan {
  const outcome = result.outcome === 'joined' || result.outcome === 'founded' ? 'conflict' : result.outcome
  return {
    plan: plan(linkDecision(result, outcome, result.join?.candidate.id ?? null, ctx), { also: result.founding ? [foundDecision(result, null, ctx)] : [] }),
    outcome,
  }
}

// ---------------------------------------------------------------------------
// The upkeep after linking
// ---------------------------------------------------------------------------

const statusDecision = (overviewId: string, storyId: string | null, outcome: string, inputs: StatusInputs, ctx: PlanContext): DecisionDraft =>
  draft({ id: ctx.newId(), kind: 'status', outcome, overviewId, storyId, inputs, actor: PIPELINE })

/**
 * An end-event check's result as its `close` decision on the story, which settles the pair unless it
 * `failed`. On agreement an open or quiet, unfrozen overview whose end event is still the one the calls
 * judged starts closing from the story's publication date, on that story, its closure review still to
 * run; otherwise `stale` (asked again on the overview as it stands, or passed by once it names none).
 */
export function planClosing(o: OverviewRow | null, c: CloseCase, result: CloseResult, ctx: PlanContext): Plan {
  let outcome: string = result.outcome
  let changes: Change[] = []
  if (result.outcome === 'closing') {
    // The calls judged the end event the case was read with: one an editor's re-center changed since is no longer this overview's
    if (o && (o.status === 'open' || o.status === 'quiet') && !o.frozen && sameValue(o.charter.endEvent, c.charter.endEvent))
      changes = overviewChange(o, { status: 'closing', closingSince: c.story.datePublished, closingStoryId: c.story.id, closureReviewedAt: null })
    else outcome = 'stale'
  }
  const inputs: CloseInputs = { endEvent: c.charter.endEvent }
  return plan(
    draft({
      id: ctx.newId(),
      kind: 'close',
      outcome,
      overviewId: c.overviewId,
      storyId: c.story.id,
      inputs,
      answer: result.answers,
      model: result.model,
      promptVersion: result.promptVersion,
      costUsd: result.costUsd,
      actor: PIPELINE,
    }),
    { changes },
  )
}

/**
 * The status machine's moves (`nextState`), each its own `status` decision, applied in order and only
 * from the state it was computed on (a move whose `from` no longer holds is dropped):
 * - an entry whose story is no longer published detached (`unpublished`, by the pipeline, not locked),
 *   and the story's link decisions undone, so a story published again is linked afresh;
 * - a scope or status moved; closing records the day in development time (`clock`); an overview that
 *   opens again loses its closing and closure; a closing whose end-event story was unpublished is
 *   cancelled, frozen or not.
 */
export function planStatus(rows: Rows, moves: readonly StatusMove[], clock: Date, ctx: PlanContext): Plan[] {
  let at = rows
  const plans: Plan[] = []
  const push = (p: Plan) => {
    const settledPlan = settle(at, { ...p, wasPublic: publicBefore(at.overview) })
    plans.push(settledPlan)
    at = applied(at, settledPlan)
  }
  for (const m of moves) {
    const row = at.overview
    if (m.kind === 'detach') {
      const e = at.entries.find(x => x.id === m.entryId && x.status === 'active')
      if (!e) continue
      const changes = entryChange(e, { status: 'detached', detachedBy: PIPELINE, detachReason: 'unpublished', detachedAt: ctx.now })
      push(plan(statusDecision(row.id, m.storyId, 'detached', { entryId: e.id, reason: 'unpublished' }, ctx), { changes, undoesLinksOf: m.storyId }))
    } else if (m.kind === 'scope') {
      // Moved already when an entry leaving settled it: the move is still logged, with nothing left to change
      if (row.scope !== m.from && row.scope !== m.to) continue
      push(plan(statusDecision(row.id, null, m.to, { from: m.from, to: m.to }, ctx), { changes: overviewChange(row, { scope: m.to }) }))
    } else if (m.kind === 'cancel_closing') {
      if (row.status !== 'closing') continue
      const inputs: StatusInputs = { from: 'closing', to: 'open', reason: 'closing_cancelled', by: 'unpublished' }
      push(plan(statusDecision(row.id, m.storyId, 'open', inputs, ctx), { changes: overviewChange(row, CLOSING_CANCELLED) }))
    } else {
      if (row.status !== m.from || row.frozen) continue
      const to: Partial<OverviewFields> =
        m.to === 'closed' ? { status: 'closed', closedAt: clock, closedReason: m.reason } : m.to === 'open' ? OPEN : { status: m.to }
      push(plan(statusDecision(row.id, null, m.to, { from: m.from, to: m.to, reason: m.reason, clock }, ctx), { changes: overviewChange(row, to) }))
    }
  }
  return plans
}

/** A burst (`anomalies`): the overview frozen by the pipeline until its burst review, the joins it counted answered; null when frozen already. */
export function planBurst(o: OverviewRow, state: Pick<OverviewState, 'burstJoins'>, ctx: PlanContext): Plan | null {
  if (o.frozen) return null
  const changes = overviewChange(o, { frozen: true, frozenBy: 'burst', frozenAt: ctx.now, joinsCountedFrom: ctx.now })
  return plan(statusDecision(o.id, null, 'frozen', { reason: 'burst', joins: state.burstJoins }, ctx), { changes })
}

/**
 * Whether the overview changed while a review's call ran (`.context/overviews.md`, "Reviews"): what the
 * call was shown (`c`) against the rows locked for its write. The title, the charter, the scope and
 * the freeze, and which active entries of published stories it has and which of them are locked.
 */
function changedSinceCase(c: ReviewCase, { overview: o, entries }: Rows): boolean {
  const shown = entries.filter(e => e.status === 'active' && e.published && e.datePublished !== null)
  const locked = new Map(shown.map(e => [e.id, e.locked]))
  return (
    o.title !== c.title ||
    !sameValue(o.charter, c.charter) ||
    o.scope !== c.scope ||
    o.frozen !== c.frozen ||
    locked.size !== c.entries.length ||
    c.entries.some(e => locked.get(e.entryId) !== e.locked)
  )
}

/**
 * A review's result (`.context/overviews.md`, "Reviews") as its `review` decision with its trigger,
 * actions, refusals and brake (and for a closure's, the closing it was for). A failed review changes
 * nothing, and so does one whose overview changed while its call ran (`changedSinceCase`): it is
 * recorded `stale`, so the review stays due and the next run asks again, and a change made meanwhile
 * is never overwritten. Otherwise: each detach of an active, unlocked entry (`review`; its story's link
 * decision stays live, so it is not linked again), each relabel of one, the narrowed charter, the title,
 * a freeze cleared, or, when the detach brake tripped, the overview frozen by the review for an editor;
 * the scope it leaves, the entries kept and the review's time; for a closure's, the closure reviewed;
 * a closing whose end-event story it detached cancelled (`leaving`, with a `status` record of it); and
 * the slug the first time it makes the overview public.
 */
export function planReview(rows: Rows, c: ReviewCase, result: ReviewResult, ctx: PlanContext): Plan {
  const { overview: o, entries } = rows
  const stale = result.outcome === 'reviewed' && changedSinceCase(c, rows)
  const inputs: ReviewInputs = {
    trigger: result.trigger,
    closingSince: result.trigger === 'closure' ? o.closingSince : null,
    actions: result.actions,
    refusals: result.refusals,
    kept: result.kept,
    scope: result.scope,
    brake: result.brake,
  }
  const decision = draft({
    id: ctx.newId(),
    kind: 'review',
    outcome: stale ? STALE_REVIEW : result.outcome,
    overviewId: c.overviewId,
    storyId: null,
    inputs,
    answer: result.answer,
    model: result.model,
    promptVersion: result.promptVersion,
    costUsd: result.costUsd,
    actor: REVIEWER,
  })
  if (result.outcome !== 'reviewed' || stale) return plan(decision)
  const byId = new Map(entries.map(e => [e.id, e]))
  const changes: Change[] = []
  const left: (string | null)[] = []
  const fields: Partial<OverviewFields> = { scope: result.scope, entriesAtLastReview: result.kept, reviewedAt: ctx.now, joinsCountedFrom: ctx.now }
  if (result.trigger === 'closure' && o.status === 'closing') fields.closureReviewedAt = ctx.now
  for (const a of result.actions) {
    const e = 'entryId' in a ? byId.get(a.entryId) : undefined
    const open = e !== undefined && e.status === 'active' && !e.locked
    if (a.kind === 'detach' && open) {
      changes.push(...entryChange(e, { status: 'detached', detachedBy: REVIEWER, detachReason: 'review', detachedAt: ctx.now }))
      left.push(e.storyId)
    } else if (a.kind === 'relabel' && open) changes.push(...entryChange(e, { role: a.to.role, roleKind: a.to.roleKind }))
    else if (a.kind === 'narrow') fields.charter = a.charter
    else if (a.kind === 'retitle') fields.title = a.to
    else if (a.kind === 'unfreeze') Object.assign(fields, UNFROZEN)
  }
  if (result.brake) Object.assign(fields, { frozen: true, frozenBy: 'review', frozenAt: ctx.now })
  const cancels = leaving(o, left)
  Object.assign(fields, cancels)
  const also =
    'status' in cancels ? [statusDecision(o.id, o.closingStoryId, 'open', { from: 'closing', to: 'open', reason: 'closing_cancelled', by: 'review' }, ctx)] : []
  return plan(decision, {
    also,
    changes: [...changes, ...overviewChange(o, fields)],
    wasPublic: publicBefore(o),
    needsSlug: result.scope === 'ongoing' && o.slug === null,
  })
}

/** The monthly audit's findings as an `audited` review decision (`audit_failed` when the call gave nothing), never applied. */
export function planAudit(c: ReviewCase, result: AuditResult, ctx: PlanContext): Plan {
  const inputs: AuditInputs = {
    trigger: 'audit',
    entries: result.entries,
    wrongJoins: result.wrongJoins,
    wrongRoles: result.wrongRoles,
    errorRate: result.errorRate,
    actions: result.actions,
    refusals: result.refusals,
  }
  return plan(
    draft({
      id: ctx.newId(),
      kind: 'review',
      outcome: result.outcome === 'reviewed' ? 'audited' : 'audit_failed',
      overviewId: c.overviewId,
      storyId: null,
      inputs,
      answer: result.answer,
      model: result.model,
      promptVersion: result.promptVersion,
      costUsd: result.costUsd,
      actor: REVIEWER,
    }),
  )
}

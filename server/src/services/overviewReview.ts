/**
 * Reviews and the monthly audit (`.context/overviews.md`, "Reviews"), over an injected call, the same
 * in production and in the eval's sandbox: `overview-review` re-reads an overview's active entries
 * against its charter, and code turns the answer into the only actions a review may take (detach an
 * entry, relabel a role, narrow the charter by additions to OUT, retitle, clear a freeze), refusing
 * everything else. A review never adds or restores an entry and never widens the charter: code builds
 * the narrowed charter itself from the current one. The audit asks the same at high effort and only
 * counts what a review would have changed. Pure.
 */
import { config } from '../config.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { OVERVIEW_PROMPT_VERSIONS, type ReviewPromptInput } from '../prompts/overviews.js'
import type { ReviewAnswer } from '../schemas/overviews.js'
import { amendCharter, answeredEndEvent, firstJudgments, REVIEW_RIGHTS, sameText, type CharterLimits } from './overviewCharterRules.js'
import { roleOf, type ModelCall } from './overviewLink.js'
import { scopeAfterReview } from './overviewStatus.js'
import type { Charter, OverviewScope, ReviewTrigger, Role } from './overviewTypes.js'

/** An active entry whose story is published, as the review reads it. */
export interface ReviewEntry {
  entryId: string
  storyId: string
  title: string
  label: string
  summary: string
  /** Publication day, `YYYY-MM-DD`. */
  date: string
  role: Role
  /** An editor attached it, set its role or restored it with an Undo: automation never detaches it or changes its role. */
  locked: boolean
}

export interface ReviewCase {
  overviewId: string
  title: string
  charter: Charter
  scope: OverviewScope
  frozen: boolean
  /** Oldest first. */
  entries: ReviewEntry[]
  /** OUT entries an editor's live undo of a review took back out: no review adds them again. */
  lockedOut: string[]
}

export type ReviewAction =
  | { kind: 'detach'; entryId: string; storyId: string; reason: string }
  | { kind: 'relabel'; entryId: string; storyId: string; from: Role; to: Role }
  | { kind: 'narrow'; added: string[]; charter: Charter }
  | { kind: 'retitle'; from: string; to: string }
  | { kind: 'unfreeze' }

export interface ReviewRefusal {
  /** The entry ref, `charter`, `title` or `freeze`. */
  what: string
  reason: string
}

export interface ReviewDeps {
  /** `audit`: the monthly audit's high effort. */
  review(input: ReviewPromptInput, options: { audit: boolean }): Promise<ModelCall<ReviewAnswer>>
}

/** The limits on what a review may write: the charter's and the title's (`overviewCharterRules.ts`). */
export type ReviewOptions = CharterLimits

const ref = (i: number) => `E${i + 1}`
const sameRole = (a: Role, b: Role) => a.role === b.role && a.roleKind === b.roleKind

/**
 * The actions a review's answer may take (`.context/overviews.md`, "Reviews"), and what code refused:
 * - an entry judged not to belong is detached, unless an editor locked it (attached it, set its role or
 *   restored it with an Undo); one judged to belong with another role is relabeled, unless an editor
 *   locked it; an id naming no shown entry (a story to
 *   add or a detached one to restore) or naming one twice is refused; an entry left unjudged stays;
 * - the charter is narrowed only by the OUT entries it adds, onto the current charter, by the review's
 *   rights (`amendCharter`, `REVIEW_RIGHTS`): a rewritten IN or END_EVENT and a dropped OUT entry are
 *   refused and never applied, as is an OUT entry an editor's undo of an earlier review took out
 *   (`lockedOut`), one longer than `maxOutChars` and any past `maxOutEntries` in all (the charter is
 *   copied into every link prompt);
 * - a new title differing from the current one retitles, unless longer than `maxTitleChars`;
 * - a freeze is cleared only on a frozen overview, and only when the answer judges every active entry,
 *   each by its own id and first judgment, to belong (an entry left unjudged keeps the freeze).
 * `kept` is the active entries left after the detaches.
 */
export function allowedActions(
  c: ReviewCase,
  answer: ReviewAnswer,
  options: ReviewOptions = config.overviews,
): { actions: ReviewAction[]; refusals: ReviewRefusal[]; kept: number } {
  const actions: ReviewAction[] = []
  const refusals: ReviewRefusal[] = []
  const byRef = new Map(c.entries.map((e, i) => [ref(i), e]))
  const { first } = firstJudgments(answer.entries)
  for (const a of answer.entries) {
    const id = a.id.trim()
    const entry = byRef.get(id)
    if (!entry) {
      refusals.push({ what: id, reason: 'names no entry of the overview: a review never adds or restores one' })
      continue
    }
    if (first.get(id) !== a) {
      refusals.push({ what: id, reason: 'judged twice' })
      continue
    }
    const role = roleOf(a)
    if (a.belongs === 'no') {
      if (entry.locked) refusals.push({ what: id, reason: 'an editor attached, set or restored it' })
      else actions.push({ kind: 'detach', entryId: entry.entryId, storyId: entry.storyId, reason: a.reason.trim() })
    } else if (!sameRole(role, entry.role)) {
      if (entry.locked) refusals.push({ what: id, reason: 'an editor attached, set or restored it, so its role is theirs' })
      else actions.push({ kind: 'relabel', entryId: entry.entryId, storyId: entry.storyId, from: entry.role, to: role })
    }
  }

  // The charter and title by the review's rights (`amendCharter`): the narrowed charter is the current one with the additions, whatever else the answer rewrote
  const amended = amendCharter(
    c,
    { title: answer.title, charter: { in: answer.charter.in, out: answer.charter.out, endEvent: answeredEndEvent(answer.charter.endEvent) } },
    REVIEW_RIGHTS,
    options,
  )
  refusals.push(...amended.refusals.filter(r => r.field !== 'title').map(r => ({ what: 'charter', reason: r.reason })))
  if (amended.outAdded.length > 0) actions.push({ kind: 'narrow', added: amended.outAdded, charter: { ...c.charter, out: amended.charter.out } })
  refusals.push(...amended.refusals.filter(r => r.field === 'title').map(r => ({ what: 'title', reason: r.reason })))
  if (!sameText(amended.title, c.title)) actions.push({ kind: 'retitle', from: c.title, to: amended.title })

  if (answer.clearFreeze && c.frozen) {
    // Every active entry judged, and judged to belong: one left unjudged keeps the freeze
    if (c.entries.every((_, i) => first.get(ref(i))?.belongs === 'yes')) actions.push({ kind: 'unfreeze' })
    else refusals.push({ what: 'freeze', reason: 'not every entry was judged to belong' })
  }
  return { actions, refusals, kept: c.entries.length - actions.filter(a => a.kind === 'detach').length }
}

export type ReviewOutcome = 'reviewed' | 'failed'

export interface ReviewResult {
  trigger: ReviewTrigger
  outcome: ReviewOutcome
  actions: ReviewAction[]
  refusals: ReviewRefusal[]
  /** Active entries left after the detaches. */
  kept: number
  /** The scope the review leaves (`scopeAfterReview`); never raised while the overview stays frozen. */
  scope: OverviewScope
  /** The detach brake tripped (`braked`): none of its detaches applied, and the overview is frozen for an editor. */
  brake: Brake | null
  answer: ReviewAnswer | null
  costUsd: number
  model: string | null
  promptVersion: string
}

const SCOPE_RANK: Record<OverviewScope, number> = { single: 0, forming: 1, ongoing: 2 }

/** The review's input: the overview and its entries under their refs, oldest first. */
export const reviewInput = (c: ReviewCase): ReviewPromptInput => ({
  title: c.title,
  charter: c.charter,
  frozen: c.frozen,
  entries: c.entries.map((e, i) => ({ ref: ref(i), title: e.title, label: e.label, summary: e.summary, date: e.date, role: e.role })),
})

/** A tripped detach brake: the detaches the review asked for, and the unlocked entries it could detach. */
export interface Brake {
  asked: number
  unlocked: number
}

/** Whether `asked` detaches trip the detach brake: more than half of the `unlocked` entries. A re-center is held to it too. */
export const brakeTrips = (asked: number, unlocked: number): boolean => asked > 0 && asked * 2 > unlocked

/**
 * The detach brake (`.context/overviews.md`, "Reviews"): one review may detach at most half of the
 * overview's unlocked entries. A review asking for more detaches none (each refused), clears no freeze
 * and freezes the overview instead, for an editor to read it (the job raises an admin notice); its
 * relabels, narrowing and retitle still apply. A review that misreads its charter so can never empty an
 * overview in one night.
 */
export function braked(c: ReviewCase, actions: readonly ReviewAction[]): { actions: ReviewAction[]; refusals: ReviewRefusal[]; brake: Brake | null } {
  const asked = actions.filter(a => a.kind === 'detach').length
  const unlocked = c.entries.filter(e => !e.locked).length
  if (!brakeTrips(asked, unlocked)) return { actions: [...actions], refusals: [], brake: null }
  return {
    actions: actions.filter(a => a.kind !== 'detach' && a.kind !== 'unfreeze'),
    refusals: [
      {
        what: 'detaches',
        reason: `asks to detach ${asked} of ${unlocked} unlocked entries, more than half: none detached, and the overview is frozen for an editor`,
      },
    ],
    brake: { asked, unlocked },
  }
}

/**
 * Reviews one overview (`trigger` any but `audit`): the call, then the actions code allows, then the
 * detach brake. The scope follows from the entries kept (3 or more make it public, D-OV4), but a review
 * that leaves the overview frozen (or freezes it) never raises it. A failed call acts on nothing, and
 * the next run asks again.
 */
export async function reviewOverview(
  c: ReviewCase,
  trigger: Exclude<ReviewTrigger, 'audit'>,
  deps: ReviewDeps,
  options: ReviewOptions = config.overviews,
): Promise<ReviewResult> {
  const call = await deps.review(reviewInput(c), { audit: false })
  const base = { trigger, costUsd: call.costUsd, model: call.model, promptVersion: OVERVIEW_PROMPT_VERSIONS.review }
  if (!call.parsed) return { ...base, outcome: 'failed', actions: [], refusals: [], kept: c.entries.length, scope: c.scope, brake: null, answer: null }
  const answer = unescapeXmlDeep(call.parsed)
  const allowed = allowedActions(c, answer, options)
  const { actions, refusals, brake } = braked(c, allowed.actions)
  const kept = c.entries.length - actions.filter(a => a.kind === 'detach').length
  const stillFrozen = brake !== null || (c.frozen && !actions.some(a => a.kind === 'unfreeze'))
  const next = scopeAfterReview(kept)
  const scope = stillFrozen && SCOPE_RANK[next] > SCOPE_RANK[c.scope] ? c.scope : next
  return { ...base, outcome: 'reviewed', actions, refusals: [...allowed.refusals, ...refusals], kept, scope, brake, answer }
}

export interface AuditResult {
  outcome: ReviewOutcome
  /** Entries the audit judged. */
  entries: number
  /** Entries it would have detached, and those it would have relabeled. */
  wrongJoins: number
  wrongRoles: number
  /** (wrong joins + wrong roles) / entries judged; null without an answer or entries. */
  errorRate: number | null
  actions: ReviewAction[]
  refusals: ReviewRefusal[]
  answer: ReviewAnswer | null
  costUsd: number
  model: string | null
  promptVersion: string
}

/**
 * The monthly audit of one public overview: the review's call at high effort, from scratch, and what
 * it would have changed, counted and never applied (`.context/overviews.md`, "Reviews").
 */
export async function auditOverview(c: ReviewCase, deps: ReviewDeps): Promise<AuditResult> {
  const call = await deps.review(reviewInput(c), { audit: true })
  const base = { costUsd: call.costUsd, model: call.model, promptVersion: OVERVIEW_PROMPT_VERSIONS.review }
  if (!call.parsed) return { ...base, outcome: 'failed', entries: 0, wrongJoins: 0, wrongRoles: 0, errorRate: null, actions: [], refusals: [], answer: null }
  const answer = unescapeXmlDeep(call.parsed)
  const { actions, refusals } = allowedActions({ ...c, frozen: false }, answer)
  const known = new Set(c.entries.map((_, i) => ref(i)))
  const entries = new Set(answer.entries.map(e => e.id.trim()).filter(id => known.has(id))).size
  const wrongJoins = actions.filter(a => a.kind === 'detach').length
  const wrongRoles = actions.filter(a => a.kind === 'relabel').length
  return {
    ...base,
    outcome: 'reviewed',
    entries,
    wrongJoins,
    wrongRoles,
    errorRate: entries > 0 ? (wrongJoins + wrongRoles) / entries : null,
    actions,
    refusals,
    answer,
  }
}

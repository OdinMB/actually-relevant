/**
 * Re-centering (`.context/overviews.md`, "Re-centering"): the rules that hold it to where a development
 * began (D-RC14, the owner's: the anchor every re-center must still cover, and the fixed limits on an
 * automated one: its scope and status, the limit of applied automated re-centers, the lock an editor's
 * re-center or an Undo of an automated one sets), which the admin reads to show the anchor in the editor's form; and the
 * automated re-center itself, over injected calls, the same in production and in the eval's sandbox:
 * the signals that fire an attempt (D-RC3), the stories it may take in (D-RC6), the neighbors its new
 * IN must not take in, the draft and its blind check, and the code rules that accept a proposal
 * (`acceptRecenter`, D-RC2, D-RC4). Pure but for the neighbor reads it is given.
 */
import { config } from '../config.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { OVERVIEW_PROMPT_VERSIONS, type RecenterCheckPromptInput, type RecenterPromptInput } from '../prompts/overviews.js'
import type { RecenterAnswer, RecenterCheckAnswer } from '../schemas/overviews.js'
import { groupCandidates, type CandidateOptions, type Neighbour } from './overviewCandidates.js'
import { amendCharter, answeredEndEvent, firstJudgments, RECENTER_RIGHTS, sameText } from './overviewCharterRules.js'
import { roleOf, type ModelCall, type Signal } from './overviewLink.js'
import { brakeTrips, type ReviewCase, type ReviewOptions } from './overviewReview.js'
import type { CandidateOverview, Charter, EntryRole, Memberships, OverviewScope, OverviewStatus, Role } from './overviewTypes.js'

const DAY_MS = 86_400_000

export type RecenterOptions = Pick<typeof config.overviews, 'anchorTurningShare' | 'anchorStandIns' | 'maxAutomatedRecenters' | 'editorRecenterLockDays'>

/** An entry as the anchor reads it. */
export interface AnchorEntry {
  entryId: string
  status: 'active' | 'detached'
  /** Its story is published: an unpublished story cannot be judged, so it is no part of the anchor. */
  published: boolean
  datePublished: Date | null
  role: EntryRole
}

/** The anchor: the entries a re-center must still cover, oldest first. */
export interface Anchor {
  /** The founding entries still active and published; with none left, the oldest active ones standing in (`standIns`). */
  founding: string[]
  standIns: boolean
  /** The other active published entries that are turning points. */
  turningPoints: string[]
}

/**
 * The anchor of an overview (`foundingIds`: the entries its founding made). A founding entry detached
 * since, or whose story is no longer published, leaves it: its removal already said it does not belong.
 * When no founding entry is left, the `anchorStandIns` oldest active entries stand in, so the anchor
 * always holds the development's start.
 */
export function anchorOf(entries: readonly AnchorEntry[], foundingIds: Iterable<string>, options: RecenterOptions = config.overviews): Anchor {
  const founded = new Set(foundingIds)
  const counted = entries
    .filter(e => e.status === 'active' && e.published && e.datePublished !== null)
    .sort((a, b) => a.datePublished!.getTime() - b.datePublished!.getTime() || a.entryId.localeCompare(b.entryId))
  const left = counted.filter(e => founded.has(e.entryId))
  const standIns = left.length === 0
  const founding = (standIns ? counted.slice(0, options.anchorStandIns) : left).map(e => e.entryId)
  const turningPoints = counted.filter(e => e.role === 'turning_point' && !founding.includes(e.entryId)).map(e => e.entryId)
  return { founding, standIns, turningPoints }
}

/**
 * Whether a re-center still covers the anchor: every founding entry, and at least `anchorTurningShare`
 * of the turning points rounded up (so one or two misreads in a long overview do not block it; 1 or 2
 * turning points must all pass), each judged to belong by both calls (`belongs`). `failed` names every
 * anchor entry judged not to belong.
 */
export function anchorHolds(
  anchor: Anchor,
  belongs: (entryId: string) => boolean,
  options: RecenterOptions = config.overviews,
): { holds: boolean; failed: string[] } {
  const failed = [...anchor.founding, ...anchor.turningPoints].filter(id => !belongs(id))
  const needed = Math.ceil(anchor.turningPoints.length * options.anchorTurningShare - 1e-9)
  const passed = anchor.turningPoints.filter(belongs).length
  return { holds: anchor.founding.every(belongs) && passed >= needed, failed }
}

/** An overview as the fixed limits on an automated re-center read it. */
export interface RecenterState {
  scope: OverviewScope
  status: OverviewStatus
  frozen: boolean
  automatedRecenters: number
  recenteredAt: Date | null
  recenteredBy: string | null
  recenterUndoneAt: Date | null
}

/** The lock on automated re-centers, until when it holds and whose it is. */
export interface RecenterLock {
  until: Date
  /** An editor's re-center, or an Undo of an automated one. */
  by: 'editor' | 'undo'
}

/**
 * The lock that keeps automation off an overview for `editorRecenterLockDays` (D-RC14): after an
 * editor's re-center in force (`recenteredBy` `editor`) and after an Undo of an automated re-center
 * (`recenterUndoneAt`), the later of the two; null when neither set one.
 */
export function recenterLock(
  o: Pick<RecenterState, 'recenteredAt' | 'recenteredBy' | 'recenterUndoneAt'>,
  options: RecenterOptions = config.overviews,
): RecenterLock | null {
  const after = (at: Date) => new Date(at.getTime() + options.editorRecenterLockDays * DAY_MS)
  const locks: RecenterLock[] = [
    ...(o.recenteredBy === 'editor' && o.recenteredAt ? [{ until: after(o.recenteredAt), by: 'editor' as const }] : []),
    ...(o.recenterUndoneAt ? [{ until: after(o.recenterUndoneAt), by: 'undo' as const }] : []),
  ]
  return locks.sort((a, b) => b.until.getTime() - a.until.getTime())[0] ?? null
}

/**
 * Why automation may not re-center the overview at `now` (the wall clock an editor acts on), or null
 * when it may: only an ongoing overview, open or quiet and not frozen (a forming one is not
 * re-centered by automation); fewer than `maxAutomatedRecenters` applied automated re-centers (after
 * that only an editor re-centers it); and no lock (`recenterLock`): no editor's re-center or Undo of an
 * automated one within `editorRecenterLockDays`.
 */
export function automatedRecenterBlocked(
  o: RecenterState,
  now: Date,
  options: RecenterOptions = config.overviews,
): 'scope' | 'status' | 'frozen' | 'limit' | 'locked' | null {
  if (o.scope !== 'ongoing') return 'scope'
  if (o.status !== 'open' && o.status !== 'quiet') return 'status'
  if (o.frozen) return 'frozen'
  if (o.automatedRecenters >= options.maxAutomatedRecenters) return 'limit'
  const lock = recenterLock(o, options)
  return lock && now.getTime() < lock.until.getTime() ? 'locked' : null
}

// ---------------------------------------------------------------------------
// The automated re-center
// ---------------------------------------------------------------------------

/** Who an automated re-center's writes name (`actor`, `recentered_by`, `joined_by`, `detached_by`). */
export const RECENTERER = 'recenter'

/** What an automated re-center reads of the settings. */
export type AttemptOptions = RecenterOptions &
  ReviewOptions &
  CandidateOptions &
  Pick<
    typeof config.overviews,
    'recenterWiderSignal' | 'recenterLookbackDays' | 'maxRecenterStories' | 'recenterKeepShare' | 'recenterMinJoins' | 'recenterNeighbourEntries'
  >

/** A live link decision's signals as an attempt counts them: the story, its signals, and the run time it was linked at. */
export interface SignalRecord {
  storyId: string
  signals: readonly Signal[]
  linkedAt: Date | null
}

export interface SignalCount {
  wider: number
  centerMoved: number
}

/**
 * The signals for one overview from stories linked after its last attempt (`triedAt`, the run time it
 * was made at, as `linkedAt` is): the only guard against repeats (D-RC3). A record from before the
 * signal (no `linkedAt`) counts nothing.
 */
export function signalsSince(overviewId: string, records: readonly SignalRecord[], triedAt: Date | null): SignalCount {
  const count: SignalCount = { wider: 0, centerMoved: 0 }
  for (const r of records) {
    if (!r.linkedAt || (triedAt && r.linkedAt.getTime() <= triedAt.getTime())) continue
    const own = r.signals.filter(s => s.overviewId === overviewId)
    if (own.some(s => s.kind === 'wider')) count.wider++
    if (own.some(s => s.kind === 'center_moved')) count.centerMoved++
  }
  return count
}

/** An attempt fires on `recenterWiderSignal` wider flags or one center flag (D-RC3). */
export const signalFires = (s: SignalCount, options: Pick<AttemptOptions, 'recenterWiderSignal'> = config.overviews): boolean =>
  s.centerMoved >= 1 || s.wider >= options.recenterWiderSignal

/** A story a re-center may take in. */
export interface OfferedStory {
  storyId: string
  title: string
  label: string
  summary: string
  /** Publication day, `YYYY-MM-DD`. */
  date: string
  datePublished: Date
  /** Its row in this overview, detached and unlocked: a join reuses it. */
  entryId: string | null
  /** The words of it its signals quoted for this overview. */
  quotes: string[]
}

/** A story an attempt weighs, as production's SELECT and the sandbox both give it. */
export interface TurnedAwayRow extends Omit<OfferedStory, 'entryId'> {
  published: boolean
  /** It is an active entry of an overview, this one or another. */
  active: boolean
  /** Its newest row in this overview, if any: who detached it and whether an editor locked it. */
  row: { entryId: string; detachedBy: string | null; locked: boolean } | null
}

/**
 * The stories a re-center may take in (D-RC6; `.context/overviews.md`, "Re-centering"): published within
 * `recenterLookbackDays` before the development clock and not after it, active in no overview, and
 * either flagged for this overview by a signal or detached from it by a review; never one an editor
 * locked there. Newest first, at most `maxRecenterStories`; a story with a row here reuses it.
 */
export function turnedAway(
  rows: readonly TurnedAwayRow[],
  clock: Date,
  options: Pick<AttemptOptions, 'recenterLookbackDays' | 'maxRecenterStories'> = config.overviews,
): OfferedStory[] {
  const since = clock.getTime() - options.recenterLookbackDays * DAY_MS
  return rows
    .filter(r => r.published && !r.active && !r.row?.locked)
    .filter(r => r.datePublished.getTime() >= since && r.datePublished.getTime() <= clock.getTime())
    .filter(r => r.quotes.length > 0 || r.row?.detachedBy === 'review')
    .sort((a, b) => b.datePublished.getTime() - a.datePublished.getTime() || a.storyId.localeCompare(b.storyId))
    .slice(0, options.maxRecenterStories)
    .map(({ published: _p, active: _a, row, ...s }) => ({ ...s, entryId: row?.entryId ?? null }))
}

/** An open overview near the development, which the new IN must not take in (merging is not a re-center's). */
export interface RecenterNeighbour {
  overviewId: string
  title: string
  in: string
}

/** What the neighbors are read with: production's tables, the sandbox's memory. */
export interface NeighbourReads {
  neighbours(storyId: string, asOf: Date): Promise<Neighbour[]>
  memberships(storyIds: string[], asOf: Date): Promise<Memberships>
  overviews(ids: string[], asOf: Date): Promise<CandidateOverview[]>
}

/**
 * The neighbors of a re-center: the overviews `groupCandidates` gives at the development clock for the
 * overview's `recenterNeighbourEntries` newest entries and the stories it may take in, itself excluded.
 */
export async function neighbourOverviews(
  overviewId: string,
  storyIds: readonly string[],
  clock: Date,
  reads: NeighbourReads,
  options: CandidateOptions = config.overviews,
): Promise<RecenterNeighbour[]> {
  const ids = new Set<string>()
  for (const id of storyIds) {
    const near = await reads.neighbours(id, clock)
    const memberships = await reads.memberships(
      near.map(n => n.id),
      clock,
    )
    for (const o of groupCandidates({ id, datePublished: clock }, near, memberships, options).overviews) if (o.overviewId !== overviewId) ids.add(o.overviewId)
  }
  if (ids.size === 0) return []
  return (await reads.overviews([...ids], clock)).map(o => ({ overviewId: o.id, title: o.title, in: o.charter.in }))
}

/** An overview as an automated re-center reads it: its review case, its state, its anchor, the stories it may take in, its neighbors and what fired the attempt. */
export interface RecenterCase extends ReviewCase {
  status: OverviewStatus
  automatedRecenters: number
  anchor: Anchor
  /** Newest first (`turnedAway`). */
  stories: OfferedStory[]
  neighbours: RecenterNeighbour[]
  fired: SignalCount
}

/** What a re-center case is built from, as production's SELECTs and the sandbox both give it. */
export interface RecenterParts {
  review: ReviewCase
  state: RecenterState & { recenterTriedAt: Date | null }
  /** The publication dates of the review's entries, by entry id. */
  entryDates: ReadonlyMap<string, Date>
  /** The entries its founding made. */
  founding: readonly string[]
  /** The live link decisions with a signal for it. */
  records: readonly SignalRecord[]
  /** The stories those name, and those a review detached from it. */
  rows: readonly TurnedAwayRow[]
}

/**
 * An overview's re-center case but its neighbors, or null when no attempt is due: automation may
 * re-center it at the wall clock `now` (`automatedRecenterBlocked`), it has an active entry, its signals
 * since the last attempt fire one (`signalFires`), and at least `recenterMinJoins` stories may be taken
 * in at the development clock (with fewer it could never re-center, so no call is made and the signals
 * wait for more).
 */
export function recenterCaseOf(
  parts: RecenterParts,
  at: { clock: Date; now: Date },
  options: AttemptOptions = config.overviews,
): Omit<RecenterCase, 'neighbours'> | null {
  const { review, state } = parts
  if (automatedRecenterBlocked(state, at.now, options) || review.entries.length === 0) return null
  const fired = signalsSince(review.overviewId, parts.records, state.recenterTriedAt)
  if (!signalFires(fired, options)) return null
  const stories = turnedAway(parts.rows, at.clock, options)
  if (stories.length < options.recenterMinJoins) return null
  const anchor = anchorOf(
    review.entries.map(e => ({
      entryId: e.entryId,
      status: 'active',
      published: true,
      datePublished: parts.entryDates.get(e.entryId) ?? null,
      role: e.role.role,
    })),
    parts.founding,
    options,
  )
  return { ...review, status: state.status, automatedRecenters: state.automatedRecenters, anchor, stories, fired }
}

/** The stories whose neighbors bound a re-center: the case's `recenterNeighbourEntries` newest entries and the stories it may take in. */
export const neighbourStories = (
  c: Omit<RecenterCase, 'neighbours'>,
  options: Pick<AttemptOptions, 'recenterNeighbourEntries'> = config.overviews,
): string[] => [...c.entries.slice(-options.recenterNeighbourEntries).map(e => e.storyId), ...c.stories.map(s => s.storyId)]

export interface RecenterDeps {
  draft(input: RecenterPromptInput): Promise<ModelCall<RecenterAnswer>>
  check(input: RecenterCheckPromptInput): Promise<ModelCall<RecenterCheckAnswer>>
}

export type RecenterOutcome = 'recentered' | 'kept' | 'refused' | 'failed'

/** The rules `acceptRecenter` holds a proposal to, each named in a refusal. */
export type RecenterRule = 'draft' | 'out' | 'end_event' | 'anchor' | 'kept' | 'joins' | 'neighbour' | 'brake'

export interface RecenterResult {
  outcome: RecenterOutcome
  /** The first rule that refused it; null unless refused. */
  rule: RecenterRule | null
  refusals: { rule: RecenterRule; reason: string }[]
  /** For a proposal: its title and charter, the old OUT with `outAdded` after it. */
  title: string | null
  charter: Charter | null
  outAdded: string[]
  /** Unlocked entries outside the anchor that both calls judged not to belong: detached. */
  detaches: { entryId: string; storyId: string }[]
  /** Stories both calls judged to belong, with the draft's role: joined. */
  joins: { storyId: string; entryId: string | null; datePublished: Date; role: Role }[]
  /** Each anchor entry, and whether both calls judged it to belong. */
  anchor: { entryId: string; founding: boolean; passed: boolean }[]
  /** Entries both calls judged to belong. */
  kept: number
  fired: SignalCount
  answer: { draft: RecenterAnswer | null; check: RecenterCheckAnswer | null }
  costUsd: number
  /** The draft's model, which the AI marker names for the new title. */
  model: string | null
  promptVersion: string
}

const entryRef = (i: number) => `E${i + 1}`
const storyRef = (i: number) => `S${i + 1}`
/** Each ref's judgment: its first, the one that counts (`firstJudgments`). */
const judgments = (answers: readonly { id: string; belongs: 'yes' | 'no' }[]) => new Map([...firstJudgments(answers).first].map(([id, a]) => [id, a.belongs]))

export const recenterInput = (c: RecenterCase): RecenterPromptInput => {
  const anchored = new Set([...c.anchor.founding, ...c.anchor.turningPoints])
  return {
    title: c.title,
    charter: c.charter,
    entries: c.entries.map((e, i) => ({
      ref: entryRef(i),
      title: e.title,
      label: e.label,
      summary: e.summary,
      date: e.date,
      role: e.role,
      anchor: anchored.has(e.entryId),
    })),
    stories: c.stories.map((s, i) => ({ ref: storyRef(i), title: s.title, label: s.label, summary: s.summary, date: s.date, quotes: s.quotes })),
  }
}

export const recenterCheckInput = (c: RecenterCase, charter: Charter): RecenterCheckPromptInput => ({
  charter,
  entries: c.entries.map((e, i) => ({ ref: entryRef(i), title: e.title, label: e.label, summary: e.summary, date: e.date })),
  stories: c.stories.map((s, i) => ({ ref: storyRef(i), title: s.title, label: s.label, summary: s.summary, date: s.date })),
  neighbours: c.neighbours.map((n, i) => ({ ref: `N${i + 1}`, title: n.title, in: n.in })),
})

/** A ref of the other list: a story's `S#` among the entries' judgments, or an entry's `E#` among the stories'. */
const misfiled = (draft: RecenterAnswer): string[] => [
  ...draft.entries.map(e => e.id.trim()).filter(id => /^S\d+$/.test(id)),
  ...draft.stories.map(s => s.id.trim()).filter(id => /^E\d+$/.test(id)),
]

/**
 * The rules a draft is held to before its check is asked (D-RC2): every judgment in its own list (a
 * story judged among the entries would join with no role); a title and an IN, something changed, and
 * the re-center's rights and the limits (`amendCharter`, `RECENTER_RIGHTS`: a title, IN and END_EVENT
 * within their caps, the old OUT list kept whole, with additions within `maxOutChars` and
 * `maxOutEntries` and none an editor's Undo locked out). Returns the proposal with the charter code
 * builds (the old OUT with the additions after it), and the refusals.
 */
function draftRules(
  c: RecenterCase,
  draft: RecenterAnswer,
  options: ReviewOptions,
): { title: string; charter: Charter; outAdded: string[]; refusals: RecenterResult['refusals'] } {
  const refusals: RecenterResult['refusals'] = []
  const title = draft.title.trim()
  const proposed: Charter = { in: draft.charter.in.trim(), out: draft.charter.out, endEvent: answeredEndEvent(draft.charter.endEvent) }
  const wrong = misfiled(draft)
  if (wrong.length > 0) refusals.push({ rule: 'draft', reason: `judges ${wrong.join(', ')} in the wrong list: a malformed draft` })
  if (!title || !proposed.in) refusals.push({ rule: 'draft', reason: 'proposes no title or no IN' })
  const amended = amendCharter(c, { title, charter: proposed }, RECENTER_RIGHTS, options)
  refusals.push(...amended.refusals.map(r => ({ rule: r.field === 'out' ? ('out' as const) : ('draft' as const), reason: r.reason })))
  const charter: Charter = { in: proposed.in, out: amended.charter.out, endEvent: proposed.endEvent }
  if (
    refusals.length === 0 &&
    sameText(title, c.title) &&
    sameText(charter.in, c.charter.in) &&
    charter.endEvent === c.charter.endEvent &&
    amended.outAdded.length === 0
  )
    refusals.push({ rule: 'draft', reason: 'proposes the title and charter it has' })
  return { title, charter, outAdded: amended.outAdded, refusals }
}

/**
 * Whether code accepts a proposal both calls answered (D-RC4, D-RC14; `.context/overviews.md`,
 * "Re-centering"), every rule that fails named: a named END_EVENT the check finds concrete (none is
 * allowed); the anchor holds (`anchorHolds`); at least `recenterKeepShare` of the entries judged to
 * belong by both calls (locked ones counted, never detached); at least `recenterMinJoins` of the stories
 * judged to belong by both; no neighbor covered; and the detach brake on what it would detach. Only an
 * entry both calls reject, unlocked and outside the anchor, is detached; only a story both accept joins.
 */
export function acceptRecenter(
  c: RecenterCase,
  draft: RecenterAnswer,
  check: RecenterCheckAnswer,
  charter: Charter,
  options: AttemptOptions = config.overviews,
): Pick<RecenterResult, 'refusals' | 'detaches' | 'joins' | 'anchor' | 'kept'> {
  const [d, k] = [judgments([...draft.entries, ...draft.stories]), judgments([...check.entries, ...check.stories])]
  const both = (ref: string, v: 'yes' | 'no') => d.get(ref) === v && k.get(ref) === v
  const refOf = new Map(c.entries.map((e, i) => [e.entryId, entryRef(i)]))
  const belongs = (entryId: string) => both(refOf.get(entryId) ?? '', 'yes')
  const refusals: RecenterResult['refusals'] = []

  if (charter.endEvent !== null && check.endEventConcrete !== 'yes')
    refusals.push({ rule: 'end_event', reason: `the check finds the END_EVENT not concrete: ${charter.endEvent}` })
  const held = anchorHolds(c.anchor, belongs, options)
  if (!held.holds) refusals.push({ rule: 'anchor', reason: `anchor entries judged not to belong: ${held.failed.map(id => refOf.get(id)).join(', ')}` })
  const kept = c.entries.filter(e => belongs(e.entryId)).length
  if (kept < c.entries.length * options.recenterKeepShare - 1e-9)
    refusals.push({ rule: 'kept', reason: `keeps ${kept} of ${c.entries.length} entries, fewer than ${Math.round(options.recenterKeepShare * 100)}%` })
  const roles = new Map(draft.stories.map(s => [s.id.trim(), roleOf(s)]))
  const joins = c.stories.flatMap((s, i) =>
    both(storyRef(i), 'yes') ? [{ storyId: s.storyId, entryId: s.entryId, datePublished: s.datePublished, role: roles.get(storyRef(i))! }] : [],
  )
  if (joins.length < options.recenterMinJoins)
    refusals.push({ rule: 'joins', reason: `takes in ${joins.length} of the stories, fewer than ${options.recenterMinJoins}` })
  const covered = check.neighbours.filter(n => n.covered === 'yes' && /^N\d+$/.test(n.id.trim()) && Number(n.id.trim().slice(1)) <= c.neighbours.length)
  if (covered.length > 0)
    refusals.push({ rule: 'neighbour', reason: `its IN takes in ${covered.map(n => `"${c.neighbours[Number(n.id.trim().slice(1)) - 1]!.title}"`).join(', ')}` })
  const anchored = new Set([...c.anchor.founding, ...c.anchor.turningPoints])
  const detaches = c.entries.flatMap((e, i) =>
    !e.locked && !anchored.has(e.entryId) && both(entryRef(i), 'no') ? [{ entryId: e.entryId, storyId: e.storyId }] : [],
  )
  const unlocked = c.entries.filter(e => !e.locked).length
  if (brakeTrips(detaches.length, unlocked))
    refusals.push({ rule: 'brake', reason: `would detach ${detaches.length} of ${unlocked} unlocked entries, more than half` })
  const anchor = [
    ...c.anchor.founding.map(id => ({ entryId: id, founding: true })),
    ...c.anchor.turningPoints.map(id => ({ entryId: id, founding: false })),
  ].map(a => ({
    ...a,
    passed: belongs(a.entryId),
  }))
  return { refusals, detaches, joins, anchor, kept }
}

/**
 * One automated re-center attempt (`.context/overviews.md`, "Re-centering"): the draft; a `keep` ends it,
 * and so does a draft code refuses (no check asked); otherwise the blind check, then `acceptRecenter`.
 * A call that gave nothing is `failed`, and the next run asks again.
 */
export async function recenterOverview(c: RecenterCase, deps: RecenterDeps, options: AttemptOptions = config.overviews): Promise<RecenterResult> {
  const draftCall = await deps.draft(recenterInput(c))
  const base: RecenterResult = {
    outcome: 'failed',
    rule: null,
    refusals: [],
    title: null,
    charter: null,
    outAdded: [],
    detaches: [],
    joins: [],
    anchor: [],
    kept: 0,
    fired: c.fired,
    answer: { draft: null, check: null },
    costUsd: draftCall.costUsd,
    model: draftCall.model,
    promptVersion: OVERVIEW_PROMPT_VERSIONS.recenter,
  }
  if (!draftCall.parsed) return base
  const draft = unescapeXmlDeep(draftCall.parsed)
  base.answer.draft = draft
  if (draft.decision === 'keep') return { ...base, outcome: 'kept' }
  const proposal = draftRules(c, draft, options)
  const proposed = { ...base, title: proposal.title, charter: proposal.charter, outAdded: proposal.outAdded }
  if (proposal.refusals.length > 0) return { ...proposed, outcome: 'refused', rule: proposal.refusals[0]!.rule, refusals: proposal.refusals }
  const checkCall = await deps.check(recenterCheckInput(c, proposal.charter))
  const costUsd = base.costUsd + checkCall.costUsd
  if (!checkCall.parsed) return { ...proposed, costUsd }
  const check = unescapeXmlDeep(checkCall.parsed)
  const accepted = acceptRecenter(c, draft, check, proposal.charter, options)
  const refused = accepted.refusals.length > 0
  return {
    ...proposed,
    ...accepted,
    // Nothing of a refused proposal applies
    ...(refused ? { detaches: [], joins: [] } : {}),
    outcome: refused ? 'refused' : 'recentered',
    rule: accepted.refusals[0]?.rule ?? null,
    answer: { draft, check },
    costUsd,
  }
}

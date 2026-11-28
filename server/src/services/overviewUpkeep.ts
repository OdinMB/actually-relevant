/**
 * The overview step's upkeep after linking (`.context/overviews.md`, "The job", parts 2 to 4), over
 * injected reads, calls and writes, the same in production and in the eval's sandbox: the status
 * machine with the unpublished-member rule and the burst check; the automated re-centers the link
 * signals fired, the reviews due and the monthly audit; and, while the stands are on, the stands
 * refreshes due. Each overview is its own item: one that fails is logged and the rest go on, and the
 * step stops starting items once it is switched off. Pure: nothing here reads or writes the database.
 */
import { config } from '../config.js'
import { auditOverview, reviewOverview, type AuditResult, type ReviewCase, type ReviewDeps, type ReviewOptions, type ReviewResult } from './overviewReview.js'
import {
  refreshStands,
  standsFacts,
  standsSignature,
  standsUntil,
  type MemberFact,
  type StandsDeps,
  type StandsOptions,
  type StandsResult,
} from './overviewStands.js'
import { recenterOverview, type AttemptOptions, type RecenterCase, type RecenterDeps, type RecenterResult } from './overviewRecenter.js'
import { anomalies, nextState, reviewDue, type StatusMove, type StatusOptions } from './overviewStatus.js'
import type { OverviewState, ReviewTrigger, Role } from './overviewTypes.js'

/** A public overview as its stands are refreshed: its entries, its members' facts and the last attempt's signature. */
export interface StandsCase {
  overviewId: string
  title: string
  /** Active, published entries, oldest first. */
  entries: { storyId: string; title: string; date: string; role: Role }[]
  members: MemberFact[]
  /** The last settled refresh's signature (`standsSignature`); null before the first. */
  lastSignature: string | null
  /** What the offer is made of, as a marker the next refresh compares (`standsCases`). */
  marker: string
  /** Nothing the offer is made of changed since the last refresh, and no current flag has: the facts were not read, and nothing is due. */
  unchanged: boolean
}

/** An overview frozen this run, for the owner's notice: by a burst of joins, or by a review that asked to detach more than half its entries. */
export interface UpkeepFreeze {
  overviewId: string
  title: string
  cause: 'burst' | 'brake'
  /** The joins the burst counted, or the detaches the review asked for. */
  count: number
}

/** What a review's write did: `written` as its result says, or `stale` when its overview changed while the call ran (or is gone), so nothing of it applied and the review stays due. */
export type ReviewWrite = 'written' | 'stale'

/** An automated re-center applied this run, for the owner's notice. */
export interface UpkeepRecenter {
  overviewId: string
  from: string
  to: string
  /** Applied automated re-centers now, of `maxAutomatedRecenters`. */
  count: number
}

export interface UpkeepDeps {
  /** Every overview with an active entry, as the status machine reads it. */
  states(): Promise<OverviewState[]>
  reviewCase(overviewId: string): Promise<ReviewCase | null>
  /** The public overviews the monthly audit takes now: none when one ran within `auditEveryDays`. */
  auditPicks(now: Date): Promise<string[]>
  /**
   * Whether part 4, the stands, runs at all: production's while the stands gate is open
   * (`overviewStandsGate.ts`), the evals' always, since they measure the stands. Off, no case is read
   * and nothing of the stands is written.
   */
  standsOn: boolean
  /** Public overviews that are not frozen, with what their stands are written from on `today`. */
  standsCases(today: string): Promise<StandsCase[]>
  /** The overviews an automated re-center is due on (`recenterCaseOf`), with their neighbors. */
  recenterCases(at: Pick<UpkeepTimes, 'clock' | 'now'>): Promise<RecenterCase[]>
  review: ReviewDeps
  stands: StandsDeps
  recenter: RecenterDeps
  applyStatus(state: OverviewState, moves: StatusMove[], clock: Date): Promise<void>
  applyBurst(state: OverviewState): Promise<void>
  applyReview(c: ReviewCase, result: ReviewResult): Promise<ReviewWrite>
  /** `stale` when the overview or a story to join changed during the calls (or the overview is gone): nothing applied, asked again next run. */
  applyRecenter(c: RecenterCase, result: RecenterResult): Promise<ReviewWrite>
  applyAudit(c: ReviewCase, result: AuditResult): Promise<void>
  /** The record's `signature` is null for a failed refresh, which the next run tries again. */
  applyStands(
    c: StandsCase,
    result: StandsResult,
    record: { signature: string | null; marker: string | null; until: string | null },
    today: string,
  ): Promise<void>
  options?: StatusOptions & StandsOptions & ReviewOptions & AttemptOptions
}

/**
 * `clock`: the development time linking has reached (today, or while a backfill drains the newest
 * story this run linked), which quiet and fading count in; `now`: the wall clock reviews are
 * spaced by; `today`: the day the stands judge facts current on (D-OV5).
 */
export interface UpkeepTimes {
  clock: Date
  now: Date
  today: string
}

export interface UpkeepTally {
  /** Status and scope moves, entries of unpublished stories detached among them. */
  moves: number
  detached: number
  bursts: number
  reviews: number
  /** Reviews whose overview changed while their call ran: recorded `stale`, nothing applied, asked again next run. */
  reviewsStale: number
  /** Actions reviews applied, and answers or parts code refused, of the reviews written. */
  reviewActions: number
  reviewRefusals: number
  /** Automated re-center attempts made, those code refused, and those gone stale (asked again next run); the applied ones are `recenters`. */
  recenterAttempts: number
  recentersRefused: number
  recentersStale: number
  recenters: UpkeepRecenter[]
  audits: number
  /** Stands refreshes attempted, and new versions written. */
  standsRefreshes: number
  standsWritten: number
  /** Stands lines written (within the limits), and those of them any check dropped: never more than the lines written. */
  standsChecked: number
  standsDropped: number
  /** Items started (an overview's status, a re-center, a review, an audit, a stands refresh due), and those whose call gave nothing or that threw, each counted once: the next run tries them again. */
  items: number
  failed: number
  /** Overviews frozen this run, each with its title, for the owner's notice. */
  freezes: UpkeepFreeze[]
  costUsd: number
  errors: { part: UpkeepPart; id: string; error: unknown }[]
  /** The step was switched off before every part ran. */
  stopped: boolean
}

export type UpkeepPart = 'status' | 'recenter' | 'review' | 'audit' | 'stands'

const emptyTally = (): UpkeepTally => ({
  moves: 0,
  detached: 0,
  bursts: 0,
  reviews: 0,
  reviewsStale: 0,
  reviewActions: 0,
  reviewRefusals: 0,
  recenterAttempts: 0,
  recentersRefused: 0,
  recentersStale: 0,
  recenters: [],
  audits: 0,
  standsRefreshes: 0,
  standsWritten: 0,
  standsChecked: 0,
  standsDropped: 0,
  items: 0,
  failed: 0,
  freezes: [],
  costUsd: 0,
  errors: [],
  stopped: false,
})

/** What a run's parts share: the deps, the clocks, the settings, the tally, and the overviews re-centered so far. */
interface UpkeepRun {
  deps: UpkeepDeps
  at: UpkeepTimes
  options: NonNullable<UpkeepDeps['options']>
  tally: UpkeepTally
  recentered: Set<string>
}

/**
 * Each part's work on one item, which says whether its call gave nothing (`true`: the next run tries
 * it again). A write that throws fails the item too; `runUpkeep` counts each failed item once.
 */
type PartWork<T> = (run: UpkeepRun, item: T) => Promise<boolean>

/** Part 2: one overview's status moves, then the burst check that freezes it. */
const statusOne: PartWork<OverviewState> = async ({ deps, at, options, tally }, state) => {
  const moves = nextState(state, at.clock, options)
  if (moves.length > 0) {
    await deps.applyStatus(state, moves, at.clock)
    tally.moves += moves.length
    tally.detached += moves.filter(m => m.kind === 'detach').length
  }
  if (anomalies(state, options).includes('burst')) {
    await deps.applyBurst(state)
    tally.bursts++
    tally.freezes.push({ overviewId: state.id, title: state.title, cause: 'burst', count: state.burstJoins })
  }
  return false
}

/** Part 3: one automated re-center attempt and its write; an applied one keeps its overview's review for the next run. */
const recenterOne: PartWork<RecenterCase> = async ({ deps, options, tally, recentered }, c) => {
  const result = await recenterOverview(c, deps.recenter, options)
  tally.costUsd += result.costUsd
  tally.recenterAttempts++
  const failed = result.outcome === 'failed'
  if ((await deps.applyRecenter(c, result)) === 'stale') {
    tally.recentersStale++
    return failed
  }
  if (result.outcome === 'refused') tally.recentersRefused++
  if (result.outcome === 'recentered') {
    recentered.add(c.overviewId)
    tally.recenters.push({ overviewId: c.overviewId, from: c.title, to: result.title!, count: c.automatedRecenters + 1 })
  }
  return failed
}

/** Part 3: one review due and its write. */
const reviewOne: PartWork<{ id: string; trigger: Exclude<ReviewTrigger, 'audit'> }> = async ({ deps, options, tally }, { id, trigger }) => {
  const c = await deps.reviewCase(id)
  if (!c || c.entries.length === 0) return false
  const result = await reviewOverview(c, trigger, deps.review, options)
  tally.costUsd += result.costUsd
  tally.reviews++
  if ((await deps.applyReview(c, result)) === 'stale') tally.reviewsStale++
  else {
    tally.reviewActions += result.actions.length
    tally.reviewRefusals += result.refusals.length
    if (result.brake) tally.freezes.push({ overviewId: c.overviewId, title: c.title, cause: 'brake', count: result.brake.asked })
  }
  return result.outcome === 'failed'
}

/** Part 3: one overview of the monthly audit, logged only. */
const auditOne: PartWork<string> = async ({ deps, tally }, id) => {
  const c = await deps.reviewCase(id)
  if (!c || c.entries.length === 0) return false
  const result = await auditOverview(c, deps.review)
  tally.costUsd += result.costUsd
  tally.audits++
  await deps.applyAudit(c, result)
  return result.outcome === 'failed'
}

/** Part 4: one overview's stands refresh, when its signature changed, and its write (a failed one records no signature, so the next run tries again). */
const standsOne: PartWork<StandsCase> = async ({ deps, at, options, tally }, c) => {
  const offered = standsFacts(c.members, at.today, options)
  const signature = standsSignature(c.title, offered, c.entries)
  if (signature === c.lastSignature) return false
  const result = await refreshStands({ title: c.title, entries: c.entries }, offered, at.today, deps.stands, options)
  tally.costUsd += result.costUsd
  tally.standsRefreshes++
  if (result.outcome === 'written') tally.standsWritten++
  tally.standsChecked += result.checked
  tally.standsDropped += result.failed
  const failed = result.outcome === 'failed'
  await deps.applyStands(c, result, { signature: failed ? null : signature, marker: failed ? null : c.marker, until: standsUntil(offered) }, at.today)
  return failed
}

/**
 * Runs parts 2 to 4 in order (`.context/overviews.md`, "The job"): the status machine (each
 * overview's moves, then the burst check that freezes it), then the automated re-centers
 * due, then the reviews due on the states as they stand after them (none for an overview re-centered
 * this run) and the monthly audit, then, while `standsOn`, the stands refreshes whose signature
 * changed. `keepGoing` is asked before each item; once it says no, nothing else starts. An item fails
 * once, whether its call gave nothing, its write threw, or both.
 */
export async function runUpkeep(deps: UpkeepDeps, at: UpkeepTimes, keepGoing: () => Promise<boolean> | boolean = () => true): Promise<UpkeepTally> {
  const run: UpkeepRun = { deps, at, options: deps.options ?? config.overviews, tally: emptyTally(), recentered: new Set() }
  const { tally } = run
  const each = async <T>(part: UpkeepPart, items: readonly T[], id: (item: T) => string, work: PartWork<T>) => {
    for (const item of items) {
      if (tally.stopped || !(await keepGoing())) {
        tally.stopped = true
        return
      }
      tally.items++
      let failed: boolean
      try {
        failed = await work(run, item)
      } catch (error) {
        failed = true
        tally.errors.push({ part, id: id(item), error })
      }
      if (failed) tally.failed++
    }
  }

  await each('status', await deps.states(), s => s.id, statusOne)
  if (tally.stopped) return tally
  // Re-centers before reviews: one applied this run judged every entry under its new charter by two calls, so its overview's review waits for the next run
  await each('recenter', await deps.recenterCases(at), c => c.overviewId, recenterOne)
  if (tally.stopped) return tally
  const due = (await deps.states()).flatMap(s => {
    const trigger = run.recentered.has(s.id) ? null : reviewDue(s, at, run.options)
    return trigger ? [{ id: s.id, trigger }] : []
  })
  await each('review', due, d => d.id, reviewOne)
  if (tally.stopped) return tally
  await each('audit', await deps.auditPicks(at.now), id => id, auditOne)
  if (tally.stopped || !deps.standsOn) return tally
  await each(
    'stands',
    (await deps.standsCases(at.today)).filter(c => !c.unchanged),
    c => c.overviewId,
    standsOne,
  )
  return tally
}

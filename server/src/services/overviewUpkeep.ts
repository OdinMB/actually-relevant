/**
 * The overview step's upkeep after linking (`.context/overviews.md`, "The job", parts 2 to 5), over
 * injected reads, calls and writes, the same in production and in the eval's sandbox: the end-event
 * closing checks; the status machine with the unpublished-member rule and the burst check; the
 * reviews due and the monthly audit; and the stands refreshes due. Each overview is its own item: one
 * that fails is logged and the rest go on, and the step stops starting items once it is switched off.
 * Pure: nothing here reads or writes the database.
 */
import { config } from '../config.js'
import { checkClosing, type CloseCase, type CloseDeps, type CloseResult } from './overviewClose.js'
import { auditOverview, reviewOverview, type AuditResult, type ReviewCase, type ReviewDeps, type ReviewResult } from './overviewReview.js'
import { refreshStands, standsFacts, standsSignature, type MemberFact, type StandsDeps, type StandsOptions, type StandsResult } from './overviewStands.js'
import { anomalies, nextState, reviewDue, type StatusMove, type StatusOptions } from './overviewStatus.js'
import type { OverviewState, Role } from './overviewTypes.js'

/** A public overview as its stands are refreshed: its entries, its members' facts and the last attempt's signature. */
export interface StandsCase {
  overviewId: string
  title: string
  /** Active, published entries, oldest first. */
  entries: { storyId: string; title: string; date: string; role: Role }[]
  members: MemberFact[]
  /** The last settled refresh's signature (`standsSignature`); null before the first. */
  lastSignature: string | null
}

export interface UpkeepDeps {
  /** Joined stories flagged as reporting their overview's end event, not yet judged. */
  closings(): Promise<CloseCase[]>
  /** Every overview with an active entry, as the status machine reads it. */
  states(): Promise<OverviewState[]>
  reviewCase(overviewId: string): Promise<ReviewCase | null>
  /** The public overviews the monthly audit takes now: none when one ran within `auditEveryDays`. */
  auditPicks(now: Date): Promise<string[]>
  /** Public overviews that are not frozen, with what their stands are written from. */
  standsCases(): Promise<StandsCase[]>
  close: CloseDeps
  review: ReviewDeps
  stands: StandsDeps
  applyClosing(c: CloseCase, result: CloseResult): Promise<void>
  applyStatus(state: OverviewState, moves: StatusMove[], clock: Date): Promise<void>
  applyBurst(state: OverviewState): Promise<void>
  applyReview(c: ReviewCase, result: ReviewResult, now: Date): Promise<void>
  applyAudit(c: ReviewCase, result: AuditResult): Promise<void>
  /** `signature` is null for a failed refresh, which the next run tries again. */
  applyStands(c: StandsCase, result: StandsResult, signature: string | null, today: string): Promise<void>
  options?: StatusOptions & StandsOptions
}

/**
 * `clock`: the development time linking has reached (today, or while a backfill drains the newest
 * story this run linked), which quiet, closing and fading count in; `now`: the wall clock reviews are
 * spaced by; `today`: the day the stands judge facts current on (D-OV5).
 */
export interface UpkeepTimes {
  clock: Date
  now: Date
  today: string
}

export interface UpkeepTally {
  /** End-event stories judged, and the closings they began. */
  closingsChecked: number
  closingsBegun: number
  /** Status and scope moves, entries of unpublished stories detached among them. */
  moves: number
  detached: number
  bursts: number
  reviews: number
  /** Actions reviews applied, and answers or parts code refused. */
  reviewActions: number
  reviewRefusals: number
  audits: number
  /** Stands refreshes attempted, and new versions written. */
  standsRefreshes: number
  standsWritten: number
  /** Stands lines the model's check was asked about, and lines any check dropped. */
  standsChecked: number
  standsDropped: number
  /** Items whose call gave nothing or that threw: the next run tries them again. */
  failed: number
  costUsd: number
  errors: { part: UpkeepPart; id: string; error: unknown }[]
  /** The step was switched off before every part ran. */
  stopped: boolean
}

export type UpkeepPart = 'closing' | 'status' | 'review' | 'audit' | 'stands'

const emptyTally = (): UpkeepTally => ({
  closingsChecked: 0,
  closingsBegun: 0,
  moves: 0,
  detached: 0,
  bursts: 0,
  reviews: 0,
  reviewActions: 0,
  reviewRefusals: 0,
  audits: 0,
  standsRefreshes: 0,
  standsWritten: 0,
  standsChecked: 0,
  standsDropped: 0,
  failed: 0,
  costUsd: 0,
  errors: [],
  stopped: false,
})

/**
 * Runs parts 2 to 5 in order (`.context/overviews.md`, "The job"): closing checks, then the status
 * machine (each overview's moves, then the burst check that freezes it), then the reviews due on the
 * states as they stand after it and the monthly audit, then the stands refreshes whose signature
 * changed. `keepGoing` is asked before each item; once it says no, nothing else starts.
 */
export async function runUpkeep(deps: UpkeepDeps, at: UpkeepTimes, keepGoing: () => Promise<boolean> | boolean = () => true): Promise<UpkeepTally> {
  const options = deps.options ?? config.overviews
  const tally = emptyTally()
  const each = async <T>(part: UpkeepPart, items: readonly T[], id: (item: T) => string, work: (item: T) => Promise<void>) => {
    for (const item of items) {
      if (tally.stopped || !(await keepGoing())) {
        tally.stopped = true
        return
      }
      try {
        await work(item)
      } catch (error) {
        tally.failed++
        tally.errors.push({ part, id: id(item), error })
      }
    }
  }

  await each(
    'closing',
    await deps.closings(),
    c => c.overviewId,
    async c => {
      const result = await checkClosing(c, deps.close)
      tally.costUsd += result.costUsd
      tally.closingsChecked++
      if (result.outcome === 'closing') tally.closingsBegun++
      if (result.outcome === 'failed') tally.failed++
      await deps.applyClosing(c, result)
    },
  )
  if (tally.stopped) return tally

  await each(
    'status',
    await deps.states(),
    s => s.id,
    async state => {
      const moves = nextState(state, at.clock, options)
      if (moves.length > 0) {
        await deps.applyStatus(state, moves, at.clock)
        tally.moves += moves.length
        tally.detached += moves.filter(m => m.kind === 'detach').length
      }
      if (anomalies(state, options).includes('burst')) {
        await deps.applyBurst(state)
        tally.bursts++
      }
    },
  )
  if (tally.stopped) return tally

  const due = (await deps.states()).flatMap(s => {
    const trigger = reviewDue(s, at, options)
    return trigger ? [{ id: s.id, trigger }] : []
  })
  await each(
    'review',
    due,
    d => d.id,
    async ({ id, trigger }) => {
      const c = await deps.reviewCase(id)
      if (!c || c.entries.length === 0) return
      const result = await reviewOverview(c, trigger, deps.review)
      tally.costUsd += result.costUsd
      tally.reviews++
      if (result.outcome === 'failed') tally.failed++
      tally.reviewActions += result.actions.length
      tally.reviewRefusals += result.refusals.length
      await deps.applyReview(c, result, at.now)
    },
  )
  if (tally.stopped) return tally

  await each(
    'audit',
    await deps.auditPicks(at.now),
    id => id,
    async id => {
      const c = await deps.reviewCase(id)
      if (!c || c.entries.length === 0) return
      const result = await auditOverview(c, deps.review)
      tally.costUsd += result.costUsd
      tally.audits++
      if (result.outcome === 'failed') tally.failed++
      await deps.applyAudit(c, result)
    },
  )
  if (tally.stopped) return tally

  await each(
    'stands',
    await deps.standsCases(),
    c => c.overviewId,
    async c => {
      const offered = standsFacts(c.members, at.today, options)
      const signature = standsSignature(offered, c.entries)
      if (signature === c.lastSignature) return
      const result = await refreshStands({ title: c.title, entries: c.entries }, offered, at.today, deps.stands, options)
      tally.costUsd += result.costUsd
      tally.standsRefreshes++
      if (result.outcome === 'written') tally.standsWritten++
      if (result.outcome === 'failed') tally.failed++
      tally.standsChecked += result.checked
      tally.standsDropped += result.failed
      await deps.applyStands(c, result, result.outcome === 'failed' ? null : signature, at.today)
    },
  )
  return tally
}

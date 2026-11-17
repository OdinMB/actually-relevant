/**
 * When a `running` story context run counts as cut off (`.context/story-context.md`, "Interrupted
 * runs"): one rule for marking runs interrupted (`markInterruptedContextRuns`) and for the publish
 * gate (`awaitingContext`). A run's row is `running` until its result is stored; a deploy or restart
 * that ends its process leaves the row so, and nothing else ever finishes it.
 */
import { config } from '../config.js'

/** When this process started: every run it starts is claimed after this. */
const OWN_START = new Date(Date.now() - process.uptime() * 1000)

let processStartedAt: Date = OWN_START

/** For tests only: the start the rule counts from (null: this process's own). */
export function _setProcessStartedAt(at: Date | null): void {
  processStartedAt = at ?? OWN_START
}

/**
 * Runs still `running` that started before this are cut off: those older than `staleRunMinutes`,
 * and, in the process that runs the schedule, every one that started before this process did, since
 * the process that ran it is gone (a deploy replaces the scheduling process; the old one drains for
 * seconds, then exits). A second process (`SCHEDULER_ENABLED` off) cannot tell the scheduling
 * process's live runs from dead ones, so it waits out the limit.
 */
export function staleBefore(now: Date): Date {
  const limit = new Date(now.getTime() - config.storyContext.staleRunMinutes * 60_000)
  return config.scheduler.enabled && processStartedAt > limit ? processStartedAt : limit
}

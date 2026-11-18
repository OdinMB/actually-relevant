/**
 * When a `running` story context run counts as cut off (`.context/story-context.md`, "Interrupted
 * runs"): one rule for marking runs interrupted (`markInterruptedContextRuns`) and for the publish
 * gate (`awaitingContext`), the shared restart rule (`lib/runCutOff.ts`) with context's own limit.
 */
import { config } from '../config.js'
import { cutOffBefore } from '../lib/runCutOff.js'

/** Context runs still `running` that started before this are cut off (`cutOffBefore`, `storyContext.staleRunMinutes`). */
export function staleBefore(now: Date): Date {
  return cutOffBefore(now, config.storyContext.staleRunMinutes)
}

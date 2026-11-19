/**
 * The overview upkeep's model calls as the evals make them (`stands`, `closure`, `review`, `replay`):
 * production's calls as `overviewSteps.ts` declares them (tier, effort, schema, prompt) on the eval's
 * cached calls (`evalCalls`), each step on its tier's arm, the monthly audit at high effort, run k ≥ 2
 * under its own cache key.
 */
import type { OverviewCalls } from '../../../services/overviewSteps.js'
import type { SuiteContext } from '../types.js'
import { evalCalls } from './link.js'

export type UpkeepCalls = Omit<OverviewCalls, 'link'>

export function upkeepCalls(ctx: SuiteContext, run: number): UpkeepCalls {
  const { close, review, stands } = evalCalls(ctx, run)
  return { close, review, stands }
}

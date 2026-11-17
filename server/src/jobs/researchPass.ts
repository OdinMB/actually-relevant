/**
 * The `research_pass` job (`.context/research-passes.md`): one research pass per selected story,
 * replacing `research_stories` and `build_story_context` once the owner switches it on. Until its
 * lifecycle is wired (plan `.plans/2026-11-17_research-passes.md`, phase 4) it does nothing: it is
 * seeded disabled, its enabling is refused (`jobEnableChecks.ts`), and it is in no chain.
 */
import { reportRunResult } from '../lib/runUsage.js'

export const RESEARCH_PASS_JOB = 'research_pass'

/** Why the job cannot be enabled yet. */
export const PASS_NOT_WIRED = 'research passes are not wired yet: the step is switched on once its eval passes (.context/research-passes.md)'

export async function runResearchPassJob(): Promise<void> {
  reportRunResult('Research passes are off: the step is not wired yet')
}

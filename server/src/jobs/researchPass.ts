/**
 * The research pass step, the `research_pass` job (`.context/research-passes.md`, "The job and the
 * gate"): one research pass per selected story it still owes (`researchPassQueue.ts`), oldest crawled
 * first, at most `config.research.pass.perRun` a run and `concurrency` at once, with no time limit.
 * Each pass applies itself as it ends (`researchPassApply.ts`), fenced on the story as read before it,
 * so the publish gate keeps the story waiting until then and an editor's work during the pass wins.
 * It runs only while the step works (its eval gate open, `researchPassGate.ts`, and the Tavily key set) and
 * its job is enabled: a run by hand of the disabled job does nothing, unlike research's, so the old
 * steps and this one never both run on a night. Before each story it re-reads that state and starts
 * no other once the step is switched off; the passes in flight finish, and are stored without being
 * applied. A failure outside a story's pass records a $0 skipped pass for it, so the gate stops
 * waiting; per-story failures never fail the job, and a failure of the job as a whole stops its chain.
 * The run's item tally goes into its usage (`recordItems`), so the run's finish records the
 * failure-share notice in this step's words (`failureShare.ts`); when more than the failure share of
 * at least `failedStoriesMin` stories failed technically, it records the failed-stories notice too.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { sanitizedError } from '../lib/runErrors.js'
import { countOf, recordItems, reportRunResult } from '../lib/runUsage.js'
import {
  nextForPass,
  owedPassStory,
  PASS_JOB_DISABLED,
  passStepState,
  passSwitchRefusal,
  RESEARCH_PASS_JOB,
  type PassStepState,
} from '../services/researchPassQueue.js'
import { markInterruptedPasses, recordSkippedPass, runPipelinePass, type PassEnd } from '../services/researchPassRuns.js'
import { jobDisplayName } from './jobDisplayName.js'

export { RESEARCH_PASS_JOB }

const log = createLogger(RESEARCH_PASS_JOB)

/** What became of each story: its pass's apply, or `refused`, `busy`, `failed` (a technical failure), `error` (outside the pass, a $0 pass recorded), `notOwed`. */
type StoryOutcome = Extract<PassEnd, { applied: unknown }>['applied'] | 'refused' | 'busy' | 'failed' | 'error' | 'notOwed'

/** Why the step does nothing now, or null while it works and its job is enabled. */
const offReason = (state: PassStepState): string | null => {
  if (!state.works) return passSwitchRefusal() ?? PASS_JOB_DISABLED
  return state.enabled ? null : PASS_JOB_DISABLED
}

/** Whether the technical failures pass the failure share: more than `share` of at least `failedStoriesMin` stories. */
const storiesFailing = (taken: number, failed: number) => taken >= config.research.pass.failedStoriesMin && failed / taken > config.jobs.failureShare.share

async function notifyFailedStories(taken: number, failed: number): Promise<void> {
  await notify({
    source: 'jobs',
    severity: 'warning',
    title: `${jobDisplayName(RESEARCH_PASS_JOB)}: ${failed.toLocaleString('en-US')} of ${countOf(taken, 'story', 'stories')} failed in the last run`,
    message:
      'A technical problem stopped their research: the AI service or web search did not answer, or an error of ours. ' +
      'Each was tried a second time in the run where the problem could pass. Nothing paused, and those stories publish as they were. ' +
      'Switch the step off on the Jobs page if it keeps happening.',
    link: '/admin/jobs',
    dedupeKey: `stories-failing:${RESEARCH_PASS_JOB}`,
  })
}

/** "2 applied, 1 rejected, 0 failed, 1 not applied": the run's summary after its count of stories. */
function tallyLine(tally: Partial<Record<StoryOutcome, number>>): string {
  const n = (...outcomes: StoryOutcome[]) => outcomes.reduce((sum, o) => sum + (tally[o] ?? 0), 0)
  const optional = (count: number, words: string) => (count > 0 ? `, ${count} ${words}` : '')
  return (
    `${n('applied')} applied, ${n('rejected')} rejected, ${n('failed', 'error')} failed` +
    optional(n('stored', 'skipped', 'dropped'), 'not applied') +
    optional(n('refused'), 'skipped') +
    optional(n('busy'), 'already being researched')
  )
}

export async function runResearchPassJob(): Promise<void> {
  await markInterruptedPasses()
  const off = offReason(await passStepState())
  if (off) {
    log.info({ why: off }, 'research passes are off; nothing researched')
    reportRunResult(`${off}; nothing researched`)
    return
  }

  const { perRun, concurrency } = config.research.pass
  const ids = await nextForPass(perRun)
  log.info({ storyCount: ids.length, concurrency }, 'starting research pass step')
  const tally: Partial<Record<StoryOutcome, number>> = {}
  const items = { checked: 0, failed: 0 }
  // `started` is the queue's next index; `begun` counts the stories whose turn came before a switch-off
  let started = 0
  let begun = 0
  let stopped = false
  const passOne = async (storyId: string): Promise<StoryOutcome> => {
    const owed = await owedPassStory(storyId)
    if (!owed) return 'notOwed'
    const run = await runPipelinePass(storyId, { status: 'selected', updatedAt: owed.updatedAt }, async () => offReason(await passStepState()) === null)
    if (run.outcome !== 'passed') return run.outcome
    if (run.end.ended === 'skipped') return 'refused'
    if (run.end.ended === 'error') return 'error'
    items.checked += run.end.tally.checked
    items.failed += run.end.tally.failed
    return run.end.ended === 'failed' ? 'failed' : run.end.applied
  }
  const worker = async () => {
    while (!stopped && started < ids.length) {
      const storyId = ids[started++]!
      if (stopped || offReason(await passStepState()) !== null) {
        if (!stopped) log.info({ left: ids.length - begun }, 'research pass step switched off; starting no other story')
        stopped = true
        return
      }
      begun++
      let outcome: StoryOutcome
      try {
        outcome = await passOne(storyId)
      } catch (err) {
        const error = sanitizedError(err)
        log.error({ storyId, error }, 'research pass step failed on a story outside its pass; recording a $0 pass and going on with the next')
        await recordSkippedPass(storyId, error).catch((e: unknown) => log.error({ storyId, error: sanitizedError(e) }, 'could not record the skipped pass'))
        outcome = 'error'
      }
      tally[outcome] = (tally[outcome] ?? 0) + 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), ids.length) }, worker))

  recordItems(items.checked, items.failed)
  const taken = Object.entries(tally).reduce((sum, [outcome, n]) => (outcome === 'notOwed' ? sum : sum + n), 0)
  const failed = (tally.failed ?? 0) + (tally.error ?? 0)
  log.info({ ...tally, taken, ...items }, 'research pass step finished')
  if (storiesFailing(taken, failed)) await notifyFailedStories(taken, failed).catch(() => {})
  const left = ids.length - begun
  reportRunResult(
    ids.length === 0
      ? 'Nothing to research'
      : `Researched ${countOf(taken, 'story', 'stories')}: ${tallyLine(tally)}` + (left > 0 ? `, ${left} left for the next run` : ''),
  )
}

/**
 * The story context step (`.context/story-context.md`, "The step"), the daily edition's fourth step,
 * after publishing: it marks stale runs failed, prunes the search cache, and builds the context of
 * the published stories it still owes (`nextForContext`), oldest published first, at most
 * `config.storyContext.perRun` a run and `concurrency` at once. A run by hand (the Jobs page's
 * "Run now") does the same as a scheduled one, the disabled job's included, so it writes cards
 * readers see. Without a Tavily key it builds nothing. The run's item tally goes into its usage
 * (`recordItems`), and when its failure share passes `config.jobs.failureShare` it records one
 * warning notice (deduped as `step-failing:build_story_context`, reopened by a repeat); nothing
 * pauses. A failure outside a story's run records a failed run for it, so the story is settled; the
 * job never throws for it.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import prisma from '../lib/prisma.js'
import { countOf, recordItems, reportRunResult } from '../lib/runUsage.js'
import { sanitizedError } from '../services/researchRuns.js'
import { nextForContext } from '../services/storyContextInput.js'
import { markInterruptedContextRuns, recordFailedRun, runStoryContext, type ContextRunOutcome } from '../services/storyContextRuns.js'
import { pruneSearchCache } from '../services/storyContextSearch.js'
import { failureShareExceeded, failureShareLine } from './jobNotes.js'

export const STORY_CONTEXT_JOB = 'build_story_context'
const JOB = STORY_CONTEXT_JOB
const log = createLogger(JOB)

/** The failure-share notice's dedupe key: one notice for the step, reopened by each repeat. */
export const stepFailingNotice = `step-failing:${JOB}`

type StoryOutcome = ContextRunOutcome['outcome'] | 'error'

/** An error outside the story's run: a failed run settles the story. */
async function recordError(storyId: string, err: unknown): Promise<'error'> {
  const error = sanitizedError(err)
  log.error({ storyId, error }, 'story context step failed on a story outside its run; recording a failed run and going on with the next')
  await recordFailedRun(storyId, error).catch((e: unknown) => log.error({ storyId, error: sanitizedError(e) }, 'could not record the failed run'))
  return 'error'
}

export async function runBuildStoryContext(): Promise<void> {
  await markInterruptedContextRuns(new Date())
  if (!config.research.tavilyApiKey) {
    log.info('web search is off (no Tavily key); no context built')
    reportRunResult('Web search is off, no context built')
    return
  }
  const pruned = await pruneSearchCache()
  const { perRun, concurrency } = config.storyContext
  const ids = await nextForContext(prisma, perRun)
  log.info({ storyCount: ids.length, concurrency, pruned }, 'starting story context step')

  const outcomes: Partial<Record<StoryOutcome, number>> = {}
  const tally = { checked: 0, failed: 0, boxes: 0 }
  let next = 0
  const worker = async () => {
    while (next < ids.length) {
      const storyId = ids[next++]!
      let outcome: StoryOutcome
      try {
        const run = await runStoryContext(storyId)
        outcome = run.outcome
        tally.checked += run.tally.checked
        tally.failed += run.tally.failed
        tally.boxes += run.boxes
      } catch (err) {
        outcome = await recordError(storyId, err)
      }
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), ids.length) }, worker))

  recordItems(tally.checked, tally.failed)
  log.info({ ...outcomes, ...tally }, 'story context step finished')
  if (failureShareExceeded(tally.checked, tally.failed)) {
    await notify({
      source: 'jobs',
      severity: 'warning',
      title: `Story context: ${failureShareLine(tally.checked, tally.failed).replace(/\.$/, '')}`,
      message:
        'The checks dropped more of what the step wrote than usual. Nothing paused, and readers see only what passed. ' +
        "Each story's Context section shows what was dropped and why; switch the step off on the Jobs page if it keeps happening.",
      link: '/admin/jobs',
      dedupeKey: stepFailingNotice,
    })
  }
  reportRunResult(
    ids.length === 0
      ? 'No story owed its context'
      : `Built the context of ${countOf(ids.length, 'story', 'stories')}: ${countOf(tally.boxes, 'card')} kept, ${tally.failed.toLocaleString('en-US')} of ${countOf(tally.checked, 'checked item')} failed`,
  )
}

/**
 * The story context step (`.context/story-context.md`, "The step"), the daily edition's fourth step,
 * after publishing: it marks stale runs failed, prunes the search cache, and builds the context of
 * the published stories it still owes (`nextForContext`), oldest published first, at most
 * `config.storyContext.perRun` a run and `concurrency` at once. A run by hand (the Jobs page's
 * "Run now") does the same as a scheduled one, the disabled job's included, so it writes cards
 * readers see. Without a Tavily key it builds nothing. The run's item tally goes into its usage
 * (`recordItems`), so the run's finish records the failure-share notice when it passes
 * `config.jobs.failureShare` (`jobs/failureShare.ts`, in this step's words); nothing pauses.
 *
 * A story whose run failed on a problem that may pass (`transientFailure`) is tried once more after
 * the others, on the same run row (ADR-0061, amended 2026-11-17); a second failure settles it, as
 * does any other failure, and no later night tries it again. When more than the failure share of
 * at least `failedStoriesMin` stories failed, the step records the failed-stories notice. A failure
 * outside a story's run records a failed run for it, so the story is settled; the job never throws
 * for it.
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
import { jobDisplayName } from './jobDisplayName.js'

export const STORY_CONTEXT_JOB = 'build_story_context'
const JOB = STORY_CONTEXT_JOB
const log = createLogger(JOB)

type StoryOutcome = ContextRunOutcome['outcome'] | 'error'

/** A story's attempt: its run, when one was written, and whether a second attempt may pass. */
interface Attempt {
  runId: string | null
  outcome: StoryOutcome
  transient: boolean
}

/** An error outside the story's run: a failed run settles the story. */
async function recordError(storyId: string, err: unknown): Promise<Attempt> {
  const error = sanitizedError(err)
  log.error({ storyId, error }, 'story context step failed on a story outside its run; recording a failed run and going on with the next')
  await recordFailedRun(storyId, error).catch((e: unknown) => log.error({ storyId, error: sanitizedError(e) }, 'could not record the failed run'))
  return { runId: null, outcome: 'error', transient: false }
}

/** Whether the failed stories pass the failure share: more than `share` of at least `failedStoriesMin` stories. */
const storiesFailing = (taken: number, failed: number) => taken >= config.storyContext.failedStoriesMin && failed / taken > config.jobs.failureShare.share

async function notifyFailedStories(taken: number, failed: number): Promise<void> {
  await notify({
    source: 'jobs',
    severity: 'warning',
    title: `${jobDisplayName(JOB)}: ${failed.toLocaleString('en-US')} of ${countOf(taken, 'story', 'stories')} failed in the last run`,
    message:
      'A technical problem stopped their runs: the AI service or web search did not answer, or an error of ours. ' +
      'Each was tried a second time in the run where the problem could pass. Nothing paused, and those stories get no context cards. ' +
      "Each story's Context section shows the error; switch the step off on the Jobs page if it keeps happening.",
    link: '/admin/jobs',
    dedupeKey: `stories-failing:${JOB}`,
  })
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

  const tally = { checked: 0, failed: 0, boxes: 0 }
  const attempts = new Map<string, Attempt>()
  const attempt = async (storyId: string, again: { runId: string } | null): Promise<void> => {
    try {
      const run = await runStoryContext(storyId, undefined, again)
      // An editor's run of the story holds it: that run settles the story
      if (!run) {
        log.info({ storyId }, 'another context run of the story is running; skipped')
        return
      }
      tally.checked += run.tally.checked
      tally.failed += run.tally.failed
      tally.boxes += run.boxes
      attempts.set(storyId, { runId: run.runId, outcome: run.outcome, transient: run.transient })
    } catch (err) {
      attempts.set(storyId, await recordError(storyId, err))
    }
  }
  /** Each story's attempt, at most `concurrency` at once. */
  const inTurn = async (stories: { storyId: string; again: { runId: string } | null }[]) => {
    let next = 0
    const worker = async () => {
      while (next < stories.length) {
        const { storyId, again } = stories[next++]!
        await attempt(storyId, again)
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), stories.length) }, worker))
  }

  await inTurn(ids.map(storyId => ({ storyId, again: null })))
  // A failure that may pass is tried once more, after the others: only its last attempt is stored
  const retried = ids.flatMap(storyId => {
    const a = attempts.get(storyId)
    return a?.transient && a.runId !== null ? [{ storyId, again: { runId: a.runId } }] : []
  })
  await inTurn(retried)

  const outcomes: Partial<Record<StoryOutcome, number>> = {}
  for (const { outcome } of attempts.values()) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  const failedStories = (outcomes.technical ?? 0) + (outcomes.error ?? 0)

  // The failure share's notice is the run's finish's (`failureShareNotice`), from these items
  recordItems(tally.checked, tally.failed)
  log.info({ ...outcomes, ...tally, retried: retried.length }, 'story context step finished')
  if (storiesFailing(ids.length, failedStories)) await notifyFailedStories(ids.length, failedStories)
  reportRunResult(
    ids.length === 0
      ? 'No story owed its context'
      : `Built the context of ${countOf(ids.length, 'story', 'stories')}: ${countOf(tally.boxes, 'card')} kept, ` +
          `${tally.failed.toLocaleString('en-US')} of ${countOf(tally.checked, 'checked item')} failed, ${countOf(failedStories, 'story', 'stories')} failed` +
          (retried.length > 0 ? ` (${retried.length.toLocaleString('en-US')} tried twice)` : ''),
  )
}

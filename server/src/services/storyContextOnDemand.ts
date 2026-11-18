/**
 * An editor's context run of one story, the admin's "Gather context" (`.context/story-context.md`,
 * "On demand"): on any published story a completed research run of which holds facts, whatever the
 * step's lookback, however many runs the story has had, and with the step switched on or off; web
 * search must be on, and research passes off (a pass writes the cards with the article). The run is claimed as the step's are (`claimContextRun`: never while
 * another run of the story is running), builds on the story's earlier completed runs, and a failure
 * that may pass is tried once more on its own row, as the step does. It runs as a one-story task the
 * admin polls, in a run scope of the step's job, so its spend is added to `build_story_context`'s
 * month and checked against that step's warning level, not counted as an editor's research.
 */
import { config } from '../config.js'
import { addMonthSpend } from '../jobs/jobLease.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { createRunScope, runInScope, settleRun, type RunScope } from '../lib/runUsage.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { sanitizedError } from '../lib/runErrors.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import { replacedByPasses } from './researchPassQueue.js'
import { checkSpendWarnings } from './spending.js'
import { contextEligibility } from './storyContextInput.js'
import type { ContextDeps } from './storyContextPipeline.js'
import { STORY_CONTEXT_JOB } from './storyContextQueue.js'
import { claimContextRun, executeContextRun, productionDeps, reopenFailedRun, type ContextRunOutcome } from './storyContextRuns.js'

const log = createLogger('story_context')

const OFF = 'Web search is off (TAVILY_API_KEY is not set), so context cannot be gathered'
const BUSY = 'Context is already being gathered for this story'
/** While research passes are on, a pass writes the cards with the article (`replacedByPasses`). */
const REPLACED = 'context is no longer gathered on its own'

type Eligibility = NonNullable<Awaited<ReturnType<typeof contextEligibility>>>

/**
 * Why the story can have no context gathered by hand at all, or null: it must be published, with a
 * research run that holds facts. A selected story's cards are the step's, built before it is published.
 */
function ineligibility(story: Eligibility): string | null {
  if (story.status !== 'published') return `Context can be gathered by hand only for a published story; this one is ${story.status}`
  if (!story.researched) return 'The story has no research run with facts to start from: research it first'
  return null
}

/**
 * For the admin's Context section: whether the story can have context gathered at all (`eligible`,
 * so a story with no run yet shows the action), and why the action is closed now, or null: web
 * search off, research passes on, the story not eligible, or a run of it running. 404 for an unknown story.
 */
export async function gatherState(storyId: string): Promise<{ eligible: boolean; refusal: string | null }> {
  const [story, running, replaced] = await Promise.all([
    contextEligibility(prisma, storyId),
    prisma.storyContextRun.count({ where: { storyId, status: 'running' } }),
    replacedByPasses(REPLACED),
  ])
  if (!story) throw new NotFoundError('Story not found')
  const why = ineligibility(story)
  return { eligible: why === null, refusal: !config.research.tavilyApiKey ? OFF : (replaced ?? why ?? (running > 0 ? BUSY : null)) }
}

/** Why the task failed, in the editor's words, or null when the run completed (cards kept or none). */
function failureOf(run: ContextRunOutcome): string | null {
  if (!run.written) return 'The run was marked interrupted before it finished'
  if (run.status === 'completed') return null
  if (run.status === 'skipped') return 'The story has no research run with facts to start from'
  return 'The run failed on a technical problem; the Context section shows the error'
}

/** The run's attempts on its row: a failure that may pass is tried once more, the second attempt's outcome stored. */
async function attempts(storyId: string, runId: string, deps: ContextDeps): Promise<ContextRunOutcome> {
  const first = await executeContextRun(storyId, runId, deps, 1)
  if (!first.transient || !(await reopenFailedRun(runId))) return first
  log.info({ runId, storyId }, 'trying the context run once more')
  return executeContextRun(storyId, runId, deps, 2)
}

/** Add what the run spent to the step's month and check the step's warning levels; never throws. */
async function recordSpend(scope: RunScope, runId: string): Promise<void> {
  try {
    const usage = await settleRun(scope)
    await addMonthSpend(STORY_CONTEXT_JOB, usage)
    if (usage.costUsd > 0) await checkSpendWarnings(STORY_CONTEXT_JOB)
  } catch (err) {
    log.error({ runId, error: sanitizedError(err) }, "could not record the context run's spend")
  }
}

/** The claimed run, counted in its task; never throws (a failure fails the task); the caller completes the task. */
async function gatherInTask(taskId: string, storyId: string, runId: string, deps: ContextDeps): Promise<void> {
  // A person waits on it: standard price, never flex
  const scope = createRunScope({ jobName: STORY_CONTEXT_JOB, flex: false })
  try {
    const failure = failureOf(await runInScope(scope, () => attempts(storyId, runId, deps)))
    if (failure) taskRegistry.increment(taskId, 'failed', failure)
    else taskRegistry.increment(taskId, 'completed')
  } catch (err) {
    const error = sanitizedError(err)
    log.error({ runId, storyId, error }, 'context run failed outside the run')
    taskRegistry.increment(taskId, 'failed', error)
  }
  await recordSpend(scope, runId)
}

/**
 * Start an editor's context run of the story in the background, as a one-story task. 409 while web
 * search is off or research passes are switched on (for any story), 404 for an unknown story, 409 for one not published or without a
 * research run that holds facts, and 409 while a run of the story is running (nothing written).
 */
export async function startContextGathering(storyId: string, deps: ContextDeps = productionDeps()): Promise<{ taskId: string; runId: string }> {
  if (!config.research.tavilyApiKey) throw new ConflictError(OFF)
  const replaced = await replacedByPasses(REPLACED)
  if (replaced) throw new ConflictError(replaced)
  const story = await contextEligibility(prisma, storyId)
  if (!story) throw new NotFoundError('Story not found')
  const why = ineligibility(story)
  if (why) throw new ConflictError(why)
  const runId = await claimContextRun(storyId)
  if (runId === null) throw new ConflictError(BUSY)

  const taskId = taskRegistry.create('context', 1, [storyId])
  log.info({ runId, storyId, taskId }, 'context run started by an editor')
  void gatherInTask(taskId, storyId, runId, deps).finally(() => taskRegistry.complete(taskId))
  return { taskId, runId }
}

/**
 * The research step (`.context/story-research.md`, "The pipeline step"): researches the selected
 * stories the step still owes (`researchQueue.ts`), oldest crawled first, at most
 * `config.research.pipeline.perRun` a run and `concurrency` at once (started in queue order, the
 * next as one finishes). In effective apply mode it applies each verdict once the run's result is
 * stored and before the run is finished (`applyVerdict`), fenced on the story as read before the
 * run, so the publish gate keeps the story waiting until then and an editor's work during the run
 * wins. A run of the disabled job (the Jobs page's "Run now") is a trial: it researches in shadow
 * and never applies. Before starting each story it re-reads the step's state and starts no other
 * once research is switched off, or the job it started enabled is disabled; the stories in flight
 * finish. A failure outside a story's run records a $0 run for it, so the gate stops waiting; the
 * job never throws for it.
 */
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { applyVerdict, pipelineMode, type VerdictOutcome } from '../services/researchApply.js'
import { nextToResearch, owedStory, researchStepState } from '../services/researchQueue.js'
import { markInterruptedRuns, recordSkippedRun, runPipelineResearch, sanitizedError } from '../services/researchRuns.js'

const log = createLogger('research_stories')

/**
 * What became of each story: a verdict's outcome; `refused` (a $0 run recorded: the cap, or a story
 * the loader cannot research); `busy` (an editor's run in progress, tried again next run); `failed`
 * or `dropped` (the run failed, or was marked interrupted before it finished); `notOwed` (moved or
 * researched since the queue was read); `error` (an error outside the run, recorded as a $0 run).
 */
type StoryOutcome = VerdictOutcome | 'refused' | 'busy' | 'failed' | 'dropped' | 'notOwed' | 'error'

/**
 * Research one story. With `mayApply` (the job was enabled at the start), its verdict is applied
 * once the result is stored, if the step still applies then; otherwise the run is shadow.
 */
async function researchOne(storyId: string, mayApply: boolean): Promise<StoryOutcome> {
  // Read before the run: the apply is fenced on this write, so an editor's work during the run wins
  const owed = await owedStory(storyId)
  if (!owed) return 'notOwed'
  const read = { status: 'selected' as const, updatedAt: owed.updatedAt }
  const applied: { outcome?: VerdictOutcome } = {}
  const run = await runPipelineResearch(storyId, async (result, runId) => {
    // Re-read: the job may have been disabled, or apply mode closed, during the run
    const applies = mayApply && (await researchStepState()).applies
    applied.outcome = applies ? await applyVerdict(storyId, runId, read, result) : 'shadow'
  })
  if (run.outcome !== 'researched') return run.outcome
  if (run.end.ended !== 'completed') return run.end.ended
  return applied.outcome ?? 'failed'
}

/** An error outside the story's run: a $0 run settles the story, so the publish gate stops waiting. */
async function recordError(storyId: string, err: unknown): Promise<'error'> {
  const error = sanitizedError(err)
  log.error({ storyId, error }, 'research step failed on a story outside its run; recording a $0 run and going on with the next')
  await recordSkippedRun(storyId, error).catch((e: unknown) => log.error({ storyId, error: sanitizedError(e) }, 'could not record the skipped run'))
  return 'error'
}

export async function runResearchStories(): Promise<void> {
  await markInterruptedRuns(prisma, new Date())
  const start = await researchStepState()
  if (!start.researches) {
    log.info('research is switched off (TAVILY_API_KEY unset, or a model without a price); nothing researched')
    return
  }
  // The disabled job cannot gate: a run of it is the owner's trial, in shadow
  const trial = !start.enabled
  const mode = pipelineMode()
  if (trial) log.info('research_stories is disabled: a trial run, in shadow; no verdict is applied and publishing does not wait')
  else if (mode.mode === 'shadow' && mode.heldBack) {
    log.warn({ reason: mode.heldBack }, 'RESEARCH_PIPELINE_MODE is apply, but applying is closed: running in shadow, no verdict is applied')
  }

  const { perRun, concurrency } = config.research.pipeline
  const ids = await nextToResearch(perRun)
  log.info({ mode: start.applies ? 'apply' : 'shadow', trial, storyCount: ids.length, concurrency }, 'starting research step')

  const tally: Partial<Record<StoryOutcome, number>> = {}
  let started = 0
  let stopped = false
  // Each worker takes the next story in queue order until the queue is done or the step is switched off
  const worker = async () => {
    while (!stopped && started < ids.length) {
      const storyId = ids[started++]!
      const state = await researchStepState()
      if (stopped || !state.researches || (!trial && !state.enabled)) {
        if (!stopped) log.info({ left: ids.length - started + 1 }, 'research step switched off; starting no other story')
        stopped = true
        return
      }
      let outcome: StoryOutcome
      try {
        outcome = await researchOne(storyId, !trial)
      } catch (err) {
        outcome = await recordError(storyId, err)
      }
      tally[outcome] = (tally[outcome] ?? 0) + 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), ids.length) }, worker))

  const total = Object.values(tally).reduce((sum, n) => sum + n, 0)
  log.info({ mode: start.applies ? 'apply' : 'shadow', trial, ...tally, total }, 'research step finished')
}

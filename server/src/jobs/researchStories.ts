/**
 * The research step (`.context/story-research.md`, "The pipeline step"): researches the selected
 * stories the step still owes (`researchQueue.ts`), one at a time, oldest crawled first, at most
 * `config.research.pipeline.perRun` a run, and applies each verdict before its run is finished
 * (`applyVerdict`), so the publish gate keeps the story waiting until then. Before each story it
 * re-reads whether the step is on (its job row enabled, research switched on) and stops when it is
 * not. One story's failure is logged and the next one runs; the job never throws for it.
 */
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { applyVerdict, pipelineMode, type VerdictOutcome } from '../services/researchApply.js'
import { nextToResearch, researchPipelineOn, stillOwed } from '../services/researchQueue.js'
import { markInterruptedRuns, runPipelineResearch } from '../services/researchRuns.js'

const log = createLogger('research_stories')

/**
 * What became of each story: a verdict's outcome; `refused` (a $0 run recorded: the cap, or a story
 * the loader cannot research); `busy` (an editor's run in progress, tried again next run); `failed`
 * or `dropped` (the run failed, or was marked interrupted before it finished); `notOwed` (moved or
 * researched since the queue was read); `error` (a database error outside the run).
 */
type StoryOutcome = VerdictOutcome | 'refused' | 'busy' | 'failed' | 'dropped' | 'notOwed' | 'error'

/** Research one story, applying its verdict before the run's finish write. */
async function researchOne(storyId: string): Promise<StoryOutcome> {
  if (!(await stillOwed(storyId))) return 'notOwed'
  const applied: { outcome?: VerdictOutcome } = {}
  const run = await runPipelineResearch(storyId, async (result, runId) => {
    // The story was selected when the queue was read and when stillOwed re-read it
    applied.outcome = await applyVerdict(storyId, runId, 'selected', result)
  })
  if (run.outcome !== 'researched') return run.outcome
  if (run.end.ended !== 'completed') return run.end.ended
  return applied.outcome ?? 'failed'
}

export async function runResearchStories(): Promise<void> {
  await markInterruptedRuns(prisma, new Date())
  if (!(await researchPipelineOn())) {
    log.info('research step is off (its job disabled, or research switched off); nothing researched')
    return
  }
  const mode = pipelineMode()
  if (mode.mode === 'shadow' && mode.heldBack) {
    log.warn({ reason: mode.heldBack }, 'RESEARCH_PIPELINE_MODE is apply, but applying is closed: running in shadow, no verdict is applied')
  }

  const ids = await nextToResearch(config.research.pipeline.perRun)
  log.info({ mode: mode.mode, storyCount: ids.length }, 'starting research step')

  const tally: Partial<Record<StoryOutcome, number>> = {}
  let done = 0
  for (const storyId of ids) {
    if (!(await researchPipelineOn())) {
      log.info({ left: ids.length - done }, 'research step switched off; stopping before the next story')
      break
    }
    let outcome: StoryOutcome
    try {
      outcome = await researchOne(storyId)
    } catch (err) {
      log.error({ err, storyId }, 'research step failed on a story; going on with the next')
      outcome = 'error'
    }
    tally[outcome] = (tally[outcome] ?? 0) + 1
    done++
  }

  log.info({ mode: mode.mode, ...tally, total: done }, 'research step finished')
}

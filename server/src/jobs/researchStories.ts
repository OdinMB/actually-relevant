/**
 * The research step (`.context/story-research.md`, "The pipeline step"): researches the selected
 * stories the step still owes (`researchQueue.ts`), oldest crawled first, at most
 * `config.research.pipeline.perRun` a run and `concurrency` at once (started in queue order, the
 * next as one finishes). It applies each verdict once the run's result is stored and before the run
 * is finished (`applyVerdict`), fenced on the story as read before the run, so the publish gate
 * keeps the story waiting until then and an editor's work during the run wins. A run by hand (the
 * Jobs page's "Run now") does the same as a scheduled one, the disabled job's included. Before
 * starting each story it re-reads the step's state and starts no other once the step is switched
 * off (`switchedOff`); the stories in flight finish, and their verdicts are not applied. Run by its
 * chain, it also starts no story once the chain's deadline has passed; those in flight finish and are
 * applied, and the rest wait for the next run, as stories past `perRun` do. A failure
 * outside a story's run records a $0 run for it, so the gate stops waiting; the job never throws
 * for it.
 */
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { runDeadlinePassed } from '../lib/runUsage.js'
import { applyVerdict, type VerdictOutcome } from '../services/researchApply.js'
import { nextToResearch, owedStory, researchStepState, type ResearchStepState } from '../services/researchQueue.js'
import { markInterruptedRuns, recordSkippedRun, runPipelineResearch, sanitizedError } from '../services/researchRuns.js'

const log = createLogger('research_stories')

/**
 * What became of each story: a verdict's outcome; `switchedOff` (the step was switched off during
 * the run, so its verdict was not applied); `refused` (a $0 run recorded: the cap, or a story the
 * loader cannot research); `busy` (an editor's run in progress, tried again next run); `failed` or
 * `dropped` (the run failed, or was marked interrupted before it finished); `notOwed` (moved or
 * researched since the queue was read); `error` (an error outside the run, recorded as a $0 run).
 */
type StoryOutcome = VerdictOutcome | 'switchedOff' | 'refused' | 'busy' | 'failed' | 'dropped' | 'notOwed' | 'error'

/**
 * Whether the step was switched off since the run started (`start`): research switched off, or the
 * job disabled after the run started with it enabled. The disabled job's flag cannot switch off a
 * run by hand of it, so only the key stops that one.
 */
const switchedOff = (start: ResearchStepState, now: ResearchStepState) => !now.researches || (start.enabled && !now.enabled)

/** Research one story; its verdict is applied once the result is stored, unless the step was switched off meanwhile. */
async function researchOne(storyId: string, start: ResearchStepState): Promise<StoryOutcome> {
  // Read before the run: the apply is fenced on this write, so an editor's work during the run wins
  const owed = await owedStory(storyId)
  if (!owed) return 'notOwed'
  const read = { status: 'selected' as const, updatedAt: owed.updatedAt }
  const applied: { outcome?: StoryOutcome } = {}
  const run = await runPipelineResearch(storyId, async (result, runId) => {
    // Re-read: research may have been switched off, or the job disabled, during the run
    applied.outcome = switchedOff(start, await researchStepState()) ? 'switchedOff' : await applyVerdict(storyId, runId, read, result)
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

  const { perRun, concurrency } = config.research.pipeline
  const ids = await nextToResearch(perRun)
  log.info({ jobEnabled: start.enabled, storyCount: ids.length, concurrency }, 'starting research step')

  const tally: Partial<Record<StoryOutcome, number>> = {}
  let started = 0
  let stopped = false
  // Each worker takes the next story in queue order until the queue is done or the step is switched off
  const worker = async () => {
    while (!stopped && started < ids.length) {
      // Past its chain's deadline the step starts no other story, so publishing is not held up
      // (.context/scheduler.md, "Chains"); the stories in flight finish
      if (runDeadlinePassed()) {
        if (!stopped) log.info({ left: ids.length - started }, "past the chain's deadline; starting no other story")
        stopped = true
        return
      }
      const storyId = ids[started++]!
      const state = await researchStepState()
      if (stopped || switchedOff(start, state)) {
        if (!stopped) log.info({ left: ids.length - started + 1 }, 'research step switched off; starting no other story')
        stopped = true
        return
      }
      let outcome: StoryOutcome
      try {
        outcome = await researchOne(storyId, start)
      } catch (err) {
        outcome = await recordError(storyId, err)
      }
      tally[outcome] = (tally[outcome] ?? 0) + 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), ids.length) }, worker))

  const total = Object.values(tally).reduce((sum, n) => sum + n, 0)
  log.info({ jobEnabled: start.enabled, ...tally, total }, 'research step finished')
}

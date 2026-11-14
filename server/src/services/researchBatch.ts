/**
 * The stories list's bulk Research (`.context/story-research.md`, "Bulk research"): the stories an
 * editor selected, researched as one `research` task, `config.research.pipeline.concurrency` at a
 * time in the order chosen. Each takes the Research button's own path when its turn comes
 * (`reserveEditorRun`: the switch, the status, the analysis, a run in progress and the monthly cap,
 * reserved under the advisory lock), so a later story sees the measured cost of the runs before it.
 * A story that path refuses is skipped with the refusal as its reason, and the batch goes on. As
 * with the button, a run only records itself: nothing is applied to a story.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { Semaphore } from '../lib/semaphore.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { ConflictError, ServiceError } from '../utils/errors.js'
import { reserveEditorRun, runInTask, sanitizedError, switchRefusal } from './researchRuns.js'

const log = createLogger('research')

const PROCESSING = 'Already being processed by another task'

/** Reserve the story's run and research it, or record why not; never throws. */
async function researchOne(taskId: string, storyId: string): Promise<void> {
  let reserved: Awaited<ReturnType<typeof reserveEditorRun>>
  try {
    reserved = await reserveEditorRun(storyId)
  } catch (err) {
    if (err instanceof ServiceError) {
      taskRegistry.skip(taskId, storyId, err.message)
      return
    }
    const error = sanitizedError(err)
    log.error({ taskId, storyId, error }, 'bulk research failed on a story before its run; going on with the next')
    taskRegistry.increment(taskId, 'failed', error)
    return
  }
  log.info({ taskId, storyId, runId: reserved.runId }, 'bulk research run started')
  await runInTask(taskId, reserved.runId, reserved.story)
}

async function researchAll(taskId: string, storyIds: string[]): Promise<void> {
  const semaphore = new Semaphore(config.research.pipeline.concurrency)
  try {
    await Promise.all(storyIds.map(storyId => semaphore.run(() => researchOne(taskId, storyId))))
  } finally {
    taskRegistry.complete(taskId)
    const task = taskRegistry.get(taskId)
    log.info({ taskId, completed: task?.completed, failed: task?.failed, skipped: task?.skipped.length }, 'bulk research finished')
  }
}

/**
 * Start researching the chosen stories in the background: 409 while research is switched off, or
 * when another task is processing every one of them. A story another task is processing is skipped
 * as the other bulk actions skip it; one chosen twice is taken once.
 */
export function startResearchBatch(storyIds: string[]): { taskId: string } {
  const off = switchRefusal()
  if (off) throw new ConflictError(off)
  const chosen = [...new Set(storyIds)]
  const processing = new Set(taskRegistry.getProcessingStoryIds())
  const queued = chosen.filter(id => !processing.has(id))
  if (queued.length === 0) throw new ConflictError('All stories are already being processed')

  const taskId = taskRegistry.create('research', chosen.length, queued)
  for (const id of chosen) if (processing.has(id)) taskRegistry.skip(taskId, id, PROCESSING)
  log.info({ taskId, stories: queued.length, skipped: chosen.length - queued.length }, 'bulk research started')
  void researchAll(taskId, queued)
  return { taskId }
}

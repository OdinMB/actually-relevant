import { getStoryIdsByStatus } from '../services/story.js'
import { selectStoriesInGroups } from '../services/analysis.js'
import { transition } from '../services/storyLifecycle.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { countOf, reportRunResult } from '../lib/runUsage.js'

const log = createLogger('select_stories')

export async function runSelectStories(): Promise<void> {
  log.info('starting selection job')

  // Snapshot all analyzed stories before filtering, so stories arriving
  // after this point are processed in the next run.
  const allAnalyzed = await getStoryIdsByStatus('analyzed')

  const ids = await getStoryIdsByStatus('analyzed', { relevanceMin: config.selection.relevanceMin })

  // Reject analyzed stories from the snapshot that don't meet threshold
  const qualifiedSet = new Set(ids)
  const belowThreshold = allAnalyzed.filter(id => !qualifiedSet.has(id))

  let belowMin = 0
  if (belowThreshold.length > 0) {
    const { moved } = await transition(belowThreshold, { to: 'rejected', reason: 'select_threshold' }, 'pipeline')
    belowMin = moved.length
    log.info({ count: moved.length }, 'rejected analyzed stories below selection relevance minimum')
  }
  const belowNote = belowMin > 0 ? `, ${belowMin} below the relevance minimum` : ''

  if (ids.length === 0) {
    log.info(`no analyzed stories with relevance >= ${config.selection.relevanceMin}`)
    reportRunResult(`Nothing to select from${belowNote}`)
    return
  }

  log.info({ storyCount: ids.length, concurrency: config.concurrency.select }, 'selecting stories')

  const result = await selectStoriesInGroups(ids)

  log.info({ selected: result.selected, rejected: result.rejected, errors: result.errors }, 'selection job finished')
  const errorNote = result.errors > 0 ? `, ${countOf(result.errors, 'error')}` : ''
  reportRunResult(`Selected ${result.selected} of ${countOf(ids.length, 'story', 'stories')}${belowNote}${errorNote}`)
}

import { getStoryIdsByStatus } from '../services/story.js'
import { preAssessStories } from '../services/analysis.js'
import { createLogger } from '../lib/logger.js'
import { countOf, reportRunResult } from '../lib/runUsage.js'

const log = createLogger('preassess_stories')

export async function runPreassessStories(): Promise<void> {
  log.info('starting pre-assessment job')

  const ids = await getStoryIdsByStatus('fetched')
  if (ids.length === 0) {
    log.info('no fetched stories to pre-assess')
    reportRunResult('Nothing to rate')
    return
  }

  log.info({ storyCount: ids.length }, 'found fetched stories to pre-assess')

  const results = await preAssessStories(ids)
  log.info({ completed: results.length, total: ids.length }, 'pre-assessment finished')
  reportRunResult(
    `Rated ${results.length === ids.length ? countOf(ids.length, 'story', 'stories') : `${results.length} of ${countOf(ids.length, 'story', 'stories')}`}`,
  )
  for (const r of results) {
    log.info({ storyId: r.storyId, rating: r.rating, emotionTag: r.emotionTag }, 'pre-assessed')
  }
}

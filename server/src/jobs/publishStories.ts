import { getStoryIdsByStatus, bulkUpdateStatus } from '../services/story.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('publish_stories')

export async function runPublishStories(): Promise<void> {
  log.info('starting publish job')

  const ids = await getStoryIdsByStatus('selected')
  if (ids.length === 0) {
    log.info('no selected stories to publish')
    return
  }

  log.info({ storyCount: ids.length }, 'publishing stories')

  // bulkUpdateStatus publishes in bounded chunks (config.publish.chunkSize), so even a
  // large `selected` backlog is processed within Render's memory limit and the tx timeout.
  const result = await bulkUpdateStatus(ids, 'published')

  log.info({ published: result.count }, 'publish job finished')
}

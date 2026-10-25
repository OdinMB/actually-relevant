import { getStoryIdsByStatus } from '../services/story.js'
import { transition } from '../services/storyLifecycle.js'
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

  // Publishes in bounded chunks (config.publish.chunkSize), so even a large `selected` backlog is
  // processed within Render's memory limit and the tx timeout. Only unclustered stories and
  // cluster primaries publish; a story trashed or rejected meanwhile is skipped.
  const { moved, skipped } = await transition(ids, { to: 'published' }, 'pipeline')

  log.info({ published: moved.length, skipped: skipped.length }, 'publish job finished')
}

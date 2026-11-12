import { getStoryIdsByStatus } from '../services/story.js'
import { transition } from '../services/storyLifecycle.js'
import { awaitingResearch } from '../services/researchQueue.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('publish_stories')

export async function runPublishStories(): Promise<void> {
  log.info('starting publish job')

  const selected = await getStoryIdsByStatus('selected')
  if (selected.length === 0) {
    log.info('no selected stories to publish')
    return
  }

  // The publish gate (.context/story-research.md, "The pipeline step"): while the research step is
  // on, a selected story it still owes waits for a later run; an editor's publish never waits
  const waiting = await awaitingResearch(selected)
  const ids = selected.filter(id => !waiting.has(id))
  if (waiting.size > 0) log.info({ waiting: waiting.size }, 'stories left for a later run: awaiting research')
  if (ids.length === 0) {
    log.info('no selected stories to publish yet')
    return
  }

  log.info({ storyCount: ids.length }, 'publishing stories')

  // Publishes in bounded chunks (config.publish.chunkSize), so even a large `selected` backlog is
  // processed within Render's memory limit and the tx timeout. Only unclustered stories and
  // cluster primaries publish; a story trashed or rejected meanwhile is skipped.
  const { moved, skipped } = await transition(ids, { to: 'published' }, 'pipeline')

  log.info({ published: moved.length, skipped: skipped.length, waiting: waiting.size }, 'publish job finished')
}

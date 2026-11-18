import { getStoryIdsByStatus } from '../services/story.js'
import { transition } from '../services/storyLifecycle.js'
import { awaitingResearch } from '../services/researchQueue.js'
import { awaitingContext } from '../services/storyContextQueue.js'
import { awaitingPass } from '../services/researchPassQueue.js'
import { createLogger } from '../lib/logger.js'
import { countOf, reportRunResult } from '../lib/runUsage.js'

const log = createLogger('publish_stories')

export async function runPublishStories(): Promise<void> {
  log.info('starting publish job')

  const selected = await getStoryIdsByStatus('selected')
  if (selected.length === 0) {
    log.info('no selected stories to publish')
    reportRunResult('Nothing to publish')
    return
  }

  // The publish gate (.context/story-research.md, "The pipeline step"): only while research is switched
  // on and the research step's job is enabled, a selected story it still owes waits for a later run, while
  // it was selected less than config.research.pipeline.maxWaitMinutes ago; an editor's publish never waits
  const waiting = await awaitingResearch(selected)
  // The same for context cards (.context/story-context.md, "The publish gate"), while the context step's
  // job is enabled and web search is on, within the same bound, and only in a run on its own: in the
  // daily edition the context step has just had its turn, so its failure or lateness never holds the edition
  const researched = selected.filter(id => !waiting.has(id))
  const waitingForCards = await awaitingContext(researched)
  // The research pass's gate (.context/research-passes.md, "The job and the gate"), while it works and its
  // job is enabled, within the same bound and in the daily edition too; it holds nothing while switched off
  const carded = researched.filter(id => !waitingForCards.has(id))
  const waitingForPass = await awaitingPass(carded)
  const ids = carded.filter(id => !waitingForPass.has(id))
  if (waiting.size > 0) log.info({ waiting: waiting.size }, 'stories left for a later run: awaiting research')
  if (waitingForCards.size > 0) log.info({ waiting: waitingForCards.size }, 'stories left for a later run: awaiting their context cards')
  if (waitingForPass.size > 0) log.info({ waiting: waitingForPass.size }, 'stories left for a later run: awaiting their research pass')
  const waitingNote =
    (waiting.size > 0 ? `, ${waiting.size} waiting for research` : '') +
    (waitingForCards.size > 0 ? `, ${waitingForCards.size} waiting for context cards` : '') +
    (waitingForPass.size > 0 ? `, ${waitingForPass.size} waiting for their research pass` : '')
  if (ids.length === 0) {
    log.info('no selected stories to publish yet')
    reportRunResult(`Nothing to publish yet${waitingNote}`)
    return
  }

  log.info({ storyCount: ids.length }, 'publishing stories')

  // Publishes in bounded chunks (config.publish.chunkSize), so even a large `selected` backlog is
  // processed within Render's memory limit and the tx timeout. Only unclustered stories and
  // cluster primaries publish; a story trashed or rejected meanwhile is skipped.
  const { moved, skipped } = await transition(ids, { to: 'published' }, 'pipeline')

  log.info(
    { published: moved.length, skipped: skipped.length, waiting: waiting.size, waitingForCards: waitingForCards.size, waitingForPass: waitingForPass.size },
    'publish job finished',
  )
  reportRunResult(`Published ${countOf(moved.length, 'story', 'stories')}${waitingNote}`)
}

import { Router } from 'express'
import { createLogger } from '../../lib/logger.js'
import * as podcastService from '../../services/podcast.js'
import { findOrCreateWeekEpisode, resumeEpisode, runWeeklyEpisode } from '../../services/podcastWeekly.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { updatePodcastSchema, podcastQuerySchema } from '../../schemas/podcast.js'

const router = Router()
const log = createLogger('podcasts')

/** Long-running podcast work continues after the 202; its outcome lands on the row and in the log. */
function inBackground(work: Promise<unknown>, what: string, podcastId: string): void {
  work.catch(err => log.error({ err, podcastId }, `${what} failed`))
}

router.get('/', validateQuery(podcastQuerySchema), async (req, res) => {
  try {
    const filters = req.parsedQuery || {}
    const result = await podcastService.getPodcasts(filters)
    res.json(result)
  } catch (err) {
    log.error({ err }, 'failed to fetch podcasts')
    res.status(500).json({ error: 'Failed to fetch podcasts' })
  }
})

/** Start (or resume) this ISO week's episode: responds with the row, then advances it in the background. */
router.post('/weekly', expensiveOpLimiter, async (_req, res) => {
  try {
    const episode = await findOrCreateWeekEpisode()
    res.status(202).json(await podcastService.getPodcastById(episode.id))
    inBackground(runWeeklyEpisode({ trigger: 'admin' }), 'weekly podcast run', episode.id)
  } catch (err) {
    log.error({ err }, 'failed to start the weekly podcast')
    res.status(500).json({ error: "Failed to start this week's episode" })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const podcast = await podcastService.getPodcastById(req.params.id)
    if (!podcast) {
      res.status(404).json({ error: 'Podcast not found' })
      return
    }
    res.json(podcast)
  } catch (err) {
    log.error({ err }, 'failed to fetch podcast')
    res.status(500).json({ error: 'Failed to fetch podcast' })
  }
})

/** Clear a block and continue the episode from its stage, in the background. */
router.post('/:id/resume', expensiveOpLimiter, async (req, res) => {
  try {
    const podcast = await podcastService.getPodcastById(req.params.id)
    if (!podcast) {
      res.status(404).json({ error: 'Podcast not found' })
      return
    }
    if (podcast.stage === 'legacy') {
      res.status(409).json({ error: 'Legacy episodes cannot be resumed' })
      return
    }
    res.status(202).json(podcast)
    inBackground(resumeEpisode(podcast.id), 'podcast resume', podcast.id)
  } catch (err) {
    log.error({ err }, 'failed to resume podcast')
    res.status(500).json({ error: 'Failed to resume podcast' })
  }
})

router.put('/:id', validateBody(updatePodcastSchema), async (req, res) => {
  try {
    const podcast = await podcastService.updatePodcastTitle(req.params.id, req.body.title)
    res.json(podcast)
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Podcast not found' })
      return
    }
    log.error({ err }, 'failed to update podcast')
    res.status(500).json({ error: 'Failed to update podcast' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await podcastService.deletePodcast(req.params.id)
    res.status(204).send()
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Podcast not found' })
      return
    }
    log.error({ err }, 'failed to delete podcast')
    res.status(500).json({ error: 'Failed to delete podcast' })
  }
})

export default router

import { Router, type Response } from 'express'
import { createLogger } from '../../lib/logger.js'
import * as podcastService from '../../services/podcast.js'
import { findOrCreateWeekEpisode, resumeEpisode, startAdminRun, type AdminRunRequest } from '../../services/podcastWeekly.js'
import { rewindEpisode } from '../../services/podcastPipeline.js'
import { getEpisodeStoryPool, replaceEpisodeStories, saveEpisodeScript, updateEpisodeMeta, PodcastEditRejectedError } from '../../services/podcastEditing.js'
import { monthToDateChars, PodcastRefusedError } from '../../services/podcastGuards.js'
import { publishEpisode, unpublishEpisode } from '../../services/podcastPublish.js'
import { config } from '../../config.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import {
  updatePodcastSchema, podcastQuerySchema, resumePodcastSchema, rewindPodcastSchema, podcastStoriesSchema, podcastScriptEditSchema,
} from '../../schemas/podcast.js'

const router = Router()
const log = createLogger('podcasts')

/** Long-running podcast work continues after the 202; its outcome lands on the row and in the log. */
function inBackground(work: Promise<unknown>, what: string, podcastId: string): void {
  work.catch(err => log.error({ err, podcastId }, `${what} failed`))
}

/**
 * The refusals every change shares: 409 when the episode's state does not allow it, 422 when a
 * person's content breaks a rule (with the errors and warnings), 404 when it is gone; else 500.
 */
function sendFailure(res: Response, err: unknown, what: string): void {
  if (err instanceof PodcastRefusedError) {
    res.status(409).json({ error: err.message })
    return
  }
  if (err instanceof PodcastEditRejectedError) {
    res.status(422).json({ error: err.message, errors: err.errors, warnings: err.warnings })
    return
  }
  if ((err as { code?: unknown })?.code === 'P2025') {
    res.status(404).json({ error: 'Podcast not found' })
    return
  }
  log.error({ err }, `failed to ${what}`)
  res.status(500).json({ error: `Failed to ${what}` })
}

/** The episode as the admin sees it, or a 404 answered; null when answered. */
async function findOr404(id: string, res: Response) {
  const podcast = await podcastService.getPodcastById(id)
  if (!podcast) res.status(404).json({ error: 'Podcast not found' })
  return podcast
}

/**
 * Start work on an episode (ADR-0009): claim its lease before answering, so it shows as in
 * progress from the 202 on and a second click gets a 409, then run it in the background.
 */
async function startInBackground(id: string, req: AdminRunRequest, res: Response, what: string): Promise<void> {
  await startAdminRun(id, req)
  res.status(202).json(await podcastService.getPodcastById(id))
  inBackground(resumeEpisode(id), what, id)
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

/** Find or create this ISO week's episode; a person then starts it in a mode on its page. */
router.post('/weekly', async (_req, res) => {
  try {
    const episode = await findOrCreateWeekEpisode()
    res.json(await podcastService.getPodcastById(episode.id))
  } catch (err) {
    log.error({ err }, "failed to find or create this week's podcast")
    res.status(500).json({ error: "Failed to open this week's episode" })
  }
})

/** Episodes a process is working on right now, with the step and the voicing progress (polled by the progress toast). */
router.get('/active', async (_req, res) => {
  try {
    res.json(await podcastService.getActiveEpisodes())
  } catch (err) {
    log.error({ err }, 'failed to list running podcast episodes')
    res.status(500).json({ error: 'Failed to list running episodes' })
  }
})

/** TTS characters reserved this UTC month against the monthly cap, and a typical and the largest episode. */
router.get('/usage', async (_req, res) => {
  try {
    res.json({
      monthToDateChars: await monthToDateChars(),
      monthlyCap: config.podcast.monthlyTtsCharCap,
      typicalEpisodeChars: config.podcast.spokenCharAim,
      maxEpisodeChars: config.podcast.spokenCharBand[1],
    })
  } catch (err) {
    log.error({ err }, 'failed to read podcast TTS usage')
    res.status(500).json({ error: 'Failed to read podcast usage' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const podcast = await findOr404(req.params.id, res)
    if (podcast) res.json(podcast)
  } catch (err) {
    log.error({ err }, 'failed to fetch podcast')
    res.status(500).json({ error: 'Failed to fetch podcast' })
  }
})

/** Start (with a mode), approve a review stop, switch to automated, or resume after a failure; runs in the background. */
router.post('/:id/resume', expensiveOpLimiter, validateBody(resumePodcastSchema), async (req, res) => {
  try {
    if (!(await findOr404(req.params.id, res))) return
    await startInBackground(req.params.id, { mode: req.body.mode }, res, 'podcast run')
  } catch (err) {
    sendFailure(res, err, 'start the podcast run')
  }
})

/**
 * Go back to an earlier stage (Start over, Regenerate script, Change stories, Edit script after
 * voicing, Regenerate audio). With `advance` the episode continues from there in the background.
 */
router.post('/:id/rewind', expensiveOpLimiter, validateBody(rewindPodcastSchema), async (req, res) => {
  try {
    const { to, advance } = req.body as { to: 'created' | 'selected' | 'scripted'; advance: boolean }
    if (!(await findOr404(req.params.id, res))) return
    if (advance) {
      await startInBackground(req.params.id, { rewindTo: to }, res, 'podcast rewind')
      return
    }
    await rewindEpisode(req.params.id, to, { dryRun: config.podcast.dryRun, mode: 'interactive' })
    res.json(await podcastService.getPodcastById(req.params.id))
  } catch (err) {
    sendFailure(res, err, 'rewind the podcast')
  }
})

/** The week's story pool for the picker, marking the episode's stories. */
router.get('/:id/story-pool', async (req, res) => {
  try {
    const podcast = await findOr404(req.params.id, res)
    if (podcast) res.json(await getEpisodeStoryPool(podcast))
  } catch (err) {
    sendFailure(res, err, 'load the story pool')
  }
})

router.put('/:id/stories', validateBody(podcastStoriesSchema), async (req, res) => {
  try {
    if (!(await findOr404(req.params.id, res))) return
    await replaceEpisodeStories(req.params.id, req.body.storyIds)
    res.json(await podcastService.getPodcastById(req.params.id))
  } catch (err) {
    sendFailure(res, err, 'save the stories')
  }
})

/** Save a person's script edit: 422 with errors (nothing saved), or the episode with the warnings. */
router.put('/:id/script', validateBody(podcastScriptEditSchema), async (req, res) => {
  try {
    if (!(await findOr404(req.params.id, res))) return
    const { warnings } = await saveEpisodeScript(req.params.id, req.body)
    res.json({ podcast: await podcastService.getPodcastById(req.params.id), warnings })
  } catch (err) {
    sendFailure(res, err, 'save the script')
  }
})

/** List a ready episode in the feed and on /podcast (409 unless ready, live and at rest). */
router.post('/:id/publish', async (req, res) => {
  try {
    if (!(await findOr404(req.params.id, res))) return
    await publishEpisode(req.params.id)
    res.json(await podcastService.getPodcastById(req.params.id))
  } catch (err) {
    sendFailure(res, err, 'publish the podcast')
  }
})

/** Take an episode out of the feed and off /podcast; always allowed, deletes nothing on the CDN. */
router.post('/:id/unpublish', async (req, res) => {
  try {
    if (!(await unpublishEpisode(req.params.id))) {
      res.status(404).json({ error: 'Podcast not found' })
      return
    }
    res.json(await podcastService.getPodcastById(req.params.id))
  } catch (err) {
    sendFailure(res, err, 'unpublish the podcast')
  }
})

router.put('/:id', validateBody(updatePodcastSchema), async (req, res) => {
  try {
    if (!(await findOr404(req.params.id, res))) return
    await updateEpisodeMeta(req.params.id, req.body)
    res.json(await podcastService.getPodcastById(req.params.id))
  } catch (err) {
    sendFailure(res, err, 'update the podcast')
  }
})

router.delete('/:id', async (req, res) => {
  try {
    if (!(await podcastService.deletePodcast(req.params.id))) {
      res.status(404).json({ error: 'Podcast not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    sendFailure(res, err, 'delete the podcast')
  }
})

export default router

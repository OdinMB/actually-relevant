import { Router, type Response } from 'express'
import { createLogger } from '../../lib/logger.js'
import * as podcastService from '../../services/podcast.js'
import { findOrCreateWeekEpisode, resumeEpisode, startAdminRun, type AdminRunRequest } from '../../services/podcastWeekly.js'
import { getWeekSlot } from '../../services/podcastWeekSlot.js'
import { rewindEpisode } from '../../services/podcastPipeline.js'
import { getEpisodeStoryPool, replaceEpisodeStories, saveEpisodeScript, updateEpisodeMeta } from '../../services/podcastEditing.js'
import { monthToDateChars } from '../../services/podcastGuards.js'
import { publishEpisode, unpublishEpisode } from '../../services/podcastPublish.js'
import { createStandaloneEpisode, saveStandaloneStories, searchStandaloneStories, suggestStandaloneStories } from '../../services/podcastStandalone.js'
import { config } from '../../config.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import {
  updatePodcastSchema,
  podcastQuerySchema,
  resumePodcastSchema,
  rewindPodcastSchema,
  podcastStoriesSchema,
  podcastScriptEditSchema,
  podcastStoryFiltersSchema,
  podcastStorySearchQuerySchema,
} from '../../schemas/podcast.js'

// Errors: the refusals every change shares are ServiceErrors the global handler in app.ts answers:
// 409 PodcastRefusedError when the episode's state does not allow it, 422 PodcastEditRejectedError
// when a person's content breaks a rule (with the errors and warnings), and a Prisma P2025 is
// "Podcast not found"; anything else is a 500 with the route's failsWith() text.
const router = Router()
const log = createLogger('podcasts')
const podcastNotFound = { notFound: 'Podcast not found' }

/** Long-running podcast work continues after the 202; its outcome lands on the row and in the log. */
function inBackground(work: Promise<unknown>, what: string, podcastId: string): void {
  work.catch(err => log.error({ err, podcastId }, `${what} failed`))
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

router.get('/', failsWith('Failed to fetch podcasts'), validateQuery(podcastQuerySchema), async (req, res) => {
  res.json(await podcastService.getPodcasts(req.parsedQuery || {}))
})

/** This ISO week's slot, read without creating a row (routed before /:id). */
router.get('/weekly', failsWith("Failed to read this week's podcast slot"), async (_req, res) => {
  res.json(await getWeekSlot())
})

/** Find or create this ISO week's episode; a person then starts it in a mode on its page. */
router.post('/weekly', failsWith("Failed to open this week's episode"), async (_req, res) => {
  const episode = await findOrCreateWeekEpisode()
  res.json(await podcastService.getPodcastById(episode.id))
})

/** Create a standalone episode at `created`; a person then chooses its stories on its page. */
router.post('/standalone', failsWith('Failed to create the episode'), async (_req, res) => {
  const episode = await createStandaloneEpisode()
  res.status(201).json(await podcastService.getPodcastById(episode.id))
})

/** Published stories of any date for a standalone episode's story finder, most relevant first. */
router.get('/story-search', failsWith('Failed to search stories'), validateQuery(podcastStorySearchQuerySchema), async (req, res) => {
  res.json(await searchStandaloneStories(req.parsedQuery || {}))
})

/** Episodes a process is working on right now, with the step and the voicing progress (polled by the progress toast). */
router.get('/active', failsWith('Failed to list running episodes'), async (_req, res) => {
  res.json(await podcastService.getActiveEpisodes())
})

/** TTS characters reserved this UTC month against the monthly cap, and a typical and the largest episode. */
router.get('/usage', failsWith('Failed to read podcast usage'), async (_req, res) => {
  res.json({
    monthToDateChars: await monthToDateChars(),
    monthlyCap: config.podcast.monthlyTtsCharCap,
    typicalEpisodeChars: config.podcast.spokenCharAim,
    maxEpisodeChars: config.podcast.spokenCharBand[1],
  })
})

router.get('/:id', failsWith('Failed to fetch podcast'), async (req, res) => {
  const podcast = await findOr404(req.params.id!, res)
  if (podcast) res.json(podcast)
})

/** Start (with a mode), approve a review stop, switch to automated, or resume after a failure; runs in the background. */
router.post(
  '/:id/resume',
  failsWith('Failed to start the podcast run', podcastNotFound),
  expensiveOpLimiter,
  validateBody(resumePodcastSchema),
  async (req, res) => {
    if (!(await findOr404(req.params.id!, res))) return
    await startInBackground(req.params.id!, { mode: req.body.mode }, res, 'podcast run')
  },
)

/**
 * Go back to an earlier stage (Start over, Regenerate script, Change stories, Edit script after
 * voicing, Regenerate audio). With `advance` the episode continues from there in the background.
 */
router.post(
  '/:id/rewind',
  failsWith('Failed to rewind the podcast', podcastNotFound),
  expensiveOpLimiter,
  validateBody(rewindPodcastSchema),
  async (req, res) => {
    const { to, advance } = req.body as { to: 'created' | 'selected' | 'scripted'; advance: boolean }
    if (!(await findOr404(req.params.id!, res))) return
    if (advance) {
      await startInBackground(req.params.id!, { rewindTo: to }, res, 'podcast rewind')
      return
    }
    await rewindEpisode(req.params.id!, to, { dryRun: config.podcast.dryRun, mode: 'interactive' })
    res.json(await podcastService.getPodcastById(req.params.id!))
  },
)

/** The week's story pool for the picker, marking the episode's stories. */
router.get('/:id/story-pool', failsWith('Failed to load the story pool', podcastNotFound), async (req, res) => {
  const podcast = await findOr404(req.params.id!, res)
  if (podcast) res.json(await getEpisodeStoryPool(podcast))
})

/** The selection model's advice for a standalone episode's stories (writes nothing): 409 unless choosable, 422 when too few match. */
router.post(
  '/:id/suggest-stories',
  failsWith('Failed to suggest stories', podcastNotFound),
  expensiveOpLimiter,
  validateBody(podcastStoryFiltersSchema),
  async (req, res) => {
    if (!(await findOr404(req.params.id!, res))) return
    res.json({ stories: await suggestStandaloneStories(req.params.id!, req.body) })
  },
)

/** Save the episode's stories: from the week's pool for a weekly episode, from any published story for a standalone one. */
router.put('/:id/stories', failsWith('Failed to save the stories', podcastNotFound), validateBody(podcastStoriesSchema), async (req, res) => {
  const podcast = await findOr404(req.params.id!, res)
  if (!podcast) return
  const save = podcast.kind === 'standalone' ? saveStandaloneStories : replaceEpisodeStories
  await save(req.params.id!, req.body.storyIds)
  res.json(await podcastService.getPodcastById(req.params.id!))
})

/** Save a person's script edit: 422 with errors (nothing saved), or the episode with the warnings. */
router.put('/:id/script', failsWith('Failed to save the script', podcastNotFound), validateBody(podcastScriptEditSchema), async (req, res) => {
  if (!(await findOr404(req.params.id!, res))) return
  const { warnings } = await saveEpisodeScript(req.params.id!, req.body)
  res.json({ podcast: await podcastService.getPodcastById(req.params.id!), warnings })
})

/** List a ready episode in the feed and on /podcast (409 unless ready, live and at rest). */
router.post('/:id/publish', failsWith('Failed to publish the podcast', podcastNotFound), async (req, res) => {
  if (!(await findOr404(req.params.id!, res))) return
  await publishEpisode(req.params.id!)
  res.json(await podcastService.getPodcastById(req.params.id!))
})

/** Take an episode out of the feed and off /podcast; always allowed, deletes nothing on the CDN. */
router.post('/:id/unpublish', failsWith('Failed to unpublish the podcast', podcastNotFound), async (req, res) => {
  if (!(await unpublishEpisode(req.params.id!))) {
    res.status(404).json({ error: 'Podcast not found' })
    return
  }
  res.json(await podcastService.getPodcastById(req.params.id!))
})

router.put('/:id', failsWith('Failed to update the podcast', podcastNotFound), validateBody(updatePodcastSchema), async (req, res) => {
  if (!(await findOr404(req.params.id!, res))) return
  await updateEpisodeMeta(req.params.id!, req.body)
  res.json(await podcastService.getPodcastById(req.params.id!))
})

router.delete('/:id', failsWith('Failed to delete the podcast', podcastNotFound), async (req, res) => {
  if (!(await podcastService.deletePodcast(req.params.id!))) {
    res.status(404).json({ error: 'Podcast not found' })
    return
  }
  res.status(204).send()
})

export default router

/**
 * Story research, the admin action (`.context/story-research.md`): this month's spend and whether
 * a run may start, a story's latest runs, starting a run in the background, and putting a run's
 * researched version on the story or taking it back off. Refusals are the services' ServiceErrors
 * (404 unknown story or run, 409 switched off, ineligible, at the cap, in progress, a run that cannot
 * be applied, a status that takes no research write).
 */
import { Router } from 'express'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { applyResearchRun, revertResearch } from '../../services/researchApply.js'
import { listResearchRuns, researchUsage, startResearchRun } from '../../services/researchRuns.js'

const router = Router()

router.get('/usage', failsWith('Failed to fetch research usage'), async (_req, res) => {
  res.json(await researchUsage())
})

router.get('/stories/:storyId/runs', failsWith('Failed to fetch research runs'), async (req, res) => {
  res.json(await listResearchRuns(req.params.storyId!))
})

router.post('/stories/:storyId/runs', failsWith('Failed to start research'), expensiveOpLimiter, async (req, res) => {
  res.status(202).json(await startResearchRun(req.params.storyId!))
})

// One embedding call each, no model call
router.post('/stories/:storyId/runs/:runId/apply', failsWith('Failed to apply the research'), async (req, res) => {
  await applyResearchRun(req.params.storyId!, req.params.runId!)
  res.status(204).send()
})

router.post('/stories/:storyId/revert', failsWith('Failed to revert to single-source'), async (req, res) => {
  await revertResearch(req.params.storyId!)
  res.status(204).send()
})

export default router

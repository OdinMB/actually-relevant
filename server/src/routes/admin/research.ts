/**
 * Story research, the admin action (`.context/story-research.md`): this month's spend and whether
 * a run may start, a story's latest runs, and starting a run in the background. Refusals are the
 * service's ServiceErrors (404 unknown story, 409 switched off, ineligible, at the cap, in progress).
 */
import { Router } from 'express'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
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

export default router

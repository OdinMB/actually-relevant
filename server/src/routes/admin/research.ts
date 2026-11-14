/**
 * Story research, the admin action (`.context/story-research.md`): this month's spend and whether
 * a run may start, a story's latest runs, starting a run in the background (one story's, or the
 * stories list's bulk Research), and putting a run's researched version on the story (one story's,
 * or each selected story's newest run) or taking it back off. Refusals are the services'
 * ServiceErrors (404 unknown story or run, 409 switched off, ineligible, at the cap, in progress, a
 * run that cannot be applied, a status that takes no research write); a bulk action skips such a
 * story instead, with the reason (a bulk Research in its task, a bulk apply in its answer).
 */
import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { bulkApplyResearchIdsSchema, bulkResearchIdsSchema } from '../../schemas/story.js'
import { applyRefusal, applyResearchRun, revertResearch } from '../../services/researchApply.js'
import { applyNewestRuns } from '../../services/researchApplyBatch.js'
import { startResearchBatch } from '../../services/researchBatch.js'
import { listResearchRuns, researchUsage, startResearchRun } from '../../services/researchRuns.js'

const router = Router()

// The month's spend and whether a run may start, plus why no run can be applied now (or null)
router.get('/usage', failsWith('Failed to fetch research usage'), async (_req, res) => {
  res.json({ ...(await researchUsage()), applyRefusal: applyRefusal() })
})

router.get('/stories/:storyId/runs', failsWith('Failed to fetch research runs'), async (req, res) => {
  res.json(await listResearchRuns(req.params.storyId!))
})

router.post('/stories/:storyId/runs', failsWith('Failed to start research'), expensiveOpLimiter, async (req, res) => {
  res.status(202).json(await startResearchRun(req.params.storyId!))
})

// The stories list's bulk Research: one task over the batch, polled at /stories/tasks/:taskId
router.post('/runs', failsWith('Failed to start bulk research'), expensiveOpLimiter, validateBody(bulkResearchIdsSchema), (req, res) => {
  res.status(202).json(startResearchBatch(req.body.storyIds))
})

// One embedding call each, no model call
router.post('/stories/:storyId/runs/:runId/apply', failsWith('Failed to apply the research'), async (req, res) => {
  await applyResearchRun(req.params.storyId!, req.params.runId!)
  res.status(204).send()
})

// The stories list's bulk "Use researched versions": each story's newest run through the apply above, one at a time; each story's outcome
router.post('/apply', failsWith('Failed to apply the researched versions'), validateBody(bulkApplyResearchIdsSchema), async (req, res) => {
  res.json(await applyNewestRuns(req.body.storyIds))
})

router.post('/stories/:storyId/revert', failsWith('Failed to revert to single-source'), async (req, res) => {
  await revertResearch(req.params.storyId!)
  res.status(204).send()
})

export default router

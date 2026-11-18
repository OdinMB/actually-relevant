/**
 * Research passes, the admin's endpoints (`.context/research-passes.md`, "Admin routes"): this
 * month's spend under the one cap and whether a pass may start, a story's passes with its versions,
 * pool and legacy runs, starting an editor's pass in the background (one story's "Research again", or
 * the stories list's bulk one), and "Undo this update". A pass applies itself, so there is no apply
 * endpoint. Refusals are the services' ServiceErrors (404 unknown story; 409 switched off, ineligible,
 * at the cap, running, nothing to undo, the story changed); a bulk pass skips such a story in its task
 * instead, with the reason. While the step's eval gate is closed every start is refused.
 */
import { Router } from 'express'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateBody } from '../../middleware/validate.js'
import { bulkResearchIdsSchema } from '../../schemas/story.js'
import { startEditorPass, startEditorPassBatch } from '../../services/researchPassRuns.js'
import { passUsage, storyPasses } from '../../services/researchPassViews.js'
import { undoUpdate } from '../../services/researchWrites.js'

const router = Router()

router.get('/usage', failsWith('Failed to fetch research pass usage'), async (_req, res) => {
  res.json(await passUsage())
})

router.get('/stories/:storyId', failsWith('Failed to fetch research passes'), async (req, res) => {
  res.json(await storyPasses(req.params.storyId!))
})

router.post('/stories/:storyId/passes', failsWith('Failed to start the research pass'), expensiveOpLimiter, async (req, res) => {
  res.status(202).json(await startEditorPass(req.params.storyId!))
})

// The stories list's bulk "Research again": one task over the batch, polled at /stories/tasks/:taskId
router.post('/passes', failsWith('Failed to start the research passes'), expensiveOpLimiter, validateBody(bulkResearchIdsSchema), async (req, res) => {
  res.status(202).json(await startEditorPassBatch(req.body.storyIds))
})

// One embedding call, no model call
router.post('/stories/:storyId/undo', failsWith('Failed to undo the update'), async (req, res) => {
  await undoUpdate(req.params.storyId!)
  res.status(204).send()
})

export default router

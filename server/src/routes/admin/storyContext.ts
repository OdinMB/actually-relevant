/**
 * A story's context in the admin (`.context/story-context.md`, "Admin"), mounted under
 * `/api/admin/stories` beside the story routes: the Context section's view, an editor's context run
 * ("On demand", 202 with the task to poll), hiding and showing all of it, and hiding, showing or
 * moving one box. 404 for an unknown story or box, 400 for a place the story does not have, 409 for
 * a run that cannot start now (the services' ServiceErrors).
 */
import { Router } from 'express'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateBody } from '../../middleware/validate.js'
import { contextBoxUpdateSchema, contextHiddenSchema } from '../../schemas/storyContext.js'
import { getContextAdmin, setContextHidden, updateContextBox } from '../../services/storyContextAdmin.js'
import { startContextGathering } from '../../services/storyContextOnDemand.js'

const router = Router()

router.get('/:id/context', failsWith('Failed to fetch the story context'), async (req, res) => {
  res.json(await getContextAdmin(req.params.id!))
})

router.post('/:id/context/run', failsWith('Failed to start gathering context'), expensiveOpLimiter, async (req, res) => {
  res.status(202).json(await startContextGathering(req.params.id!))
})

router.put('/:id/context', failsWith('Failed to update the story context'), validateBody(contextHiddenSchema), async (req, res) => {
  await setContextHidden(req.params.id!, (req.body as { hidden: boolean }).hidden)
  res.status(204).end()
})

router.patch('/:id/context/boxes/:boxId', failsWith('Failed to update the context card'), validateBody(contextBoxUpdateSchema), async (req, res) => {
  await updateContextBox(req.params.id!, req.params.boxId!, req.body as { hidden?: boolean; place?: string })
  res.status(204).end()
})

export default router

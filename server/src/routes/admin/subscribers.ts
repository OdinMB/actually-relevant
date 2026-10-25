import { Router } from 'express'
import { failsWith } from '../../middleware/routeErrors.js'
import * as subscribersService from '../../services/subscribers.js'

const router = Router()

router.get('/', failsWith('Failed to load subscribers'), async (_req, res) => {
  res.json(await subscribersService.getSubscriberReconciliation())
})

export default router

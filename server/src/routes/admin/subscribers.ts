import { Router } from 'express'
import { createLogger } from '../../lib/logger.js'
import * as subscribersService from '../../services/subscribers.js'

const router = Router()
const log = createLogger('subscribers')

router.get('/', async (_req, res) => {
  try {
    const data = await subscribersService.getSubscriberReconciliation()
    res.json(data)
  } catch (err) {
    log.error({ err }, 'failed to load subscriber reconciliation')
    res.status(500).json({ error: 'Failed to load subscribers' })
  }
})

export default router

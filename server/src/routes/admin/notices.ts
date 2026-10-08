/** Admin HTTP API for notices (`.context/admin-notices.md`): list, unseen count, mark seen. */
import { Router } from 'express'
import { z } from 'zod'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { createLogger } from '../../lib/logger.js'
import {
  NOTICE_SOURCES,
  countUnseenNotices,
  listNotices,
  markNoticeSeen,
  markNoticesSeen,
} from '../../services/adminNotices.js'

const router = Router()
const log = createLogger('admin:notices')

const listQuerySchema = z.object({
  source: z.enum(NOTICE_SOURCES).optional(),
  show: z.enum(['unseen', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

router.get('/', validateQuery(listQuerySchema), async (req, res) => {
  try {
    const { source, show, page, limit } = req.parsedQuery! as z.infer<typeof listQuerySchema>
    const result = await listNotices({ source, unseenOnly: show === 'unseen' }, page, limit)
    res.json({ ...result, page, limit })
  } catch (err) {
    log.error({ err }, 'failed to list notices')
    res.status(500).json({ error: 'Failed to list notices' })
  }
})

// For the sidebar badge and the dashboard
router.get('/count', async (_req, res) => {
  try {
    res.json(await countUnseenNotices())
  } catch (err) {
    log.error({ err }, 'failed to count notices')
    res.status(500).json({ error: 'Failed to count notices' })
  }
})

const markAllSchema = z.object({ source: z.enum(NOTICE_SOURCES).optional() })

router.post('/seen', validateBody(markAllSchema), async (req, res) => {
  try {
    const affected = await markNoticesSeen(req.body.source)
    res.json({ affected })
  } catch (err) {
    log.error({ err }, 'failed to mark notices seen')
    res.status(500).json({ error: 'Failed to mark notices seen' })
  }
})

router.post('/:id/seen', async (req, res) => {
  try {
    const notice = await markNoticeSeen(req.params.id)
    if (!notice) {
      res.status(404).json({ error: 'Notice not found' })
      return
    }
    res.json(notice)
  } catch (err) {
    log.error({ err }, 'failed to mark notice seen')
    res.status(500).json({ error: 'Failed to mark notice seen' })
  }
})

export default router

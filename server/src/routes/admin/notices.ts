/** Admin HTTP API for notices (`.context/admin-notices.md`): list, unseen count, mark seen. */
import { Router } from 'express'
import { z } from 'zod'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import {
  NOTICE_SOURCES,
  countUnseenNotices,
  listNotices,
  markNoticeSeen,
  markNoticesSeen,
} from '../../services/adminNotices.js'

const router = Router()

const listQuerySchema = z.object({
  source: z.enum(NOTICE_SOURCES).optional(),
  show: z.enum(['unseen', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

router.get('/', failsWith('Failed to list notices'), validateQuery(listQuerySchema), async (req, res) => {
  const { source, show, page, limit } = req.parsedQuery! as z.infer<typeof listQuerySchema>
  const result = await listNotices({ source, unseenOnly: show === 'unseen' }, page, limit)
  res.json({ ...result, page, limit })
})

// For the sidebar badge and the dashboard
router.get('/count', failsWith('Failed to count notices'), async (_req, res) => {
  res.json(await countUnseenNotices())
})

const markAllSchema = z.object({ source: z.enum(NOTICE_SOURCES).optional() })

router.post('/seen', failsWith('Failed to mark notices seen'), validateBody(markAllSchema), async (req, res) => {
  const affected = await markNoticesSeen(req.body.source)
  res.json({ affected })
})

router.post('/:id/seen', failsWith('Failed to mark notice seen'), async (req, res) => {
  const notice = await markNoticeSeen(req.params.id)
  if (!notice) {
    res.status(404).json({ error: 'Notice not found' })
    return
  }
  res.json(notice)
})

export default router

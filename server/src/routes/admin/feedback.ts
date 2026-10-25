import { Router } from 'express'
import { z } from 'zod'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import prisma from '../../lib/prisma.js'

const router = Router()
const feedbackNotFound = { notFound: 'Feedback not found' }

const listQuerySchema = z.object({
  status: z.enum(['unread', 'read', 'archived']).optional(),
  category: z.enum(['general', 'bug', 'suggestion', 'other']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const feedbackSelect = {
  id: true,
  category: true,
  message: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const

// List feedback with filters and pagination
router.get('/', failsWith('Failed to list feedback'), validateQuery(listQuerySchema), async (req, res) => {
  const { status, category, page, limit } = req.parsedQuery!

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (category) where.category = category

  const [items, total, unreadCount] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: feedbackSelect,
    }),
    prisma.feedback.count({ where }),
    prisma.feedback.count({ where: { status: 'unread' } }),
  ])

  res.json({ items, total, page, limit, unreadCount })
})

// Get unread count (for sidebar badge)
router.get('/count', failsWith('Failed to get feedback count'), async (_req, res) => {
  const unreadCount = await prisma.feedback.count({ where: { status: 'unread' } })
  res.json({ unreadCount })
})

const updateStatusSchema = z.object({
  status: z.enum(['unread', 'read', 'archived']),
})

// Update feedback status
router.patch('/:id', failsWith('Failed to update feedback', feedbackNotFound), validateBody(updateStatusSchema), async (req, res) => {
  const feedback = await prisma.feedback.update({
    where: { id: req.params.id },
    data: { status: req.body.status },
    select: feedbackSelect,
  })
  res.json(feedback)
})

// Delete feedback
router.delete('/:id', failsWith('Failed to delete feedback', feedbackNotFound), async (req, res) => {
  await prisma.feedback.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

const bulkActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(['read', 'archived', 'delete']),
})

// Bulk actions
router.post('/bulk', failsWith('Failed to perform bulk action'), validateBody(bulkActionSchema), async (req, res) => {
  const { ids, action } = req.body

  if (action === 'delete') {
    const result = await prisma.feedback.deleteMany({ where: { id: { in: ids } } })
    res.json({ affected: result.count })
  } else {
    const result = await prisma.feedback.updateMany({
      where: { id: { in: ids } },
      data: { status: action },
    })
    res.json({ affected: result.count })
  }
})

export default router

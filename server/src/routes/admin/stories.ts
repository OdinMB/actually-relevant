import { Router } from 'express'
import * as storyService from '../../services/story.js'
import * as analysisService from '../../services/analysis.js'
import { getLifetimeStoryStats } from '../../services/storyRetention.js'
import { crawlUrl } from '../../services/crawler.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import {
  createStorySchema,
  updateStorySchema,
  updateStoryStatusSchema,
  bulkUpdateStatusSchema,
  storyQuerySchema,
  batchStoriesQuerySchema,
  preassessBodySchema,
  selectBodySchema,
  bulkStoryIdsSchema,
  bulkSelectIdsSchema,
} from '../../schemas/story.js'
import { taskRegistry } from '../../lib/taskRegistry.js'
import { allowedFrom, partition } from '../../services/storyLifecycle.js'
import { crawlUrlSchema } from '../../schemas/job.js'

// Errors: services throw ServiceErrors (404/400/409) and the global handler in app.ts answers;
// failsWith() names each route's 500 text and its Prisma not-found/duplicate text.
const router = Router()
const storyNotFound = { notFound: 'Story not found' }

router.get('/stats', failsWith('Failed to fetch story stats'), async (_req, res) => {
  res.json(await storyService.getStoryStats())
})

// Lifetime totals: live stories plus those the monthly cleanup deleted (.context/story-retention.md)
router.get('/lifetime-stats', failsWith('Failed to fetch lifetime story stats'), async (_req, res) => {
  res.json(await getLifetimeStoryStats())
})

router.get('/', failsWith('Failed to fetch stories'), validateQuery(storyQuerySchema), async (req, res) => {
  res.json(await storyService.getStories(req.parsedQuery!))
})

router.get('/batch', failsWith('Failed to fetch batch stories'), validateQuery(batchStoriesQuerySchema), async (req, res) => {
  const { ids } = req.parsedQuery!
  if (ids.length === 0) {
    res.json([])
    return
  }
  res.json(await storyService.getStoriesByIds(ids))
})

// --- Bulk task endpoints ---

function filterProcessingIds(storyIds: string[]): { filtered: string[]; skipped: string[] } {
  const processingIds = new Set(taskRegistry.getProcessingStoryIds())
  const filtered: string[] = []
  const skipped: string[] = []
  for (const id of storyIds) {
    if (processingIds.has(id)) skipped.push(id)
    else filtered.push(id)
  }
  return { filtered, skipped }
}

router.post('/bulk-preassess', failsWith('Failed to start bulk pre-assess'), expensiveOpLimiter, validateBody(bulkStoryIdsSchema), async (req, res) => {
  const { filtered, skipped } = filterProcessingIds(req.body.storyIds)
  if (filtered.length === 0) {
    res.status(409).json({ error: 'All stories are already being processed', skipped })
    return
  }
  const taskId = taskRegistry.create('preassess', filtered.length, filtered)
  analysisService.bulkPreAssess(filtered, taskId)
  res.status(202).json({ taskId, ...(skipped.length > 0 ? { skipped } : {}) })
})

router.post('/bulk-reclassify', failsWith('Failed to start bulk reclassify'), expensiveOpLimiter, validateBody(bulkStoryIdsSchema), async (req, res) => {
  const { filtered, skipped } = filterProcessingIds(req.body.storyIds)
  if (filtered.length === 0) {
    res.status(409).json({ error: 'All stories are already being processed', skipped })
    return
  }
  const taskId = taskRegistry.create('reclassify', filtered.length, filtered)
  analysisService.bulkReclassify(filtered, taskId)
  res.status(202).json({ taskId, ...(skipped.length > 0 ? { skipped } : {}) })
})

router.post('/bulk-tag-emotions', failsWith('Failed to start bulk emotion tagging'), expensiveOpLimiter, validateBody(bulkStoryIdsSchema), async (req, res) => {
  const { filtered, skipped } = filterProcessingIds(req.body.storyIds)
  if (filtered.length === 0) {
    res.status(409).json({ error: 'All stories are already being processed', skipped })
    return
  }
  const taskId = taskRegistry.create('emotion', filtered.length, filtered)
  analysisService.bulkTagEmotions(filtered, taskId)
  res.status(202).json({ taskId, ...(skipped.length > 0 ? { skipped } : {}) })
})

router.post('/bulk-assess', failsWith('Failed to start bulk assess'), expensiveOpLimiter, validateBody(bulkStoryIdsSchema), async (req, res) => {
  const { filtered, skipped } = filterProcessingIds(req.body.storyIds)
  if (filtered.length === 0) {
    res.status(409).json({ error: 'All stories are already being processed', skipped })
    return
  }
  const taskId = taskRegistry.create('assess', filtered.length, filtered)
  analysisService.bulkAssess(filtered, taskId)
  res.status(202).json({ taskId, ...(skipped.length > 0 ? { skipped } : {}) })
})

router.post('/bulk-select', failsWith('Failed to start bulk select'), expensiveOpLimiter, validateBody(bulkSelectIdsSchema), async (req, res) => {
  const { filtered, skipped } = filterProcessingIds(req.body.storyIds)
  if (filtered.length === 0) {
    res.status(409).json({ error: 'All stories are already being processed', skipped })
    return
  }
  // Selection only moves `analyzed` stories; the others come back as skipped
  const { eligible, skipped: notAnalyzed } = await partition(filtered, allowedFrom({ to: 'selected' }, 'pipeline'))
  skipped.push(...notAnalyzed.map(s => s.id))
  if (eligible.length < 2) {
    res.status(400).json({ error: 'At least 2 analyzed, non-processing story IDs are required after filtering', skipped })
    return
  }
  const taskId = taskRegistry.create('select', eligible.length, eligible)
  analysisService.bulkSelect(eligible, taskId)
  res.status(202).json({ taskId, ...(skipped.length > 0 ? { skipped } : {}) })
})

router.get('/processing', failsWith('Failed to get processing story IDs'), (_req, res) => {
  res.json({ storyIds: taskRegistry.getProcessingStoryIds() })
})

router.get('/tasks/:taskId', failsWith('Failed to get task status'), (req, res) => {
  const task = taskRegistry.get(req.params.taskId)
  if (!task) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  res.json(task)
})

router.get('/:id', failsWith('Failed to fetch story'), async (req, res) => {
  const story = await storyService.getStoryById(req.params.id)
  if (!story) {
    res.status(404).json({ error: 'Story not found' })
    return
  }
  res.json(story)
})

// A feedId naming no feed is a 400 (BadRequestError from createStory)
router.post('/', failsWith('Failed to create story', { duplicate: 'A story with this URL already exists' }), validateBody(createStorySchema), async (req, res) => {
  res.status(201).json(await storyService.createStory(req.body))
})

router.put('/:id', failsWith('Failed to update story', storyNotFound), validateBody(updateStorySchema), async (req, res) => {
  res.json(await storyService.updateStory(req.params.id, req.body))
})

router.put('/:id/status', failsWith('Failed to update story status', storyNotFound), validateBody(updateStoryStatusSchema), async (req, res) => {
  res.json(await storyService.updateStoryStatus(req.params.id, req.body.status))
})

router.post('/bulk-status', failsWith('Failed to bulk update story status'), validateBody(bulkUpdateStatusSchema), async (req, res) => {
  const result = await storyService.bulkUpdateStatus(req.body.ids, req.body.status)
  res.json({ updated: result.count })
})

router.post('/preassess', failsWith('Failed to pre-assess stories'), expensiveOpLimiter, validateBody(preassessBodySchema), async (req, res) => {
  const storyIds: string[] = req.body.storyIds && req.body.storyIds.length > 0
    ? req.body.storyIds
    : await storyService.getStoryIdsByStatus('fetched')

  if (storyIds.length === 0) {
    res.json({ processed: 0, results: [] })
    return
  }

  const results = await analysisService.preAssessStories(storyIds)
  res.json({ processed: results.length, results })
})

router.post('/:id/assess', failsWith('Failed to assess story'), expensiveOpLimiter, async (req, res) => {
  await analysisService.assessStory(req.params.id)
  res.json(await storyService.getStoryById(req.params.id))
})

router.post('/select', failsWith('Failed to select stories'), expensiveOpLimiter, validateBody(selectBodySchema), async (req, res) => {
  res.json(await analysisService.selectStories(req.body.storyIds))
})

router.post('/:id/publish', failsWith('Failed to publish story', storyNotFound), async (req, res) => {
  res.json(await storyService.publishStory(req.params.id))
})

router.post('/:id/reject', failsWith('Failed to reject story', storyNotFound), async (req, res) => {
  res.json(await storyService.rejectStory(req.params.id))
})

router.post('/:id/dissolve-cluster', failsWith('Failed to dissolve cluster', storyNotFound), async (req, res) => {
  await storyService.dissolveCluster(req.params.id)
  res.json(await storyService.getStoryById(req.params.id))
})

router.post('/crawl-url', failsWith('Failed to crawl URL'), validateBody(crawlUrlSchema), async (req, res) => {
  const result = await crawlUrl(req.body.url, req.body.feedId)
  if (!result) {
    res.status(422).json({ error: 'Could not extract content from URL' })
    return
  }
  res.status(201).json(result)
})

router.delete('/:id', failsWith('Failed to delete story', storyNotFound), async (req, res) => {
  await storyService.deleteStory(req.params.id)
  res.status(204).send()
})

export default router

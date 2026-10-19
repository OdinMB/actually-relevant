import { Router } from 'express'
import { z } from 'zod'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import * as clusterService from '../../services/cluster.js'
import { createClusterSchema, searchStoriesQuerySchema } from '../../schemas/cluster.js'

// Errors: the service throws ServiceErrors (400 for a bad request, 404 "Cluster not found",
// StoriesAlreadyClusteredError 409 with the story ids) and the global handler in app.ts answers.
const router = Router()
const clusterNotFound = { notFound: 'Cluster not found' }

const setPrimarySchema = z.object({
  storyId: z.string().uuid(),
})

const removeMemberSchema = z.object({
  storyId: z.string().uuid(),
})

const mergeSchema = z.object({
  sourceId: z.string().uuid(),
})

router.get('/search-stories', failsWith('Failed to search stories'), validateQuery(searchStoriesQuerySchema), async (req, res) => {
  const { q, limit } = req.parsedQuery!
  res.json(await clusterService.searchStoriesForCluster(q, limit))
})

router.get('/', failsWith('Failed to list clusters'), async (_req, res) => {
  res.json(await clusterService.getAllClusters())
})

router.get('/:id', failsWith('Failed to get cluster'), async (req, res) => {
  const cluster = await clusterService.getClusterById(req.params.id)
  if (!cluster) {
    res.status(404).json({ error: 'Cluster not found' })
    return
  }
  res.json(cluster)
})

router.post('/', failsWith('Failed to create cluster'), validateBody(createClusterSchema), async (req, res) => {
  const { storyIds, primaryStoryId } = req.body
  res.status(201).json(await clusterService.createManualCluster(storyIds, primaryStoryId))
})

router.put('/:id/primary', failsWith('Failed to set cluster primary', clusterNotFound), validateBody(setPrimarySchema), async (req, res) => {
  res.json(await clusterService.setClusterPrimary(req.params.id, req.body.storyId))
})

router.post('/:id/remove-member', failsWith('Failed to remove member from cluster', clusterNotFound), validateBody(removeMemberSchema), async (req, res) => {
  const cluster = await clusterService.removeFromCluster(req.params.id, req.body.storyId)
  res.json(cluster ?? { dissolved: true })
})

router.post('/:id/merge', failsWith('Failed to merge clusters'), validateBody(mergeSchema), async (req, res) => {
  res.json(await clusterService.mergeClusters(req.params.id, req.body.sourceId))
})

router.delete('/:id', failsWith('Failed to dissolve cluster'), async (req, res) => {
  await clusterService.dissolveCluster(req.params.id)
  res.status(204).send()
})

export default router

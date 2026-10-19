/**
 * The admin HTTP API of one social channel (Bluesky, Mastodon): its feed, its post records, drafts
 * from one story or the best of several, publishing, deleting and the metrics refresh. Each
 * channel's post format and API live in its service; this router is the same for every channel.
 * Mounted at /api/admin/bluesky and /api/admin/mastodon (.context/bluesky.md, .context/mastodon.md).
 *
 * Errors: the services throw NotFoundError ("Story not found", "Post not found") and
 * BadRequestError (not analyzed, already posted, not a draft, credentials missing), which the
 * global handler in app.ts answers; failsWith() names each route's 500 text.
 */
import { Router } from 'express'
import type { ZodSchema } from 'zod'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'

/** The service functions every channel exports under the same names. */
export interface SocialChannelService {
  getFeed(options: Record<string, unknown>): Promise<unknown>
  listPosts(options: Record<string, unknown>): Promise<unknown>
  getPostById(postId: string): Promise<unknown>
  generateDraft(storyId: string): Promise<unknown>
  pickAndDraft(storyIds: string[]): Promise<unknown>
  updateDraft(postId: string, postText: string): Promise<unknown>
  publishPost(postId: string): Promise<unknown>
  deletePostRecord(postId: string): Promise<unknown>
  updateMetrics(): Promise<unknown>
}

/** The channel's request schemas (the channels differ in their feed cursor). */
export interface SocialChannelSchemas {
  feedQuery: ZodSchema
  listPostsQuery: ZodSchema
  generateDraftBody: ZodSchema
  pickAndDraftBody: ZodSchema
  updateDraftBody: ZodSchema
}

export function socialChannelRouter(service: SocialChannelService, schemas: SocialChannelSchemas): Router {
  const router = Router()

  // Fetch merged API + DB feed
  router.get('/feed', failsWith('Failed to fetch feed'), validateQuery(schemas.feedQuery), async (req, res) => {
    res.json(await service.getFeed(req.parsedQuery || {}))
  })

  // List posts (paginated, filterable by status)
  router.get('/posts', failsWith('Failed to list posts'), validateQuery(schemas.listPostsQuery), async (req, res) => {
    res.json(await service.listPosts(req.parsedQuery || {}))
  })

  // Get single post
  router.get('/posts/:id', failsWith('Failed to get post'), async (req, res) => {
    const post = await service.getPostById(req.params.id)
    if (!post) {
      res.status(404).json({ error: 'Post not found' })
      return
    }
    res.json(post)
  })

  // Generate draft from a single story
  router.post('/posts/generate', failsWith('Failed to generate draft'), expensiveOpLimiter, validateBody(schemas.generateDraftBody), async (req, res) => {
    res.status(201).json(await service.generateDraft(req.body.storyId))
  })

  // Pick best from multiple stories and generate draft
  router.post('/posts/pick-and-draft', failsWith('Failed to pick and draft post'), expensiveOpLimiter, validateBody(schemas.pickAndDraftBody), async (req, res) => {
    res.status(201).json(await service.pickAndDraft(req.body.storyIds))
  })

  // Update draft text
  router.put('/posts/:id', failsWith('Failed to update draft'), validateBody(schemas.updateDraftBody), async (req, res) => {
    res.json(await service.updateDraft(req.params.id, req.body.postText))
  })

  // Publish draft to the channel
  router.post('/posts/:id/publish', failsWith('Failed to publish post'), expensiveOpLimiter, async (req, res) => {
    res.json(await service.publishPost(req.params.id))
  })

  // Delete post (draft or published)
  router.delete('/posts/:id', failsWith('Failed to delete post'), async (req, res) => {
    await service.deletePostRecord(req.params.id)
    res.status(204).send()
  })

  // Manually trigger metrics refresh
  router.post('/metrics/refresh', failsWith('Failed to refresh metrics'), expensiveOpLimiter, async (_req, res) => {
    await service.updateMetrics()
    res.json({ success: true })
  })

  return router
}

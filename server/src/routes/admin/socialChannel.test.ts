import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

function mockChannelService() {
  return {
    getFeed: vi.fn(),
    listPosts: vi.fn(),
    getPostById: vi.fn(),
    generateDraft: vi.fn(),
    pickAndDraft: vi.fn(),
    updateDraft: vi.fn(),
    publishPost: vi.fn(),
    deletePostRecord: vi.fn(),
    updateMetrics: vi.fn(),
  }
}

const mockBluesky = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>)
const mockMastodon = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>)
vi.mock('../../services/bluesky.js', () => mockBluesky)
vi.mock('../../services/mastodon.js', () => mockMastodon)
vi.mock('../../lib/prisma.js', () => ({ default: { $disconnect: vi.fn() } }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))

Object.assign(mockBluesky, mockChannelService())
Object.assign(mockMastodon, mockChannelService())

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')
const { BadRequestError, NotFoundError } = await import('../../utils/errors.js')

const STORY_1 = '00000000-0000-4000-8000-000000000001'
const STORY_2 = '00000000-0000-4000-8000-000000000002'

describe.each([
  ['bluesky', mockBluesky, 'Bluesky'],
  ['mastodon', mockMastodon, 'Mastodon'],
] as const)('Admin %s API', (channel, service, name) => {
  const base = `/api/admin/${channel}`

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires auth', async () => {
    const res = await request(app).get(`${base}/posts`)
    expect(res.status).toBe(401)
  })

  describe('GET /feed and /posts', () => {
    it('passes the parsed query to the service', async () => {
      service.listPosts.mockResolvedValue({ items: [], total: 0 })
      const res = await request(app).get(`${base}/posts?status=draft&page=2&limit=10`).set(authHeader())
      expect(res.status).toBe(200)
      expect(service.listPosts).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft', page: 2, limit: 10 }))
    })

    it('answers 500 with the route text when the feed fails', async () => {
      service.getFeed.mockRejectedValue(new Error('API down'))
      const res = await request(app).get(`${base}/feed`).set(authHeader())
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to fetch feed' })
    })
  })

  describe('GET /posts/:id', () => {
    it('returns the post', async () => {
      service.getPostById.mockResolvedValue({ id: 'p1' })
      const res = await request(app).get(`${base}/posts/p1`).set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ id: 'p1' })
    })

    it('answers 404 for an unknown post', async () => {
      service.getPostById.mockResolvedValue(null)
      const res = await request(app).get(`${base}/posts/nope`).set(authHeader())
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Post not found' })
    })
  })

  describe('POST /posts/generate', () => {
    it('creates a draft (201)', async () => {
      service.generateDraft.mockResolvedValue({ id: 'p1', status: 'draft' })
      const res = await request(app).post(`${base}/posts/generate`).set(authHeader()).send({ storyId: STORY_1 })
      expect(res.status).toBe(201)
      expect(service.generateDraft).toHaveBeenCalledWith(STORY_1)
    })

    it('answers 400 for a body without a story id', async () => {
      const res = await request(app).post(`${base}/posts/generate`).set(authHeader()).send({})
      expect(res.status).toBe(400)
      expect(service.generateDraft).not.toHaveBeenCalled()
    })

    it.each([
      [new NotFoundError('Story not found'), 404],
      [new BadRequestError('Story must be fully analyzed (title and summary required)'), 400],
      [new BadRequestError(`Story already has a ${name} post`), 400],
    ])('answers the service refusal %s', async (err, status) => {
      service.generateDraft.mockRejectedValue(err)
      const res = await request(app).post(`${base}/posts/generate`).set(authHeader()).send({ storyId: STORY_1 })
      expect(res.status).toBe(status)
      expect(res.body).toEqual({ error: err.message })
    })

    it('answers 500 with the route text on an unexpected failure', async () => {
      service.generateDraft.mockRejectedValue(new Error('model down'))
      const res = await request(app).post(`${base}/posts/generate`).set(authHeader()).send({ storyId: STORY_1 })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to generate draft' })
    })
  })

  describe('POST /posts/pick-and-draft', () => {
    it('picks and drafts (201)', async () => {
      service.pickAndDraft.mockResolvedValue({ post: { id: 'p1' }, reasoning: 'r' })
      const res = await request(app).post(`${base}/posts/pick-and-draft`).set(authHeader()).send({ storyIds: [STORY_1, STORY_2] })
      expect(res.status).toBe(201)
      expect(service.pickAndDraft).toHaveBeenCalledWith([STORY_1, STORY_2])
    })

    it('answers 400 when no story can be drafted', async () => {
      service.pickAndDraft.mockRejectedValue(new BadRequestError('No stories found'))
      const res = await request(app).post(`${base}/posts/pick-and-draft`).set(authHeader()).send({ storyIds: [STORY_1, STORY_2] })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'No stories found' })
    })
  })

  describe('PUT /posts/:id', () => {
    it('updates the draft text', async () => {
      service.updateDraft.mockResolvedValue({ id: 'p1', postText: 'new' })
      const res = await request(app).put(`${base}/posts/p1`).set(authHeader()).send({ postText: 'new' })
      expect(res.status).toBe(200)
      expect(service.updateDraft).toHaveBeenCalledWith('p1', 'new')
    })

    it.each([
      [new NotFoundError('Post not found'), 404],
      [new BadRequestError('Can only edit draft posts'), 400],
    ])('answers the service refusal %s', async (err, status) => {
      service.updateDraft.mockRejectedValue(err)
      const res = await request(app).put(`${base}/posts/p1`).set(authHeader()).send({ postText: 'new' })
      expect(res.status).toBe(status)
      expect(res.body).toEqual({ error: err.message })
    })
  })

  describe('POST /posts/:id/publish', () => {
    it('publishes the draft', async () => {
      service.publishPost.mockResolvedValue({ id: 'p1', status: 'published' })
      const res = await request(app).post(`${base}/posts/p1/publish`).set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('published')
    })

    it.each([
      [new NotFoundError('Post not found'), 404],
      [new BadRequestError('Can only publish draft posts'), 400],
      [new BadRequestError(`${name} credentials not configured`), 400],
    ])('answers the service refusal %s', async (err, status) => {
      service.publishPost.mockRejectedValue(err)
      const res = await request(app).post(`${base}/posts/p1/publish`).set(authHeader())
      expect(res.status).toBe(status)
      expect(res.body).toEqual({ error: err.message })
    })

    it('answers 500 with the route text when the network call fails', async () => {
      service.publishPost.mockRejectedValue(new Error('ECONNRESET'))
      const res = await request(app).post(`${base}/posts/p1/publish`).set(authHeader())
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to publish post' })
    })
  })

  describe('DELETE /posts/:id', () => {
    it('deletes the record (204)', async () => {
      service.deletePostRecord.mockResolvedValue(undefined)
      const res = await request(app).delete(`${base}/posts/p1`).set(authHeader())
      expect(res.status).toBe(204)
    })

    it('answers 404 for an unknown post', async () => {
      service.deletePostRecord.mockRejectedValue(new NotFoundError('Post not found'))
      const res = await request(app).delete(`${base}/posts/p1`).set(authHeader())
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Post not found' })
    })
  })

  describe('POST /metrics/refresh', () => {
    it('refreshes the metrics', async () => {
      service.updateMetrics.mockResolvedValue(undefined)
      const res = await request(app).post(`${base}/metrics/refresh`).set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: true })
      expect(service.updateMetrics).toHaveBeenCalledTimes(1)
    })

    it('answers 500 with the route text on failure', async () => {
      service.updateMetrics.mockRejectedValue(new Error('API down'))
      const res = await request(app).post(`${base}/metrics/refresh`).set(authHeader())
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to refresh metrics' })
    })
  })

  it('calls only its own channel service', async () => {
    const other = service === mockBluesky ? mockMastodon : mockBluesky
    service.updateMetrics.mockResolvedValue(undefined)
    await request(app).post(`${base}/metrics/refresh`).set(authHeader())
    expect(other.updateMetrics).not.toHaveBeenCalled()
  })
})

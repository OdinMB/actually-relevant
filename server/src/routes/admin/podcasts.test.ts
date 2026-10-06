import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, samplePodcast, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

const mockPrisma = vi.hoisted(() => ({
  podcast: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  $disconnect: vi.fn(),
}))
const mockWeekly = vi.hoisted(() => ({
  findOrCreateWeekEpisode: vi.fn(),
  runWeeklyEpisode: vi.fn(),
  resumeEpisode: vi.fn(),
}))

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/podcastWeekly.js', () => mockWeekly)
vi.mock('../../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')

describe('Admin Podcasts API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWeekly.runWeeklyEpisode.mockResolvedValue({ outcome: 'done', podcastId: 'podcast-1' })
    mockWeekly.resumeEpisode.mockResolvedValue({ outcome: 'done', podcastId: 'podcast-1' })
  })

  describe('GET /api/admin/podcasts', () => {
    it('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/admin/podcasts')
      expect(res.status).toBe(401)
    })

    it('returns paginated podcasts with their progress flag', async () => {
      mockPrisma.podcast.findMany.mockResolvedValue([samplePodcast(), samplePodcast({ id: 'podcast-2', leaseUntil: new Date(Date.now() + 60_000) })])
      mockPrisma.podcast.count.mockResolvedValue(2)

      const res = await request(app).get('/api/admin/podcasts').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body.data.map((p: { inProgress: boolean }) => p.inProgress)).toEqual([false, true])
      expect(res.body.total).toBe(2)
    })

    it('filters by stage', async () => {
      mockPrisma.podcast.findMany.mockResolvedValue([])
      mockPrisma.podcast.count.mockResolvedValue(0)

      const res = await request(app).get('/api/admin/podcasts?stage=scripted').set(authHeader())
      expect(res.status).toBe(200)
      expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stage: 'scripted' } }))
    })

    it('rejects an unknown stage', async () => {
      const res = await request(app).get('/api/admin/podcasts?stage=done').set(authHeader())
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/admin/podcasts/:id', () => {
    it('returns a single podcast', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast())
      const res = await request(app).get('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Episode #1')
    })

    it('returns 404 for unknown podcast', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(null)
      const res = await request(app).get('/api/admin/podcasts/unknown').set(authHeader())
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/admin/podcasts/weekly', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/api/admin/podcasts/weekly')
      expect(res.status).toBe(401)
      expect(mockWeekly.runWeeklyEpisode).not.toHaveBeenCalled()
    })

    it('answers 202 with the week\'s row and starts the run in the background', async () => {
      mockWeekly.findOrCreateWeekEpisode.mockResolvedValue(samplePodcast({ weekKey: '2026-W41' }))
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ weekKey: '2026-W41' }))

      const res = await request(app).post('/api/admin/podcasts/weekly').set(authHeader())
      expect(res.status).toBe(202)
      expect(res.body.weekKey).toBe('2026-W41')
      expect(mockWeekly.runWeeklyEpisode).toHaveBeenCalledWith({ trigger: 'admin' })
    })

    it('still answers when the background run fails', async () => {
      mockWeekly.findOrCreateWeekEpisode.mockResolvedValue(samplePodcast())
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast())
      mockWeekly.runWeeklyEpisode.mockRejectedValue(new Error('boom'))

      const res = await request(app).post('/api/admin/podcasts/weekly').set(authHeader())
      expect(res.status).toBe(202)
    })
  })

  describe('POST /api/admin/podcasts/:id/resume', () => {
    it('answers 202 and resumes the episode in the background', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast())
      const res = await request(app).post('/api/admin/podcasts/podcast-1/resume').set(authHeader())
      expect(res.status).toBe(202)
      expect(mockWeekly.resumeEpisode).toHaveBeenCalledWith('podcast-1')
    })

    it('returns 404 for an unknown podcast', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(null)
      const res = await request(app).post('/api/admin/podcasts/unknown/resume').set(authHeader())
      expect(res.status).toBe(404)
      expect(mockWeekly.resumeEpisode).not.toHaveBeenCalled()
    })

    it('refuses a legacy episode', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ stage: 'legacy' }))
      const res = await request(app).post('/api/admin/podcasts/podcast-1/resume').set(authHeader())
      expect(res.status).toBe(409)
      expect(mockWeekly.resumeEpisode).not.toHaveBeenCalled()
    })
  })

  describe('PUT /api/admin/podcasts/:id', () => {
    it('updates the title', async () => {
      mockPrisma.podcast.update.mockResolvedValue(samplePodcast({ title: 'Updated' }))
      const res = await request(app).put('/api/admin/podcasts/podcast-1').set(authHeader()).send({ title: 'Updated' })
      expect(res.status).toBe(200)
      expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'podcast-1' }, data: { title: 'Updated' } })
    })

    it('rejects status and script', async () => {
      const status = await request(app).put('/api/admin/podcasts/podcast-1').set(authHeader()).send({ title: 'T', status: 'published' })
      expect(status.status).toBe(400)
      const script = await request(app).put('/api/admin/podcasts/podcast-1').set(authHeader()).send({ title: 'T', script: 'x' })
      expect(script.status).toBe(400)
      expect(mockPrisma.podcast.update).not.toHaveBeenCalled()
    })

    it('returns 404 for unknown podcast', async () => {
      mockPrisma.podcast.update.mockRejectedValue({ code: 'P2025' })
      const res = await request(app).put('/api/admin/podcasts/unknown').set(authHeader()).send({ title: 'Test' })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/admin/podcasts/:id', () => {
    it('deletes a podcast', async () => {
      mockPrisma.podcast.delete.mockResolvedValue(samplePodcast())
      const res = await request(app).delete('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(204)
    })

    it('returns 404 for unknown podcast', async () => {
      mockPrisma.podcast.delete.mockRejectedValue({ code: 'P2025' })
      const res = await request(app).delete('/api/admin/podcasts/unknown').set(authHeader())
      expect(res.status).toBe(404)
    })
  })
})

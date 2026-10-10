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
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  podcastAudioChunk: { count: vi.fn() },
  podcastTtsUsage: { aggregate: vi.fn() },
  $executeRaw: vi.fn(),
  $disconnect: vi.fn(),
}))
const mockWeekly = vi.hoisted(() => ({
  findOrCreateWeekEpisode: vi.fn(),
  startAdminRun: vi.fn(),
  resumeEpisode: vi.fn(),
}))
const mockWeekSlot = vi.hoisted(() => ({ getWeekSlot: vi.fn() }))
const mockPipeline = vi.hoisted(() => ({ rewindEpisode: vi.fn() }))
const mockEditing = vi.hoisted(() => ({
  getEpisodeStoryPool: vi.fn(),
  replaceEpisodeStories: vi.fn(),
  saveEpisodeScript: vi.fn(),
  updateEpisodeMeta: vi.fn(),
}))
const mockBunny = vi.hoisted(() => ({ deleteObject: vi.fn(), putObject: vi.fn(), isBunnyConfigured: vi.fn(), publicUrl: vi.fn() }))
const mockPublish = vi.hoisted(() => ({ publishEpisode: vi.fn(), unpublishEpisode: vi.fn() }))
const mockStandalone = vi.hoisted(() => ({
  createStandaloneEpisode: vi.fn(),
  searchStandaloneStories: vi.fn(),
  suggestStandaloneStories: vi.fn(),
  saveStandaloneStories: vi.fn(),
}))

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/podcastWeekly.js', () => mockWeekly)
vi.mock('../../services/podcastWeekSlot.js', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/podcastWeekSlot.js')>()), ...mockWeekSlot }))
vi.mock('../../services/podcastPipeline.js', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/podcastPipeline.js')>()), ...mockPipeline }))
vi.mock('../../services/podcastEditing.js', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/podcastEditing.js')>()), ...mockEditing }))
vi.mock('../../lib/bunnyStorage.js', () => mockBunny)
vi.mock('../../services/podcastStandalone.js', () => mockStandalone)
vi.mock('../../services/podcastPublish.js', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/podcastPublish.js')>()), ...mockPublish }))
vi.mock('../../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')
const { PodcastRefusedError } = await import('../../services/podcastGuards.js')
const { PodcastEditRejectedError } = await import('../../services/podcastEditing.js')

describe('Admin Podcasts API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWeekly.startAdminRun.mockResolvedValue(undefined)
    mockWeekly.resumeEpisode.mockResolvedValue({ outcome: 'done', podcastId: 'podcast-1' })
    mockPrisma.podcastTtsUsage.aggregate.mockResolvedValue({ _sum: { chars: 5400 } })
    mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast())
    mockPrisma.podcast.findUniqueOrThrow.mockImplementation(() => mockPrisma.podcast.findUnique())
    mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$executeRaw.mockResolvedValue(1)
    mockBunny.deleteObject.mockResolvedValue(undefined)
  })

  describe('GET /api/admin/podcasts', () => {
    it('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/admin/podcasts')
      expect(res.status).toBe(401)
    })

    it('returns paginated podcasts with their progress and review flags', async () => {
      mockPrisma.podcast.findMany.mockResolvedValue([
        samplePodcast({ mode: 'interactive', stage: 'selected' }),
        samplePodcast({ id: 'podcast-2', leaseUntil: new Date(Date.now() + 60_000) }),
      ])
      mockPrisma.podcast.count.mockResolvedValue(2)

      const res = await request(app).get('/api/admin/podcasts').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body.data.map((p: { inProgress: boolean }) => p.inProgress)).toEqual([false, true])
      expect(res.body.data.map((p: { awaitingReview: boolean }) => p.awaitingReview)).toEqual([true, false])
      expect(res.body.total).toBe(2)
    })

    it('filters by stage, the new selected stage included', async () => {
      mockPrisma.podcast.findMany.mockResolvedValue([])
      mockPrisma.podcast.count.mockResolvedValue(0)

      const res = await request(app).get('/api/admin/podcasts?stage=selected').set(authHeader())
      expect(res.status).toBe(200)
      expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stage: 'selected' } }))
    })

    it('rejects an unknown stage', async () => {
      const res = await request(app).get('/api/admin/podcasts?stage=done').set(authHeader())
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/admin/podcasts/:id', () => {
    it('returns a single podcast', async () => {
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

  describe('GET /api/admin/podcasts/active', () => {
    it('is routed before /:id and lists the running episodes', async () => {
      mockPrisma.podcast.findMany.mockResolvedValue([{ id: 'podcast-1', title: 'W41: x', stage: 'created', mode: 'interactive', dialogue: null }])
      const res = await request(app).get('/api/admin/podcasts/active').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body).toEqual([{ id: 'podcast-1', title: 'W41: x', stage: 'created', mode: 'interactive', activity: 'Selecting stories', chunksDone: null, chunksTotal: null }])
      expect(mockPrisma.podcast.findUnique).not.toHaveBeenCalled()
    })

    it('requires auth', async () => {
      expect((await request(app).get('/api/admin/podcasts/active')).status).toBe(401)
    })
  })

  describe('GET /api/admin/podcasts/weekly', () => {
    const slot = { weekKey: '2026-W41', episode: null, fridayRun: 'create', fridayWindow: 'ahead', automaticRunEnabled: true }

    it('requires auth', async () => {
      expect((await request(app).get('/api/admin/podcasts/weekly')).status).toBe(401)
      expect(mockWeekSlot.getWeekSlot).not.toHaveBeenCalled()
    })

    it('is routed before /:id and reads the slot without creating the week\'s row', async () => {
      mockWeekSlot.getWeekSlot.mockResolvedValue(slot)
      const res = await request(app).get('/api/admin/podcasts/weekly').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body).toEqual(slot)
      expect(mockWeekly.findOrCreateWeekEpisode).not.toHaveBeenCalled()
      expect(mockPrisma.podcast.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'weekly' } }))
    })

    it('answers 500 when the slot cannot be read', async () => {
      mockWeekSlot.getWeekSlot.mockRejectedValue(new Error('db down'))
      expect((await request(app).get('/api/admin/podcasts/weekly').set(authHeader())).status).toBe(500)
    })
  })

  describe('POST /api/admin/podcasts/weekly', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/api/admin/podcasts/weekly')
      expect(res.status).toBe(401)
      expect(mockWeekly.findOrCreateWeekEpisode).not.toHaveBeenCalled()
    })

    it('finds or creates the week\'s row and starts nothing', async () => {
      mockWeekly.findOrCreateWeekEpisode.mockResolvedValue(samplePodcast({ weekKey: '2026-W41' }))
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ weekKey: '2026-W41' }))

      const res = await request(app).post('/api/admin/podcasts/weekly').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body.weekKey).toBe('2026-W41')
      expect(mockWeekly.startAdminRun).not.toHaveBeenCalled()
      expect(mockWeekly.resumeEpisode).not.toHaveBeenCalled()
    })
  })

  describe('standalone episodes', () => {
    it('POST /standalone creates the row and answers 201 with the episode', async () => {
      mockStandalone.createStandaloneEpisode.mockResolvedValue(samplePodcast({ kind: 'standalone' }))
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ kind: 'standalone' }))
      const res = await request(app).post('/api/admin/podcasts/standalone').set(authHeader())
      expect(res.status).toBe(201)
      expect(res.body.kind).toBe('standalone')
      expect(mockWeekly.startAdminRun).not.toHaveBeenCalled()
    })

    it('GET /story-search is routed before /:id and passes the parsed filters', async () => {
      mockStandalone.searchStandaloneStories.mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10, totalPages: 0 })
      const res = await request(app).get('/api/admin/podcasts/story-search?search=water&page=2&pageSize=10&crawledAfter=2026-09-01T00:00:00.000Z').set(authHeader())
      expect(res.status).toBe(200)
      expect(mockStandalone.searchStandaloneStories).toHaveBeenCalledWith({ search: 'water', page: 2, pageSize: 10, crawledAfter: '2026-09-01T00:00:00.000Z' })
      expect(mockPrisma.podcast.findUnique).not.toHaveBeenCalled()
    })

    it('GET /story-search rejects a bad date and a page over 50', async () => {
      expect((await request(app).get('/api/admin/podcasts/story-search?crawledAfter=yesterday').set(authHeader())).status).toBe(400)
      expect((await request(app).get('/api/admin/podcasts/story-search?pageSize=51').set(authHeader())).status).toBe(400)
      expect(mockStandalone.searchStandaloneStories).not.toHaveBeenCalled()
    })

    it('POST /:id/suggest-stories returns the stories, and maps a refusal to 409 and too few matches to 422', async () => {
      mockStandalone.suggestStandaloneStories.mockResolvedValueOnce([{ id: 'story-1' }])
      const ok = await request(app).post('/api/admin/podcasts/podcast-1/suggest-stories').set(authHeader()).send({ issueId: 'issue-1' })
      expect(ok.status).toBe(200)
      expect(ok.body).toEqual({ stories: [{ id: 'story-1' }] })
      expect(mockStandalone.suggestStandaloneStories).toHaveBeenCalledWith('podcast-1', { issueId: 'issue-1' })

      mockStandalone.suggestStandaloneStories.mockRejectedValueOnce(new PodcastRefusedError('only a standalone episode'))
      expect((await request(app).post('/api/admin/podcasts/podcast-1/suggest-stories').set(authHeader()).send({})).status).toBe(409)
      mockStandalone.suggestStandaloneStories.mockRejectedValueOnce(new PodcastEditRejectedError(['only 2 stories match the filters']))
      const tooFew = await request(app).post('/api/admin/podcasts/podcast-1/suggest-stories').set(authHeader()).send({})
      expect(tooFew.status).toBe(422)
      expect(tooFew.body.errors).toEqual(['only 2 stories match the filters'])
    })

    it('PUT /:id/stories saves a standalone episode\'s stories through the standalone path', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ kind: 'standalone' }))
      const storyIds = ['s1', 's2', 's3', 's4']
      const res = await request(app).put('/api/admin/podcasts/podcast-1/stories').set(authHeader()).send({ storyIds })
      expect(res.status).toBe(200)
      expect(mockStandalone.saveStandaloneStories).toHaveBeenCalledWith('podcast-1', storyIds)
      expect(mockEditing.replaceEpisodeStories).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/podcasts/:id/resume', () => {
    it('claims the lease (with the given mode) before its 202, then runs in the background', async () => {
      const res = await request(app).post('/api/admin/podcasts/podcast-1/resume').set(authHeader()).send({ mode: 'interactive' })
      expect(res.status).toBe(202)
      expect(mockWeekly.startAdminRun).toHaveBeenCalledWith('podcast-1', { mode: 'interactive' })
      expect(mockWeekly.startAdminRun.mock.invocationCallOrder[0]).toBeLessThan(mockWeekly.resumeEpisode.mock.invocationCallOrder[0])
      expect(mockWeekly.resumeEpisode).toHaveBeenCalledWith('podcast-1')
    })

    it('accepts no body (continue in the episode\'s own mode)', async () => {
      const res = await request(app).post('/api/admin/podcasts/podcast-1/resume').set(authHeader())
      expect(res.status).toBe(202)
      expect(mockWeekly.startAdminRun).toHaveBeenCalledWith('podcast-1', { mode: undefined })
    })

    it('answers 409 when the lease is held or no mode is chosen, and runs nothing', async () => {
      mockWeekly.startAdminRun.mockRejectedValueOnce(new PodcastRefusedError('the episode is in progress'))
      const res = await request(app).post('/api/admin/podcasts/podcast-1/resume').set(authHeader())
      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/in progress/)
      expect(mockWeekly.resumeEpisode).not.toHaveBeenCalled()
    })

    it('rejects an unknown mode', async () => {
      const res = await request(app).post('/api/admin/podcasts/podcast-1/resume').set(authHeader()).send({ mode: 'turbo' })
      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown podcast', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(null)
      const res = await request(app).post('/api/admin/podcasts/unknown/resume').set(authHeader())
      expect(res.status).toBe(404)
      expect(mockWeekly.startAdminRun).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/podcasts/:id/rewind', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/api/admin/podcasts/podcast-1/rewind').send({ to: 'scripted', advance: true })
      expect(res.status).toBe(401)
    })

    it('with advance claims the lease and rewinds before its 202, then continues in the background', async () => {
      const res = await request(app).post('/api/admin/podcasts/podcast-1/rewind').set(authHeader()).send({ to: 'scripted', advance: true })
      expect(res.status).toBe(202)
      expect(mockWeekly.startAdminRun).toHaveBeenCalledWith('podcast-1', { rewindTo: 'scripted' })
      expect(mockWeekly.resumeEpisode).toHaveBeenCalledWith('podcast-1')
    })

    it('with advance answers 409 when the lease is held', async () => {
      mockWeekly.startAdminRun.mockRejectedValueOnce(new PodcastRefusedError('the episode is in progress'))
      const res = await request(app).post('/api/admin/podcasts/podcast-1/rewind').set(authHeader()).send({ to: 'selected', advance: true })
      expect(res.status).toBe(409)
      expect(mockWeekly.resumeEpisode).not.toHaveBeenCalled()
    })

    it('without advance rewinds, makes the episode interactive and answers 200', async () => {
      const res = await request(app).post('/api/admin/podcasts/podcast-1/rewind').set(authHeader()).send({ to: 'scripted', advance: false })
      expect(res.status).toBe(200)
      expect(mockPipeline.rewindEpisode).toHaveBeenCalledWith('podcast-1', 'scripted', { dryRun: expect.any(Boolean), mode: 'interactive' })
      expect(mockWeekly.resumeEpisode).not.toHaveBeenCalled()
    })

    it('maps a refused rewind (published, wrong stage) to 409', async () => {
      mockPipeline.rewindEpisode.mockRejectedValueOnce(new PodcastRefusedError('a published episode cannot be changed'))
      const res = await request(app).post('/api/admin/podcasts/podcast-1/rewind').set(authHeader()).send({ to: 'selected', advance: false })
      expect(res.status).toBe(409)
    })

    it('rejects a target that is not a rewind stage', async () => {
      const res = await request(app).post('/api/admin/podcasts/podcast-1/rewind').set(authHeader()).send({ to: 'ready', advance: true })
      expect(res.status).toBe(400)
    })
  })

  describe('story pool and stories', () => {
    it('lists the pool for the episode', async () => {
      mockEditing.getEpisodeStoryPool.mockResolvedValue({ stories: [], minStories: 4, maxStories: 5 })
      const res = await request(app).get('/api/admin/podcasts/podcast-1/story-pool').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ stories: [], minStories: 4, maxStories: 5 })
    })

    it('saves the stories and maps content errors to 422 and state refusals to 409', async () => {
      const ok = await request(app).put('/api/admin/podcasts/podcast-1/stories').set(authHeader()).send({ storyIds: ['a', 'b', 'c', 'd'] })
      expect(ok.status).toBe(200)
      expect(mockEditing.replaceEpisodeStories).toHaveBeenCalledWith('podcast-1', ['a', 'b', 'c', 'd'])

      mockEditing.replaceEpisodeStories.mockRejectedValueOnce(new PodcastEditRejectedError(['an episode has 4 to 5 stories; 3 chosen']))
      const content = await request(app).put('/api/admin/podcasts/podcast-1/stories').set(authHeader()).send({ storyIds: ['a', 'b', 'c'] })
      expect(content.status).toBe(422)
      expect(content.body.errors).toEqual(['an episode has 4 to 5 stories; 3 chosen'])

      mockEditing.replaceEpisodeStories.mockRejectedValueOnce(new PodcastRefusedError('the episode is in progress and cannot be edited'))
      const busy = await request(app).put('/api/admin/podcasts/podcast-1/stories').set(authHeader()).send({ storyIds: ['a', 'b', 'c', 'd'] })
      expect(busy.status).toBe(409)
    })
  })

  describe('PUT /api/admin/podcasts/:id/script', () => {
    const edit = { episodeSummary: 'S', segments: [{ kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Hi.' }] }] }

    it('returns the episode and the warnings on a save', async () => {
      mockEditing.saveEpisodeScript.mockResolvedValue({ warnings: ['segment 3 (story 2): the first turn must carry a spoken bridge'] })
      const res = await request(app).put('/api/admin/podcasts/podcast-1/script').set(authHeader()).send(edit)
      expect(res.status).toBe(200)
      expect(res.body.warnings).toHaveLength(1)
      expect(res.body.podcast.id).toBe('podcast-1')
    })

    it('maps content errors to 422 with the errors and warnings', async () => {
      mockEditing.saveEpisodeScript.mockRejectedValueOnce(new PodcastEditRejectedError(['contains a URL'], ['short bridge']))
      const res = await request(app).put('/api/admin/podcasts/podcast-1/script').set(authHeader()).send(edit)
      expect(res.status).toBe(422)
      expect(res.body).toMatchObject({ errors: ['contains a URL'], warnings: ['short bridge'] })
    })

    it('rejects an edit that changes a speaker to an unknown one', async () => {
      const bad = { ...edit, segments: [{ ...edit.segments[0], turns: [{ speaker: 'HOST_C', text: 'Hi.' }] }] }
      const res = await request(app).put('/api/admin/podcasts/podcast-1/script').set(authHeader()).send(bad)
      expect(res.status).toBe(400)
      expect(mockEditing.saveEpisodeScript).not.toHaveBeenCalled()
    })
  })

  describe('PUT /api/admin/podcasts/:id', () => {
    it('updates the title and the "edited by a person" flag', async () => {
      const res = await request(app).put('/api/admin/podcasts/podcast-1').set(authHeader()).send({ title: 'Updated', humanEdited: true })
      expect(res.status).toBe(200)
      expect(mockEditing.updateEpisodeMeta).toHaveBeenCalledWith('podcast-1', { title: 'Updated', humanEdited: true })
    })

    it('rejects status, script and an empty body', async () => {
      for (const body of [{ title: 'T', status: 'published' }, { title: 'T', script: 'x' }, {}]) {
        const res = await request(app).put('/api/admin/podcasts/podcast-1').set(authHeader()).send(body)
        expect(res.status).toBe(400)
      }
      expect(mockEditing.updateEpisodeMeta).not.toHaveBeenCalled()
    })

    it('returns 404 for unknown podcast', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(null)
      const res = await request(app).put('/api/admin/podcasts/unknown').set(authHeader()).send({ title: 'Test' })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/admin/podcasts/usage', () => {
    it('returns the month to date, the cap and a typical episode for the cost confirmation', async () => {
      const res = await request(app).get('/api/admin/podcasts/usage').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        monthToDateChars: 5400,
        monthlyCap: expect.any(Number),
        typicalEpisodeChars: expect.any(Number),
        maxEpisodeChars: expect.any(Number),
      })
    })

    it('requires auth', async () => {
      const res = await request(app).get('/api/admin/podcasts/usage')
      expect(res.status).toBe(401)
    })
  })

  describe('DELETE /api/admin/podcasts/:id', () => {
    it('deletes an unpublished podcast and its stored audio', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ stage: 'ready', audioPath: 'episodes/a.mp3', transcriptPath: 'episodes/a.vtt' }))
      mockPrisma.podcast.delete.mockResolvedValue(samplePodcast())
      const res = await request(app).delete('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(204)
      expect(mockBunny.deleteObject.mock.calls.map(c => c[0])).toEqual(['episodes/a.mp3', 'episodes/a.vtt'])
    })

    it('refuses a published episode with 409', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ stage: 'ready', status: 'published' }))
      const res = await request(app).delete('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(409)
      expect(mockPrisma.podcast.delete).not.toHaveBeenCalled()
    })

    it('refuses with 409 while a run or a publish holds the episode, one that started after the page loaded included', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ stage: 'ready', audioPath: 'episodes/a.mp3' }))
      mockPrisma.$executeRaw.mockResolvedValue(0)
      const res = await request(app).delete('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(409)
      expect(mockPrisma.podcast.delete).not.toHaveBeenCalled()
      expect(mockBunny.deleteObject).not.toHaveBeenCalled()
    })

    it('deletes a published legacy row', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ stage: 'legacy', status: 'published' }))
      mockPrisma.podcast.delete.mockResolvedValue(samplePodcast())
      const res = await request(app).delete('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(204)
    })

    it('returns 404 for unknown podcast', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(null)
      const res = await request(app).delete('/api/admin/podcasts/unknown').set(authHeader())
      expect(res.status).toBe(404)
    })

    it('refuses an episode that was published and then taken down', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ stage: 'ready', status: 'draft', publishedAt: new Date(), unpublishedAt: new Date() }))
      const res = await request(app).delete('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(409)
      expect(mockPrisma.podcast.delete).not.toHaveBeenCalled()
    })

    it('refuses with 409 and keeps the audio when the episode was published before the lease was taken', async () => {
      mockPrisma.podcast.findUnique.mockResolvedValue(samplePodcast({ stage: 'ready', audioPath: 'episodes/a.mp3' }))
      mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue(samplePodcast({ stage: 'ready', audioPath: 'episodes/a.mp3', status: 'published', publishedAt: new Date() }))
      const res = await request(app).delete('/api/admin/podcasts/podcast-1').set(authHeader())
      expect(res.status).toBe(409)
      expect(mockPrisma.podcast.delete).not.toHaveBeenCalled()
      expect(mockBunny.deleteObject).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/podcasts/:id/publish and /unpublish', () => {
    it('require auth', async () => {
      expect((await request(app).post('/api/admin/podcasts/podcast-1/publish')).status).toBe(401)
      expect((await request(app).post('/api/admin/podcasts/podcast-1/unpublish')).status).toBe(401)
    })

    it('publishes and returns the episode', async () => {
      mockPublish.publishEpisode.mockResolvedValue(undefined)
      const res = await request(app).post('/api/admin/podcasts/podcast-1/publish').set(authHeader())
      expect(res.status).toBe(200)
      expect(mockPublish.publishEpisode).toHaveBeenCalledWith('podcast-1')
      expect(res.body.id).toBe('podcast-1')
    })

    it('maps a publish refusal to 409', async () => {
      mockPublish.publishEpisode.mockRejectedValue(new PodcastRefusedError('a dry-run episode (silent stub voice) cannot be published'))
      const res = await request(app).post('/api/admin/podcasts/podcast-1/publish').set(authHeader())
      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/dry-run/)
    })

    it('unpublishes, or answers 404 for an unknown episode', async () => {
      mockPublish.unpublishEpisode.mockResolvedValueOnce(true)
      expect((await request(app).post('/api/admin/podcasts/podcast-1/unpublish').set(authHeader())).status).toBe(200)
      mockPublish.unpublishEpisode.mockResolvedValueOnce(false)
      expect((await request(app).post('/api/admin/podcasts/unknown/unpublish').set(authHeader())).status).toBe(404)
    })
  })
})

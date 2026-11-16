import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

const mockPrisma = vi.hoisted(() => ({
  jobRun: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $disconnect: vi.fn(),
}))

const mockRunJob = vi.hoisted(() => vi.fn())
const mockRunCrawlFeeds = vi.hoisted(() => vi.fn())
const mockRunPreassessStories = vi.hoisted(() => vi.fn())
const mockRunAssessStories = vi.hoisted(() => vi.fn())
const mockRunSelectStories = vi.hoisted(() => vi.fn())

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))
const mockReloadJob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockIsJobRunning = vi.hoisted(() => vi.fn())
const mockJobsWithLiveLease = vi.hoisted(() => vi.fn())
const mockJobEnableRefusal = vi.hoisted(() => vi.fn().mockReturnValue(null))
vi.mock('../../jobs/scheduler.js', () => ({ runJob: mockRunJob, reloadJob: mockReloadJob, isJobRunning: mockIsJobRunning, runningJobs: new Set() }))
vi.mock('../../jobs/jobLease.js', () => ({ jobsWithLiveLease: mockJobsWithLiveLease }))
vi.mock('../../jobs/jobEnableChecks.js', () => ({ jobEnableRefusal: mockJobEnableRefusal }))
vi.mock('../../jobs/crawlFeeds.js', () => ({ runCrawlFeeds: mockRunCrawlFeeds }))
vi.mock('../../jobs/preassessStories.js', () => ({ runPreassessStories: mockRunPreassessStories }))
vi.mock('../../jobs/assessStories.js', () => ({ runAssessStories: mockRunAssessStories }))
vi.mock('../../jobs/selectStories.js', () => ({ runSelectStories: mockRunSelectStories }))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')

describe('Admin Jobs API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsJobRunning.mockResolvedValue(false)
    mockJobsWithLiveLease.mockResolvedValue(new Set())
  })

  describe('GET /api/admin/jobs', () => {
    it('returns all jobs', async () => {
      const jobs = [
        { jobName: 'crawl_feeds', enabled: true, cronExpression: '0 */6 * * *' },
        { jobName: 'assess_stories', enabled: false, cronExpression: '0 8 * * *' },
      ]
      mockPrisma.jobRun.findMany.mockResolvedValue(jobs)

      const res = await request(app).get('/api/admin/jobs').set(authHeader())

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0].jobName).toBe('crawl_feeds')
    })

    it("reports a job as running while another process's lease is live, and keeps the lease and resume bookkeeping out", async () => {
      const lockedUntil = new Date(Date.now() + 60_000)
      mockPrisma.jobRun.findMany.mockResolvedValue([
        { jobName: 'crawl_feeds', enabled: true, cronExpression: '0 */6 * * *', lockedBy: 'other:1:abcd', lockedUntil, interruptedRuns: 1 },
        { jobName: 'assess_stories', enabled: true, cronExpression: '0 8 * * *', lockedBy: null, lockedUntil: null, interruptedRuns: 0 },
      ])
      mockJobsWithLiveLease.mockResolvedValue(new Set(['crawl_feeds']))

      const res = await request(app).get('/api/admin/jobs').set(authHeader())

      expect(res.status).toBe(200)
      expect(res.body.map((job: { running: boolean }) => job.running)).toEqual([true, false])
      expect(res.body[0]).not.toHaveProperty('lockedBy')
      expect(res.body[0]).not.toHaveProperty('lockedUntil')
      expect(res.body[0]).not.toHaveProperty('interruptedRuns')
    })

    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/jobs')
      expect(res.status).toBe(401)
    })
  })

  describe('PUT /api/admin/jobs/:jobName', () => {
    it('updates job settings', async () => {
      const updatedJob = { jobName: 'crawl_feeds', enabled: false, cronExpression: '0 */6 * * *' }
      mockPrisma.jobRun.update.mockResolvedValue(updatedJob)

      const res = await request(app).put('/api/admin/jobs/crawl_feeds').set(authHeader()).send({ enabled: false })

      expect(res.status).toBe(200)
      expect(res.body.enabled).toBe(false)
    })

    it('validates cron expression', async () => {
      const res = await request(app).put('/api/admin/jobs/crawl_feeds').set(authHeader()).send({ cronExpression: 'not-a-cron' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid cron expression')
    })

    it('returns 404 for unknown job', async () => {
      mockPrisma.jobRun.update.mockRejectedValue({ code: 'P2025' })

      const res = await request(app).put('/api/admin/jobs/nonexistent').set(authHeader()).send({ enabled: true })

      expect(res.status).toBe(404)
    })

    it('refuses to enable a job whose precondition fails, naming what is missing, and saves nothing', async () => {
      mockJobEnableRefusal.mockReturnValueOnce('podcast configuration missing: ELEVENLABS_API_KEY')

      const res = await request(app).put('/api/admin/jobs/generate_podcast').set(authHeader()).send({ enabled: true })

      expect(res.status).toBe(422)
      expect(res.body.error).toContain('ELEVENLABS_API_KEY')
      expect(mockJobEnableRefusal).toHaveBeenCalledWith('generate_podcast')
      expect(mockPrisma.jobRun.update).not.toHaveBeenCalled()
      expect(mockReloadJob).not.toHaveBeenCalled()
    })

    it('saves a Flex switch, and a chain step review pause and chain clock times', async () => {
      mockPrisma.jobRun.update.mockResolvedValue({})
      await request(app).put('/api/admin/jobs/assess_stories').set(authHeader()).send({ flex: true, pauseForReview: true }).expect(200)
      await request(app).put('/api/admin/jobs/daily_edition_chain').set(authHeader()).send({ flexUntil: '04:00', deadline: null }).expect(200)
      await request(app).put('/api/admin/jobs/publish_podcast').set(authHeader()).send({ notBefore: 'Sat 08:00' }).expect(200)
      expect(mockPrisma.jobRun.update).toHaveBeenCalledWith({ where: { jobName: 'publish_podcast' }, data: { notBefore: 'Sat 08:00' } })
      expect(mockPrisma.jobRun.update).toHaveBeenCalledWith({ where: { jobName: 'assess_stories' }, data: { flex: true, pauseForReview: true } })
      expect(mockPrisma.jobRun.update).toHaveBeenCalledWith({ where: { jobName: 'daily_edition_chain' }, data: { flexUntil: '04:00', deadline: null } })
    })

    it.each([
      ['a schedule for a chain step', 'preassess_stories', { cronExpression: '0 1 * * *' }, 'no schedule of its own'],
      ['a review pause outside a chain', 'cleanup_old_stories', { pauseForReview: true }, 'only a step of a chain'],
      ['a hold time outside a chain', 'social_auto_post', { notBefore: '11:30' }, 'only a step of a chain'],
      ['a deadline on a job that is not a chain', 'research_stories', { deadline: '05:00' }, 'only a chain'],
    ])('refuses %s and saves nothing', async (_what, jobName, body, message) => {
      const res = await request(app).put(`/api/admin/jobs/${jobName}`).set(authHeader()).send(body)
      expect(res.status).toBe(400)
      expect(res.body.error).toContain(message)
      expect(mockPrisma.jobRun.update).not.toHaveBeenCalled()
    })

    it('refuses a chain clock time that is not HH:MM', async () => {
      const res = await request(app).put('/api/admin/jobs/daily_edition_chain').set(authHeader()).send({ deadline: '5am' })
      expect(res.status).toBe(400)
      expect(mockPrisma.jobRun.update).not.toHaveBeenCalled()
    })

    it('checks no precondition when a job is disabled or only rescheduled', async () => {
      mockPrisma.jobRun.update.mockResolvedValue({ jobName: 'generate_podcast', enabled: false })
      await request(app).put('/api/admin/jobs/generate_podcast').set(authHeader()).send({ enabled: false })
      await request(app).put('/api/admin/jobs/generate_podcast').set(authHeader()).send({ cronExpression: '0 6 * * 5' })
      expect(mockJobEnableRefusal).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/jobs/:jobName/run', () => {
    it('answers 409 and starts nothing while the job is already running', async () => {
      mockIsJobRunning.mockResolvedValueOnce(true)

      const res = await request(app).post('/api/admin/jobs/crawl_feeds/run').set(authHeader())

      expect(res.status).toBe(409)
      expect(mockIsJobRunning).toHaveBeenCalledWith('crawl_feeds')
      expect(mockRunJob).not.toHaveBeenCalled()
    })

    it('triggers a known job', async () => {
      mockRunJob.mockResolvedValue(undefined)

      const res = await request(app).post('/api/admin/jobs/crawl_feeds/run').set(authHeader())

      expect(res.status).toBe(200)
      expect(res.body.message).toContain('crawl_feeds')
      expect(mockRunJob).toHaveBeenCalledWith('crawl_feeds', mockRunCrawlFeeds)
    })

    it('returns 404 for unknown job', async () => {
      const res = await request(app).post('/api/admin/jobs/nonexistent/run').set(authHeader())

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/admin/jobs/:jobName/continue', () => {
    const chainRow = (resumeStep: string | null, resumeReason: string | null) => ({
      jobName: 'daily_edition_chain',
      interruptedRuns: 0,
      resumeStep,
      resumeReason,
    })

    it('continues a chain waiting for review from the step after the pause', async () => {
      mockPrisma.jobRun.findUnique.mockResolvedValue(chainRow('publish_stories', 'review'))
      mockRunJob.mockResolvedValue({ result: 'succeeded' })

      const res = await request(app).post('/api/admin/jobs/daily_edition_chain/continue').set(authHeader())

      expect(res.status).toBe(200)
      expect(res.body.message).toContain('publish_stories')
      expect(mockRunJob).toHaveBeenCalledWith('daily_edition_chain', expect.any(Function))
    })

    it('answers 400 for a chain with nothing to continue', async () => {
      mockPrisma.jobRun.findUnique.mockResolvedValue(chainRow(null, null))
      const res = await request(app).post('/api/admin/jobs/daily_edition_chain/continue').set(authHeader())
      expect(res.status).toBe(400)
      expect(mockRunJob).not.toHaveBeenCalled()
    })

    it('answers 409 while the chain runs, and 404 for a job that is not a chain', async () => {
      mockIsJobRunning.mockResolvedValueOnce(true)
      expect((await request(app).post('/api/admin/jobs/daily_edition_chain/continue').set(authHeader())).status).toBe(409)
      expect((await request(app).post('/api/admin/jobs/crawl_feeds/continue').set(authHeader())).status).toBe(404)
      expect(mockRunJob).not.toHaveBeenCalled()
    })
  })
})

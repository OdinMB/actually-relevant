import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({ jobRun: { findMany: vi.fn() } }))
const mockGuards = vi.hoisted(() => ({ assertPodcastRunnable: vi.fn() }))
const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }))
const mockLog = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLog }))
vi.mock('../services/podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('../services/podcastGuards.js')>()), ...mockGuards }))
vi.mock('../services/podcastAudioStages.js', () => ({ GENERATE_PODCAST_JOB: 'generate_podcast' }))
vi.mock('../lib/notify.js', () => mockNotify)

const { checkPodcastConfigAtBoot } = await import('./podcastBootCheck.js')
const { PodcastBlockedError } = await import('../services/podcastGuards.js')

describe('checkPodcastConfigAtBoot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stays silent while both podcast jobs are disabled, whatever is missing', async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([])
    mockGuards.assertPodcastRunnable.mockImplementation(() => { throw new PodcastBlockedError('podcast configuration missing: ELEVENLABS_API_KEY') })
    await checkPodcastConfigAtBoot()
    expect(mockGuards.assertPodcastRunnable).not.toHaveBeenCalled()
    expect(mockNotify.notify).not.toHaveBeenCalled()
    expect(mockLog.warn).not.toHaveBeenCalled()
    mockGuards.assertPodcastRunnable.mockReset()
  })

  it('asks only about the podcast job rows that are enabled', async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([])
    await checkPodcastConfigAtBoot()
    expect(mockPrisma.jobRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobName: { in: ['generate_podcast', 'publish_podcast'] }, enabled: true },
    }))
  })

  it('records a missing setting as one keyed podcast notice when a podcast job is enabled', async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([{ jobName: 'generate_podcast' }])
    mockGuards.assertPodcastRunnable.mockImplementationOnce(() => { throw new PodcastBlockedError('podcast configuration missing: BUNNY_STORAGE_ZONE') })
    await checkPodcastConfigAtBoot()
    expect(mockNotify.notify).toHaveBeenCalledWith(expect.objectContaining({
      source: 'podcast', severity: 'warning', dedupeKey: 'podcast-config', message: expect.stringContaining('BUNNY_STORAGE_ZONE'),
    }))
  })

  it('sends nothing when the configuration is complete', async () => {
    mockPrisma.jobRun.findMany.mockResolvedValueOnce([{ jobName: 'publish_podcast' }])
    await checkPodcastConfigAtBoot()
    expect(mockNotify.notify).not.toHaveBeenCalled()
    expect(mockLog.warn).not.toHaveBeenCalled()
  })

  it('never throws, even when the database is down', async () => {
    mockPrisma.jobRun.findMany.mockRejectedValueOnce(new Error('connection refused'))
    await expect(checkPodcastConfigAtBoot()).resolves.toBeUndefined()
    expect(mockNotify.notify).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGuards = vi.hoisted(() => ({ assertPodcastRunnable: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('../services/podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('../services/podcastGuards.js')>()), ...mockGuards }))

const { jobEnableRefusal } = await import('./jobEnableChecks.js')
const { PodcastBlockedError } = await import('../services/podcastGuards.js')
const { GENERATE_PODCAST_JOB } = await import('../services/podcastAudioStages.js')
const { PUBLISH_PODCAST_JOB } = await import('./publishPodcast.js')

describe('jobEnableRefusal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses either podcast job while the podcast configuration is incomplete, naming what is missing', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => { throw new PodcastBlockedError('podcast configuration missing: ELEVENLABS_API_KEY, WEBHOOK_URL') })
    for (const job of [GENERATE_PODCAST_JOB, PUBLISH_PODCAST_JOB]) {
      expect(jobEnableRefusal(job)).toContain('ELEVENLABS_API_KEY, WEBHOOK_URL')
    }
    expect(mockGuards.assertPodcastRunnable).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'cron' }))
  })

  it('allows a podcast job once the configuration is complete', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => {})
    expect(jobEnableRefusal(GENERATE_PODCAST_JOB)).toBeNull()
  })

  it('never checks the podcast configuration for another job', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => { throw new PodcastBlockedError('podcast configuration missing: BUNNY_STORAGE_ZONE') })
    expect(jobEnableRefusal('crawl_feeds')).toBeNull()
    expect(mockGuards.assertPodcastRunnable).not.toHaveBeenCalled()
  })

  it('lets an unexpected error through rather than reading it as a missing setting', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => { throw new Error('boom') })
    expect(() => jobEnableRefusal(PUBLISH_PODCAST_JOB)).toThrow('boom')
  })
})

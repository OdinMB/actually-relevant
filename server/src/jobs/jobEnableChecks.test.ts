import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { config } from '../config.js'

const mockGuards = vi.hoisted(() => ({ assertPodcastRunnable: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('../services/podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('../services/podcastGuards.js')>()), ...mockGuards }))
// The real gate (Actually Uplifting is closed by default), wrapped so a test can open the show.
vi.mock('../services/podcastEdition.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/podcastEdition.js')>()
  return { ...actual, upliftingShowProblem: vi.fn(actual.upliftingShowProblem) }
})

const { jobEnableRefusal } = await import('./jobEnableChecks.js')
const { PodcastBlockedError } = await import('../services/podcastGuards.js')
const { GENERATE_PODCAST_JOB } = await import('../services/podcastAudioStages.js')
const { PUBLISH_PODCAST_JOB } = await import('./publishPodcast.js')
const { GENERATE_UPLIFTING_PODCAST_JOB, PUBLISH_UPLIFTING_PODCAST_JOB, upliftingShowProblem } = await import('../services/podcastEdition.js')

describe('jobEnableRefusal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses either podcast job while the podcast configuration is incomplete, naming what is missing', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => {
      throw new PodcastBlockedError('podcast configuration missing: ELEVENLABS_API_KEY, BUNNY_STORAGE_ZONE')
    })
    for (const job of [GENERATE_PODCAST_JOB, PUBLISH_PODCAST_JOB]) {
      expect(jobEnableRefusal(job)).toContain('ELEVENLABS_API_KEY, BUNNY_STORAGE_ZONE')
    }
  })

  it('allows a podcast job once the configuration is complete', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => {})
    expect(jobEnableRefusal(GENERATE_PODCAST_JOB)).toBeNull()
  })

  it('never checks the podcast configuration for another job', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => {
      throw new PodcastBlockedError('podcast configuration missing: BUNNY_STORAGE_ZONE')
    })
    expect(jobEnableRefusal('crawl_feeds')).toBeNull()
    expect(mockGuards.assertPodcastRunnable).not.toHaveBeenCalled()
  })

  describe("Actually Uplifting's jobs", () => {
    const saved = { full: config.plunk.fullEditionSegmentId, uplifting: config.plunk.upliftingSegmentId, key: config.plunk.secretKey }
    afterEach(() => {
      config.plunk.fullEditionSegmentId = saved.full
      config.plunk.upliftingSegmentId = saved.uplifting
      config.plunk.secretKey = saved.key
    })

    it('refuses both while the editions are closed, naming the two segment variables', () => {
      config.plunk.fullEditionSegmentId = ''
      config.plunk.upliftingSegmentId = ''
      config.plunk.secretKey = 'sk_test'
      for (const job of ['generate_uplifting_newsletter', 'publish_uplifting_newsletter']) {
        expect(jobEnableRefusal(job)).toMatch(/PLUNK_FULL_EDITION_SEGMENT_ID and PLUNK_UPLIFTING_SEGMENT_ID/)
      }
    })

    it('allows both once the editions are open, the publish job only with the Plunk key', () => {
      config.plunk.fullEditionSegmentId = 'seg-full'
      config.plunk.upliftingSegmentId = 'seg-up'
      config.plunk.secretKey = ''
      expect(jobEnableRefusal('generate_uplifting_newsletter')).toBeNull()
      expect(jobEnableRefusal('publish_uplifting_newsletter')).toMatch(/PLUNK_SECRET_KEY/)
      config.plunk.secretKey = 'sk_test'
      expect(jobEnableRefusal('publish_uplifting_newsletter')).toBeNull()
    })
  })

  describe("the Actually Uplifting podcast's jobs", () => {
    const UPLIFTING_PODCAST_JOBS = [GENERATE_UPLIFTING_PODCAST_JOB, PUBLISH_UPLIFTING_PODCAST_JOB]
    // Back to the real gate (mockReset restores the implementation vi.fn was given)
    afterEach(() => vi.mocked(upliftingShowProblem).mockReset())

    it('refuses both while the show is closed, naming what it waits for, even with the podcast configured', () => {
      mockGuards.assertPodcastRunnable.mockImplementation(() => {})
      for (const job of UPLIFTING_PODCAST_JOBS) {
        expect(jobEnableRefusal(job)).toMatch(/Actually Uplifting is switched off: PODCAST_UPLIFTING_ENABLED/)
      }
    })

    it('once the show is open, refuses both only while the podcast configuration is incomplete', () => {
      vi.mocked(upliftingShowProblem).mockReturnValue(null)
      mockGuards.assertPodcastRunnable.mockImplementation(() => {
        throw new PodcastBlockedError('podcast configuration missing: BUNNY_STORAGE_ZONE')
      })
      for (const job of UPLIFTING_PODCAST_JOBS) expect(jobEnableRefusal(job)).toMatch(/BUNNY_STORAGE_ZONE/)
      mockGuards.assertPodcastRunnable.mockImplementation(() => {})
      for (const job of UPLIFTING_PODCAST_JOBS) expect(jobEnableRefusal(job)).toBeNull()
    })

    it("leaves the main show's podcast jobs to the configuration alone", () => {
      mockGuards.assertPodcastRunnable.mockImplementation(() => {})
      expect(jobEnableRefusal(GENERATE_PODCAST_JOB)).toBeNull()
      expect(jobEnableRefusal(PUBLISH_PODCAST_JOB)).toBeNull()
    })
  })

  it('lets an unexpected error through rather than reading it as a missing setting', () => {
    mockGuards.assertPodcastRunnable.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => jobEnableRefusal(PUBLISH_PODCAST_JOB)).toThrow('boom')
  })
})

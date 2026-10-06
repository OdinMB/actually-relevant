import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.hoisted(() => ({ pickAutoPublishCandidate: vi.fn(), publishEpisode: vi.fn() }))
const mockGuards = vi.hoisted(() => ({ assertJobEnabled: vi.fn(), assertPodcastRunnable: vi.fn() }))
const mockNotify = vi.hoisted(() => ({ notifyEvent: vi.fn() }))

vi.mock('../services/podcastPublish.js', () => mockPublish)
vi.mock('../services/podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('../services/podcastGuards.js')>()), ...mockGuards }))
vi.mock('../lib/notify.js', () => mockNotify)

const { runPublishPodcast, PUBLISH_PODCAST_JOB } = await import('./publishPodcast.js')
const { PodcastBlockedError, PodcastStoppedError, PodcastRefusedError } = await import('../services/podcastGuards.js')

const MONDAY = new Date('2026-10-12T07:00:00Z')
const CANDIDATE = { id: 'pod-1', title: 'W41: Water', weekKey: '2026-W41' }

describe('runPublishPodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublish.pickAutoPublishCandidate.mockResolvedValue(CANDIDATE)
    mockGuards.assertJobEnabled.mockResolvedValue(undefined)
  })

  it('publishes the candidate and sends a notice', async () => {
    await runPublishPodcast(MONDAY)
    expect(mockPublish.pickAutoPublishCandidate).toHaveBeenCalledWith(MONDAY)
    expect(mockPublish.publishEpisode).toHaveBeenCalledWith('pod-1', MONDAY)
    expect(mockNotify.notifyEvent.mock.calls[0][1]).toContain('W41: Water')
  })

  it('does nothing on a day other than Monday (UTC), so a boot catch-up never publishes mid-week', async () => {
    await expect(runPublishPodcast(new Date('2026-10-15T10:00:00Z'))).resolves.toBeUndefined() // Thursday
    await runPublishPodcast(new Date('2026-10-11T23:59:00Z')) // Sunday, just before Monday UTC
    expect(mockGuards.assertPodcastRunnable).not.toHaveBeenCalled()
    expect(mockPublish.pickAutoPublishCandidate).not.toHaveBeenCalled()
    expect(mockPublish.publishEpisode).not.toHaveBeenCalled()
  })

  it('runs on any hour of a UTC Monday', async () => {
    const lateMonday = new Date('2026-10-12T23:30:00Z')
    await runPublishPodcast(lateMonday)
    expect(mockPublish.publishEpisode).toHaveBeenCalledWith('pod-1', lateMonday)
  })

  it('does nothing without a candidate', async () => {
    mockPublish.pickAutoPublishCandidate.mockResolvedValueOnce(null)
    await runPublishPodcast(MONDAY)
    expect(mockPublish.publishEpisode).not.toHaveBeenCalled()
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('re-checks its own job row right before publishing, after picking the candidate', async () => {
    await runPublishPodcast(MONDAY)
    expect(mockGuards.assertJobEnabled).toHaveBeenCalledWith(PUBLISH_PODCAST_JOB)
    expect(mockGuards.assertJobEnabled.mock.invocationCallOrder[0]).toBeGreaterThan(mockPublish.pickAutoPublishCandidate.mock.invocationCallOrder[0])
    expect(mockGuards.assertJobEnabled.mock.invocationCallOrder[0]).toBeLessThan(mockPublish.publishEpisode.mock.invocationCallOrder[0])
  })

  it('does not publish when its row was disabled during the run, and does not fail', async () => {
    mockGuards.assertJobEnabled.mockRejectedValueOnce(new PodcastStoppedError(PUBLISH_PODCAST_JOB))
    await expect(runPublishPodcast(MONDAY)).resolves.toBeUndefined()
    expect(mockPublish.publishEpisode).not.toHaveBeenCalled()
  })

  it('fails (so the scheduler alerts) when the configuration is incomplete, before looking for a candidate', async () => {
    mockGuards.assertPodcastRunnable.mockImplementationOnce(() => { throw new PodcastBlockedError('podcast configuration missing: WEBHOOK_URL') })
    await expect(runPublishPodcast(MONDAY)).rejects.toThrow(/WEBHOOK_URL/)
    expect(mockPublish.pickAutoPublishCandidate).not.toHaveBeenCalled()
  })

  it('fails when publishing is refused, so the owner learns the episode was not published', async () => {
    mockPublish.publishEpisode.mockRejectedValueOnce(new PodcastRefusedError('the edited AI line awaits confirmation'))
    await expect(runPublishPodcast(MONDAY)).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })
})

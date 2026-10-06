import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.hoisted(() => ({ pickAutoPublishCandidate: vi.fn(), publishEpisode: vi.fn() }))
const mockGuards = vi.hoisted(() => ({ assertJobEnabled: vi.fn(), assertPodcastRunnable: vi.fn() }))
const mockNotify = vi.hoisted(() => ({ notifyEvent: vi.fn() }))

vi.mock('../services/podcastPublish.js', () => mockPublish)
vi.mock('../services/podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('../services/podcastGuards.js')>()), ...mockGuards }))
vi.mock('../lib/notify.js', () => mockNotify)

const { runPublishPodcast, isPublishDay, PUBLISH_PODCAST_JOB } = await import('./publishPodcast.js')
const { PodcastBlockedError, PodcastStoppedError, PodcastRefusedError } = await import('../services/podcastGuards.js')

// Saturday 07:00 in Berlin (CEST, UTC+2): the cron slot.
const SATURDAY = new Date('2026-10-17T05:00:00Z')
const CANDIDATE = { id: 'pod-1', title: 'W42: Water', weekKey: '2026-W42' }

describe('isPublishDay', () => {
  it('is Saturday by the Berlin calendar in summer time (CEST), not by the UTC one', () => {
    expect(isPublishDay(new Date('2026-10-16T21:59:00Z'))).toBe(false) // Friday 23:59 CEST
    expect(isPublishDay(new Date('2026-10-16T22:00:00Z'))).toBe(true) // Saturday 00:00 CEST, still Friday in UTC
    expect(isPublishDay(new Date('2026-10-17T21:59:00Z'))).toBe(true) // Saturday 23:59 CEST
    expect(isPublishDay(new Date('2026-10-17T22:00:00Z'))).toBe(false) // Sunday 00:00 CEST, still Saturday in UTC
  })

  it('follows the switch to winter time (CET, UTC+1) on the last Sunday of October', () => {
    // 2026-10-24 is the Saturday before the switch (CEST); 2026-10-31 the first one after it (CET).
    expect(isPublishDay(new Date('2026-10-24T22:30:00Z'))).toBe(false) // Sunday 00:30 CEST
    expect(isPublishDay(new Date('2026-10-30T22:30:00Z'))).toBe(false) // Friday 23:30 CET
    expect(isPublishDay(new Date('2026-10-30T23:00:00Z'))).toBe(true) // Saturday 00:00 CET
    expect(isPublishDay(new Date('2026-10-31T22:59:00Z'))).toBe(true) // Saturday 23:59 CET
    expect(isPublishDay(new Date('2026-10-31T23:00:00Z'))).toBe(false) // Sunday 00:00 CET
  })

  it('follows the switch to summer time on the last Sunday of March', () => {
    // 2027-03-27 is the Saturday before the switch (CET); 2027-04-03 the first one after it (CEST).
    expect(isPublishDay(new Date('2027-03-26T23:00:00Z'))).toBe(true) // Saturday 00:00 CET
    expect(isPublishDay(new Date('2027-03-27T23:00:00Z'))).toBe(false) // Sunday 00:00 CET
    expect(isPublishDay(new Date('2027-04-02T22:00:00Z'))).toBe(true) // Saturday 00:00 CEST
  })
})

describe('runPublishPodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublish.pickAutoPublishCandidate.mockResolvedValue(CANDIDATE)
    mockGuards.assertJobEnabled.mockResolvedValue(undefined)
  })

  it('publishes the candidate and sends a notice', async () => {
    await runPublishPodcast(SATURDAY)
    expect(mockPublish.pickAutoPublishCandidate).toHaveBeenCalledWith(SATURDAY)
    expect(mockPublish.publishEpisode).toHaveBeenCalledWith('pod-1', SATURDAY)
    expect(mockNotify.notifyEvent.mock.calls[0][1]).toContain('W42: Water')
  })

  it('does nothing on a day other than Saturday in Berlin, so a boot catch-up never publishes on another day', async () => {
    await expect(runPublishPodcast(new Date('2026-10-15T10:00:00Z'))).resolves.toBeUndefined() // Thursday
    await runPublishPodcast(new Date('2026-10-17T22:30:00Z')) // Saturday in UTC, Sunday 00:30 in Berlin
    await runPublishPodcast(new Date('2026-10-19T05:00:00Z')) // Monday, the old publish day
    expect(mockGuards.assertPodcastRunnable).not.toHaveBeenCalled()
    expect(mockPublish.pickAutoPublishCandidate).not.toHaveBeenCalled()
    expect(mockPublish.publishEpisode).not.toHaveBeenCalled()
  })

  it('runs on any hour of a Berlin Saturday, the late UTC Friday hours included', async () => {
    const earlySaturday = new Date('2026-10-16T22:30:00Z') // Saturday 00:30 CEST
    await runPublishPodcast(earlySaturday)
    expect(mockPublish.publishEpisode).toHaveBeenCalledWith('pod-1', earlySaturday)
  })

  it('does nothing without a candidate', async () => {
    mockPublish.pickAutoPublishCandidate.mockResolvedValueOnce(null)
    await runPublishPodcast(SATURDAY)
    expect(mockPublish.publishEpisode).not.toHaveBeenCalled()
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('re-checks its own job row right before publishing, after picking the candidate', async () => {
    await runPublishPodcast(SATURDAY)
    expect(mockGuards.assertJobEnabled).toHaveBeenCalledWith(PUBLISH_PODCAST_JOB)
    expect(mockGuards.assertJobEnabled.mock.invocationCallOrder[0]).toBeGreaterThan(mockPublish.pickAutoPublishCandidate.mock.invocationCallOrder[0])
    expect(mockGuards.assertJobEnabled.mock.invocationCallOrder[0]).toBeLessThan(mockPublish.publishEpisode.mock.invocationCallOrder[0])
  })

  it('does not publish when its row was disabled during the run, and does not fail', async () => {
    mockGuards.assertJobEnabled.mockRejectedValueOnce(new PodcastStoppedError(PUBLISH_PODCAST_JOB))
    await expect(runPublishPodcast(SATURDAY)).resolves.toBeUndefined()
    expect(mockPublish.publishEpisode).not.toHaveBeenCalled()
  })

  it('fails (so the scheduler alerts) when the configuration is incomplete, before looking for a candidate', async () => {
    mockGuards.assertPodcastRunnable.mockImplementationOnce(() => { throw new PodcastBlockedError('podcast configuration missing: WEBHOOK_URL') })
    await expect(runPublishPodcast(SATURDAY)).rejects.toThrow(/WEBHOOK_URL/)
    expect(mockPublish.pickAutoPublishCandidate).not.toHaveBeenCalled()
  })

  it('fails when publishing is refused, so the owner learns the episode was not published', async () => {
    mockPublish.publishEpisode.mockRejectedValueOnce(new PodcastRefusedError('the edited AI line awaits confirmation'))
    await expect(runPublishPodcast(SATURDAY)).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })
})

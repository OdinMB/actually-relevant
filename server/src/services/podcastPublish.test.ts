import { describe, it, expect, vi, beforeEach } from 'vitest'
import { samplePodcast } from '../test/helpers.js'

const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  podcast: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
}))
const mockFeed = vi.hoisted(() => ({ invalidateFeedCache: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./podcastFeed.js', () => mockFeed)

const { publishEpisode, unpublishEpisode, getPublishedEpisodes, pickAutoPublishCandidate, publishBlockedReason } = await import('./podcastPublish.js')
const { PodcastRefusedError, wasPublished, standaloneCopyRefusal } = await import('./podcastGuards.js')

const NOW = new Date('2026-10-12T07:00:00Z') // Monday of 2026-W42
const ready = (overrides: Record<string, unknown> = {}) =>
  samplePodcast({ stage: 'ready', audioUrl: 'https://audio.example/e.mp3', audioBytes: 5_000_000, ...overrides })

/** The data of every fenced write but the lease release. */
const writes = () => mockPrisma.podcast.updateMany.mock.calls.map(c => c[0].data).filter(d => !('leaseOwner' in d))

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$executeRaw.mockResolvedValue(1)
  mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
})

describe('publishEpisode', () => {
  it('refuses an episode that is not ready, and saves nothing', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready({ stage: 'voiced' }))
    await expect(publishEpisode('podcast-1', NOW)).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(writes()).toHaveLength(0)
    expect(mockFeed.invalidateFeedCache).not.toHaveBeenCalled()
  })

  it('publishes a ready standalone episode now that its wording is confirmed', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready({ kind: 'standalone', weekKey: null }))
    await publishEpisode('podcast-1', NOW)
    expect(writes()).toEqual([{ status: 'published', publishedAt: NOW, unpublishedAt: null }])
    expect(mockFeed.invalidateFeedCache).toHaveBeenCalledOnce()
  })

  it('refuses a dry-run episode', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready({ dryRun: true }))
    await expect(publishEpisode('podcast-1', NOW)).rejects.toThrow(/dry-run/)
    expect(writes()).toHaveLength(0)
  })

  it('publishes an episode edited by a person', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready({ humanEdited: true }))
    await publishEpisode('podcast-1', NOW)
    expect(writes()).toEqual([{ status: 'published', publishedAt: NOW, unpublishedAt: null }])
    expect(mockFeed.invalidateFeedCache).toHaveBeenCalledOnce()
  })

  it('refuses an episode in progress (the lease is held elsewhere)', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(publishEpisode('podcast-1', NOW)).rejects.toBeInstanceOf(PodcastRefusedError)
  })

  it('publishes a ready episode, sets the first publication date, clears a takedown and rebuilds the feed', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready({ unpublishedAt: new Date('2026-10-01') }))
    await publishEpisode('podcast-1', NOW)
    expect(writes()).toEqual([{ status: 'published', publishedAt: NOW, unpublishedAt: null }])
    expect(mockFeed.invalidateFeedCache).toHaveBeenCalledOnce()
  })

  it('keeps the first publication date when republishing', async () => {
    const first = new Date('2026-10-05T08:00:00Z')
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready({ publishedAt: first, unpublishedAt: new Date('2026-10-06') }))
    await publishEpisode('podcast-1', NOW)
    expect(writes()[0].publishedAt).toBe(first)
  })
})

describe('publishBlockedReason', () => {
  it('is null for a ready, voiced draft at rest, so the admin offers Publish', () => {
    expect(publishBlockedReason(ready(), false)).toBeNull()
  })

  it('is null for an episode generated before the review modes and the publish columns existed', () => {
    // A Phase 2 row after the later migrations: automated mode, never edited, a draft never published.
    const phase2 = ready({ mode: 'automated', humanEdited: false, status: 'draft', publishedAt: null, unpublishedAt: null, readyAt: new Date('2026-10-06T10:00:00Z') })
    expect(publishBlockedReason(phase2, false)).toBeNull()
  })

  it('names the run while a process holds the episode', () => {
    expect(publishBlockedReason(ready(), true)).toMatch(/run is working/)
  })

  it('gives the same refusal the publish action would', () => {
    expect(publishBlockedReason(ready({ stage: 'voiced' }), false)).toMatch(/at voiced/)
    expect(publishBlockedReason(ready({ dryRun: true }), false)).toMatch(/dry-run/)
    expect(publishBlockedReason(ready({ audioUrl: null }), false)).toMatch(/no uploaded audio/)
  })

  it('offers Publish for a ready standalone episode now that its wording is confirmed', () => {
    expect(publishBlockedReason(ready({ kind: 'standalone', weekKey: null }), false)).toBeNull()
  })

  it('would refuse a standalone episode, and never a weekly one, if its wording were unconfirmed', () => {
    expect(standaloneCopyRefusal('standalone', false)).toMatch(/standalone episode .* owner's confirmation/)
    expect(standaloneCopyRefusal('standalone', true)).toBeNull()
    expect(standaloneCopyRefusal('weekly', false)).toBeNull()
  })

  it('is null for a listed episode, which can always be unpublished', () => {
    expect(publishBlockedReason(ready({ status: 'published', dryRun: true }), true)).toBeNull()
  })
})

describe('unpublishEpisode', () => {
  it('takes a published episode down without a lease or a stage check, and rebuilds the feed', async () => {
    expect(await unpublishEpisode('podcast-1', NOW)).toBe(true)
    expect(mockPrisma.podcast.updateMany).toHaveBeenCalledWith({
      where: { id: 'podcast-1', status: 'published' },
      data: { status: 'draft', unpublishedAt: NOW },
    })
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockFeed.invalidateFeedCache).toHaveBeenCalledOnce()
  })

  it('is a no-op for an episode that is not published, and false for an unknown one', async () => {
    mockPrisma.podcast.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'podcast-1' })
    expect(await unpublishEpisode('podcast-1', NOW)).toBe(true)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    expect(await unpublishEpisode('unknown', NOW)).toBe(false)
  })

  it('leaves the episode "ever published", so it can no longer be regenerated or deleted', () => {
    expect(wasPublished({ stage: 'ready', status: 'draft', publishedAt: new Date('2026-10-05') })).toBe(true)
    expect(wasPublished({ stage: 'ready', status: 'draft', publishedAt: null })).toBe(false)
    expect(wasPublished({ stage: 'legacy', status: 'published', publishedAt: null })).toBe(false)
  })
})

describe('getPublishedEpisodes', () => {
  it('lists only published, ready, live episodes with audio, newest first', async () => {
    mockPrisma.podcast.findMany.mockResolvedValueOnce([])
    await getPublishedEpisodes()
    const query = mockPrisma.podcast.findMany.mock.calls[0][0]
    expect(query.where).toMatchObject({ status: 'published', stage: 'ready', dryRun: false, publishedAt: { not: null }, audioUrl: { not: null } })
    expect(query.orderBy).toEqual({ publishedAt: 'desc' })
  })

  it('maps rows to the public shape with the frozen story snapshot', async () => {
    const publishedAt = new Date('2026-10-12T08:00:00Z')
    const stories = [{ ref: 1, id: 's1', title: 'T', publisher: 'P', sourceUrl: 'https://x.example/1', slug: 't', issue: 'I' }]
    mockPrisma.podcast.findMany.mockResolvedValueOnce([{
      id: 'podcast-1', title: 'W42: T', kind: 'weekly', episodeSummary: 'S.', episodeStories: stories, humanEdited: true,
      audioUrl: 'https://audio.example/e.mp3', audioBytes: 123, durationSec: 360, transcriptUrl: null, publishedAt,
    }])
    expect(await getPublishedEpisodes()).toEqual([{
      id: 'podcast-1', title: 'W42: T', kind: 'weekly', summary: 'S.', stories, humanEdited: true,
      audioUrl: 'https://audio.example/e.mp3', audioBytes: 123, durationSec: 360, transcriptUrl: null, publishedAt,
    }])
  })
})

describe('pickAutoPublishCandidate', () => {
  it('asks for the newest never-published, never-unpublished, live ready episode of this or last ISO week, ready since the evening before', async () => {
    const saturdayMorning = new Date('2026-10-17T05:00:00Z') // 07:00 in Berlin, 2026-W42
    mockPrisma.podcast.findFirst.mockResolvedValueOnce(null)
    expect(await pickAutoPublishCandidate(saturdayMorning)).toBeNull()
    const query = mockPrisma.podcast.findFirst.mock.calls[0][0]
    expect(query.where).toMatchObject({
      kind: 'weekly',
      stage: 'ready',
      dryRun: false,
      status: { not: 'published' },
      publishedAt: null,
      unpublishedAt: null,
      readyAt: { lte: new Date('2026-10-16T21:00:00Z') }, // 8 hours earlier: Friday 23:00 in Berlin
      weekKey: { in: ['2026-W42', '2026-W41'] },
    })
    expect(query.orderBy).toEqual({ readyAt: 'desc' })
  })
})

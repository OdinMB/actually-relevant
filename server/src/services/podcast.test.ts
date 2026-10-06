import { describe, it, expect, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  podcast: { findUnique: vi.fn() },
  podcastTtsUsage: { aggregate: vi.fn(async () => ({ _sum: { chars: 5400 } })) },
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { getPodcastById } = await import('./podcast.js')

describe('getPodcastById', () => {
  it('reports an episode as in progress only while its lease is live', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'p', stage: 'created', leaseUntil: new Date(Date.now() + 60_000) })
    expect((await getPodcastById('p'))?.inProgress).toBe(true)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'p', stage: 'created', leaseUntil: new Date(Date.now() - 60_000) })
    expect((await getPodcastById('p'))?.inProgress).toBe(false)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'p', stage: 'created', leaseUntil: null })
    expect((await getPodcastById('p'))?.inProgress).toBe(false)
  })

  it('adds the TTS characters spent on the episode', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'p', stage: 'ready', leaseUntil: null })
    expect((await getPodcastById('p'))?.ttsChars).toBe(5400)
    expect(mockPrisma.podcastTtsUsage.aggregate).toHaveBeenCalledWith({ _sum: { chars: true }, where: { podcastId: 'p' } })
  })
})

import { describe, it, expect, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({ podcast: { findUnique: vi.fn() } }))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { getPodcastById } = await import('./podcast.js')

describe('getPodcastById', () => {
  it('reports an episode as in progress only while its lease is live', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'p', leaseUntil: new Date(Date.now() + 60_000) })
    expect((await getPodcastById('p'))?.inProgress).toBe(true)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'p', leaseUntil: new Date(Date.now() - 60_000) })
    expect((await getPodcastById('p'))?.inProgress).toBe(false)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce({ id: 'p', leaseUntil: null })
    expect((await getPodcastById('p'))?.inProgress).toBe(false)
  })
})

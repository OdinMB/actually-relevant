import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  blueskyPost: { findFirst: vi.fn() },
  mastodonPost: { findFirst: vi.fn() },
}))
const mockSocial = vi.hoisted(() => ({ findAutoPostCandidates: vi.fn(), pickBestStoryForSocial: vi.fn() }))
const mockBluesky = vi.hoisted(() => ({ generateDraft: vi.fn(), publishPost: vi.fn() }))
const mockMastodon = vi.hoisted(() => ({ generateDraft: vi.fn(), publishPost: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/bluesky.js', () => ({ isBlueskyConfigured: () => true }))
vi.mock('../lib/mastodon.js', () => ({ isMastodonConfigured: () => true }))
vi.mock('../services/socialMedia.js', () => mockSocial)
vi.mock('../services/bluesky.js', () => mockBluesky)
vi.mock('../services/mastodon.js', () => mockMastodon)

const { config } = await import('../config.js')
const { runSocialAutoPost } = await import('./socialAutoPost.js')

/** Run the job to completion, skipping the pause between channel publishes. */
async function run(): Promise<void> {
  const done = runSocialAutoPost()
  done.catch(() => {})
  await vi.runAllTimersAsync()
  return done
}

describe('runSocialAutoPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    config.bluesky.autoPost.enabled = true
    config.mastodon.autoPost.enabled = true
    mockSocial.findAutoPostCandidates.mockResolvedValue([{ id: 'story-1' }])
    mockSocial.pickBestStoryForSocial.mockResolvedValue({ storyId: 'story-1', reasoning: 'best' })
    mockPrisma.blueskyPost.findFirst.mockResolvedValue(null)
    mockPrisma.mastodonPost.findFirst.mockResolvedValue(null)
    mockBluesky.generateDraft.mockResolvedValue({ id: 'bsky-post' })
    mockMastodon.generateDraft.mockResolvedValue({ id: 'masto-post' })
    mockBluesky.publishPost.mockResolvedValue({})
    mockMastodon.publishPost.mockResolvedValue({})
  })

  afterEach(() => vi.useRealTimers())

  it('fails the run, naming each channel, when every channel attempt failed', async () => {
    mockBluesky.publishPost.mockRejectedValue(new Error('bluesky down'))
    mockMastodon.generateDraft.mockRejectedValue(new Error('mastodon down'))
    await expect(run()).rejects.toThrow(/bluesky: bluesky down.*mastodon: mastodon down/)
  })

  it('succeeds when at least one channel posted, even though another failed', async () => {
    mockBluesky.publishPost.mockRejectedValue(new Error('bluesky down'))
    await expect(run()).resolves.toBeUndefined()
    expect(mockMastodon.publishPost).toHaveBeenCalledWith('masto-post')
  })

  it('does not count a channel that already has the story as an attempt', async () => {
    mockPrisma.blueskyPost.findFirst.mockResolvedValue({ id: 'earlier' })
    mockMastodon.publishPost.mockRejectedValue(new Error('mastodon down'))
    await expect(run()).rejects.toThrow(/mastodon: mastodon down/)

    mockPrisma.mastodonPost.findFirst.mockResolvedValue({ id: 'earlier' })
    await expect(run()).resolves.toBeUndefined()
  })
})

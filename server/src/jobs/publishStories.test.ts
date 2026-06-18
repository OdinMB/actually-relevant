import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetStoryIdsByStatus = vi.hoisted(() => vi.fn())
const mockBulkUpdateStatus = vi.hoisted(() => vi.fn())

vi.mock('../services/story.js', () => ({
  getStoryIdsByStatus: mockGetStoryIdsByStatus,
  bulkUpdateStatus: mockBulkUpdateStatus,
}))

const { runPublishStories } = await import('./publishStories.js')

describe('runPublishStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when no stories are selected', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue([])

    await runPublishStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('selected')
    expect(mockBulkUpdateStatus).not.toHaveBeenCalled()
  })

  it('publishes the selected stories', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['a', 'b', 'c'])
    mockBulkUpdateStatus.mockResolvedValue({ count: 3 })

    await runPublishStories()

    expect(mockBulkUpdateStatus).toHaveBeenCalledWith(['a', 'b', 'c'], 'published')
  })
})

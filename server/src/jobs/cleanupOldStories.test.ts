import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDeleteBatch = vi.hoisted(() => vi.fn())
const mockDeleteClusters = vi.hoisted(() => vi.fn())
const mockClearEmbeddings = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('../services/storyRetention.js', () => ({
  deleteOldStoriesBatch: mockDeleteBatch,
  deleteEmptyClusters: mockDeleteClusters,
  clearOldEmbeddingsBatch: mockClearEmbeddings,
}))
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLog }))

const { runCleanupOldStories } = await import('./cleanupOldStories.js')
const { config } = await import('../config.js')

describe('runCleanupOldStories', () => {
  const batchSize = config.storyRetention.batchSize

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteClusters.mockResolvedValue(0)
    mockClearEmbeddings.mockResolvedValue(0)
  })

  it('deletes in batches until one comes back short, then clears embeddings and reports', async () => {
    mockDeleteBatch
      .mockResolvedValueOnce({ rejected: batchSize - 1, trashed: 1 })
      .mockResolvedValueOnce({ rejected: 3 })
    mockDeleteClusters.mockResolvedValue(2)
    mockClearEmbeddings.mockResolvedValueOnce(batchSize).mockResolvedValueOnce(4)

    const result = await runCleanupOldStories()

    expect(mockDeleteBatch).toHaveBeenCalledTimes(2)
    expect(mockClearEmbeddings).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      deletedByStatus: { rejected: batchSize + 2, trashed: 1 },
      deleted: batchSize + 3,
      clustersDeleted: 2,
      embeddingsCleared: batchSize + 4,
    })
    expect(mockNotify).toHaveBeenCalledTimes(1)
    const notice = mockNotify.mock.calls[0][0]
    expect(notice).toMatchObject({ source: 'jobs', severity: 'info', title: 'Old stories cleaned up' })
    expect(notice.message).toContain(`Deleted ${batchSize + 3} stories`)
    expect(notice.message).toContain(`rejected ${batchSize + 2}, trashed 1`)
    expect(notice.message).toContain(`embeddings of ${batchSize + 4}`)
  })

  it('still records a notice when nothing was due', async () => {
    mockDeleteBatch.mockResolvedValue({})

    await runCleanupOldStories()

    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify.mock.calls[0][0].message).toContain('none were due')
  })

  it('fails with what it did before the error, and leaves the alert to the scheduler', async () => {
    mockDeleteBatch.mockResolvedValueOnce({ rejected: batchSize }).mockRejectedValueOnce(new Error('connection lost'))

    await expect(runCleanupOldStories()).rejects.toThrow(
      `Story cleanup failed after deleting ${batchSize} stories and clearing 0 embeddings: connection lost`,
    )
    expect(mockNotify).not.toHaveBeenCalled()
  })
})

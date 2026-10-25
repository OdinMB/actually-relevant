import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDeleteBatch = vi.hoisted(() => vi.fn())
const mockRepairClusters = vi.hoisted(() => vi.fn())
const mockClearEmbeddings = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('../services/storyRetention.js', () => ({
  deleteOldStoriesBatch: mockDeleteBatch,
  clearOldEmbeddingsBatch: mockClearEmbeddings,
}))
vi.mock('../services/clusterRepair.js', () => ({ repairClusters: mockRepairClusters }))

const batchOf = (deletedByStatus: Record<string, number>, clusterIds: string[] = []) => ({ deletedByStatus, clusterIds })
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLog }))

const { runCleanupOldStories } = await import('./cleanupOldStories.js')
const { config } = await import('../config.js')

describe('runCleanupOldStories', () => {
  const batchSize = config.storyRetention.batchSize

  beforeEach(() => {
    vi.clearAllMocks()
    mockRepairClusters.mockResolvedValue({ dissolved: 0, reElected: 0 })
    mockClearEmbeddings.mockResolvedValue(0)
  })

  it('deletes in batches until one comes back short, repairs the touched clusters, clears embeddings and reports', async () => {
    mockDeleteBatch
      .mockResolvedValueOnce(batchOf({ rejected: batchSize - 1, trashed: 1 }, ['c1', 'c2']))
      .mockResolvedValueOnce(batchOf({ rejected: 3 }, ['c2', 'c3']))
    mockRepairClusters.mockResolvedValue({ dissolved: 2, reElected: 1 })
    mockClearEmbeddings.mockResolvedValueOnce(batchSize).mockResolvedValueOnce(4)

    const result = await runCleanupOldStories()

    expect(mockDeleteBatch).toHaveBeenCalledTimes(2)
    expect([...mockRepairClusters.mock.calls[0][0]].sort()).toEqual(['c1', 'c2', 'c3'])
    expect(mockClearEmbeddings).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      deletedByStatus: { rejected: batchSize + 2, trashed: 1 },
      deleted: batchSize + 3,
      clustersDeleted: 2,
      primariesReElected: 1,
      embeddingsCleared: batchSize + 4,
    })
    expect(mockNotify).toHaveBeenCalledTimes(1)
    const notice = mockNotify.mock.calls[0][0]
    expect(notice).toMatchObject({ source: 'jobs', severity: 'info', title: 'Old stories cleaned up' })
    expect(notice.message).toContain(`Deleted ${batchSize + 3} stories`)
    expect(notice.message).toContain(`rejected ${batchSize + 2}, trashed 1`)
    expect(notice.message).toContain(`embeddings of ${batchSize + 4}`)
    expect(notice.message).toContain('Dissolved 2 duplicate clusters')
    expect(notice.message).toContain('new primary for 1 cluster whose')
  })

  it('still records a notice when nothing was due', async () => {
    mockDeleteBatch.mockResolvedValue(batchOf({}))

    await runCleanupOldStories()

    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify.mock.calls[0][0].message).toContain('none were due')
  })

  it('fails with what it did before the error, and leaves the alert to the scheduler', async () => {
    mockDeleteBatch.mockResolvedValueOnce(batchOf({ rejected: batchSize })).mockRejectedValueOnce(new Error('connection lost'))

    await expect(runCleanupOldStories()).rejects.toThrow(`Story cleanup failed after deleting ${batchSize} stories and clearing 0 embeddings: connection lost`)
    expect(mockNotify).not.toHaveBeenCalled()
  })
})

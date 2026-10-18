/**
 * The cleanup_old_stories job (`.context/story-retention.md`): once a month, delete the old stories
 * nobody needs (counting them into `story_archive_counts` as they go) and clear the embeddings of the
 * old unpublished stories it keeps, so the database stops growing. Every run records a notice: the
 * result on success, or the job-failure notice (with what was done before the error) on failure.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { clearOldEmbeddingsBatch, deleteEmptyClusters, deleteOldStoriesBatch } from '../services/storyRetention.js'

const log = createLogger('cleanup_old_stories')

export interface CleanupResult {
  deletedByStatus: Record<string, number>
  deleted: number
  clustersDeleted: number
  embeddingsCleared: number
}

function describe(result: CleanupResult): string {
  const statuses = Object.entries(result.deletedByStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status} ${count}`)
    .join(', ')
  const deleted = `Deleted ${result.deleted} stories crawled more than ${config.storyRetention.maxAgeMonths} months ago`
  return [
    result.deleted > 0 ? `${deleted} (${statuses}).` : `${deleted}: none were due.`,
    `Cleared the embeddings of ${result.embeddingsCleared} older unpublished stories that were kept.`,
    result.clustersDeleted > 0 ? `Removed ${result.clustersDeleted} empty duplicate cluster${result.clustersDeleted === 1 ? '' : 's'}.` : null,
    'The deleted stories stay counted in the lifetime totals.',
  ].filter(Boolean).join(' ')
}

export async function runCleanupOldStories(): Promise<CleanupResult> {
  const result: CleanupResult = { deletedByStatus: {}, deleted: 0, clustersDeleted: 0, embeddingsCleared: 0 }
  const { batchSize } = config.storyRetention

  try {
    for (;;) {
      const batch = await deleteOldStoriesBatch()
      let batchTotal = 0
      for (const [status, count] of Object.entries(batch)) {
        result.deletedByStatus[status] = (result.deletedByStatus[status] ?? 0) + count
        batchTotal += count
      }
      result.deleted += batchTotal
      if (batchTotal < batchSize) break
    }
    result.clustersDeleted = await deleteEmptyClusters()
    for (;;) {
      const cleared = await clearOldEmbeddingsBatch()
      result.embeddingsCleared += cleared
      if (cleared < batchSize) break
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // Rethrown for the scheduler, whose job-failure notice carries this message.
    throw new Error(`Story cleanup failed after deleting ${result.deleted} stories and clearing ${result.embeddingsCleared} embeddings: ${reason}`)
  }

  log.info(result, 'old stories cleaned up')
  await notify({
    source: 'jobs',
    severity: 'info',
    title: 'Old stories cleaned up',
    message: describe(result),
    link: '/admin/jobs',
  })
  return result
}

/**
 * Cluster repair after member stories are deleted (`.context/dedup.md`), shared by `deleteStory()`
 * and the retention cleanup so both leave clusters in the same state. Each cluster is repaired in
 * its own transaction holding the cluster's row lock:
 * - a cluster left with one member or none is dissolved: the member leaves, the cluster row goes;
 * - a cluster that kept two or more members but lost its primary (`primary_story_id` is
 *   `ON DELETE SET NULL`) gets a new primary by the lifecycle module's election in pipeline mode,
 *   which never moves a story out of `rejected`.
 */
import { createLogger } from '../lib/logger.js'
import { reelectPrimary, withClusterLocks } from './storyLifecycle.js'

const log = createLogger('cluster-repair')

export interface ClusterRepairResult {
  /** Clusters removed because one member or none was left */
  dissolved: number
  /** Clusters that got a new primary */
  reElected: number
}

type Repair = 'dissolved' | 'reElected' | null

async function repairCluster(clusterId: string): Promise<Repair> {
  return withClusterLocks([clusterId], async (tx, locked) => {
    // A cluster another path already removed is not an error
    if (!locked.has(clusterId)) return null
    const remaining = await tx.story.count({ where: { clusterId } })
    if (remaining <= 1) {
      await tx.story.updateMany({ where: { clusterId }, data: { clusterId: null } })
      await tx.storyCluster.delete({ where: { id: clusterId } })
      log.info({ clusterId, remaining }, 'dissolved cluster after member deletion')
      return 'dissolved'
    }
    const cluster = await tx.storyCluster.findUnique({ where: { id: clusterId }, select: { primaryStoryId: true } })
    if (cluster && !cluster.primaryStoryId) {
      await reelectPrimary(clusterId, 'pipeline', tx)
      return 'reElected'
    }
    return null
  })
}

export async function repairClusters(clusterIds: Iterable<string>): Promise<ClusterRepairResult> {
  const result: ClusterRepairResult = { dissolved: 0, reElected: 0 }
  for (const clusterId of new Set(clusterIds)) {
    const repair = await repairCluster(clusterId)
    if (repair) result[repair]++
  }
  return result
}

/**
 * Story retention (`.context/story-retention.md`): what the monthly cleanup_old_stories job deletes,
 * the counts it keeps in `story_archive_counts`, and the lifetime totals that add those counts to
 * the live stories.
 *
 * Raw SQL throughout: each delete batch and its roll-up are one statement (a data-modifying CTE), so
 * a story can never be deleted without being counted, or counted twice. The cutoff is on the
 * database clock, like the other timestamps.
 */
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'

/** Statuses whose old stories are deleted. Every other unpublished status only loses its embedding. */
export const DELETABLE_STATUSES = ['fetched', 'pre_analyzed', 'rejected', 'trashed'] as const

const cutoff = (maxAgeDays: number) =>
  Prisma.sql`((now() AT TIME ZONE 'UTC') - make_interval(days => ${maxAgeDays}::int))`

/**
 * Delete up to `limit` stories crawled before the cutoff and add their counts to
 * `story_archive_counts`, in one statement. Kept whatever their age: published stories, stories a
 * newsletter, podcast or social post names, and every member of a cluster with a published story
 * (its "Also covered by" sources). Returns the deleted count per status.
 */
export async function deleteOldStoriesBatch(
  maxAgeDays: number = config.storyRetention.maxAgeDays,
  limit: number = config.storyRetention.batchSize,
): Promise<Record<string, number>> {
  const statuses = Prisma.join(DELETABLE_STATUSES.map(s => Prisma.sql`${s}::"StoryStatus"`))
  const rows = await prisma.$queryRaw<{ status: string; count: number }[]>`
    WITH doomed AS (
      SELECT s."id" FROM "stories" s
      WHERE s."date_crawled" < ${cutoff(maxAgeDays)}
        AND s."status" IN (${statuses})
        AND NOT EXISTS (SELECT 1 FROM "bluesky_posts" b WHERE b."story_id" = s."id")
        AND NOT EXISTS (SELECT 1 FROM "mastodon_posts" m WHERE m."story_id" = s."id")
        AND NOT EXISTS (SELECT 1 FROM "newsletters" n
                        WHERE s."id" = ANY(n."story_ids") OR s."id" = ANY(n."selected_story_ids"))
        AND NOT EXISTS (SELECT 1 FROM "podcasts" p WHERE s."id" = ANY(p."story_ids"))
        AND NOT EXISTS (SELECT 1 FROM "stories" o
                        WHERE s."cluster_id" IS NOT NULL AND o."cluster_id" = s."cluster_id"
                          AND o."status" = 'published')
      ORDER BY s."date_crawled"
      LIMIT ${limit}::int
      FOR UPDATE OF s SKIP LOCKED
    ),
    deleted AS (
      DELETE FROM "stories" s USING doomed d WHERE s."id" = d."id"
      RETURNING s."date_crawled", s."feed_id", s."issue_id", s."status", s."relevance_pre",
                s."relevance", s."emotion_tag"
    ),
    counted AS (
      INSERT INTO "story_archive_counts" ("id", "crawl_month", "feed_id", "issue_id", "status",
                                          "relevance_pre", "relevance", "emotion_tag", "story_count")
      SELECT gen_random_uuid()::text, date_trunc('month', "date_crawled")::date, "feed_id", "issue_id",
             "status"::text, "relevance_pre", "relevance", "emotion_tag"::text, count(*)::int
      FROM deleted
      GROUP BY 2, 3, 4, 5, 6, 7, 8
      RETURNING "status", "story_count"
    )
    SELECT "status", sum("story_count")::int AS "count" FROM counted GROUP BY "status"`
  return Object.fromEntries(rows.map(r => [r.status, Number(r.count)]))
}

/** Clusters left with no member once their stories are deleted. */
export async function deleteEmptyClusters(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "story_clusters" c
    WHERE NOT EXISTS (SELECT 1 FROM "stories" s WHERE s."cluster_id" = c."id")`
}

/**
 * Clear the embedding of up to `limit` unpublished stories crawled before the cutoff (the ones the
 * delete keeps). The hash goes too, so publishing such a story generates a new one (`ensureEmbedding`).
 */
export async function clearOldEmbeddingsBatch(
  maxAgeDays: number = config.storyRetention.maxAgeDays,
  limit: number = config.storyRetention.batchSize,
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "stories" SET "embedding" = NULL, "embedding_content_hash" = NULL, "embedding_generated_at" = NULL
    WHERE "id" IN (
      SELECT "id" FROM "stories"
      WHERE "date_crawled" < ${cutoff(maxAgeDays)}
        AND "status" <> 'published'
        AND "embedding" IS NOT NULL
      LIMIT ${limit}::int
    )`
}

export interface LifetimeStoryStats {
  /** Every story ever crawled: live plus deleted by the cleanup. */
  total: number
  /** Of those, the ones the cleanup deleted (counted in story_archive_counts). */
  archived: number
  byStatus: Record<string, number>
  /** Screening rating 1-10; "none" for stories never screened. */
  byRelevancePre: Record<string, number>
  /** Full-assessment rating 1-10; "none" for stories never fully assessed. */
  byRelevance: Record<string, number>
}

type CountRow = { key: string | null; count: number }

function addRows(target: Record<string, number>, rows: CountRow[]): void {
  for (const row of rows) {
    const key = row.key ?? 'none'
    target[key] = (target[key] ?? 0) + Number(row.count)
  }
}

/** Lifetime totals: the live stories plus the archived counts. */
export async function getLifetimeStoryStats(): Promise<LifetimeStoryStats> {
  const [liveStatus, livePre, liveRel, archStatus, archPre, archRel] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`SELECT "status"::text AS "key", count(*)::int AS "count" FROM "stories" GROUP BY 1`,
    prisma.$queryRaw<CountRow[]>`SELECT "relevance_pre"::text AS "key", count(*)::int AS "count" FROM "stories" GROUP BY 1`,
    prisma.$queryRaw<CountRow[]>`SELECT "relevance"::text AS "key", count(*)::int AS "count" FROM "stories" GROUP BY 1`,
    prisma.$queryRaw<CountRow[]>`SELECT "status" AS "key", sum("story_count")::int AS "count" FROM "story_archive_counts" GROUP BY 1`,
    prisma.$queryRaw<CountRow[]>`SELECT "relevance_pre"::text AS "key", sum("story_count")::int AS "count" FROM "story_archive_counts" GROUP BY 1`,
    prisma.$queryRaw<CountRow[]>`SELECT "relevance"::text AS "key", sum("story_count")::int AS "count" FROM "story_archive_counts" GROUP BY 1`,
  ])

  const byStatus: Record<string, number> = {}
  const byRelevancePre: Record<string, number> = {}
  const byRelevance: Record<string, number> = {}
  addRows(byStatus, liveStatus)
  addRows(byStatus, archStatus)
  addRows(byRelevancePre, livePre)
  addRows(byRelevancePre, archPre)
  addRows(byRelevance, liveRel)
  addRows(byRelevance, archRel)

  const sum = (rows: CountRow[]) => rows.reduce((n, r) => n + Number(r.count), 0)
  const archived = sum(archStatus)
  return { total: sum(liveStatus) + archived, archived, byStatus, byRelevancePre, byRelevance }
}

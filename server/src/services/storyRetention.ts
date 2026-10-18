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

const cutoff = (maxAgeMonths: number) =>
  Prisma.sql`((now() AT TIME ZONE 'UTC') - make_interval(months => ${maxAgeMonths}::int))`

/**
 * Delete up to `limit` stories crawled before the cutoff and add their counts to
 * `story_archive_counts`, in one statement. Kept whatever their age: published stories, stories a
 * newsletter, podcast or social post names, and every member of a cluster with a published story
 * (its "Also covered by" sources). Returns the deleted count per status.
 */
export async function deleteOldStoriesBatch(
  maxAgeMonths: number = config.storyRetention.maxAgeMonths,
  limit: number = config.storyRetention.batchSize,
): Promise<Record<string, number>> {
  const statuses = Prisma.join(DELETABLE_STATUSES.map(s => Prisma.sql`${s}::"StoryStatus"`))
  const rows = await prisma.$queryRaw<{ status: string; count: number }[]>`
    WITH doomed AS (
      SELECT s."id" FROM "stories" s
      WHERE s."date_crawled" < ${cutoff(maxAgeMonths)}
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
  maxAgeMonths: number = config.storyRetention.maxAgeMonths,
  limit: number = config.storyRetention.batchSize,
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "stories" SET "embedding" = NULL, "embedding_content_hash" = NULL, "embedding_generated_at" = NULL
    WHERE "id" IN (
      SELECT "id" FROM "stories"
      WHERE "date_crawled" < ${cutoff(maxAgeMonths)}
        AND "status" <> 'published'
        AND "embedding" IS NOT NULL
      LIMIT ${limit}::int
    )`
}

export interface LifetimeMonthRow {
  /** YYYY-MM, by crawl date */
  month: string
  crawled: number
  /** Got a screening rating */
  screened: number
  /** Got a full assessment */
  assessed: number
  published: number
  /** Of `crawled`, deleted by the cleanup */
  archived: number
}

export interface LifetimeGroupRow {
  id: string
  name: string
  crawled: number
  published: number
  archived: number
  /** Mean screening rating over the stories that got one, 1 decimal; null when none did */
  avgRelevancePre: number | null
  /** Stories with a screening rating of 7 or more */
  highPre: number
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
  /** Newest month first */
  byMonth: LifetimeMonthRow[]
  /** By feed (source), most crawled first */
  byFeed: LifetimeGroupRow[]
  /** By issue (the story's, else its feed's), most crawled first */
  byIssue: LifetimeGroupRow[]
}

/** A screening rating at or above this counts as "high" in the per-source and per-issue rows. */
export const HIGH_PRE_RATING = 7

interface CombinedRow {
  month: string
  feedId: string
  feedName: string | null
  issueId: string | null
  issueName: string | null
  status: string
  relevancePre: number | null
  relevance: number | null
  n: number
  archived: number
}

/**
 * Live stories and archived counts as one list of grouped rows, so every breakdown below adds the
 * two the same way. Issue: the story's, else its feed's (as the rest of the app reads it).
 */
async function loadCombinedRows(): Promise<CombinedRow[]> {
  const rows = await prisma.$queryRaw<CombinedRow[]>`
    WITH combined AS (
      SELECT date_trunc('month', s."date_crawled")::date AS month, s."feed_id", COALESCE(s."issue_id", f."issue_id") AS issue_id,
             s."status"::text AS status, s."relevance_pre", s."relevance", count(*)::int AS n, 0 AS archived
      FROM "stories" s JOIN "feeds" f ON f."id" = s."feed_id"
      GROUP BY 1, 2, 3, 4, 5, 6
      UNION ALL
      SELECT a."crawl_month", a."feed_id", COALESCE(a."issue_id", f."issue_id"), a."status", a."relevance_pre", a."relevance",
             sum(a."story_count")::int, sum(a."story_count")::int
      FROM "story_archive_counts" a LEFT JOIN "feeds" f ON f."id" = a."feed_id"
      GROUP BY 1, 2, 3, 4, 5, 6
    )
    SELECT to_char(c.month, 'YYYY-MM') AS "month", c."feed_id" AS "feedId",
           f."title" AS "feedName", c.issue_id AS "issueId", i."name" AS "issueName",
           c.status, c."relevance_pre" AS "relevancePre", c."relevance", c.n, c.archived
    FROM combined c
    LEFT JOIN "feeds" f ON f."id" = c."feed_id"
    LEFT JOIN "issues" i ON i."id" = c.issue_id`
  return rows.map(r => ({ ...r, n: Number(r.n), archived: Number(r.archived) }))
}

type GroupAcc = LifetimeGroupRow & { preSum: number; preCount: number }

function groupRows(rows: CombinedRow[], key: (r: CombinedRow) => [string, string]): LifetimeGroupRow[] {
  const groups = new Map<string, GroupAcc>()
  for (const r of rows) {
    const [id, name] = key(r)
    let g = groups.get(id)
    if (!g) {
      g = { id, name, crawled: 0, published: 0, archived: 0, avgRelevancePre: null, highPre: 0, preSum: 0, preCount: 0 }
      groups.set(id, g)
    }
    g.crawled += r.n
    g.archived += r.archived
    if (r.status === 'published') g.published += r.n
    if (r.relevancePre !== null) {
      g.preSum += r.relevancePre * r.n
      g.preCount += r.n
      if (r.relevancePre >= HIGH_PRE_RATING) g.highPre += r.n
    }
  }
  return [...groups.values()]
    .map(({ preSum, preCount, ...g }) => ({ ...g, avgRelevancePre: preCount ? Math.round((preSum / preCount) * 10) / 10 : null }))
    .sort((a, b) => b.crawled - a.crawled || a.name.localeCompare(b.name))
}

const ratingKey = (rating: number | null) => (rating === null ? 'none' : String(rating))
const bump = (target: Record<string, number>, key: string, n: number) => { target[key] = (target[key] ?? 0) + n }

/** Lifetime totals: the live stories plus the archived counts, overall and by month, feed and issue. */
export async function getLifetimeStoryStats(): Promise<LifetimeStoryStats> {
  const rows = await loadCombinedRows()

  const byStatus: Record<string, number> = {}
  const byRelevancePre: Record<string, number> = {}
  const byRelevance: Record<string, number> = {}
  const months = new Map<string, LifetimeMonthRow>()
  let total = 0
  let archived = 0

  for (const r of rows) {
    total += r.n
    archived += r.archived
    bump(byStatus, r.status, r.n)
    bump(byRelevancePre, ratingKey(r.relevancePre), r.n)
    bump(byRelevance, ratingKey(r.relevance), r.n)

    let m = months.get(r.month)
    if (!m) {
      m = { month: r.month, crawled: 0, screened: 0, assessed: 0, published: 0, archived: 0 }
      months.set(r.month, m)
    }
    m.crawled += r.n
    m.archived += r.archived
    if (r.relevancePre !== null) m.screened += r.n
    if (r.relevance !== null) m.assessed += r.n
    if (r.status === 'published') m.published += r.n
  }

  return {
    total,
    archived,
    byStatus,
    byRelevancePre,
    byRelevance,
    byMonth: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    byFeed: groupRows(rows, r => [r.feedId, r.feedName ?? 'Unknown feed']),
    byIssue: groupRows(rows, r => [r.issueId ?? 'none', r.issueName ?? 'No issue']),
  }
}

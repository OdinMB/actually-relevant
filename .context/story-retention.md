# Story Retention

The monthly `cleanup_old_stories` job keeps the database from growing without bound: it deletes old stories nobody needs, keeps their counts so lifetime totals survive, and clears the embeddings of the old unpublished stories it keeps (ADR-0039, its cutoff superseded by ADR-0042).

## What the job does

Each run, in this order (`jobs/cleanupOldStories.ts`, SQL in `services/storyRetention.ts`):

1. **Deletes old stories in batches** of `config.storyRetention.batchSize` (500) until a batch comes back short. A story is deleted when it was crawled more than `config.storyRetention.maxAgeMonths` (6) months ago on the database clock (`make_interval(months => …)`; the owner shortened it from a year on 2026-10-18), its status is `fetched`, `pre_analyzed`, `rejected` or `trashed` (`DELETABLE_STATUSES`), and none of these keeps it:
   - a Bluesky or Mastodon post row for it (the foreign keys are `RESTRICT`),
   - a newsletter that lists it in `story_ids` or `selected_story_ids`,
   - a podcast that lists it in `story_ids`,
   - a published story in its cluster (the published page's "Also covered by" sources).

   `published`, `analyzed` and `selected` stories are never deleted. A "Report an error" sent from a deleted story stays, its `feedback.story_id` set to NULL by the foreign key.
2. **Counts each deleted story in the same statement** (one data-modifying CTE: select with `FOR UPDATE SKIP LOCKED`, delete, insert the grouped counts into `story_archive_counts`). A story can never be deleted without being counted or counted twice.
3. **Repairs the clusters it took members from**, as `deleteStory()` does (`repairClusters()`, `dedup.md`): the delete statement also returns the deleted stories' cluster ids, and after the last batch a cluster left with one member or none is dissolved, and one that keeps two or more members but lost its primary (`primary_story_id` is `ON DELETE SET NULL`) gets a new primary by the lifecycle module's election in pipeline mode (`reelectPrimary()`, one transaction per cluster under its lock), which never restores a rejected story: an elected `duplicate` stays rejected, and a trashed or otherwise rejected member is never elected. Without this a lost primary would leave every member a non-primary (selection and auto-reject skip such a cluster).
4. **Clears the embeddings** (`embedding`, `embedding_content_hash`, `embedding_generated_at`) of every unpublished story crawled before the same cutoff, in batches. Clearing the hash is what makes `ensureEmbedding()` generate a new one.
5. **Records a notice** (source `jobs`, severity `info`, no dedupe key, so one row per run) with the deleted count per status, the cleared embeddings, the dissolved clusters and the re-elected primaries, including on a run where nothing was due.

`storyRetention.db.test.ts` runs all of this against PostgreSQL (`database-migrations.md`, "Integration Tests"): every deletable and kept status, each keep rule, the counts, batching and a second run, embedding clearing and the cluster repair.

A failure stops the run and throws "Story cleanup failed after deleting N stories and clearing M embeddings: <reason>", so the scheduler's job-failure notice (`job-failure:cleanup_old_stories`) carries what was done. Batches already committed stay committed; the next run carries on.

## Getting an embedding back

An old unpublished story without an embedding gets one again when it is:
- **published**, by any path (the publish job, `publishStory`, `updateStoryStatus`, bulk status, an admin edit setting `status: 'published'` through `updateStory`, all through `storyLifecycle.ts`), or **put back on the site** as a restored duplicate by a cluster edit or an editor's election: each ensures a missing embedding, before the flip for a publish and right after the commit for a restore. As everywhere, a failed generation is logged and the story goes live without one.
- **re-assessed**: the assessment writes a fresh embedding with the analysis.

Until then it is invisible to the semantic half of admin search, related stories and dedup candidates (dedup only looks 14 days back anyway).

## Summary table: `story_archive_counts`

One row per (crawl month, feed, issue, final status, screening rating, full rating, emotion tag) per delete batch, with `story_count`. Append-only: the same combination gets a row per batch that held it, so readers always `SUM(story_count)`. No foreign keys: a feed (soft-deleted, never removed) or issue can change, the counts stay. Nothing in the app writes to it except the delete statement.

## Lifetime totals

`getLifetimeStoryStats()` reads the live stories (grouped) and the archive rows as one list (`loadCombinedRows`) and adds them up the same way: `total`, `archived`, counts by status, screening rating (`relevancePre`) and full rating (`relevance`) with `none` for unrated, and rows by crawl month, by feed and by issue (the story's issue, else its feed's). Each feed and issue row has crawled, published, deleted, the mean screening rating and the count screened at `HIGH_PRE_RATING` (7) or above. `GET /api/admin/stories/lifetime-stats` serves it, uncached.

- **Stats page** (`/admin/stats`, "Stats" in the admin nav): tiles (crawled, screened, fully assessed, published, deleted by cleanup), both rating distributions, final status, then sortable tables by source and by issue and a table by month. Each source links to its feed's edit panel (`/admin/feeds?open=<id>`).
- **Dashboard**: one line of lifetime totals with a link to the Stats page. `GET /api/admin/stories/stats` (the status grid) still counts live stories only.
- **Feeds** (`feed-management.md`, Quality Metrics): `totalCrawled`, the publish rate and the new `avgRelevancePre` include archived stories, and `archivedCount` says how many; the feed table's Crawled column and the edit panel's quality card show them. The extraction-method breakdown counts live stories only, since the archive keeps no crawl method.

## Disk space

Deleted rows and cleared embeddings free space Postgres reuses for new rows (autovacuum), so the database stops growing; the files do not shrink. That is the goal (owner, 2026-10-18). Shrinking would take a manual `VACUUM FULL stories`, which locks the table while it runs.

## Schedule

`0 3 1 * *` (03:00 UTC on the 1st), seeded **enabled** by migration `20261018120000_story_retention` with no `last_completed_at`, so a deploy never starts it at boot: its first run is the next 1st, or a manual Run on the Jobs page. `estimateCronIntervalMs` reads a fixed day of the month as about 30 days, so once it has run it is overdue at boot only after about 60 days without a run.

## Key Files

| File | Role |
|------|------|
| `server/src/jobs/cleanupOldStories.ts` | The job: batches, notice, failure message |
| `server/src/services/storyRetention.ts` | Delete-and-count statement (with the touched cluster ids), embedding clearing, lifetime totals |
| `server/src/services/clusterRepair.ts` | `repairClusters()`, shared with `deleteStory()` |
| `server/src/services/storyRetention.db.test.ts` | The retention SQL and cluster repair against PostgreSQL |
| `server/src/routes/admin/stories.ts` | `GET /api/admin/stories/lifetime-stats` |
| `client/src/pages/admin/StatsPage.tsx` | The Stats page |
| `client/src/pages/admin/DashboardPage.tsx` | Lifetime totals line |
| `server/src/services/feed.ts` | `getAllFeedQualityMetrics()`: lifetime per-feed totals |
| `server/src/config.ts` | `storyRetention.maxAgeMonths`, `storyRetention.batchSize` |
| `server/src/jobs/jobSettings.ts` | The cutoff line shown under the job's name on the Jobs page (`setting` in `GET /api/admin/jobs`) |

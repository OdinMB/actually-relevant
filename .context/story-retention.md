# Story Retention

The monthly `cleanup_old_stories` job keeps the database from growing without bound: it deletes old stories nobody needs, keeps their counts so lifetime totals survive, and clears the embeddings of the old unpublished stories it keeps (ADR-0039).

## What the job does

Each run, in this order (`jobs/cleanupOldStories.ts`, SQL in `services/storyRetention.ts`):

1. **Deletes old stories in batches** of `config.storyRetention.batchSize` (500) until a batch comes back short. A story is deleted when it was crawled more than `config.storyRetention.maxAgeDays` (365) days ago on the database clock, its status is `fetched`, `pre_analyzed`, `rejected` or `trashed` (`DELETABLE_STATUSES`), and none of these keeps it:
   - a Bluesky or Mastodon post row for it (the foreign keys are `RESTRICT`),
   - a newsletter that lists it in `story_ids` or `selected_story_ids`,
   - a podcast that lists it in `story_ids`,
   - a published story in its cluster (the published page's "Also covered by" sources).

   `published`, `analyzed` and `selected` stories are never deleted.
2. **Counts each deleted story in the same statement** (one data-modifying CTE: select with `FOR UPDATE SKIP LOCKED`, delete, insert the grouped counts into `story_archive_counts`). A story can never be deleted without being counted or counted twice.
3. **Deletes empty clusters**, those no story points to any more. Deleting a cluster's primary sets `primary_story_id` to null (`ON DELETE SET NULL`); a cluster that keeps members without a primary is left as is, since its kept members are rejected anyway.
4. **Clears the embeddings** (`embedding`, `embedding_content_hash`, `embedding_generated_at`) of every unpublished story crawled before the same cutoff, in batches. Clearing the hash is what makes `ensureEmbedding()` generate a new one.
5. **Records a notice** (source `jobs`, severity `info`, no dedupe key, so one row per run) with the deleted count per status, the cleared embeddings and the removed clusters, including on a run where nothing was due.

A failure stops the run and throws "Story cleanup failed after deleting N stories and clearing M embeddings: <reason>", so the scheduler's job-failure notice (`job-failure:cleanup_old_stories`) carries what was done. Batches already committed stay committed; the next run carries on.

## Getting an embedding back

An old unpublished story without an embedding gets one again when it is:
- **published**, by any path (`publishStory`, `updateStoryStatus`, bulk publish's `publishChunk`): each calls `ensureEmbedding(s)` first. As everywhere, a failed generation is logged and the publish goes ahead without one.
- **re-assessed**: the assessment writes a fresh embedding with the analysis.

Until then it is invisible to the semantic half of admin search, related stories and dedup candidates (dedup only looks 14 days back anyway).

## Summary table: `story_archive_counts`

One row per (crawl month, feed, issue, final status, screening rating, full rating, emotion tag) per delete batch, with `story_count`. Append-only: the same combination gets a row per batch that held it, so readers always `SUM(story_count)`. No foreign keys: a feed (soft-deleted, never removed) or issue can change, the counts stay. Nothing in the app writes to it except the delete statement.

## Lifetime totals

`getLifetimeStoryStats()` adds the archive counts to the live stories: `total`, `archived`, and counts by status, screening rating (`relevancePre`) and full rating (`relevance`), with `none` for unrated. `GET /api/admin/stories/lifetime-stats` serves it and the admin Dashboard's "Lifetime Totals" section shows it. `GET /api/admin/stories/stats` still counts live stories only.

## Disk space

Deleted rows and cleared embeddings free space Postgres reuses for new rows (autovacuum), so the database stops growing; the files do not shrink. That is the goal (owner, 2026-10-18). Shrinking would take a manual `VACUUM FULL stories`, which locks the table while it runs.

## Schedule

`0 3 1 * *` (03:00 UTC on the 1st), seeded **enabled** by migration `20261018120000_story_retention` with no `last_completed_at`, so a deploy never starts it at boot: its first run is the next 1st, or a manual Run on the Jobs page. `estimateCronIntervalMs` reads a fixed day of the month as about 30 days, so once it has run it is overdue at boot only after about 60 days without a run.

## Key Files

| File | Role |
|------|------|
| `server/src/jobs/cleanupOldStories.ts` | The job: batches, notice, failure message |
| `server/src/services/storyRetention.ts` | Delete-and-count statement, empty clusters, embedding clearing, lifetime totals |
| `server/src/routes/admin/stories.ts` | `GET /api/admin/stories/lifetime-stats` |
| `client/src/pages/admin/DashboardPage.tsx` | Lifetime Totals section |
| `server/src/config.ts` | `storyRetention.maxAgeDays`, `storyRetention.batchSize` |

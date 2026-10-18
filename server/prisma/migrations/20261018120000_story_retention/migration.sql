-- Story retention (.context/story-retention.md): the cleanup_old_stories job adds the counts of the
-- stories it deletes here, in the same statement as the delete, so lifetime totals survive it.
-- Hand-written to match `prisma migrate diff`; no "stories_embedding_idx" drop.

-- CreateTable
CREATE TABLE "story_archive_counts" (
    "id" TEXT NOT NULL,
    "crawl_month" DATE NOT NULL,
    "feed_id" TEXT NOT NULL,
    "issue_id" TEXT,
    "status" TEXT NOT NULL,
    "relevance_pre" INTEGER,
    "relevance" INTEGER,
    "emotion_tag" TEXT,
    "story_count" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_archive_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_archive_counts_crawl_month_idx" ON "story_archive_counts"("crawl_month");

-- The monthly job, seeded enabled: 03:00 UTC on the 1st. No last_completed_at, so a deploy never
-- starts it at boot; the first run is the next 1st of the month (or a manual Run on the Jobs page).
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'cleanup_old_stories', true, '0 3 1 * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

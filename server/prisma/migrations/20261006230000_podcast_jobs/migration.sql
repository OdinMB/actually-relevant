-- Two-speaker podcast, phase 4: automation.
-- `review_reminder_sent_at` makes the Sunday reminder about an unfinished interactive episode
-- idempotent across the job's slots and processes (claimed with a conditional UPDATE).
-- Both job rows are seeded DISABLED (on/off is the admin Jobs page) and with
-- `last_completed_at = now()`, so the scheduler's boot catch-up does not run them just because
-- they never completed (ADR-0011).
-- Written by hand from the schema change (no `stories_embedding_idx` drop to remove).

-- AlterTable
ALTER TABLE "podcasts" ADD COLUMN     "review_reminder_sent_at" TIMESTAMP(3);

-- Seed the podcast jobs (disabled)
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "last_completed_at", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'generate_podcast', false, '0 6,10,14,18 * * 6,0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'publish_podcast', false, '0 7 * * 1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

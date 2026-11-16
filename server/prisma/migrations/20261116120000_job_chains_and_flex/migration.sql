-- Chains, flex processing and run costs (.context/scheduler.md, "Chains" and "Cost and flex"; owner
-- direction 2026-11-16).
-- Columns on job_runs: each job's Flex switch, a chain step's review pause and its "not before" time,
-- a chain's flex cut-off and deadline ("HH:MM" UTC), where a chain goes on from and, for a chain held
-- for a step's time, when it goes on; when its current run started; and what the last finished run spent.
-- Rows:
-- - Intake (crawl, pre-assess, assess) at 04, 10, 16 and 22 UTC: a feed lists only its newest
--   articles, so crawling stays several times a day, and a person's part starts with assessed stories.
-- - The daily edition (select, research, publish) at 23:00 UTC, an hour after the last intake, at
--   standard price from 03:30, research starting no new story after 05:00.
-- - The newsletter chain (Saturday 04:00 UTC: build and send the full edition, then Actually Uplifting)
--   and the podcast chain (Friday's slots build both shows' episodes; both publish steps are held until
--   Saturday 07:00 on the podcast's Berlin clock).
-- A chain's steps no longer run on their own schedules: a step's `enabled` is its On/Off in the chain,
-- and its cron expression is kept, unused, for a way back. The social post stays a job of its own.
-- Seeded ENABLED, so publishing moves from a fixed 02:45 UTC to as soon as the daily edition is done,
-- and what was off stays off through its step's switch. A never-completed row is not overdue at boot,
-- so a chain waits for its first cron tick.
-- Flex is on for every job by default (owner, 2026-11-16); a job without AI calls ignores it.
-- Written by hand (no index on story_embeddings is touched, so no `story_embeddings_embedding_idx` drop to remove).

ALTER TABLE "job_runs"
  ADD COLUMN "flex" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pause_for_review" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "not_before" TEXT,
  ADD COLUMN "flex_until" TEXT,
  ADD COLUMN "deadline" TEXT,
  ADD COLUMN "resume_step" TEXT,
  ADD COLUMN "resume_reason" TEXT,
  ADD COLUMN "resume_at" TIMESTAMP(3),
  ADD COLUMN "chain_started_at" TIMESTAMP(3),
  ADD COLUMN "last_run_usage" JSONB;

INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "flex_until", "deadline", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'daily_edition_chain', true, '0 23 * * *', '03:30', '05:00', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'intake_chain', true, '0 4,10,16,22 * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'newsletter_chain', true, '0 4 * * 6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'podcast_chain', true, '0 2,6,10,14,18 * * 5', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

UPDATE "job_runs" SET "not_before" = 'Sat 07:00', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" IN ('publish_podcast', 'publish_uplifting_podcast');

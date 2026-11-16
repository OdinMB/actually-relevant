-- Chains, flex processing and run costs (.context/scheduler.md, "Chains" and "Cost and flex"; owner
-- direction 2026-11-16).
-- Columns on job_runs: each job's Flex switch, a chain step's review pause and its "not before" time,
-- a chain's flex cut-off and deadline ("HH:MM" UTC), where a chain goes on from and, for a chain held
-- for a step's time, when it goes on; when its current run started; and what the last finished run spent.
-- Row: the daily edition (pre-assess, assess, select, research, publish, social post) at 23:00 UTC, at
-- standard price from 03:30, research starting no new story after 05:00, the social post held until
-- 11:30 UTC. Its steps no longer run on their own schedules: a step's `enabled` is its On/Off in the
-- chain, and its cron expression is kept, unused, for a way back.
-- Seeded ENABLED, so publishing moves from a fixed 02:45 UTC to as soon as the chain is done. A
-- never-completed row is not overdue at boot, so the chain waits for its first cron tick.
-- Crawling stays a job of its own, several times a day, so a busy feed's articles are read before they
-- drop off it; it moves to 04, 10, 16 and 22 UTC so the last crawl lands an hour before the chain.
-- Flex starts on the two assessment steps only, a week's measurement (design 2026-11-16, "Measure
-- first"); every other job starts at standard price.
-- Written by hand (no index on story_embeddings is touched, so no `story_embeddings_embedding_idx` drop to remove).

ALTER TABLE "job_runs"
  ADD COLUMN "flex" BOOLEAN NOT NULL DEFAULT false,
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

UPDATE "job_runs" SET "not_before" = '11:30', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'social_auto_post';

UPDATE "job_runs" SET "cron_expression" = '0 4,10,16,22 * * *', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'crawl_feeds';

UPDATE "job_runs" SET "flex" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" IN ('preassess_stories', 'assess_stories');

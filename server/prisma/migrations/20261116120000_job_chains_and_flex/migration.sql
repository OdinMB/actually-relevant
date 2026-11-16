-- Chains, flex processing and run costs (.context/scheduler.md, "Chains" and "Cost and flex"; owner
-- direction 2026-11-16).
-- Columns on job_runs: each job's Flex switch, a chain step's review pause, a chain's flex cut-off
-- and deadline ("HH:MM" UTC), where a chain goes on from, and what the last finished run spent.
-- Rows: the two chains. Intake (crawl, pre-assess, assess) at 03:00, 09:00, 15:00 and 21:00 UTC;
-- the daily edition (select, research, publish) at 23:00 UTC, at standard price from 03:30, research
-- starting no new story after 05:00. Their steps no longer run on their own schedules: a step's
-- `enabled` is its On/Off in the chain, and its cron expression is kept, unused, for a way back.
-- Seeded ENABLED, so publishing moves from a fixed 02:45 UTC to as soon as the chain is done. A
-- never-completed row is not overdue at boot, so each chain waits for its first cron tick.
-- Flex starts on the intake's two model steps only, a week's measurement before the daily edition
-- (design 2026-11-16, "Measure first"); every other job starts at standard price.
-- Written by hand (no index on story_embeddings is touched, so no `story_embeddings_embedding_idx` drop to remove).

ALTER TABLE "job_runs"
  ADD COLUMN "flex" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pause_for_review" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "flex_until" TEXT,
  ADD COLUMN "deadline" TEXT,
  ADD COLUMN "resume_step" TEXT,
  ADD COLUMN "resume_reason" TEXT,
  ADD COLUMN "last_run_usage" JSONB;

INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'intake_chain', true, '0 3,9,15,21 * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "flex_until", "deadline", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'daily_edition_chain', true, '0 23 * * *', '03:30', '05:00', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

UPDATE "job_runs" SET "flex" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" IN ('preassess_stories', 'assess_stories');

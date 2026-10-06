-- Podcast schedule (ADR-0013): episodes are generated on Friday and published on Saturday morning,
-- Berlin time. Moves the two seeded podcast job rows to their new cron expressions.
-- generate_podcast: Friday 02:00, 06:00, 10:00, 14:00, 18:00 on the server's clock (UTC on Render).
-- publish_podcast: Saturday 07:00, read on Europe/Berlin's clock by the scheduler
-- (server/src/jobs/jobTimeZones.ts), so it stays at 07:00 local across summer and winter time.
-- Only the cron expression changes: `enabled` and `last_completed_at` keep their values. A row whose
-- expression someone already changed by hand in the admin Jobs page is left alone.
-- Written by hand (data only; no schema change, so no `stories_embedding_idx` drop to remove).

UPDATE "job_runs" SET "cron_expression" = '0 2,6,10,14,18 * * 5', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'generate_podcast' AND "cron_expression" = '0 6,10,14,18 * * 6,0';

UPDATE "job_runs" SET "cron_expression" = '0 7 * * 6', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'publish_podcast' AND "cron_expression" = '0 7 * * 1';

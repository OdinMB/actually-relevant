-- The weekly podcast chain runs once on Friday, at 02:00 UTC, instead of at five slots (owner,
-- 2026-11-16): a failed build is now retried within that one run instead of by a later slot. Only a row still on the old default changes; a schedule set by hand stays.

UPDATE "job_runs" SET "cron_expression" = '0 2 * * 5', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'podcast_chain' AND "cron_expression" = '0 2,6,10,14,18 * * 5';

-- The research step runs once a day, between Select and Publish (.context/story-research.md, "The
-- pipeline step"; owner direction 2026-11-12). research_stories: daily at 02:20, 15 minutes after
-- select_stories (02:05), so a selection slowed by model retries is done before the step reads its
-- queue. publish_stories: from 02:15 to 02:45, so the step has 25 minutes for the day's selected
-- stories, several at once (config.research.pipeline.concurrency). A daily expression gives the
-- research job a 24-hour estimate, so it can now be overdue at boot like the other daily pipeline
-- jobs (only while enabled).
-- Only the cron expression changes: `enabled` and `last_completed_at` keep their values. A row whose
-- expression someone already changed by hand in the admin Jobs page is left alone.
-- Written by hand (data only; no schema change, so no `story_embeddings_embedding_idx` drop to remove).

UPDATE "job_runs" SET "cron_expression" = '20 2 * * *', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'research_stories' AND "cron_expression" = '15 * * * *';

UPDATE "job_runs" SET "cron_expression" = '45 2 * * *', "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'publish_stories' AND "cron_expression" = '15 2 * * *';

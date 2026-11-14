-- The research step is the norm (owner decision 2026-11-14; .context/story-research.md, "The
-- pipeline step"): there is no shadow mode and no gate on applying, so the `research_stories` job is
-- switched on. While it is enabled it researches the day's selected stories, applies each verdict
-- (the researched version, or a rejection for old news or a contradicted claim) and holds publishing
-- for them; it does nothing while TAVILY_API_KEY is unset. The admin Jobs page stays its off switch.
-- Only `enabled` changes: `cron_expression` and `last_completed_at` keep their values, so a job that
-- last finished more than 48 hours ago is overdue at the next boot, like any daily job.
-- Written by hand (data only; no schema change, so no `story_embeddings_embedding_idx` drop to remove).

UPDATE "job_runs" SET "enabled" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "job_name" = 'research_stories' AND "enabled" = false;

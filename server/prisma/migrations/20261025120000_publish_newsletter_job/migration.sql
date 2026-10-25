-- publish_newsletter: sends this week's automatic issue to all subscribers and marks it published.
-- Seeded DISABLED (on/off is the admin Jobs page), 30 minutes after generate_newsletter's default
-- `0 4 * * 6`. A never-completed row is not overdue at boot, so it waits for its first cron tick.
-- Written by hand (no schema change, no `stories_embedding_idx` drop to remove).

INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'publish_newsletter', false, '30 4 * * 6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

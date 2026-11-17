-- A chain's flex cut-off and deadline count in hours from the start of each run instead of a time of
-- day (owner, 2026-11-17): a time of day means nothing for a chain that runs several times a day.
-- Each existing time is turned into its hours after the chain's start where the chain starts once a
-- day ("M H * * *"; the daily edition's 23:00 start gives 03:30 -> 4.5 h and 05:00 -> 6 h), to the
-- nearest quarter hour; on any other schedule it becomes no cut-off.
-- Written by hand (no index on story_embeddings is touched, so no `story_embeddings_embedding_idx` drop to remove).

ALTER TABLE "job_runs"
  ADD COLUMN "flex_hours" DOUBLE PRECISION,
  ADD COLUMN "deadline_hours" DOUBLE PRECISION;

UPDATE "job_runs"
SET
  "flex_hours" = CASE WHEN "flex_until" ~ '^\d\d:\d\d$' THEN NULLIF(round(((
      (split_part("flex_until", ':', 1)::int * 60 + split_part("flex_until", ':', 2)::int)
      - (split_part("cron_expression", ' ', 2)::int * 60 + split_part("cron_expression", ' ', 1)::int)
      + 1440) % 1440) / 15.0) / 4.0, 0) END,
  "deadline_hours" = CASE WHEN "deadline" ~ '^\d\d:\d\d$' THEN NULLIF(round(((
      (split_part("deadline", ':', 1)::int * 60 + split_part("deadline", ':', 2)::int)
      - (split_part("cron_expression", ' ', 2)::int * 60 + split_part("cron_expression", ' ', 1)::int)
      + 1440) % 1440) / 15.0) / 4.0, 0) END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE ("flex_until" IS NOT NULL OR "deadline" IS NOT NULL)
  AND "cron_expression" ~ '^\d+ \d+ \* \* \*$';

-- reviewed-destructive: both values were carried over into flex_hours and deadline_hours above; no code reads the old columns
ALTER TABLE "job_runs"
  DROP COLUMN "flex_until",
  DROP COLUMN "deadline";

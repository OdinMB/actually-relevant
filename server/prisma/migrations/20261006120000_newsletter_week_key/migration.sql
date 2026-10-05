-- AlterTable: ISO week key of the automatic weekly issue (set only by the generate_newsletter job)
ALTER TABLE "newsletters" ADD COLUMN "week_key" TEXT;

-- Backfill: built issues titled "Week N, YYYY" (the job's title format) get "YYYY-Www",
-- so an issue built before this deploy still blocks its own week. Unbuilt rows stay null,
-- so the job's abandoned-draft cleanup can never reach a row it did not create.
UPDATE "newsletters"
SET "week_key" = substring("title" from '^Week \d+, (\d{4})$')
  || '-W'
  || lpad(substring("title" from '^Week (\d+), \d{4}$'), 2, '0')
WHERE "title" ~ '^Week \d+, \d{4}$'
  AND "html" <> '';

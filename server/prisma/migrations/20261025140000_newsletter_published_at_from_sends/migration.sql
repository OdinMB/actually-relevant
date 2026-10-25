-- An issue's public date is the date it was first emailed, when it was (newsletterArchive.ts,
-- publicationFields). Issues already published on the web before that rule carry the day they were
-- published instead; move each one back to its earliest live, not-failed send (sent_at, or
-- created_at for a scheduled send, which records no time of its own). Never moves a date forward.
-- Written by hand (no schema change, no `stories_embedding_idx` drop to remove).

UPDATE "newsletters" AS n
SET "published_at" = s.first_sent
FROM (
  SELECT "newsletter_id", MIN(COALESCE("sent_at", "created_at")) AS first_sent
  FROM "newsletter_sends"
  WHERE "is_test" = false AND "status" <> 'failed'
  GROUP BY "newsletter_id"
) AS s
WHERE n."id" = s."newsletter_id"
  AND n."published_at" IS NOT NULL
  AND s.first_sent < n."published_at";

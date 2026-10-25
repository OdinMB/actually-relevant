-- Public newsletter archive: a stable URL segment per issue and the date it was first published.

-- AlterTable
ALTER TABLE "newsletters" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "newsletters_slug_key" ON "newsletters"("slug");

-- Backfill issues that are already published: published_at from their last update, and a slug
-- from the title ("Week 42, 2026" -> "week-42-2026"), the same rule as newsletterSlugBase() in
-- services/newsletterArchive.ts. "archive" is the archive page's own path; repeats get -2, -3, ...
WITH base AS (
  SELECT
    id,
    created_at,
    COALESCE(NULLIF(trim(BOTH '-' FROM lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'issue') AS raw
  FROM "newsletters"
  WHERE status = 'published'
),
named AS (
  SELECT id, created_at, CASE WHEN raw = 'archive' THEN 'archive-issue' ELSE left(raw, 80) END AS name
  FROM base
),
numbered AS (
  SELECT id, name, row_number() OVER (PARTITION BY name ORDER BY created_at, id) AS n
  FROM named
)
UPDATE "newsletters" AS nl
SET slug = CASE WHEN numbered.n = 1 THEN numbered.name ELSE numbered.name || '-' || numbered.n END,
    published_at = nl.updated_at
FROM numbered
WHERE nl.id = numbered.id;

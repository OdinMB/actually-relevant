-- Standalone podcast episodes (ADR-0016): an episode is `weekly` (this ISO week's, the only kind the
-- generate and publish jobs touch) or `standalone` (built by hand from any published stories).
-- Every existing row, legacy ones included, becomes `weekly`; a legacy row stays recognisable by
-- `stage = legacy`. The CHECK keeps a standalone row's week key null, so it can never take a week's
-- unique key or be found as "this week's episode".
-- Written by hand from the schema change (no `stories_embedding_idx` drop to remove).

-- CreateEnum
CREATE TYPE "PodcastKind" AS ENUM ('weekly', 'standalone');

-- AlterTable
ALTER TABLE "podcasts" ADD COLUMN     "kind" "PodcastKind" NOT NULL DEFAULT 'weekly';

-- A standalone episode never carries a week key
ALTER TABLE "podcasts" ADD CONSTRAINT "podcasts_standalone_without_week_key" CHECK ("kind" <> 'standalone' OR "week_key" IS NULL);

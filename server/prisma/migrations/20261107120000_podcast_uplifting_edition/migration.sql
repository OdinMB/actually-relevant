-- The podcast's second show, Actually Uplifting (services/podcastEdition.ts, .context/podcast.md,
-- "Actually Uplifting show"): `podcasts.edition` names the show an episode belongs to. Every existing
-- episode becomes `full` through the constant default, which backfills without a table rewrite.
-- The week key is unique per show now, so a week holds one episode of each; standalone episodes stay
-- on the main show (CHECK). The missed-week claim is per show too.
-- generate_uplifting_podcast (Friday, 30 minutes after each generate_podcast slot) and
-- publish_uplifting_podcast (Saturday 07:00 on Berlin's clock, jobs/jobTimeZones.ts) are seeded
-- DISABLED; the admin refuses to enable either while the show is closed (PODCAST_UPLIFTING_ENABLED,
-- the owner's copy confirmation and the artwork). A never-completed row is not overdue at boot.
-- Written by hand from the schema change; it touches no index but the two named below, the story
-- embeddings index included.
-- reviewed-destructive: the dropped unique index and primary key are each replaced in this same migration by the per-show (edition, week_key) one; no row is lost.

-- CreateEnum
CREATE TYPE "PodcastEdition" AS ENUM ('full', 'uplifting');

-- AlterTable
ALTER TABLE "podcasts" ADD COLUMN     "edition" "PodcastEdition" NOT NULL DEFAULT 'full';

-- The week key, unique per show (replaces the unique index on week_key alone)
DROP INDEX "podcasts_week_key_key";
CREATE UNIQUE INDEX "podcasts_edition_week_key_key" ON "podcasts"("edition", "week_key");

-- Standalone episodes belong to the main show
ALTER TABLE "podcasts" ADD CONSTRAINT "podcasts_standalone_full_edition" CHECK ("kind" <> 'standalone' OR "edition" = 'full');

-- The missed-week claim, once per show and ISO week
ALTER TABLE "podcast_missed_week_alerts" ADD COLUMN     "edition" "PodcastEdition" NOT NULL DEFAULT 'full';
ALTER TABLE "podcast_missed_week_alerts" DROP CONSTRAINT "podcast_missed_week_alerts_pkey",
ADD CONSTRAINT "podcast_missed_week_alerts_pkey" PRIMARY KEY ("edition", "week_key");

-- The two weekly jobs of the Actually Uplifting show, disabled
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'generate_uplifting_podcast', false, '30 2,6,10,14,18 * * 5', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'publish_uplifting_podcast', false, '0 7 * * 6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

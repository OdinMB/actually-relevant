-- The newsletter's two editions (ADR-0052): `full`, as every issue so far, and `uplifting`, Actually
-- Uplifting's issue of uplifting stories only. Every existing issue and signup becomes `full` through
-- the constant default, which backfills without writing a value per row.
-- generate_uplifting_newsletter and publish_uplifting_newsletter are seeded DISABLED (on/off is the
-- admin Jobs page), 10 minutes after their full counterparts' defaults (`0 4 * * 6`, `30 4 * * 6`).
-- A never-completed row is not overdue at boot, so it waits for its first cron tick; the admin
-- refuses to enable either while the editions are not open (both Plunk segment variables set).
-- Written by hand from the schema change; it touches no index, the story embeddings index included.

-- CreateEnum
CREATE TYPE "NewsletterEdition" AS ENUM ('full', 'uplifting');

-- AlterTable
ALTER TABLE "newsletters" ADD COLUMN     "edition" "NewsletterEdition" NOT NULL DEFAULT 'full';

-- AlterTable
ALTER TABLE "pending_subscriptions" ADD COLUMN     "edition" "NewsletterEdition" NOT NULL DEFAULT 'full';

-- The two weekly jobs of the Actually Uplifting edition, disabled
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'generate_uplifting_newsletter', false, '10 4 * * 6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'publish_uplifting_newsletter', false, '40 4 * * 6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

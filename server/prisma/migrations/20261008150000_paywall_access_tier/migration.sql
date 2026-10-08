-- Paywalled stories (ADR-0030, ADR-0031, ADR-0032): the access tier classified at extraction, and
-- each feed's paywall setting. Existing stories stay null (= unknown; their HTML is gone, no
-- backfill); existing feeds get automatic detection on.
-- Written by hand in the shape db:migrate:create emits, so that authoring it did not apply the
-- pending admin_notices migration to the local database; it carries no DROP INDEX.

-- AlterTable
ALTER TABLE "feeds" ADD COLUMN     "paywall_detection" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paywall_title_marker" TEXT;

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "access_tier" TEXT;

-- Why a story is rejected (ADR-0046). Additive: a nullable column, a backfill and a CHECK that
-- the backfill satisfies, so it cannot fail on existing data.

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('paywall', 'assess_threshold', 'select_threshold', 'selection', 'duplicate', 'editor');

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "rejection_reason" "RejectionReason";

-- Backfill: locked stories were rejected at crawl (ADR-0031)
UPDATE "stories" SET "rejection_reason" = 'paywall'
WHERE "status" = 'rejected' AND "access_tier" = 'locked';

-- Backfill: rejected non-primary cluster members were auto-rejected as duplicates. Every other
-- rejection stays null, which no cluster dissolve ever restores.
UPDATE "stories" s SET "rejection_reason" = 'duplicate'
FROM "story_clusters" c
WHERE s."status" = 'rejected'
  AND s."rejection_reason" IS NULL
  AND s."cluster_id" = c."id"
  AND c."primary_story_id" IS DISTINCT FROM s."id";

-- A reason only on a rejected story: every move out of rejected clears it
ALTER TABLE "stories" ADD CONSTRAINT "stories_rejection_reason_only_when_rejected"
  CHECK ("status" = 'rejected' OR "rejection_reason" IS NULL);

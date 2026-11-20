-- Re-centering an overview's charter (.context/overviews.md, "Re-centering"; ADR-0071): the two
-- decision kinds (an automated re-center and an editor's new charter); when the charter was last
-- re-centered and by whom (an editor's or an Undo's keeps automation off it for 180 days); when
-- automation last tried, so only signals after it count; and the applied automated re-centers, at
-- most 2 before only an editor may re-center. The GIN index serves the re-center signals the link
-- decisions will keep (`inputs -> 'signals'`). A charter's `endEvent` may now be null in the jsonb;
-- stored charters keep their strings, so no data changes. Additive: nothing in production holds
-- overview rows yet. Authored with db:migrate:create; its proposed DROP INDEX
-- "story_embeddings_embedding_idx" removed.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OverviewDecisionKind" ADD VALUE 'recenter';
ALTER TYPE "OverviewDecisionKind" ADD VALUE 'editor_recenter';

-- AlterTable
ALTER TABLE "overviews" ADD COLUMN     "automated_recenters" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recenter_tried_at" TIMESTAMP(3),
ADD COLUMN     "recentered_at" TIMESTAMP(3),
ADD COLUMN     "recentered_by" TEXT;

-- The link decisions' re-center signals, found by containment (raw SQL: Prisma has no expression index)
CREATE INDEX "overview_decisions_link_signals" ON "overview_decisions" USING GIN ((inputs -> 'signals') jsonb_path_ops) WHERE kind = 'link';

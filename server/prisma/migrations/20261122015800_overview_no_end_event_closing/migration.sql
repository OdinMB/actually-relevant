-- Overviews close only by fading or an editor's Close (ADR-0072): the records only the end-event
-- closing used are dropped. The `closing` status, the `close` decision kind and the columns
-- `closing_since`, `closing_story_id` and `closure_reviewed_at` go; `end_event` was a value of the
-- plain-text `closed_reason`, so it needs no change here. The overviews step never ran anywhere, so
-- these columns and values hold no rows, and the enum casts below cannot fail on one.
-- Authored from db:migrate:diff (db:migrate:create refused to run non-interactively over the enum
-- warnings): its proposed DROP INDEX "story_embeddings_embedding_idx" removed, its BEGIN/COMMIT
-- removed (the file runs as one transaction, .context/database-migrations.md), and the partial
-- index on link decisions' signals dropped and created again around the decision kind's new type,
-- since its predicate compares `kind` with a value of the old type.

-- reviewed-destructive: the overviews step never ran, so these columns and values hold no rows; the index is created again below
DROP INDEX "overview_decisions_link_signals";

-- AlterEnum
CREATE TYPE "OverviewDecisionKind_new" AS ENUM ('link', 'found', 'role', 'stands', 'status', 'review', 'editor_attach', 'editor_detach', 'editor_role', 'editor_retitle', 'editor_freeze', 'editor_hide', 'editor_close', 'undo', 'recenter', 'editor_recenter');
ALTER TABLE "overview_decisions" ALTER COLUMN "kind" TYPE "OverviewDecisionKind_new" USING ("kind"::text::"OverviewDecisionKind_new");
ALTER TYPE "OverviewDecisionKind" RENAME TO "OverviewDecisionKind_old";
ALTER TYPE "OverviewDecisionKind_new" RENAME TO "OverviewDecisionKind";
-- reviewed-destructive: the overviews step never ran, so no decision has the `close` kind
DROP TYPE "public"."OverviewDecisionKind_old";

CREATE INDEX "overview_decisions_link_signals" ON "overview_decisions" USING GIN ((inputs -> 'signals') jsonb_path_ops) WHERE kind = 'link';

-- AlterEnum
CREATE TYPE "OverviewStatus_new" AS ENUM ('open', 'quiet', 'closed');
-- reviewed-destructive: the default is set again below, once the column has the new type
ALTER TABLE "public"."overviews" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "overviews" ALTER COLUMN "status" TYPE "OverviewStatus_new" USING ("status"::text::"OverviewStatus_new");
ALTER TYPE "OverviewStatus" RENAME TO "OverviewStatus_old";
ALTER TYPE "OverviewStatus_new" RENAME TO "OverviewStatus";
-- reviewed-destructive: the overviews step never ran, so no overview has the `closing` status
DROP TYPE "public"."OverviewStatus_old";
ALTER TABLE "overviews" ALTER COLUMN "status" SET DEFAULT 'open';

-- DropForeignKey
-- reviewed-destructive: the overviews step never ran, so `closing_story_id` holds no rows
ALTER TABLE "overviews" DROP CONSTRAINT "overviews_closing_story_id_fkey";

-- AlterTable
-- reviewed-destructive: the overviews step never ran, so these columns hold no rows
ALTER TABLE "overviews" DROP COLUMN "closing_since",
DROP COLUMN "closing_story_id",
DROP COLUMN "closure_reviewed_at";

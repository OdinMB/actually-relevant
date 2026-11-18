-- Ongoing-story overviews (.context/overviews.md, ADR-0070): the overviews, their entries (our
-- stories), the versions of "Where this stands" and the decisions log; the `link_overviews` job,
-- seeded DISABLED (a step of the daily edition after publishing; its cron expression is kept, unused,
-- as for every chain step), with a $10 spending warning level. Additive only: nothing is dropped or
-- altered on existing tables, no column is added to `stories`, and nothing reads these tables until
-- the job is switched on.
-- Authored with db:migrate:create; its proposed DROP INDEX "story_embeddings_embedding_idx" removed.

-- CreateEnum
CREATE TYPE "OverviewScope" AS ENUM ('single', 'forming', 'ongoing');

-- CreateEnum
CREATE TYPE "OverviewStatus" AS ENUM ('open', 'quiet', 'closing', 'closed');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('story');

-- CreateEnum
CREATE TYPE "EntryRole" AS ENUM ('turning_point', 'routine');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('active', 'detached');

-- CreateEnum
CREATE TYPE "StandsStatus" AS ENUM ('current', 'superseded');

-- CreateEnum
CREATE TYPE "OverviewDecisionKind" AS ENUM ('link', 'found', 'role', 'stands', 'status', 'close', 'review', 'editor_attach', 'editor_detach', 'editor_role', 'editor_retitle', 'editor_freeze', 'editor_hide', 'undo');

-- CreateTable
CREATE TABLE "overviews" (
    "id" TEXT NOT NULL,
    "slug" TEXT,
    "title" TEXT NOT NULL,
    "issue_id" TEXT,
    "scope" "OverviewScope" NOT NULL DEFAULT 'forming',
    "status" "OverviewStatus" NOT NULL DEFAULT 'open',
    "charter" JSONB NOT NULL,
    "charter_model" TEXT NOT NULL,
    "charter_prompt_version" TEXT NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "founded_at" TIMESTAMP(3) NOT NULL,
    "last_entry_at" TIMESTAMP(3),
    "closing_since" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "entries_at_last_review" INTEGER NOT NULL DEFAULT 0,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overview_entries" (
    "id" TEXT NOT NULL,
    "overview_id" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL DEFAULT 'story',
    "story_id" TEXT,
    "role" "EntryRole" NOT NULL,
    "role_kind" TEXT,
    "status" "EntryStatus" NOT NULL DEFAULT 'active',
    "judgment" "JudgmentStatus" NOT NULL DEFAULT 'unreviewed',
    "joined_by" TEXT NOT NULL,
    "detached_by" TEXT,
    "detach_reason" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "shared" JSONB,
    "confidence" DOUBLE PRECISION,
    "model" TEXT,
    "prompt_version" TEXT,
    "decision_id" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detached_at" TIMESTAMP(3),

    CONSTRAINT "overview_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overview_stands" (
    "id" TEXT NOT NULL,
    "overview_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "StandsStatus" NOT NULL DEFAULT 'current',
    "sentences" JSONB NOT NULL,
    "doing" JSONB NOT NULL DEFAULT '[]',
    "facts_seen" JSONB NOT NULL DEFAULT '[]',
    "as_of" DATE NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "record" JSONB,
    "written_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overview_stands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overview_decisions" (
    "id" TEXT NOT NULL,
    "kind" "OverviewDecisionKind" NOT NULL,
    "overview_id" TEXT,
    "story_id" TEXT,
    "outcome" TEXT NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "answer" JSONB,
    "model" TEXT,
    "prompt_version" TEXT,
    "confidence" DOUBLE PRECISION,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),
    "undone_by" TEXT,

    CONSTRAINT "overview_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "overviews_slug_key" ON "overviews"("slug");

-- CreateIndex
CREATE INDEX "overviews_scope_status_idx" ON "overviews"("scope", "status");

-- CreateIndex
CREATE INDEX "overviews_issue_id_idx" ON "overviews"("issue_id");

-- CreateIndex
CREATE INDEX "overview_entries_overview_id_status_idx" ON "overview_entries"("overview_id", "status");

-- CreateIndex
CREATE INDEX "overview_entries_story_id_idx" ON "overview_entries"("story_id");

-- CreateIndex
CREATE UNIQUE INDEX "overview_stands_overview_id_number_key" ON "overview_stands"("overview_id", "number");

-- CreateIndex
CREATE INDEX "overview_decisions_story_id_kind_idx" ON "overview_decisions"("story_id", "kind");

-- CreateIndex
CREATE INDEX "overview_decisions_overview_id_created_at_idx" ON "overview_decisions"("overview_id", "created_at");

-- AddForeignKey
ALTER TABLE "overviews" ADD CONSTRAINT "overviews_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overview_entries" ADD CONSTRAINT "overview_entries_overview_id_fkey" FOREIGN KEY ("overview_id") REFERENCES "overviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overview_entries" ADD CONSTRAINT "overview_entries_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overview_entries" ADD CONSTRAINT "overview_entries_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "overview_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overview_stands" ADD CONSTRAINT "overview_stands_overview_id_fkey" FOREIGN KEY ("overview_id") REFERENCES "overviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overview_decisions" ADD CONSTRAINT "overview_decisions_overview_id_fkey" FOREIGN KEY ("overview_id") REFERENCES "overviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overview_decisions" ADD CONSTRAINT "overview_decisions_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A `story` entry names its story; later entry kinds (watched sources, contributions) need no
-- constraint change.
ALTER TABLE "overview_entries" ADD CONSTRAINT "overview_entries_story_check" CHECK ("kind" <> 'story' OR "story_id" IS NOT NULL);

-- At most one active entry per story, and one current "Where this stands" per overview. Prisma
-- cannot model a partial index and leaves it out of its diffs; check:migrations fails on a drop of either.
CREATE UNIQUE INDEX "overview_entries_one_active" ON "overview_entries"("story_id") WHERE "status" = 'active';

CREATE UNIQUE INDEX "overview_stands_one_current" ON "overview_stands"("overview_id") WHERE "status" = 'current';

-- The step, disabled, and its warning level
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'link_overviews', false, '30 1 * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "spend_warnings" ("scope", "level_usd") VALUES ('link_overviews', 10)
ON CONFLICT DO NOTHING;

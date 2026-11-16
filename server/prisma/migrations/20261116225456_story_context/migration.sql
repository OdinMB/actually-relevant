-- Story context (.context/story-context.md): the context runs, facts and boxes, and the 7-day
-- search cache; the build_story_context step, the daily edition's fourth step after
-- publish_stories, seeded disabled (its cron expression is kept, unused, as for every chain step),
-- with a spending warning level of $20 (owner, 2026-11-16).
-- Authored with db:migrate:create; its proposed DROP INDEX "story_embeddings_embedding_idx" removed.

-- CreateEnum
CREATE TYPE "ContextValidity" AS ENUM ('fixed', 'slow', 'fast');

-- CreateEnum
CREATE TYPE "ContextVerdict" AS ENUM ('supported', 'rejected', 'unjudged');

-- CreateEnum
CREATE TYPE "JudgmentStatus" AS ENUM ('unreviewed', 'reviewed', 'demoted');

-- CreateEnum
CREATE TYPE "ContextBoxType" AS ENUM ('compared', 'why_now', 'build_up', 'who_affected', 'response', 'next', 'key_term', 'figures');

-- CreateEnum
CREATE TYPE "ContextRunStatus" AS ENUM ('running', 'completed', 'skipped', 'failed');

-- CreateTable
CREATE TABLE "story_context_runs" (
    "id" TEXT NOT NULL,
    "story_id" TEXT,
    "research_run_id" TEXT,
    "status" "ContextRunStatus" NOT NULL DEFAULT 'running',
    "outcome" TEXT,
    "boxes" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "model_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tavily_credits" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "story_context_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_facts" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "reused_from_id" TEXT,
    "source_url" TEXT NOT NULL,
    "source_outlet" TEXT NOT NULL,
    "source_title" TEXT NOT NULL,
    "source_date" DATE,
    "source_kind" TEXT NOT NULL,
    "supporting_sentence" TEXT NOT NULL,
    "passage" TEXT,
    "support_found" BOOLEAN NOT NULL DEFAULT false,
    "statement" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "value_high" DOUBLE PRECISION,
    "unit" TEXT NOT NULL DEFAULT '',
    "approx" TEXT NOT NULL DEFAULT 'exact',
    "provisional" BOOLEAN NOT NULL DEFAULT false,
    "counted" TEXT NOT NULL DEFAULT '',
    "place" TEXT NOT NULL DEFAULT '',
    "as_of" DATE,
    "as_of_precision" TEXT,
    "credited" TEXT NOT NULL DEFAULT '',
    "credited_kind" TEXT,
    "validity" "ContextValidity" NOT NULL DEFAULT 'fixed',
    "verdict" "ContextVerdict" NOT NULL,
    "verdict_problem" TEXT,
    "status" "JudgmentStatus" NOT NULL DEFAULT 'unreviewed',
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_boxes" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "ContextBoxType" NOT NULL,
    "heading" TEXT NOT NULL,
    "teaser" TEXT NOT NULL DEFAULT '',
    "sentences" JSONB NOT NULL,
    "visual" JSONB,
    "gap" BOOLEAN NOT NULL DEFAULT false,
    "as_of" DATE,
    "as_of_precision" TEXT,
    "place" TEXT,
    "place_by_editor" BOOLEAN NOT NULL DEFAULT false,
    "status" "JudgmentStatus" NOT NULL DEFAULT 'unreviewed',
    "model" TEXT,
    "prompt_version" TEXT,
    "written_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_search_cache" (
    "key" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "credits" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_search_cache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "story_context_runs_story_id_idx" ON "story_context_runs"("story_id");

-- CreateIndex
CREATE INDEX "story_context_runs_started_at_idx" ON "story_context_runs"("started_at");

-- CreateIndex
CREATE INDEX "context_facts_story_id_idx" ON "context_facts"("story_id");

-- CreateIndex
CREATE UNIQUE INDEX "context_facts_run_id_ref_key" ON "context_facts"("run_id", "ref");

-- CreateIndex
CREATE INDEX "context_boxes_story_id_idx" ON "context_boxes"("story_id");

-- CreateIndex
CREATE INDEX "context_search_cache_created_at_idx" ON "context_search_cache"("created_at");

-- AddForeignKey
ALTER TABLE "story_context_runs" ADD CONSTRAINT "story_context_runs_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_context_runs" ADD CONSTRAINT "story_context_runs_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "story_research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "story_context_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_boxes" ADD CONSTRAINT "context_boxes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_boxes" ADD CONSTRAINT "context_boxes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "story_context_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The step, disabled, and its warning level
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'build_story_context', false, '30 1 * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "spend_warnings" ("scope", "level_usd") VALUES ('build_story_context', 20)
ON CONFLICT DO NOTHING;

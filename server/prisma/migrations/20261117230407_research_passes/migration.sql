-- Research passes (.context/research-passes.md, ADR-0067): one repeatable step over one evidence pool
-- per story. The pass rows, the pool (searches, sources, facts), the article's versions and the
-- cards a pass wrote; the `research_pass` job, seeded DISABLED (it joins the daily edition chain
-- later; its cron expression is kept, unused, as for every chain step), with build_story_context's
-- $20 spending warning level. Additive only: nothing reads these tables until the job is switched on,
-- and the research and context run tables are left as they are.
-- Authored with db:migrate:create; its proposed DROP INDEX "story_embeddings_embedding_idx" removed.

-- CreateEnum
CREATE TYPE "PassKind" AS ENUM ('first', 'later');

-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('running', 'completed', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "VersionKind" AS ENUM ('first', 'update', 'legacy');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('current', 'superseded', 'reverted');

-- CreateEnum
CREATE TYPE "FactDropReason" AS ENUM ('contradicted', 'editor');

-- CreateTable
CREATE TABLE "research_passes" (
    "id" TEXT NOT NULL,
    "story_id" TEXT,
    "number" INTEGER NOT NULL,
    "trigger" "ResearchRunTrigger" NOT NULL,
    "kind" "PassKind" NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'running',
    "outcome" TEXT,
    "verdict" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "model_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tavily_credits" INTEGER NOT NULL DEFAULT 0,
    "record" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "version_id" TEXT,

    CONSTRAINT "research_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_searches" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "pass_id" TEXT,
    "kind" TEXT NOT NULL,
    "slot" TEXT,
    "angle" TEXT,
    "query" TEXT NOT NULL,
    "normalized_query" TEXT NOT NULL,
    "window_start" DATE,
    "window_end" DATE,
    "depth" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_sources" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "ref" TEXT,
    "origin" TEXT NOT NULL,
    "earlier_story_id" TEXT,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "outlet" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "published_date" DATE,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "country" TEXT NOT NULL DEFAULT '',
    "relation" TEXT NOT NULL DEFAULT '',
    "favicon" TEXT,
    "used_raw_content" BOOLEAN NOT NULL DEFAULT false,
    "voices" JSONB NOT NULL DEFAULT '[]',
    "first_pass_id" TEXT,
    "opt_out_checked" BOOLEAN NOT NULL DEFAULT false,
    "drop_reason" TEXT,
    "drop_pass_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_facts" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "fact_key" TEXT NOT NULL,
    "reused_from_id" TEXT,
    "supporting_sentence" TEXT NOT NULL,
    "passage" TEXT,
    "support_found" BOOLEAN NOT NULL DEFAULT false,
    "statement" TEXT NOT NULL,
    "measures" TEXT NOT NULL DEFAULT '',
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
    "slot" TEXT,
    "extract_model" TEXT NOT NULL,
    "extract_prompt_version" TEXT NOT NULL,
    "structure_model" TEXT,
    "structure_prompt_version" TEXT,
    "first_pass_id" TEXT,
    "verdict" "ContextVerdict" NOT NULL DEFAULT 'unjudged',
    "verdict_problem" TEXT,
    "check_model" TEXT,
    "check_prompt_version" TEXT,
    "checked_pass_id" TEXT,
    "status" "JudgmentStatus" NOT NULL DEFAULT 'unreviewed',
    "dropped_pass_id" TEXT,
    "drop_reason" "FactDropReason",
    "contradicted_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_versions" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "pass_id" TEXT,
    "kind" "VersionKind" NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'current',
    "title" TEXT,
    "title_label" TEXT,
    "summary" TEXT,
    "marketing_blurb" TEXT,
    "quote" TEXT,
    "quote_attribution" TEXT,
    "relevance_reasons" TEXT,
    "antifactors" TEXT,
    "emotion_tag" "EmotionTag",
    "research" JSONB NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "note" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pass_boxes" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "pass_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "ContextBoxType" NOT NULL,
    "heading" TEXT NOT NULL,
    "teaser" TEXT NOT NULL DEFAULT '',
    "sentences" JSONB NOT NULL,
    "visual" JSONB,
    "as_of" DATE,
    "as_of_precision" TEXT,
    "place" TEXT,
    "place_by_editor" BOOLEAN NOT NULL DEFAULT false,
    "status" "JudgmentStatus" NOT NULL DEFAULT 'unreviewed',
    "model" TEXT,
    "prompt_version" TEXT,
    "written_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pass_boxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_passes_version_id_key" ON "research_passes"("version_id");

-- CreateIndex
CREATE INDEX "research_passes_started_at_idx" ON "research_passes"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "research_passes_story_id_number_key" ON "research_passes"("story_id", "number");

-- CreateIndex
CREATE INDEX "evidence_searches_story_id_idx" ON "evidence_searches"("story_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_sources_story_id_normalized_url_key" ON "evidence_sources"("story_id", "normalized_url");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_sources_story_id_ref_key" ON "evidence_sources"("story_id", "ref");

-- CreateIndex
CREATE INDEX "pool_facts_source_id_idx" ON "pool_facts"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "pool_facts_story_id_fact_key_key" ON "pool_facts"("story_id", "fact_key");

-- CreateIndex
CREATE UNIQUE INDEX "pool_facts_story_id_ref_key" ON "pool_facts"("story_id", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "article_versions_story_id_number_key" ON "article_versions"("story_id", "number");

-- CreateIndex
CREATE INDEX "pass_boxes_story_id_idx" ON "pass_boxes"("story_id");

-- CreateIndex
CREATE INDEX "pass_boxes_pass_id_idx" ON "pass_boxes"("pass_id");

-- AddForeignKey
ALTER TABLE "research_passes" ADD CONSTRAINT "research_passes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_passes" ADD CONSTRAINT "research_passes_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "article_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_searches" ADD CONSTRAINT "evidence_searches_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_searches" ADD CONSTRAINT "evidence_searches_pass_id_fkey" FOREIGN KEY ("pass_id") REFERENCES "research_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_first_pass_id_fkey" FOREIGN KEY ("first_pass_id") REFERENCES "research_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_drop_pass_id_fkey" FOREIGN KEY ("drop_pass_id") REFERENCES "research_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_facts" ADD CONSTRAINT "pool_facts_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_facts" ADD CONSTRAINT "pool_facts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "evidence_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_facts" ADD CONSTRAINT "pool_facts_first_pass_id_fkey" FOREIGN KEY ("first_pass_id") REFERENCES "research_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_facts" ADD CONSTRAINT "pool_facts_checked_pass_id_fkey" FOREIGN KEY ("checked_pass_id") REFERENCES "research_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_facts" ADD CONSTRAINT "pool_facts_dropped_pass_id_fkey" FOREIGN KEY ("dropped_pass_id") REFERENCES "research_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_pass_id_fkey" FOREIGN KEY ("pass_id") REFERENCES "research_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pass_boxes" ADD CONSTRAINT "pass_boxes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pass_boxes" ADD CONSTRAINT "pass_boxes_pass_id_fkey" FOREIGN KEY ("pass_id") REFERENCES "research_passes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one current version per story. Prisma cannot model a partial index, so a generated
-- migration proposes dropping it: delete that line (check:migrations fails on a drop of it).
CREATE UNIQUE INDEX "article_versions_one_current" ON "article_versions"("story_id") WHERE "status" = 'current';

-- The step, disabled, and its warning level
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'research_pass', false, '30 1 * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "spend_warnings" ("scope", "level_usd") VALUES ('research_pass', 20)
ON CONFLICT DO NOTHING;

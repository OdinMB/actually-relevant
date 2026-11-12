-- Story research runs, the admin action (.context/story-research.md): one row per run, every run
-- kept. A deleted story's runs keep a null story_id (ON DELETE SET NULL), so the month's spend still
-- counts them. Additive only. Authored with db:migrate:create; its proposed
-- DROP INDEX "story_embeddings_embedding_idx" (Prisma cannot model the HNSW index) was deleted.

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "story_research_runs" (
    "id" TEXT NOT NULL,
    "story_id" TEXT,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'running',
    "verdict" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "tavily_credits" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "story_research_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_research_runs_story_id_started_at_idx" ON "story_research_runs"("story_id", "started_at");

-- CreateIndex
CREATE INDEX "story_research_runs_started_at_idx" ON "story_research_runs"("started_at");

-- AddForeignKey
ALTER TABLE "story_research_runs" ADD CONSTRAINT "story_research_runs_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

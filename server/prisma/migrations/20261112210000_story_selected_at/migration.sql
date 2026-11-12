-- When a story last entered `selected` (.context/story-research.md, "The pipeline step"): the
-- publish gate holds a story for research at most config.research.pipeline.maxWaitMinutes from it.
-- Only the lifecycle's move into `selected` sets it (test/statusWriters.test.ts).
-- The stories selected now take their last write as an approximation; a NULL is never held.
-- Written by hand in the shape db:migrate:create emits, since the authoring environment had no local
-- database; additive only, and it carries no DROP INDEX, the story embeddings index included.

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "selected_at" TIMESTAMP(3);

-- Backfill
UPDATE "stories" SET "selected_at" = "updated_at" WHERE "status" = 'selected';

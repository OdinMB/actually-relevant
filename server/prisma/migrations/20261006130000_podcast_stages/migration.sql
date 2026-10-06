-- Two-speaker podcast, phase 1: production stage, weekly key, dialogue, show notes, failure, block and lease fields.

-- CreateEnum
CREATE TYPE "PodcastStage" AS ENUM ('legacy', 'created', 'scripted', 'voiced', 'ready');

-- AlterTable
-- The stage column is added with default 'legacy' so existing rows backfill as legacy, then new rows default to 'created'.
ALTER TABLE "podcasts" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blocked_at" TIMESTAMP(3),
ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "dialogue" JSONB,
ADD COLUMN     "dry_run" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "episode_stories" JSONB,
ADD COLUMN     "episode_summary" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "lease_owner" TEXT,
ADD COLUMN     "lease_until" TIMESTAMP(3),
ADD COLUMN     "script_model_id" TEXT,
ADD COLUMN     "show_notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "stage" "PodcastStage" NOT NULL DEFAULT 'legacy',
ADD COLUMN     "week_key" TEXT;

ALTER TABLE "podcasts" ALTER COLUMN "stage" SET DEFAULT 'created';

-- CreateIndex
CREATE UNIQUE INDEX "podcasts_week_key_key" ON "podcasts"("week_key");

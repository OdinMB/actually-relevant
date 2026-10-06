-- Two-speaker podcast, phase 2b: interactive and automated modes.
-- A new `selected` stage between `created` and `scripted` (stories chosen, script not written yet),
-- the per-episode mode, the "edited by a person" flag, the TTS seed of the current render, and when
-- the stories were selected (the anchor of the week's pool the story picker lists).
-- Written from `db:migrate:diff` (its `DROP INDEX "stories_embedding_idx"` left out).

-- AlterEnum
ALTER TYPE "PodcastStage" ADD VALUE 'selected' BEFORE 'scripted';

-- CreateEnum
CREATE TYPE "PodcastMode" AS ENUM ('automated', 'interactive');

-- AlterTable
ALTER TABLE "podcasts" ADD COLUMN     "human_edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mode" "PodcastMode",
ADD COLUMN     "stories_selected_at" TIMESTAMP(3),
ADD COLUMN     "tts_seed" INTEGER;

-- Episodes already past `created` were produced in one run, as an automated run is now, which
-- selected their stories right after the row was created.
UPDATE "podcasts" SET "mode" = 'automated', "stories_selected_at" = "created_at" WHERE "stage" NOT IN ('legacy', 'created');

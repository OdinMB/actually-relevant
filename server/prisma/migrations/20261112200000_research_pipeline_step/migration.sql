-- The research pipeline step (.context/story-research.md, "The pipeline step"): three rejection reasons
-- for its verdicts, who started each research run, and the `research_stories` job, seeded DISABLED
-- (on/off is the admin Jobs page; nothing researches or waits until the owner enables it). Hourly at
-- :15; its hour field `*` keeps it out of the boot catch-up. Existing runs were all started by an
-- editor, which the column's default records.
-- Written by hand in the shape db:migrate:create emits, since the authoring environment had no local
-- database; additive only, and it carries no DROP INDEX, the story embeddings index included.

-- AlterEnum
ALTER TYPE "RejectionReason" ADD VALUE 'research_rating';
ALTER TYPE "RejectionReason" ADD VALUE 'stale';
ALTER TYPE "RejectionReason" ADD VALUE 'contradicted';

-- CreateEnum
CREATE TYPE "ResearchRunTrigger" AS ENUM ('editor', 'pipeline');

-- AlterTable
ALTER TABLE "story_research_runs" ADD COLUMN     "trigger" "ResearchRunTrigger" NOT NULL DEFAULT 'editor';

-- The job row
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'research_stories', false, '15 * * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

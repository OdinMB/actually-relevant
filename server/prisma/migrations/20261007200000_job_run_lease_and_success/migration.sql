-- AlterTable
ALTER TABLE "job_runs" ADD COLUMN     "last_succeeded_at" TIMESTAMP(3),
ADD COLUMN     "locked_by" TEXT,
ADD COLUMN     "locked_until" TIMESTAMP(3);

-- Backfill: a finished run without an error was a success
UPDATE "job_runs" SET "last_succeeded_at" = "last_completed_at"
WHERE "last_completed_at" IS NOT NULL AND "last_error" IS NULL;

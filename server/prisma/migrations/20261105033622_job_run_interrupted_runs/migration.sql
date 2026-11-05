-- AlterTable: consecutive interrupted runs of a job (.context/scheduler.md, "Interrupted runs")
ALTER TABLE "job_runs" ADD COLUMN     "interrupted_runs" INTEGER NOT NULL DEFAULT 0;

-- Admin notices (ADR-0028): every owner alert is kept here and shown in the admin; WEBHOOK_URL
-- only forwards. A repeat of a dedupe key folds into its row (services/adminNotices.ts).
-- Authored with db:migrate:create; its `DROP INDEX "stories_embedding_idx"` was removed.

-- CreateTable
CREATE TABLE "admin_notices" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "dedupe_key" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMP(3),

    CONSTRAINT "admin_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_notices_dedupe_key_key" ON "admin_notices"("dedupe_key");

-- CreateIndex
CREATE INDEX "admin_notices_seen_at_last_occurred_at_idx" ON "admin_notices"("seen_at", "last_occurred_at");

-- The Plunk complaint and bounce poll (ADR-0029), seeded enabled: it only reads, and does nothing
-- without PLUNK_SECRET_KEY. No last_completed_at: an hourly cron has no catch-up interval.
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'poll_plunk_activity', true, '20 * * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Signups over the hourly confirmation-email limit are accepted and wait in pending_subscriptions
-- until the send_queued_confirmations job sends their email, oldest first, within the limit
-- (services/subscribeLimits.ts, jobs/sendQueuedConfirmations.ts). sent_at is when the confirmation
-- email went out, NULL while the signup waits; the limits count sends by it.
-- Written by hand, not by db:migrate:create: Prisma adds the column with its default in one
-- statement, which stamps every existing row with this migration's time, and the hourly limit would
-- then count them all as sent in the last hour.

-- AlterTable
ALTER TABLE "pending_subscriptions" ADD COLUMN "sent_at" TIMESTAMP(3);

-- Every existing row stands for an email sent when the row was created (ADR-0022).
UPDATE "pending_subscriptions" SET "sent_at" = "created_at";

-- A row written without sent_at is a sent email: the direct send, and the previous release, which
-- keeps writing rows while both run during a deploy, so the job never sends those a second time.
ALTER TABLE "pending_subscriptions" ALTER COLUMN "sent_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Seeded enabled: a queued signup was told its email is on its way, and only this job sends it.
-- It does nothing while the queue is empty or SUBSCRIPTIONS_ENABLED is off. Every ten minutes; the
-- hour field `*` gives no catch-up interval, so it is never overdue at boot.
INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'send_queued_confirmations', true, '*/10 * * * *', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

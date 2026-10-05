-- Reconcile drift between schema.prisma and the migration history (2026-10-05).
-- `prisma migrate diff` from a fully migrated database to the schema also emits
-- DROP INDEX "stories_embedding_idx"; it is deliberately left out. That pgvector HNSW
-- index comes from raw SQL in 20260206120000_add_embedding_fields and Prisma cannot model
-- it; src/test/migrations.test.ts fails if a migration drops it.

-- newsletter_sends.html_content: the Prisma field is required with no default, so every
-- insert already supplies it. The database default only hid that.
ALTER TABLE "newsletter_sends" ALTER COLUMN "html_content" DROP DEFAULT;

-- newsletter_sends.stats: created nullable, and the insert paths never set it. Backfill
-- with the empty object the schema default and the admin stats display expect, then
-- enforce it.
UPDATE "newsletter_sends" SET "stats" = '{}' WHERE "stats" IS NULL OR "stats" = 'null'::jsonb;

ALTER TABLE "newsletter_sends" ALTER COLUMN "stats" SET NOT NULL,
ALTER COLUMN "stats" SET DEFAULT '{}';

-- CreateIndex
CREATE INDEX "newsletter_sends_plunk_campaign_id_idx" ON "newsletter_sends"("plunk_campaign_id");

-- CreateIndex
-- Tokens are randomUUID() values, so duplicates are not expected. If one exists, this
-- statement fails and the whole migration rolls back; no row is deleted.
CREATE UNIQUE INDEX "pending_subscriptions_token_key" ON "pending_subscriptions"("token");

-- RenameIndex: the index followed feeds.url when it was renamed to rss_url.
ALTER INDEX "feeds_url_key" RENAME TO "feeds_rss_url_key";

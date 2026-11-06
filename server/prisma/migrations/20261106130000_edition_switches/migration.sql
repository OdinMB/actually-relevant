-- Each subscriber's latest switch of newsletter edition from an issue's footer link (ADR-0052), one
-- row per Plunk contact: with the confirmed signups it tells the closed-editions guard who is on
-- Actually Uplifting (services/knownEditions.ts). It holds the Plunk contact id, which
-- pending_subscriptions already stores, and no address. Additive: a new, empty table.
-- From `db:migrate:diff`, with its `DROP INDEX "story_embeddings_embedding_idx"` line deleted.

-- CreateTable
CREATE TABLE "edition_switches" (
    "plunk_contact_id" TEXT NOT NULL,
    "edition" "NewsletterEdition" NOT NULL,
    "switched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edition_switches_pkey" PRIMARY KEY ("plunk_contact_id")
);

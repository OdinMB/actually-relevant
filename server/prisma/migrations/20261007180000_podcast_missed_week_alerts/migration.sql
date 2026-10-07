-- The missed-week alert: when publish_podcast runs on its Saturday and finds no weekly episode to
-- publish, it claims the ISO week here (INSERT ... ON CONFLICT DO NOTHING) before notifying, so a
-- retry or a boot catch-up the same week sends nothing more.
-- Written by hand from the schema change (no `stories_embedding_idx` drop to remove).

-- CreateTable
CREATE TABLE "podcast_missed_week_alerts" (
    "week_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "podcast_missed_week_alerts_pkey" PRIMARY KEY ("week_key")
);

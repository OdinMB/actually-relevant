-- Feed favicons in the database (.context/feed-management.md, "Favicons"): the 32 px PNG the API
-- serves at GET /api/feeds/:id/favicon, one row per feed, deleted with its feed. They used to be
-- files under client/public/images/feeds/, which reached the site only with a commit and a rebuild.
-- The table starts empty; the client falls back to those committed files until an admin runs
-- "Fetch All Favicons".
-- Written by hand in the shape db:migrate:create emits, since the authoring environment had no local
-- database; it carries no DROP INDEX.

-- CreateTable
CREATE TABLE "feed_favicons" (
    "feed_id" TEXT NOT NULL,
    "png" BYTEA NOT NULL,
    "source_url" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_favicons_pkey" PRIMARY KEY ("feed_id")
);

-- AddForeignKey
ALTER TABLE "feed_favicons" ADD CONSTRAINT "feed_favicons_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

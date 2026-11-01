-- Where the crawler takes a feed's article text (.context/content-extraction.md, "Full Text from the
-- RSS Item"): 'page' fetches the article page as before, 'rss' uses the full text in the RSS item and
-- never fetches the page (publishers such as Substack forbid crawling their pages). Existing feeds
-- keep 'page'. The allowed values are checked by Zod (schemas/feed.ts), as for stories.access_tier.
-- Written by hand in the shape db:migrate:create emits, since the authoring environment had no local
-- database; it carries no DROP INDEX.

-- AlterTable
ALTER TABLE "feeds" ADD COLUMN     "content_source" TEXT NOT NULL DEFAULT 'page';

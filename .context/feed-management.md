# Feed Management

Feed lifecycle, crawl scheduling and health tracking, quality metrics and favicons. Code: `server/src/services/feed.ts`, `server/src/services/favicon.ts`, `server/src/routes/admin/feeds.ts`. Crawling and extraction themselves are in `content-extraction.md`.

## Creating and Updating Feeds

Creating a feed requires `title`, `rssUrl` and an `issueId` that exists. An unknown issue fails with "Issue not found", and an update that changes `issueId` is checked the same way. New feeds start `active = true` with both failure counters at 0. `crawlIntervalHours` defaults to 24 in the schema and in Zod (`server/prisma/schema.prisma`, `server/src/schemas/feed.ts`); the admin form (`client/src/components/admin/FeedForm.tsx`) pre-fills 6. Optional fields: `url` (homepage), `displayTitle`, `language`, `region`, `htmlSelector`, and the paywall setting below.

## Paywall Setting

Two fields per feed (ADR-0032), shown in the create dialog and the edit panel (`FeedPaywallFields`). How the crawler applies them: `content-extraction.md`, "Access Classification".

- **`paywallDetection`** ("Detect paywalled articles automatically", default on). Off, the markup rule never produces `locked`; what would have been locked is stored as `metered`. For a metered feed whose full-text articles the rule rejects.
- **`paywallTitleMarker`** ("Subscriber-article title marker", optional regex, e.g. `^\(S\+\)` for SPIEGEL). A match on the article's title forces `locked`, whatever the markup or the checkbox say. For publishers without the schema.org tag, and for bot-blocked feeds that reach us only through the API tier, provided the API keeps the title prefix. Zod refuses a marker that does not compile, is over 200 characters, or repeats a group that itself contains `+` or `*` (e.g. `(\w+\s?)+`, which backtracks catastrophically on the publisher-controlled title), with a 400 on create and update. The crawl tests only the title's first 300 characters.

There is no "always locked" mode: that is the same as deactivating the feed. Changing either field affects future crawls only; stories already rejected as locked stay rejected (an editor can filter the story list by feed, Status "Rejected" and "Paywall: Locked" and re-queue them).

## Deleting Feeds (Soft Delete)

`deleteFeed()` only deactivates a feed that has any stories (`active = false`, returning `action: 'deactivated'`). This keeps the link between stories and their source feed, which attribution, newsletters and favicons depend on. A feed with no stories is deleted outright (`action: 'deleted'`).

## When a Feed Is Due

The crawl job (`crawlAllDueFeeds()`) takes the feeds that `getDueFeeds()` returns. A feed is due when it is active and either `lastCrawledAt` is null or `lastCrawledAt + crawlIntervalHours < now()`. The filter runs in SQL against each feed's own interval. Inactive feeds are never crawled on schedule.

## Crawl Status and Health Counters

All of this is in `updateCrawlStatus()` in `server/src/services/feed.ts`. Every outcome sets `lastCrawlResult`. Error fields change only on a new error (`lastCrawlError` and `lastCrawlErrorAt` are set) or a success (both cleared); any other outcome leaves the previous error visible.

| Outcome | `lastCrawledAt` | `consecutiveFailedCrawls` | `consecutiveEmptyCrawls` / `lastSuccessfulCrawlAt` |
|---|---|---|---|
| At least one story created | now | 0 | 0 / now |
| Every new item failed extraction (total failure) | unchanged, so the feed is retried next run; on the 3rd consecutive total failure (`MAX_CONSECUTIVE_FAILURES`) it is forced to now and the counter resets, to break the retry loop | +1 (or reset at 3) | unchanged |
| RSS had items but all were duplicates (nothing new) | now | 0 | unchanged |
| Reachable RSS returned zero items (not 304) | now (the crawler reports this as `hadSuccess: true`, so errors are cleared) | 0 | +1 / unchanged |
| RSS could not be fetched or parsed (`fetchFailed`) | unchanged, so retried next run; forced to now on the 3rd consecutive failure, as for a total failure. Sets "RSS fetch failed: …" as the error | +1 (or reset at 3) | +1 / unchanged |
| 304 Not Modified | now | 0 | unchanged; errors untouched. A 304 is not an empty crawl. |
| `crawlFeed` throws for another reason (in `crawlAllDueFeeds`: a missing feed, a database error) | passes `fetchFailed: true`, so handled exactly like the row above, but sets "Crawl failed: …" as the error, since the RSS fetch may not be what failed | +1 (or reset at 3) | +1 / unchanged |

An unreachable or broken feed is a recorded error, never an empty crawl: `crawlFeed()` catches `parseFeed()`'s error and passes `fetchFailed: true` (`content-extraction.md`, "Conditional RSS Requests"). It still counts toward `consecutiveEmptyCrawls`, so a feed that keeps failing also reaches the stale warning.

## Stale-Feed Warning

A feed is stale once `consecutiveEmptyCrawls >= config.crawl.staleAfterEmptyCrawls` (default 5, env `STALE_AFTER_EMPTY_CRAWLS`; `isFeedStale()` in `feed.ts`). The admin feed endpoints return a computed `isStale` on every feed, so the client holds no copy of the threshold. In the feed table, a stale feed shows an "N empty" warning icon whose tooltip says "No new articles in last N crawls" and gives the last success time (`client/src/components/admin/FeedTable.tsx`).

## Quality Metrics

`GET /api/admin/feeds/quality` returns these per feed (`getAllFeedQualityMetrics()`):

- `totalCrawled`: all stories in the feed, any status.
- `publishedCount`: stories with status `published`.
- `publishRate`: published ÷ total, rounded to 3 decimals, 0 when the feed has no stories.
- `avgRelevance`: mean `relevance` of stories in `analyzed`, `selected` or `published` that have a rating, rounded to 1 decimal, otherwise null.
- `extractionMethods`: `crawlMethod → count`, counting only stories with a `crawlMethod`. `teaser` appears for locked pages where every extraction tier failed.

Paywall-locked stories are stored (as `rejected`), so they count in `totalCrawled` and lower `publishRate`.

Feeds with no stories are included. Results are cached in process memory for `config.feedQuality.cacheMinutes` (10). The feed table shows the dominant method, and the edit panel shows the full percentage breakdown.

## Favicons

The favicon is stored at `client/public/images/feeds/<feedId>.png` (`FAVICON_DIR` overrides the folder). The fetched bytes are written as they are, without converting them to PNG, and the feed ID must be a UUID. The source host is the homepage `url` if set, otherwise the `rssUrl`. The fetcher tries that hostname first, then each shorter parent domain down to two labels (`feeder-prod.int.politico.com` → `int.politico.com` → `politico.com`). For each domain it tries, in order:

1. The Google favicon API at 32 px. Responses of 400 bytes or less are treated as Google's generic globe and rejected.
2. The homepage HTML (reading at most 2 MB): `<link rel*="icon">` entries are sorted by declared size closest to 32 px, and entries with no size go last.
3. `/favicon.ico`.

An accepted image must have an `image/*` content type, be non-empty and be at most 100,000 bytes. It is read in a stream that stops once it passes the limit, with a 10 s timeout. `POST /api/admin/feeds/:id/favicon` always refetches (`force = true`). `POST /api/admin/feeds/fetch-favicons` covers only active feeds, skips any feed that already has a favicon, runs 5 at a time, and returns succeeded, failed and skipped counts plus errors.

## Key Files

| File | Role |
|------|------|
| `server/src/services/feed.ts` | CRUD, due query, crawl status, quality metrics |
| `server/src/services/favicon.ts` | Favicon discovery and storage |
| `server/src/routes/admin/feeds.ts` | Admin feed endpoints |
| `server/src/schemas/feed.ts` | Zod schemas and defaults |
| `client/src/components/admin/FeedTable.tsx` | Feed table, stale warning, dominant extraction method |
| `client/src/components/admin/FeedForm.tsx` | Create dialog |
| `client/src/components/admin/FeedEditPanel.tsx` | Edit panel, quality card |
| `client/src/components/admin/FeedPaywallFields.tsx` | Paywall setting fields, shared by both |

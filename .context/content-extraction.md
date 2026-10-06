# Content Extraction

The crawler fetches RSS feeds and extracts article content using a 3-tier fallback chain. Each tier is tried in order; the first one that produces enough text wins.

## Extraction Chain

```
1. CSS Selector (feed-specific)
   ↓ fails or too short
2. Mozilla Readability (ML-based)
   ↓ fails
3. Configured API (Diffbot or PipFeed, no fallback)
```

### Tier 1: CSS Selector

If the feed has an `htmlSelector` configured (e.g., `article.post-content`), the extractor queries that selector on the fetched HTML. This is the most reliable method for feeds with consistent layouts.

**When to use**: Set `htmlSelector` on a feed when Readability fails or extracts too much noise (nav, sidebars, etc.).

**Minimum length**: Content must be at least `config.crawl.minContentLength` characters (default 300, env `MIN_CONTENT_LENGTH`) to be accepted. If shorter, falls through to Readability. This threshold applies to all three extraction tiers.

### Tier 2: Mozilla Readability

Uses `@mozilla/readability` with `jsdom` to extract the main article content. Works well for standard news articles. This is the primary extraction method for most feeds.

### Tier 3: External API

Only the configured `config.crawl.extractionApi` (default `diffbot`) is called — there is no fallback to the other API. Requires `DIFFBOT_TOKEN` or `PIPFEED_API_KEY` depending on which API is configured. Skipped if the required key isn't set.

All API calls go through a shared `ApiThrottle` (`apiThrottle` in `server/src/services/extractor.ts`) that serializes requests and handles 429 rate limiting. It runs one API call at a time and waits an inter-call delay before each one. The base delay is `config.crawl.minDelayPerDomainMs` (default 200 ms), the same as the per-domain crawl limiter; backoff and maximum delay are both 30 s. On a 429 the delay becomes `min(delay × 2, 30 s)`; if the delay was 0, it jumps straight to the 30 s backoff value. While the backoff window is open, no API call starts. After each success the delay halves, down to no less than the base. This means the system slows down instead of stopping — it respects the provider's signal without abandoning the crawl.

### Local Extraction Skip

When consecutive articles in a feed all fail local extraction (tiers 1+2), the crawler skips local extraction for remaining articles (controlled by `config.crawl.localFailThreshold`, default 3). This avoids wasting time on HTTP 403s from sites that block scrapers. The counter increments both when extraction succeeds via API (local failed but API worked) and when extraction fails entirely (local + API both failed). The counter resets when any article succeeds via a local method. With the default `crawlArticles` of 1, articles are processed sequentially, so the threshold takes effect as soon as `localFailThreshold` consecutive failures occur. Independently of the counter, pages larger than `maxParseBytes` always skip the local tiers (see Resource Limits).

### Total Failure Bail-Out

When consecutive articles all fail extraction entirely (local + API both return nothing), the crawler stops attempting remaining articles (controlled by `config.crawl.totalFailThreshold`, default 3). This prevents burning API quota on feeds where the source blocks all extraction methods. The counter resets when any article succeeds. Once bail-out triggers, every remaining article in that feed is counted as an error without being attempted, and the crawl's `errorMessage` becomes "N of M articles failed extraction".

### Extraction Method Tracking

The extraction method that succeeded (`selector`, `readability`, `diffbot`, or `pipfeed`) is persisted to `Story.crawlMethod` when the story is created. This field is used by the feed quality metrics to show a per-feed breakdown of which extraction tiers are working. The admin panel displays the dominant method in the feed table and a full percentage breakdown in the feed edit panel. Stories created before this feature have `crawlMethod = null` and are excluded from the breakdown.

### Mid-Flight Cancellation

The crawler passes a `shouldAbort` callback (tied to the `skipAll` flag) through `extractContent()` → `extractByApi()` → `ApiThrottle.run()`. This allows in-flight extractions to bail out before making expensive API calls — even if they started before `skipAll` was set. The abort is checked at three points: before the API tier in `extractContent()`, before entering the throttle in `extractByApi()`, and after dequeuing/backoff-waiting inside `ApiThrottle.run()`. This prevents wasting 30+ seconds on API backoff waits for articles in a feed that has already been identified as failing.

## Resource Limits

HTTP responses from page fetches, RSS feeds, and external API calls (Diffbot, PipFeed) are capped at 5 MB (`maxContentLength`) to prevent OOM on pathological responses. Pages whose fetched HTML exceeds `config.crawl.maxParseBytes` (default 2 MB, env `MAX_PARSE_BYTES`) skip local parsing (tiers 1+2) and fall straight through to the API tier: a multi-MB HTML string expands ~10-20x as a DOM, and that allocation counts against Render's ~512 MiB RSS limit — which `--max-old-space-size=384` does **not** bound (it caps only the V8 heap) — so a single oversized page can OOM the crawl even at low concurrency. JSDOM DOM objects are explicitly released via `dom.window.close()` in a `finally` block after Readability extraction, as JSDOM windows hold timers, event listeners, and expanded DOM trees that are not reliably garbage collected without explicit cleanup. Outbound webhook and email service (Plunk) responses are capped at 1 MB. The Bluesky og:image fetch uses `AbortSignal.timeout(10_000)` to prevent hanging. Favicon fetches use streaming reads with per-chunk size checks to avoid allocating large buffers for unexpected responses.

Article page fetches follow at most 5 redirects. Each redirect target is checked with `isAllowedUrl()` (`server/src/utils/urlValidation.ts`), which blocks non-http(s) schemes, localhost, loopback, private, link-local and metadata IPs, and `.internal`/`.local` hosts. A blocked redirect fails the fetch, and the page counts as a local-extraction failure (`fetchPage()` in `server/src/services/extractor.ts`).

### CPU & Memory Budget

JSDOM + Readability parsing is the most expensive operation in the server, on two axes. **CPU:** JSDOM constructs a full DOM in pure JavaScript, saturating a CPU core for the duration of each parse. **Memory:** the resulting DOM plus JSDOM's native/CSSOM allocations count against Render's ~512 MiB RSS limit — which `--max-old-space-size=384` does *not* bound (it caps only the V8 heap), so the process can be OOM-killed with heap well under 384 MB. The effective parallelism is `crawlFeeds * crawlArticles` (worst case: all articles hit tier 2 simultaneously). On a 0.5 vCPU / 512 MiB instance, keep this product at 2 or below — that bounds CPU; the per-parse `maxParseBytes` guard bounds memory. The shipped defaults are `crawlFeeds=2, crawlArticles=1` (product 2), and production sets the same via `CONCURRENCY_CRAWL_FEEDS`/`CONCURRENCY_CRAWL_ARTICLES`. If memory still spikes, drop to product 1 (`CONCURRENCY_CRAWL_FEEDS=1`) so only one parse runs at a time, and/or lower `MAX_PARSE_BYTES`. Analysis jobs (pre-assess, assess, select) are I/O-bound (waiting on OpenAI) and don't meaningfully compete for CPU.

## Crawl Flow

```
RSS Feed → Parse items (max config.crawl.rssItemLimit, default 30)
         → Deduplicate against existing story URLs
         → For each new item (parallel, up to config.concurrency.crawlArticles):
            → Fetch page HTML (with retry, timeout config.crawl.httpTimeoutMs, default 10 s)
            → Extract content (3-tier chain)
            → Create story with status 'fetched'
         → Update the feed's crawl status (see feed-management.md, "Crawl status and health counters")
```

Feeds are crawled in parallel (up to `config.concurrency.crawlFeeds`, default 2). Article extraction within each feed runs up to `config.concurrency.crawlArticles` at a time (default 1, i.e. sequential). See the CPU & Memory Budget section for why these defaults are intentionally low. All HTTP requests (RSS parsing, page fetching, PipFeed API) use `withRetry()` from `server/src/lib/retry.ts` (3 attempts with exponential backoff).

### Conditional RSS Requests

The RSS fetch sends the feed's stored `lastEtag` as `If-None-Match` and `lastModified` as `If-Modified-Since` (`server/src/services/rssParser.ts`). When the response carries an ETag or Last-Modified header, both values are written back to the feed (`updateFeedCacheHeaders()` in `server/src/services/feed.ts`). A `304 Not Modified` ends the crawl right away with zero new stories and is recorded as `lastCrawlResult = '304 not modified'`; how it affects the feed's counters is in `feed-management.md`. RSS fetches follow at most 3 redirects and accept only status 200 or 304. Items without a link are dropped, and an item with no title gets "Untitled".

`parseFeed()` throws when the feed cannot be fetched (after `withRetry()`'s attempts) or parsed. `crawlFeed()` catches it and records a crawl error, "RSS fetch failed: <reason>" (`summarizeError()`, e.g. `HTTP 503`), returning `errors: 1` without touching cache headers. One failing feed never aborts the others in `crawlAllDueFeeds()`. A reachable feed with zero items is still an empty crawl, not an error; the counters for both are in `feed-management.md`.

### Story Fields from the RSS Fallback

When the extractor returns no title or publish date, the story uses the RSS item's title and `isoDate`/`pubDate` instead (`crawlFeed()` in `server/src/services/crawler.ts`). Every new story is created in `fetched` status, with `crawlMethod` set to the tier that succeeded.

### Deduplication

URLs are normalized (HTTPS, no trailing slash, no tracking params, sorted query) before any dedup logic. The crawler first removes duplicates within the RSS batch itself, then batch-checks remaining URLs against existing stories using `getExistingUrls()`. As a safety net, P2002 unique constraint errors during `createStory` (e.g., from concurrent crawls) are treated as skips rather than errors.

### Manual Crawling

- `POST /api/admin/stories/crawl-url` — crawl a single URL into a specific feed
- `POST /api/admin/feeds/:id/crawl` — trigger full RSS crawl for one feed
- `POST /api/admin/feeds/crawl-all` — crawl all feeds that are due

`crawl-url` normalizes the URL first. It rejects the request with "URL already crawled" when a story with that normalized URL already exists. It returns `null` and creates no story when every extraction tier fails. There is no RSS item here, so a missing title becomes "Untitled" and a missing publish date stays empty (`crawlUrl()` in `server/src/services/crawler.ts`).

## Key Files

| File | Role |
|------|------|
| `server/src/services/crawler.ts` | Orchestration: RSS → deduplicate → extract → create stories |
| `server/src/services/extractor.ts` | 3-tier extraction chain |
| `server/src/services/rssParser.ts` | RSS/Atom feed parsing (max `config.crawl.rssItemLimit` items) |
| `server/src/lib/retry.ts` | Retry utility with exponential backoff (used by RSS parser, extractor) |
| `server/src/jobs/crawlFeeds.ts` | Scheduled job handler |
| `server/src/utils/urlValidation.ts` | `isAllowedUrl()` redirect/SSRF guard |

Feed CRUD, the due rule, crawl-health counters, quality metrics and favicons: `feed-management.md`.

## Adding a New Feed

1. Create the feed via `POST /api/admin/feeds` with the RSS URL and issue ID
2. Test the crawl: `POST /api/admin/feeds/:id/crawl`
3. Check extracted content quality in the stories
4. If content is noisy or incomplete, set `htmlSelector` on the feed via `PUT /api/admin/feeds/:id`

# Content Extraction

The crawler fetches RSS feeds and extracts article content using a 3-tier fallback chain. Each tier is tried in order; the first one that produces enough text wins. A feed whose `contentSource` is `'rss'` skips the chain entirely and takes the text from its RSS items (see "Full Text from the RSS Item"). Before either, every article is checked against its publisher's machine-readable opt-outs, and a reserved one is never read (see "Publisher opt-out check").

## Publisher opt-out check

The crawler enforces the machine-readable half of the source policy (`feed-management.md`, "Source Policy"; ADR-0050, ADR-0055) for each article, on every crawl. `checkOptOut(url, { fetchesPage })` in `server/src/services/publisherOptOut.ts` works from the article URL alone, so a caller without a feed (the planned research feature) can use it too. It never throws; it answers `{ reserved: false }` or `{ reserved: true, reason, unverified }`, checking in this order and giving the first reason that applies:

- **robots.txt unreadable** (a 5xx, a timeout, a network error, a robots.txt URL the SSRF guard refuses, or an article URL that does not parse): reserved, `unverified`, as RFC 9309 treats an unreachable file. This holds for `contentSource: 'rss'` items too, since the file also carries the Content-Signal. Any 4xx (401, 403 and 429 included) means no robots.txt and allows everything, as RFC 9309 says (Google treats a 429 as unreachable; we don't). So does a robots.txt behind more than 5 redirects, which RFC 9309 §2.3.1.2 lets a crawler take as unavailable (the same holds for tdmrep.json).
- **robots.txt path rules**, only when `fetchesPage` is true (`parseRobotsTxt()`, `isPathAllowed()` in `server/src/lib/robotsTxt.ts`): the groups naming the product token `ActuallyRelevant` (a user-agent line's leading letters, so `ActuallyRelevant/1.0` names it and `ActuallyRelevantClone` does not), merged; without one, the `*` groups; groups for other named bots are ignored. The longest matching `Allow`/`Disallow` pattern wins, `Allow` on a tie, no match allows; `*` matches any sequence and a final `$` anchors the end; the path compared is pathname plus query of the parsed URL, which is what the request sends. Pattern and path are compared in one percent-encoding (RFC 9309 §2.2.2, RFC 3986 §6.2.2; `normalizePercentEncoding()`): `%xx` hex uppercased, a `%xx` of an unreserved character (`A-Z a-z 0-9 - . _ ~`) decoded, non-ASCII characters encoded as UTF-8. So `Disallow: /новости/` matches `/%d0%bd%d0%be…` and `/%D0%BD%D0%BE…` alike, and `/~staff/` matches `/%7Estaff/`; an encoded reserved character (`%2F`) stays distinct from `/`. "Longest" counts the encoded pattern. The matcher is linear-time, with no regex built from the publisher's pattern.
- **Content-Signal** with `ai-input=no`, in the applicable group or before every group. The key=value pair counts wherever it stands in the line, so a signal scoped to a path applies to the whole host (the safe reading). Other signals (`search`, `ai-train`) are ignored.
- **`/.well-known/tdmrep.json`** (`parseTdmRep()`, `isTdmReserved()` in `server/src/lib/tdmRep.ts`): any entry whose `location` pattern (read like a robots.txt pattern, percent-encoding included) matches the path and whose `tdm-reservation` is 1 reserves it, wherever it stands in the file. A missing, invalid or non-array file, and a malformed entry, reserve nothing. A tdmrep.json that cannot be read (5xx, timeout, network) means no reservation.

**Page-level TDMRep.** Where the page is fetched, `fetchPage()` in `extractor.ts` reads its `tdm-reservation` response header and `<meta name="tdm-reservation" content="1">` (`pageTdmReservation()`, a linear scan with no DOM, so it also runs on pages over `maxParseBytes`). A reserving page is a `PageRefusal` of kind `reserved`: its text is discarded and the item is skipped as an opt-out.

**Redirects.** The check runs on the article URL, but many feeds link through a redirector (FeedBurner, a URL shortener), whose robots.txt is not the publisher's. So the page fetch does not let axios follow redirects (`maxRedirects: 0` in `getPageOnce()`): `getFollowingCheckedRedirects()` in `server/src/services/checkedRedirects.ts` follows at most 5, resolving a relative `Location`, and checks each target before requesting it, with `isAllowedUrl()` (the request's `lookup` checks the address) and `checkOptOut(target, { fetchesPage: true })`. Every hop is checked, a same-host one too, since its path can be disallowed; the host files are cached per origin, so a same-host hop reads no robots.txt again. A reserved target is never requested: the page is a `PageRefusal` of kind `reserved` whose reason names the target host ("robots.txt disallows all crawlers (redirect target publisher.example)"), `unverified` when that host's robots.txt could not be read. Like a page-level reservation, it skips the item as an opt-out, blocks the API tier for the rest of the crawl and makes crawl-url answer 400, so no extraction API is given a URL whose redirect chain reached a reservation. A target the SSRF guard refuses, a 3xx without a `Location` and a sixth redirect fail the fetch as a network error does (null; the API tier may run). Each hop goes through `crawlLimiter` and `withRetry()` and has its own `httpTimeoutMs`. Limit: with skip-local set no page is fetched, so no chain is walked, and the API tier gets the item URL with only the item's host checked (see "Local Extraction Skip").

**Host files.** Each origin's robots.txt and tdmrep.json are fetched together, once, and kept in an in-memory `TTLCache` for 24 hours (`config.publisherOptOut.cacheHours`, up to 5000 origins). When either file could not be read, the origin is read again after 60 minutes (`retryMinutes`) instead. Each fetch goes through `crawlLimiter`, the SSRF guard (`isAllowedUrl()` and `ssrfGuard`, at most 5 redirects), the crawler user agent, `withRetry()` (its defaults: 3 retries on a 5xx or a connection reset, so a host answering 5xx costs up to about 27 s, once an hour; the 5 s timeout fires through the abort signal as axios's "canceled" error, which is not retried), a 5 s timeout for the whole exchange (`fetchTimeoutMs`) and the first 500 KiB of the body (`maxFileBytes`, RFC 9309's minimum; `readCapped()` in `server/src/lib/streamRead.ts`). The constants are in `config.publisherOptOut`, with no env overrides. A publisher that adds or lifts a reservation is seen within 24 hours; there is no admin way to re-read a host sooner.

**A reserved item** (`CrawlNotes.skipForOptOut()` in `crawler.ts`) is counted in `skipped`, logged at info, never fetched, stored or counted as a failure or as attempted, and looked at again on every crawl while it stays in the feed. The feed's error names the first reason and the count (see "Crawl Flow").

**Crawler identity.** Every crawler request (article pages, RSS feeds, favicons, robots.txt, tdmrep.json) sends the one user agent `CRAWLER_USER_AGENT` from `server/src/lib/crawlerIdentity.ts`, `ActuallyRelevant/1.0 (news curation bot; +https://actuallyrelevant.news)`, whose product token `CRAWLER_PRODUCT_TOKEN` is what robots.txt groups are matched against.

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

**The API tier makes up for technical failures only** (owner decision, ADR-0055): a timeout, a network error, a 5xx, a page over `maxParseBytes`, or local extraction that failed or came out too short. It never runs for a publisher's no. A page fetch answered 401, 403, 429 or 451 (`REFUSAL_STATUSES` in `extractor.ts`, read after `withRetry()`'s retries) is a `PageRefusal` of kind `denied`, and a page carrying a TDM reservation, or a redirect to a reserved URL, one of kind `reserved` (see "Publisher opt-out check"); `extractContent()` returns it without calling any tier. Either one sets `apiBlocked` for the rest of that feed's crawl (`extractAndStorePages()` in `crawler.ts`), and the `skipApiTier` callback, read at the moment the tier would run and again inside `ApiThrottle.run()` (so a call already queued when the block comes is left out too, with `crawlArticles` above 1 or another feed's calls ahead of it), then leaves the API out for every other article of the crawl. The cost: articles from sites that block every bot are lost, and on a host that refuses some pages a technical failure on another page of the same crawl goes without the API tier.

A `denied` page counts as an extraction failure (toward skip-local and skip-all, and the feed is retried next run), and the feed's error names the first one: "N of M articles failed extraction; publisher refused the crawler (HTTP 403)". A `reserved` page is an opt-out skip, not a failure.

All API calls go through a shared `ApiThrottle` (`apiThrottle` in `server/src/services/extractor.ts`) that serializes requests and handles 429 rate limiting. It runs one API call at a time and waits an inter-call delay before each one. The base delay is `config.crawl.minDelayPerDomainMs` (default 200 ms), the same as the per-domain crawl limiter; backoff and maximum delay are both 30 s. On a 429 the delay becomes `min(delay × 2, 30 s)`; if the delay was 0, it jumps straight to the 30 s backoff value. While the backoff window is open, no API call starts. After each success the delay halves, down to no less than the base. This means the system slows down instead of stopping — it respects the provider's signal without abandoning the crawl.

### Local Extraction Skip

When consecutive articles in a feed all fail local extraction (tiers 1+2), the crawler skips local extraction for remaining articles (controlled by `config.crawl.localFailThreshold`, default 3). This avoids wasting page fetches and parses on a site whose layout local extraction can't read; the remaining articles go straight to the API tier. A refusing site no longer reaches that tier: its first refusal has already blocked the API for the crawl, so its remaining articles fail and skip-all ends the crawl. With skip-local set no page is fetched, so a page-level refusal or `tdm-reservation` on those articles goes unseen before the API tier runs, and so does the host an item URL redirects to (the API follows the redirect itself); the item host's files are still checked for each. The counter increments both when extraction succeeds via API (local failed but API worked) and when extraction fails entirely (local + API both failed). The counter resets when any article succeeds via a local method. With the default `crawlArticles` of 1, articles are processed sequentially, so the threshold takes effect as soon as `localFailThreshold` consecutive failures occur. Independently of the counter, pages larger than `maxParseBytes` always skip the local tiers (see Resource Limits).

### Total Failure Bail-Out

When consecutive articles all fail extraction entirely (local + API both return nothing), the crawler stops attempting remaining articles (controlled by `config.crawl.totalFailThreshold`, default 3). This prevents burning API quota on feeds where the source blocks all extraction methods. The counter resets when any article succeeds. Once bail-out triggers, every remaining article in that feed is counted as an error without being attempted, and the crawl's `errorMessage` starts "N of M articles failed extraction" (see "Crawl Flow" for the notes that may follow).

### Extraction Method Tracking

The extraction method that succeeded (`selector`, `readability`, `diffbot`, or `pipfeed`), `teaser` for a locked page where every tier failed (see Access Classification), or `rss` for a story whose text came from its RSS item (`CrawlMethod` in `extractor.ts`; `rss` is never a tier of the chain), is persisted to `Story.crawlMethod` when the story is created. This field is used by the feed quality metrics to show a per-feed breakdown of which extraction tiers are working. The admin panel displays the dominant method in the feed table and a full percentage breakdown in the feed edit panel. Stories created before this feature have `crawlMethod = null` and are excluded from the breakdown.

### Mid-Flight Cancellation

The crawler passes a `shouldAbort` callback (tied to the `skipAll` flag) through `extractContent()` → `extractByApi()` → `ApiThrottle.run()`. This allows in-flight extractions to bail out before making expensive API calls — even if they started before `skipAll` was set. The abort is checked before the API tier in `extractContent()`, before entering the throttle in `extractByApi()`, and inside `ApiThrottle.run()` after dequeuing, after a backoff wait and after the inter-call delay. The throttle's abort also reads `skipApiTier`, so the crawl's API block reaches calls already waiting in it. This prevents wasting 30+ seconds on API backoff waits for articles in a feed that has already been identified as failing.

## Access Classification

Every extraction result carries an access tier, stored as `Story.accessTier` (ADR-0030). `classifyAccess()` in `server/src/lib/paywall.ts` reads the fetched HTML with cheerio: every `script[type="application/ld+json"]` (top-level arrays, `@graph`, `hasPart`; a malformed block is ignored), `meta[property="article:content_tier"]`, the JSON-LD `wordCount`, and `og:title`. `isAccessibleForFree` is normalized from `true`/`false` and the strings `"True"`/`"False"`; any node saying false means the publisher restricts the article.

- **No flag** → `unknown` (BBC and most free sites). Never treated as paid.
- **Flag true** → `free`.
- **Flag false** → `locked` when there is evidence of truncation: `content_tier` is `locked`, or the extracted words fall below `config.paywall.minWordRatio` (0.3, env `PAYWALL_MIN_WORD_RATIO`) × `wordCount`, or the extracted text, whitespace collapsed, is shorter than `config.paywall.lockedMaxChars` (1,500, env `PAYWALL_LOCKED_MAX_CHARS`). Otherwise `metered`: metered sites (The Diplomat, STAT) mark every article false but serve the full text, so the flag alone would remove them.

The feed's paywall setting applies after the markup rule (ADR-0032; fields in `feed-management.md`). With `paywallDetection` off, what would be locked is stored as `metered`. A `paywallTitleMarker` that matches the page title (`og:title`, else `<title>`, else the winning tier's title) forces `locked`, whatever the markup, the length or the checkbox say. A marker that fails to compile at crawl time is logged and ignored.

The classification runs whenever the page was fetched and is under `maxParseBytes`, against whichever tier's text won, **the API tier included**: a teaser under 300 characters falls through to Diffbot, and the HTML is still in hand. With no parseable HTML (fetch failed, page over `maxParseBytes`, or `skipLocal` set for the rest of the crawl) the tier is `unknown`, unless the feed's title marker matches the API tier's title.

**The teaser result.** When every tier fails on a page classified as `locked`, `extractContent()` returns `method: 'teaser'` with the page title and its `og:description`/meta description (or empty) as content, instead of `null`. `null` would count toward `skipLocal` and `skipAll` and the item would be retried, with a fresh API call, on every crawl while it stays in the RSS feed. The crawler counts `teaser` as a local success, and so any result classified `locked` (an API-tier win on a page whose HTML showed it locked): counting those as local failures would set `skipLocal` and switch classification off for the rest of a paywalled feed's crawl. A `shouldAbort` bail-out still returns `null`.

**A locked story is created `rejected`, not `fetched`**, by `createStory()` (ADR-0031), so no model call is ever made for it and it never reaches any reader-facing surface; the override and its consequences are in `story-pipeline.md`. The crawler logs one info line per locked story stored.

**Limits.** Classification is a snapshot: SPIEGEL unlocks some S+ pieces later, and a story rejected as locked stays rejected. Stories crawled before the column existed have `accessTier = null`. A publisher's subscribe prompt can push a teaser over `lockedMaxChars`: a SPIEGEL international S+ teaser extracted to about 3,100 characters on 2026-10-08, including the "weiterlesen mit SPIEGEL+" offer, and would be `metered` by the markup rule alone; SPIEGEL's `og:title` starts "(S+) ", which the feed's title marker `^\(S\+\)` catches. The crawler's user agent was served the full markup by SPIEGEL on that date. The second cheerio parse adds to the per-article memory in the CPU & Memory Budget, bounded by the same `maxParseBytes`.

## Full Text from the RSS Item

For publishers whose terms forbid fetching their article pages but whose feed carries each whole article, such as Substack newsletters, a feed's `contentSource` is `'rss'` (field in `feed-management.md`; which publishers qualify: its "Source Policy"). For such a feed `crawlFeed()` never fetches a page and never calls an extraction tier, the API tier included (`storeRssItems()` in `crawler.ts`, `server/src/services/rssContent.ts`):

- **The opt-out check** runs first for each item with `fetchesPage: false`: no page is fetched, so robots.txt path rules don't apply, but Content-Signal and TDMRep reserve the use itself, and an unreadable robots.txt skips the item (see "Publisher opt-out check").
- **The text** is the item's `contentHtml` (`rssParser.ts`: `content:encoded`, else the RSS description or the Atom content) turned into plain text by `htmlToText()`: scripts, styles, embeds and forms dropped, whitespace inside a block collapsed, `<br>` a newline, one blank line between blocks (paragraphs, headings, list items, quotes).
- **Too short** (under `config.crawl.minContentLength`, 300; e.g. a paid post whose item carries only a preview, or a feed without full text): the item is skipped, counted in `skipped`, logged at info. Never an error and never a fallback to the page, which would break the publisher's terms. It is looked at again on every crawl while it stays in the feed (no fetch, so cheap). Skipped items do not count as attempted, so a crawl where every new item was too short is "nothing new", not a total failure.
- **The story** takes the item's title and date, `crawlMethod: 'rss'` and `accessTier: 'unknown'` (an item has no access markup), or `locked` when the feed's `paywallTitleMarker` matches the item title, and is then created `rejected` as any locked story. `paywallDetection` has no effect here.
- **Single URLs** cannot be crawled into such a feed: `crawlUrl()` refuses with 400 "This feed takes article text from its RSS feed; single URLs can't be crawled" before any fetch.

Limit: the length threshold is the only check that an item holds the whole article. A paid post whose free preview runs past 300 characters is stored as if it were the full text.

## Resource Limits

HTTP responses from page fetches, RSS feeds, and external API calls (Diffbot, PipFeed) are capped at 5 MB (`maxContentLength`) to prevent OOM on pathological responses. Pages whose fetched HTML exceeds `config.crawl.maxParseBytes` (default 2 MB, env `MAX_PARSE_BYTES`) skip local parsing (tiers 1+2) and fall straight through to the API tier: a multi-MB HTML string expands ~10-20x as a DOM, and that allocation counts against Render's ~512 MiB RSS limit — which `--max-old-space-size=320` does **not** bound (it caps only the V8 heap) — so a single oversized page can OOM the crawl even at low concurrency. JSDOM DOM objects are explicitly released via `dom.window.close()` in a `finally` block after Readability extraction, as JSDOM windows hold timers, event listeners, and expanded DOM trees that are not reliably garbage collected without explicit cleanup. Outbound webhook and email service (Plunk) responses are capped at 1 MB. The Bluesky og:image fetch uses `AbortSignal.timeout(10_000)` to prevent hanging. Favicon fetches, and the robots.txt and tdmrep.json reads of the opt-out check (first 500 KiB, 5 s for the whole exchange), use streaming reads with per-chunk size checks (`readCapped()` in `server/src/lib/streamRead.ts`, which cuts at exactly its cap) to avoid allocating large buffers for unexpected responses.

### SSRF guard

Every server-side fetch of a URL that came from outside goes through `server/src/utils/urlValidation.ts`: article pages (`fetchPage()` in `extractor.ts`), feeds (`parseFeed()` in `rssParser.ts`, admin-entered URLs), favicons (`favicon.ts`, including `<link rel=icon>` hrefs taken from the fetched page), and each host's robots.txt and tdmrep.json (`fetchSmallFile()` in `publisherOptOut.ts`; a refused robots.txt counts as unreadable and skips the host's articles). It has two layers, and both must pass:

- **The URL** (`isAllowedUrl()`): http(s) only; no IP literal in a private, loopback, link-local (cloud metadata), carrier-grade NAT, documentation, multicast or reserved range, in any spelling the URL parser accepts (decimal `2130706433`, hex `0x7f.1`, IPv4-mapped, IPv4-compatible and NAT64 IPv6); no single-label name (Render's private service names, e.g. the database host), `localhost` or `*.localhost`, and no `.local`, `.internal`, `.localdomain` or `.home.arpa` name.
- **What a name resolves to** (`safeLookup()`, passed to axios as `lookup` via `ssrfGuard`): every address DNS returns is checked, and one private record refuses the request. The check runs at connect time, so there is no window for DNS rebinding between check and fetch.

Redirects (at most 5) pass both layers: for feeds, favicons and the host files, `beforeRedirect` re-runs `isAllowedUrl()` on the target, and follow-redirects reuses the `lookup` option for the next hop; an article page follows its redirects itself, one request per hop with the same `lookup`, running `isAllowedUrl()` and the opt-out check on each target first (`checkedRedirects.ts`; "Publisher opt-out check", "Redirects"). A refused request fails like any other fetch error: the article counts as a local-extraction failure, the feed records a crawl error ("Blocked feed URL: ..."), and the favicon source is skipped. Any new fetch of an outside URL spreads `...ssrfGuard` into its axios options and checks `isAllowedUrl()` first.

### CPU & Memory Budget

JSDOM + Readability parsing is the most expensive operation in the server, on two axes. **CPU:** JSDOM constructs a full DOM in pure JavaScript, saturating a CPU core for the duration of each parse. **Memory:** the resulting DOM plus JSDOM's native/CSSOM allocations count against Render's ~512 MiB RSS limit — which `--max-old-space-size=320` does *not* bound (it caps only the V8 heap), so the process can be OOM-killed with heap well under 320 MB. The effective parallelism is `crawlFeeds * crawlArticles` (worst case: all articles hit tier 2 simultaneously). On a 0.5 vCPU / 512 MiB instance, keep this product at 2 or below — that bounds CPU; the per-parse `maxParseBytes` guard bounds memory. The shipped defaults are `crawlFeeds=2, crawlArticles=1` (product 2), and production sets the same via `CONCURRENCY_CRAWL_FEEDS`/`CONCURRENCY_CRAWL_ARTICLES`. If memory still spikes, drop to product 1 (`CONCURRENCY_CRAWL_FEEDS=1`) so only one parse runs at a time, and/or lower `MAX_PARSE_BYTES`. Analysis jobs (pre-assess, assess, select) are I/O-bound (waiting on OpenAI) and don't meaningfully compete for CPU.

## Crawl Flow

```
RSS Feed → Parse items (max config.crawl.rssItemLimit, default 30)
         → Deduplicate against existing story URLs
         → contentSource 'page' (default): for each new item (parallel, up to config.concurrency.crawlArticles):
            → Publisher opt-out check (fetchesPage: true); skip the item if reserved
            → Fetch page HTML (with retry, timeout config.crawl.httpTimeoutMs, default 10 s, per redirect hop;
              each redirect target opt-out-checked first); a refusal (401/403/429/451), page-level
              reservation or reserved redirect target ends the item and blocks the API tier for the crawl
            → Extract content (3-tier chain) and classify access
            → Create story with status 'fetched', or 'rejected' when its access tier is 'locked'
         → contentSource 'rss': for each new item, in order, no page fetched:
            → Publisher opt-out check (fetchesPage: false); skip the item if reserved
            → Text from the item's HTML; skip the item if shorter than minContentLength
            → Create story (crawlMethod 'rss'; 'rejected' when the title marker matches)
         → Update the feed's crawl status (see feed-management.md, "Crawl status and health counters")
```

Feeds are crawled in parallel (up to `config.concurrency.crawlFeeds`, default 2). Article extraction within each feed runs up to `config.concurrency.crawlArticles` at a time (default 1, i.e. sequential). See the CPU & Memory Budget section for why these defaults are intentionally low.

**The crawl's error** (`CrawlNotes` in `crawler.ts`) is built from up to three parts, each only when it applies, joined by "; ": "N of M articles failed extraction" (`M` counts attempted items, opt-out skips excluded), the first refusal ("publisher refused the crawler (HTTP 403)"), and the first opt-out with the count ("Publisher opted out: robots.txt disallows ActuallyRelevant (2 articles skipped)", or "Publisher opt-out unknown: robots.txt unreachable (HTTP 503) (…)" for an unreadable robots.txt). An opt-out sets the error even on a crawl that created stories, so the feed table shows it. The client's `extraction-failing` problem reads the first part as a prefix (`feed-management.md`, "Export").

All HTTP requests (RSS parsing, page fetching, the opt-out check's host files, PipFeed API) use `withRetry()` from `server/src/lib/retry.ts` (3 attempts with exponential backoff).

### Conditional RSS Requests

The RSS fetch sends the feed's stored `lastEtag` as `If-None-Match` and `lastModified` as `If-Modified-Since` (`server/src/services/rssParser.ts`). When the response carries an ETag or Last-Modified header, both values are written back to the feed (`updateFeedCacheHeaders()` in `server/src/services/feed.ts`). A `304 Not Modified` ends the crawl right away with zero new stories and is recorded as `lastCrawlResult = '304 not modified'`; how it affects the feed's counters is in `feed-management.md`. RSS fetches follow at most 3 redirects and accept only status 200 or 304. Items without a link are dropped, and an item with no title gets "Untitled".

`parseFeed()` throws when the feed cannot be fetched (after `withRetry()`'s attempts) or parsed. `crawlFeed()` catches it and records a crawl error, "RSS fetch failed: <reason>" (`summarizeError()`, e.g. `HTTP 503`), returning `errors: 1` without touching cache headers. One failing feed never aborts the others in `crawlAllDueFeeds()`. A reachable feed with zero items is still an empty crawl, not an error; the counters for both are in `feed-management.md`.

### Story Fields from the RSS Fallback

When the extractor returns no title or publish date, the story uses the RSS item's title and `isoDate`/`pubDate` instead (`crawlFeed()` in `server/src/services/crawler.ts`). Every new story is created in `fetched` status, or `rejected` when its access tier is `locked`, with `crawlMethod` set to the tier that succeeded and `accessTier` to the classification.

### Deduplication

URLs are normalized (HTTPS, no trailing slash, no tracking params, sorted query) before any dedup logic. The crawler first removes duplicates within the RSS batch itself, then batch-checks remaining URLs against existing stories using `getExistingUrls()`. As a safety net, P2002 unique constraint errors during `createStory` (e.g., from concurrent crawls) are treated as skips rather than errors.

### Manual Crawling

- `POST /api/admin/stories/crawl-url` — crawl a single URL into a specific feed
- `POST /api/admin/feeds/:id/crawl` — trigger full RSS crawl for one feed
- `POST /api/admin/feeds/crawl-all` — crawl all feeds that are due

`crawl-url` refuses a feed whose `contentSource` is `'rss'` (400, see "Full Text from the RSS Item"). It normalizes the URL first. It rejects the request with "URL already crawled" when a story with that normalized URL already exists. It runs the publisher opt-out check before any fetch and answers a reserved URL, a page that turns out to carry a TDM reservation, or one that redirects to a reserved URL, with 400 and the reason ("Publisher opted out: …", or "Publisher opt-out unknown: …" for an unreadable robots.txt). A refused page fetch (401, 403, 429, 451) is 422 "Could not extract content from URL: publisher refused the crawler (HTTP 403)", with no API tier. It returns `null` and creates no story when every extraction tier fails, except on a page classified `locked`, where it stores the `teaser` result. Any URL classified `locked` is created `rejected` (ADR-0031), like a scheduled crawl's; the response and the "URL crawled successfully" toast do not say so, the story is found under the story list's Status "Rejected" and "Paywall: Locked" filters, and crawling the URL again returns "URL already crawled". There is no RSS item here, so a missing title becomes "Untitled" and a missing publish date stays empty (`crawlUrl()` in `server/src/services/crawler.ts`).

## Key Files

| File | Role |
|------|------|
| `server/src/services/crawler.ts` | Orchestration: RSS → deduplicate → opt-out check → extract → create stories; the crawl-wide API block and the crawl's error (`CrawlNotes`) |
| `server/src/services/extractor.ts` | 3-tier extraction chain, teaser result, page refusals (`PageRefusal`, `REFUSAL_STATUSES`, page-level TDM reservation) |
| `server/src/services/publisherOptOut.ts` | Publisher opt-out check by URL (`checkOptOut()`, `optOutMessage()`), host-file fetch and per-origin cache |
| `server/src/services/checkedRedirects.ts` | A page fetch's redirects, one hop at a time, each target checked by `isAllowedUrl()` and `checkOptOut()` first |
| `server/src/lib/robotsTxt.ts` | robots.txt parsing (RFC 9309 groups, longest match, `*`/`$`, percent-encoding normalized) and Content-Signal `ai-input=no`; pure |
| `server/src/lib/tdmRep.ts` | TDMRep: tdmrep.json rules, page `tdm-reservation` header and meta tag; pure |
| `server/src/lib/crawlerIdentity.ts` | `CRAWLER_PRODUCT_TOKEN` and `CRAWLER_USER_AGENT`, sent by every crawler request |
| `server/src/lib/streamRead.ts` | `readCapped()`: a response stream read up to a byte cap (opt-out host files, favicons) |
| `server/src/lib/paywall.ts` | Access classification from publisher markup and the feed's paywall setting |
| `server/src/scripts/scan-teaser-analyses.ts` | `npm run scan:teasers`: read-only list of published stories probably rated on a teaser |
| `server/src/services/rssParser.ts` | RSS/Atom feed parsing (max `config.crawl.rssItemLimit` items), each item's `contentHtml` |
| `server/src/services/rssContent.ts` | Story text from the RSS item for `contentSource: 'rss'` feeds (`htmlToText()`, `storyFromRssItem()`) |
| `server/src/lib/retry.ts` | Retry utility with exponential backoff (used by RSS parser, extractor) |
| `server/src/jobs/crawlFeeds.ts` | Scheduled job handler |
| `server/src/utils/urlValidation.ts` | SSRF guard: `isAllowedUrl()`, `safeLookup()`, `ssrfGuard` axios options |

Feed CRUD, the due rule, crawl-health counters, quality metrics and favicons: `feed-management.md`.

## Adding a New Feed

1. Check the publisher against the source policy (`feed-management.md`, "Source Policy: Publishers' AI Opt-Outs"); for a publisher that forbids fetching pages but carries the full text in its feed, set `contentSource: 'rss'`
2. Create the feed via `POST /api/admin/feeds` with the RSS URL and issue ID, or in a changeset (`feed-management.md`, "Changesets")
3. Test the crawl: `POST /api/admin/feeds/:id/crawl`
4. Check extracted content quality in the stories
5. If content is noisy or incomplete, set `htmlSelector` on the feed via `PUT /api/admin/feeds/:id`
6. For a publisher with subscriber articles, check that its locked articles come in as `rejected` with the Paywall badge; set a title marker for one that marks them only in the title, and switch detection off for a metered feed whose full-text articles are rejected

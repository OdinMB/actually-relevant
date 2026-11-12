# Feed Management

Feed lifecycle, changesets, the feed export, the source policy, crawl scheduling and health tracking, quality metrics and favicons. Code: `server/src/services/feed.ts`, `server/src/services/feedChangeset.ts`, `server/src/services/favicon*.ts`, `server/src/routes/admin/feeds.ts`. Crawling and extraction themselves are in `content-extraction.md`.

## Creating and Updating Feeds

Creating a feed requires `title`, `rssUrl` and an `issueId` that exists. An unknown issue fails with "Issue not found", and an update that changes `issueId` is checked the same way. New feeds start `active = true` with both failure counters at 0. `crawlIntervalHours` defaults to 24 in the schema and in Zod (`server/prisma/schema.prisma`, `server/src/schemas/feed.ts`); the admin form (`client/src/components/admin/FeedForm.tsx`) pre-fills 6. Optional fields: `url` (homepage), `displayTitle`, `language`, `region`, `htmlSelector`, `contentSource`, and the paywall setting below.

- **`contentSource`** ("Article text", `'page'` or `'rss'`, default `'page'`; a text column checked by Zod, not a Postgres enum). `'page'` fetches each article page and runs the extraction chain; `'rss'` takes the full text from the RSS item and never fetches the page, for publishers whose terms forbid fetching pages but whose feed carries each whole article, such as Substack newsletters (`content-extraction.md`, "Full Text from the RSS Item"). Shown in the create dialog and the edit panel (`FeedContentSourceField`). A single URL cannot be crawled into an `'rss'` feed.

## Paywall Setting

Two fields per feed (ADR-0032), shown in the create dialog and the edit panel (`FeedPaywallFields`). How the crawler applies them: `content-extraction.md`, "Access Classification".

- **`paywallDetection`** ("Detect paywalled articles automatically", default on). Off, the markup rule never produces `locked`; what would have been locked is stored as `metered`. For a metered feed whose full-text articles the rule rejects.
- **`paywallTitleMarker`** ("Subscriber-article title marker", optional regex, e.g. `^\(S\+\)` for SPIEGEL). A match on the article's title forces `locked`, whatever the markup or the checkbox say. For publishers without the schema.org tag, and for bot-blocked feeds that reach us only through the API tier, provided the API keeps the title prefix. Zod refuses a marker that does not compile, is over 200 characters, or repeats a group that itself contains `+` or `*` (e.g. `(\w+\s?)+`, which backtracks catastrophically on the publisher-controlled title), with a 400 on create and update. The crawl tests only the title's first 300 characters.

There is no "always locked" mode: that is the same as deactivating the feed. Changing either field affects future crawls only; stories already rejected as locked stay rejected (an editor can filter the story list by feed, Status "Rejected" and "Paywall: Locked" and re-queue them).

## Deleting Feeds (Soft Delete)

`deleteFeed()` only deactivates a feed that has any stories (`active = false`, returning `action: 'deactivated'`). This keeps the link between stories and their source feed, which attribution, newsletters and favicons depend on. A feed with no stories is deleted outright (`action: 'deleted'`).

## Changesets

A changeset is one JSON file of feed changes, typically researched by an AI agent, that an admin uploads on the Feeds page ("Import changes"), previews and applies in one step. The info icon beside the button ("How to prepare a changeset") shows the agent instructions with a copy button; they are built in `client/src/components/admin/feedChangesetInstructions.ts` from the live issue list and `@shared/constants` (regions, format constants), so slugs and regions cannot drift. Keep them in step with the schema and the source policy below.

**Format** (`server/src/schemas/feedChangeset.ts`; every object strict, an unknown key is an error):

- Envelope: `format: "actually-relevant/feed-changeset"`, `version: 1`, optional `title` (≤ 200 chars) and `createdAt` (≤ 40), `changes`: 1 to 200 entries. A bad envelope is refused whole (400 "Validation failed" with Zod's flattened `details`); each change is checked on its own, so one malformed change is reported beside the others.
- `{ action: "create", feed, reason }`: `feed` has the fields of `POST /api/admin/feeds` with `issue` (an issue **slug**) in place of `issueId`; `title`, `rssUrl` and `issue` required, `language` and `crawlIntervalHours` default as for the endpoint.
- `{ action: "update", match, set, reason }`: `set` has the fields of `PUT /api/admin/feeds/:id` (including `active` and `contentSource`), with `issue` (slug) in place of `issueId`, and at least one field.
- `{ action: "delete", match, reason }`: as `DELETE /api/admin/feeds/:id`, deleted without stories, deactivated with them.
- `match`: exactly one of `id`, `rssUrl` (exact) or `title` (exact, case-sensitive), against every feed, active or not. `reason`: required, trimmed, 1 to 500 characters.

**Resolution** (`planChangeset()` in `server/src/services/feedChangesetPlan.ts`, pure; preview and apply share it). Changes resolve in file order against the feeds as they were before the changeset, so a match never finds a feed the same file creates. Each change gets `status: 'ok' | 'noop' | 'error'`:

- `error`: an invalid change (the Zod issue with its path, e.g. `set.region: …`), no feed or several feeds for the match, an unknown issue slug, an `rssUrl` held by another feed or by an earlier change in the file, or a second change to a feed that an earlier change already changes. A change can carry several problems, joined with "; ".
- `noop`: an update whose fields already have those values (only the fields that differ are written), or a delete of an inactive feed that has stories.
- RSS URLs are tracked in order: an update moving a feed off a URL, or a delete of a feed without stories, frees it for a later change; a delete that only deactivates does not.

**Endpoints** (admin router, before `/:id`; body limit 512 kB for this path in `app.ts`, 100 kB elsewhere):

- `POST /api/admin/feeds/changesets/preview` writes nothing and answers `{ title, results, counts: { ok, noop, error } }`. Each result is `{ index (from 0), action ('create' | 'update' | 'delete', or null for an unknown one), feedTitle (the matched or new feed's title, null when no single feed matched), reason, status, message, diff? }`, with `diff` on updates only, `[{ field, from, to }]`, `issue` shown as slugs.
- `POST /api/admin/feeds/changesets/apply` resolves again inside one Prisma transaction (`config.database.transactionTimeoutMs`). **All or nothing:** if any change is `error` it writes nothing and answers 400 `{ error: "N of M changes have errors; nothing was applied" ("has an error" for one), applied: false, title, results, counts }` (`ChangesetHasErrorsError`); otherwise it performs every `ok` change through `createFeed`/`updateFeed`/`deleteFeed` with the transaction client and answers `{ applied: true, title, results, counts }`, the messages now saying what was done ("Created", "Updated N fields", "Deleted", "Deactivated (it has stories)"); once it has committed, the favicons of the feeds it created or gave a new `url` or `rssUrl` are fetched in the background ("Favicons"). A delete recounts stories inside the transaction, so a feed that gained a story since the preview is deactivated. A write the database refuses (a unique RSS URL taken meanwhile: 409 "A feed with this RSS URL already exists") rolls the whole changeset back.

The import panel (`FeedChangesetImportPanel.tsx`) parses the file in the browser (not JSON: an error, no request), shows the preview, and enables "Apply N changes" only while no change has an error; a refused apply shows the new preview.

## Export

"Export" beside "Import changes" (`FeedExportDialog.tsx`) hands the feeds to an AI agent that answers with a changeset. It is built in the browser, with no endpoint of its own: the dialog loads every feed, inactive ones included and whatever the page's filters, plus the quality metrics and issues.

- **JSON** (`buildFeedExport()` in `feedExport.ts`): "Feeds with problems" or "All feeds", downloaded as `feeds-<problems|all>-YYYY-MM-DD.json` (local date) or copied. It holds `scope`, `exportedAt`, `problemDefinitions` (each code explained), the issue tree (`issues`: slug, name, `children`), and per feed its settings, issue slug and name (and the parent's name for a sub-issue), crawl state, `quality` (crawled, published, publish rate, average relevance, dominant method; null without metrics) and `problems`.
- **Feeds with problems** (`findFeedProblems()` in `feedProblems.ts`, pure): an inactive feed never has one. An active feed has each of these that holds:
  - `rss-fetch-failed`: `lastCrawlResult` starts with "RSS fetch failed". It reads the most recent crawl, so an RSS error that `lastCrawlError` still shows after a 304 or a crawl with only known items does not count.
  - `extraction-failing`: `lastCrawlError` starts "N of M articles failed extraction" with N/M above one half; notes such as a refusal or an opt-out may follow after "; " (`content-extraction.md`, "Crawl Flow"). A feed whose only error is an opt-out has no problem code; it shows in the feed table and the edit panel.
  - `stale`: `isStale`, the stale-feed warning below.
  - `nothing-analyzed`: quality metrics with `totalCrawled > 0`, `publishedCount` 0 and `avgRelevance` null. A feed added hours ago whose stories still await analysis can match; the fix prompt tells the agent to leave such a feed alone.
  The first two parse the crawler's own messages (`server/src/services/crawler.ts`): change them together.
- **Prompts** (`feedExportPrompts.ts`): "Copy fix prompt" holds the feeds with problems and asks for each cause, a source-policy check, at most one update or delete per feed, and a report; it is unavailable while no feed has problems. "Copy gap analysis prompt" holds every feed and asks for coverage per issue, sub-issue, region and language (feeds with problems and inactive feeds not counted), verified replacements and additions, and two changesets applied in order, fixes and deletions first, then additions. Both embed the full changeset instructions (`buildChangesetInstructions()`) and the export JSON, whichever scope is chosen for the JSON.

## Source Policy: Publishers' AI Opt-Outs

Which sources may be crawled, given publishers' reservations against AI use (owner decision, 2026-11-01, the "middle line"). It is applied when sources are chosen, by people and by the agent instructions above, and **the crawler enforces its machine-readable part** for each article on every crawl (ADR-0055; see "Enforced by the crawler" below). The public summary is on the Methodology page, "Publishers' AI Opt-Outs" (`client/src/pages/MethodologyPage.tsx`).

A source is admissible unless its publisher has made a reservation that applies to us:

- **Honored (exclude the source):** a general machine-readable reservation, which is TDMRep `tdm-reservation: 1` (in `/.well-known/tdmrep.json`, an HTTP header or the meta tag), a Cloudflare-style `Content-Signal` with `ai-input=no`, or a robots.txt rule that disallows `*` or our user agent `ActuallyRelevant` for the article pages; and terms of use that forbid AI processing, summarizing, or text and data mining of the content.
- **Not treated as applying to us:** robots.txt rules that block only *named* AI-company crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended, …), and terms that forbid only AI *training*. We do not train models, the crawler identifies itself (`CRAWLER_USER_AGENT` in `server/src/lib/crawlerIdentity.ts`, sent by every crawler request), it fetches one page per article (none for `contentSource: 'rss'`), and every story links to the original.
- **Why:** the EU DSM Directive, Art. 4, permits text and data mining unless the rightsholder reserved it in machine-readable form; the general reservations above are that form.
- **Publishers that forbid page fetching but carry the full text in the feed** (Substack): admissible with `contentSource: 'rss'`; a paid post whose item carries only a preview is skipped, never fetched.

**Enforced by the crawler:** before it reads an article, the crawler checks robots.txt (for `ActuallyRelevant`, else `*`), `Content-Signal: ai-input=no` and TDMRep (tdmrep.json, and a fetched page's header or meta tag), and skips a reserved article without storing it; a publisher that adds a reservation is honored within 24 hours, with no review. The API tier (Diffbot, PipFeed) never routes around a no: it is not asked for a page refused with 401, 403, 429 or 451 or carrying a reservation, nor for the rest of that feed's crawl. Rules and limits: `content-extraction.md`, "Publisher opt-out check" and "Tier 3: External API". **Not enforced:** terms of use stay a human check when a source is added or reviewed; and a page-level marker on an article whose page is not fetched (skip-local set for the rest of a crawl) goes unseen, though the host files are still checked.

## When a Feed Is Due

The crawl job (`crawlAllDueFeeds()`) takes the feeds that `getDueFeeds()` returns. A feed is due when it is active and either `lastCrawledAt` is null or `lastCrawledAt + crawlIntervalHours < now()`. The filter runs in SQL against each feed's own interval. Inactive feeds are never crawled on schedule.

## Crawl Status and Health Counters

All of this is in `updateCrawlStatus()` in `server/src/services/feed.ts`. Every outcome sets `lastCrawlResult`. Error fields change only on a new error (`lastCrawlError` and `lastCrawlErrorAt` are set) or a success (both cleared); any other outcome leaves the previous error visible. A crawl that skipped items for a publisher opt-out sets the error even when it also created stories, so the opt-out stays visible beside them (`content-extraction.md`, "Crawl Flow"). Opt-out skips don't count as attempted, so they never make a crawl a total failure.

| Outcome | `lastCrawledAt` | `consecutiveFailedCrawls` | `consecutiveEmptyCrawls` / `lastSuccessfulCrawlAt` |
|---|---|---|---|
| At least one story created | now | 0 | 0 / now |
| Every new item failed extraction (total failure) | unchanged, so the feed is retried next run; on the 3rd consecutive total failure (`MAX_CONSECUTIVE_FAILURES`) it is forced to now and the counter resets, to break the retry loop | +1 (or reset at 3) | unchanged |
| RSS had items but all were duplicates (nothing new) | now | 0 | unchanged |
| Every new item skipped for a publisher opt-out (none attempted) | now | 0 | unchanged; the opt-out is set as the error ("Publisher opted out: … (N articles skipped)", or "Publisher opt-out unknown: …" while robots.txt can't be read) |
| Reachable RSS returned zero items (not 304) | now (the crawler reports this as `hadSuccess: true`, so errors are cleared) | 0 | +1 / unchanged |
| RSS could not be fetched or parsed (`fetchFailed`) | unchanged, so retried next run; forced to now on the 3rd consecutive failure, as for a total failure. Sets "RSS fetch failed: …" as the error | +1 (or reset at 3) | +1 / unchanged |
| 304 Not Modified | now | 0 | unchanged; errors untouched. A 304 is not an empty crawl. |
| `crawlFeed` throws for another reason (in `crawlAllDueFeeds`: a missing feed, a database error) | passes `fetchFailed: true`, so handled exactly like the row above, but sets "Crawl failed: …" as the error, since the RSS fetch may not be what failed | +1 (or reset at 3) | +1 / unchanged |

An unreachable or broken feed is a recorded error, never an empty crawl: `crawlFeed()` catches `parseFeed()`'s error and passes `fetchFailed: true` (`content-extraction.md`, "Conditional RSS Requests"). It still counts toward `consecutiveEmptyCrawls`, so a feed that keeps failing also reaches the stale warning.

## Stale-Feed Warning

A feed is stale once `consecutiveEmptyCrawls >= config.crawl.staleAfterEmptyCrawls` (default 5, env `STALE_AFTER_EMPTY_CRAWLS`; `isFeedStale()` in `feed.ts`). The admin feed endpoints return a computed `isStale` on every feed, so the client holds no copy of the threshold. In the feed table, a stale feed shows an "N empty" warning icon whose tooltip says "No new articles in last N crawls" and gives the last success time (`client/src/components/admin/FeedTable.tsx`).

## Quality Metrics

`GET /api/admin/feeds/quality` returns these per feed (`getAllFeedQualityMetrics()`):

- `totalCrawled`: all stories ever crawled from the feed, any status, including those the monthly cleanup deleted (`story_archive_counts`, `story-retention.md`).
- `archivedCount`: of those, the ones the cleanup deleted.
- `publishedCount`: stories with status `published` (never deleted).
- `publishRate`: published ÷ total, rounded to 3 decimals, 0 when the feed has no stories.
- `avgRelevancePre`: mean screening rating over every story that got one, deleted ones included, rounded to 1 decimal, otherwise null.
- `avgRelevance`: mean `relevance` of stories in `analyzed`, `selected` or `published` that have a rating, rounded to 1 decimal, otherwise null.
- `extractionMethods`: `crawlMethod → count`, counting only live stories with a `crawlMethod` (the archive keeps no crawl method). `teaser` appears for locked pages where every extraction tier failed, `rss` for stories whose text came from the RSS item (`contentSource: 'rss'`).

Paywall-locked stories are stored (as `rejected`), so they count in `totalCrawled` and lower `publishRate`.

Feeds with no stories are included. Results are cached in process memory for `config.feedQuality.cacheMinutes` (10). The feed table shows lifetime Crawled, the dominant method, and the edit panel shows lifetime crawled (with the deleted count), the screening average and the full percentage breakdown. The open edit panel is in the URL (`/admin/feeds?open=<id>`), which the Stats page links to.

## Favicons

A feed's favicon is a 32 px PNG in the database (`feed_favicons`: `feed_id` as key, deleted with its feed; `png`; `source_url`, the image it was made from; `fetched_at`), so a feed added in production gets its icon on the site with no commit or deploy. A table of its own keeps the bytes out of every feed query. Code: `favicon.ts` (finding), `faviconImage.ts` (conversion), `faviconStore.ts` (storage), `routes/public/feedFavicon.ts` (serving).

**Finding.** The source host is the homepage `url` if set, otherwise the `rssUrl`. The fetcher tries that hostname first, then each shorter parent domain down to two labels (`feeder-prod.int.politico.com` → `int.politico.com` → `politico.com`). For each domain it tries, in order, and keeps the first image that converts:

1. The Google favicon API at 32 px. Responses of 400 bytes or less are treated as Google's generic globe and rejected.
2. The homepage HTML (reading at most 2 MB): `<link rel*="icon">` entries are sorted by declared size closest to 32 px, and entries with no size go last.
3. `/favicon.ico`.

A downloaded image must have an `image/*` content type, be non-empty and be at most 100,000 bytes. It is read in a stream that stops once it passes the limit, with a 10 s timeout, through the SSRF guard (`content-extraction.md`).

**Conversion** (`toFaviconPng()`, with `@napi-rs/canvas`): PNG, JPEG, GIF, WebP, BMP and ICO become a 32 x 32 PNG, scaled to fit and centred on transparency. SVG and anything else is refused, and the fetcher moves on to the next source. Before decoding, the size the image declares is read from its header (`image-size`; for an ICO, from each embedded PNG or BMP, not the directory) and an image over 1024 px on either side is refused: a blank PNG of a few kB declares gigabytes of pixels, and decoding one took the test process down.

**When it is fetched.**

- After `POST /api/admin/feeds` creates a feed, and after a changeset apply has committed, for every feed it created and every update that changed `url` or `rssUrl` (`fetchFaviconsInBackground()`): not awaited, 5 at a time, failures logged, never failing or delaying the request. After the commit, because the favicon's row references the feed. `PUT /api/admin/feeds/:id` does not refetch; the edit panel's "Fetch Favicon" does.
- `POST /api/admin/feeds/:id/favicon` ("Fetch Favicon" in the edit panel) always refetches and replaces the stored one.
- `POST /api/admin/feeds/fetch-favicons` ("Fetch All Favicons" on the Feeds page) covers only active feeds, fetches those with no stored favicon, 5 at a time, and returns succeeded, failed and skipped (already stored) counts plus errors. It answers when all are done; a run longer than Cloudflare's 100 s proxy limit can show an error in the admin while the server carries on, and clicking again fills in the rest.

**Serving.** `GET /api/feeds/:id/favicon` (public, no auth) answers the PNG with `Cache-Control: public, max-age=86400` (`config.favicon.httpCacheSeconds`), a strong ETag (304 on `If-None-Match`) and `Cross-Origin-Resource-Policy: cross-origin`, since the site and mail clients show it from other origins; 404 (not cached) when none is stored or the id is not a UUID. It is mounted before the shared rate limiter, as a page of story cards asks for one per feed, and is open to any origin (`publicReadPaths` in `app.ts`). It is not in the OpenAPI document: like a story's `og.png`, it is an asset of the site, not part of the data API. Stored favicons are kept in memory for an hour (`config.favicon.memoryCache*`, one of the caches "Clear site cache" empties); saving one drops its copy, and a missing one is never remembered.

**Where it is shown.** `FeedFavicon` (story cards and story pages) tries the API (`API_BASE`, so `VITE_API_URL`), then the file committed under `client/public/images/feeds/<feedId>.png`, then hides itself; `FeedFaviconPreview` (feed table, edit panel) does the same and ends in a grey placeholder, with `?t=` after a refetch to get past the browser's copy. The newsletter email links `config.apiUrl` + `/api/feeds/<id>/favicon` (`feedFaviconUrl()`), and has no fallback: a feed without a stored favicon shows a broken image there.

**The committed files** (about 110, from before 2026-11-01, when favicons were written into `client/public/images/feeds/` and reached the site only with a commit) stay as the site's fallback. Nothing writes there any more. After the deploy that introduced the table, "Fetch All Favicons" once moves every active feed onto a stored favicon, which the newsletter needs; stories of inactive feeds keep the committed file.

## Key Files

| File | Role |
|------|------|
| `server/src/services/feed.ts` | CRUD (each write takes an optional transaction client), due query, crawl status, quality metrics |
| `server/src/services/feedChangesetPlan.ts` | Changeset resolution: matches, slugs, RSS URL tracking, noop and diff (pure) |
| `server/src/services/feedChangeset.ts` | Changeset preview, and apply in one transaction |
| `server/src/services/favicon.ts` | Favicon discovery: one feed, all missing, or in the background |
| `server/src/services/faviconImage.ts` | Downloaded favicon to 32 px PNG, with the declared-size guard |
| `server/src/services/faviconStore.ts` | `feed_favicons` reads and writes, the in-memory copy |
| `server/src/routes/public/feedFavicon.ts` | `GET /api/feeds/:id/favicon` |
| `client/src/components/FeedFavicon.tsx` | Public and admin favicon, with the API → committed file fallback |
| `server/src/routes/admin/feeds.ts` | Admin feed endpoints, changesets included |
| `server/src/schemas/feed.ts` | Zod schemas and defaults |
| `server/src/schemas/feedChangeset.ts` | Changeset file format |
| `client/src/components/admin/FeedTable.tsx` | Feed table, stale warning, dominant extraction method |
| `client/src/components/admin/FeedForm.tsx` | Create dialog |
| `client/src/components/admin/FeedEditPanel.tsx` | Edit panel, quality card |
| `client/src/components/admin/FeedPaywallFields.tsx` | Paywall setting fields, shared by both |
| `client/src/components/admin/FeedContentSourceField.tsx` | Article text (content source) field, shared by both |
| `client/src/components/admin/FeedChangesetControls.tsx` | "Import changes" button and the instructions info icon |
| `client/src/components/admin/FeedChangesetImportPanel.tsx` | Import panel: file, preview, apply |
| `client/src/components/admin/feedChangesetInstructions.ts` | The agent instructions text |
| `client/src/components/admin/FeedExportDialog.tsx` | Export dialog: scope, JSON download and copy, prompt copy |
| `client/src/components/admin/feedExport.ts` | The export JSON and its file name |
| `client/src/components/admin/feedProblems.ts` | Which feeds have problems (pure) |
| `client/src/components/admin/feedExportPrompts.ts` | The fix and gap-analysis prompts |

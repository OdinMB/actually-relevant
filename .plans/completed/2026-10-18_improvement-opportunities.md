# Improvement Opportunities — Actually Relevant

**Date:** 2026-10-18
**Scope:** Full codebase (`server/`, `client/`, `shared/`, `scripts/`, `.context/`), lenses 1-13. Architecture (lens 14) is left to a separate find-arch-issues run.
**Automated tool findings:**
- **Dependency audit** (`npm audit`, runs from the lockfiles): server **0** vulnerabilities. Client **26** in total (5 low, 14 moderate, 7 high), **22 of them in production dependencies** (5 high). Two sources: `@scalar/api-reference-react` 0.8.x pulls in the Vercel `ai` SDK (`@ai-sdk/provider-utils`, GHSA-866g-f22w-33x8, resource consumption) and `ts-deepmerge` < 8; `braces` (GHSA-vfj7-8cjw-p6xm, high) and `postcss-selector-parser` come through tailwind 3 / chokidar / fast-glob. Fixes are breaking upgrades: `@scalar/api-reference-react@0.9.x`, tailwind 4.
- **Type checker, linter, tests, coverage:** not run. `node_modules` is not installed in either package, and installing (with Puppeteer and Prisma engines) was out of budget for this pass. The project has no linter configured (no ESLint config or script). Run `npm run typecheck --prefix server|client` and the test suites after install to complete this section.
- How this pass was run: no sub-agent tool was available in this environment, so all lenses were analysed in one context, which makes it narrower than a six-agent pass. Hot spots were read in full (auth, app setup, public story routes, the story service, retention, scheduler, extractor, embeddings, newsletter HTML); the rest was covered by targeted searches.

## Critical

### Story retention deletes irreversibly from Nov 1 and its SQL has never been run in a test, with a cluster edge case the per-story delete handles but the bulk delete does not
**Location:** `server/src/services/storyRetention.ts` — `deleteOldStoriesBatch()`, `deleteEmptyClusters()`; compare `server/src/services/story.ts` — `deleteStory()`
**Category:** Test Coverage / Data integrity
**Description:** `cleanup_old_stories` is seeded enabled and first runs on 2026-11-01 at 03:00 UTC. The cutoff is now 6 months, so the first run covers half the corpus. The deletion is one data-modifying CTE whose keep rules (published, social posts, newsletter `story_ids`/`selected_story_ids`, podcast `story_ids`, any cluster member with a published sibling) exist only in that SQL string. The only test, `jobs/cleanupOldStories.test.ts`, mocks the whole service, so no test ever runs the statement against Postgres. A typo in a keep clause or a wrong status cast would delete rows that cannot be recovered. ADR-0039 says "their text is not recoverable".
There is also a real gap next to the untested SQL. `story_clusters.primary_story_id` is `ON DELETE SET NULL` (migration `20260207120000_add_story_clusters`). `deleteStory()` re-elects the primary through `updatePrimary()` and dissolves clusters left with one member. The bulk delete does neither: `deleteEmptyClusters()` removes only clusters with **zero** members. An old rejected primary whose cluster still holds younger unpublished members leaves a cluster with a null primary. `analysis.ts` then treats every member as a non-primary (`s.cluster.primaryStoryId !== s.id`), and `dedup.ts` `autoRejectNonPrimary` returns early. A cluster can also be left with a single member. Clusters that span 6 months are rare but possible.
**Options:**
- **Add a Postgres-backed test for this file before Nov 1** (local Docker DB on 5433, opt-in via a test DB URL; seed one story per keep rule and per deletable status, assert what survives and what is counted, run twice to prove idempotence). Cost: about a day, and the first DB-backed test tier in the repo (see the Important item below). It gives real confidence in the one irreversible job.
- **Also repair clusters after each batch**: re-elect primaries that became null and dissolve one-member clusters, using the same rules as `deleteStory()`. Cost: a second statement per batch plus tests. It gives up nothing. The decision here is whether the cluster repair belongs in the retention job or in a shared helper.
- **Leave it and disable the job until tested**: flip `cleanup_old_stories` off on the Jobs page before Nov 1. Costs nothing, but the database keeps growing toward the Render storage warning that motivated ADR-0039.

## Important

### Related-stories lists keep showing unpublished stories for days, and every cache miss on the public endpoint spends an LLM call
**Location:** `server/src/services/story.ts` — `getRelatedStories()`, `relatedCache`; `server/src/routes/public/stories.ts` — `GET /:slug/related`
**Category:** Performance / Correctness
**Description:** A cache hit re-fetches the cached IDs with `where: { id: { in: ids } }`, without `status: 'published'`. A story that is unpublished, rejected or trashed after it was cached therefore keeps appearing in other stories' related lists for up to `relatedStories.cacheHours` (72 h). The route then adds `Cache-Control: max-age=259200` (another 72 h at the browser and CDN), so the stale link can live for up to six days. Each link leads to a 404. Separately, every cache miss runs a small-tier LLM re-rank inside an anonymous public GET. The cache is per process, lost on every deploy, capped at 500 entries, and does not dedupe concurrent misses for the same slug. After each deploy, the first visitor to every story page triggers a model call, and anyone walking the sitemap can trigger one call per published story, limited only by the general `apiLimiter`.
**Options:**
- **Filter by status on the cached path and evict on status change.** Add `status: 'published'` to both final fetches (a one-line fix), and drop a slug's entry when that story leaves `published`. Small cost. Unpublished stories disappear from the server's answer at once, but the 72 h HTTP cache still holds them.
- **Precompute the re-rank at publish time and store the IDs on the story** (or in a small table), so the public path makes no LLM calls. Cost: a migration and a backfill, and related lists stop refreshing as new stories arrive unless a job recomputes them. It removes the cost amplification and the cold-cache work after deploys.
- **Leave the LLM on the request path but dedupe in-flight misses and lower the HTTP max-age.** Cheap, but it reduces rather than closes both problems.
- **Behavior question for the owner:** when a story is unpublished, must it vanish from related lists immediately, or is "within a few days" acceptable? That decides whether the HTTP cache lifetime has to drop too.

### Route error mapping matches on exception message strings (97 sites), and the older routes duplicate what the global handler already does
**Location:** `server/src/app.ts` — global error handler (`notFoundMessages`); `server/src/routes/admin/{stories,newsletters,clusters,bluesky,mastodon,feeds,issues,users}.ts` — every `catch (err: any)`
**Category:** Error Handling / Convention Compliance
**Description:** Most admin routes map failures to status codes by comparing `err.message === 'Story not found'` and similar strings. The global handler does the same with a hard-coded list (`'Feed not found'`, `'Story not found'`, …). Rewording a service's error message silently turns a 404 or 400 into a 500, and no type ties a message to the routes that test for it. Around 130 hand-written `res.status(500)` blocks sit behind `express-async-errors`, which already routes thrown errors to the global handler, and many repeat its P2025/P2002 mapping. The newer podcast routes avoid all of this: typed `PodcastRefusedError` and `PodcastEditRejectedError` go through one `sendFailure()` helper. Two conventions now coexist and nothing documents which one to follow.
**Options:**
- **Typed service errors plus one mapper**: introduce `NotFoundError`, `ConflictError` and `InvalidStateError` (or extend the podcast pattern), map them in the global handler, and delete the per-route string checks file by file. Cost: a mechanical refactor across roughly 10 route files with their tests. It gives one convention, `any`-free catches, and messages that can be reworded safely.
- **Keep the per-route try/catch but switch to `instanceof`** on typed errors. Less churn, but the duplicated 500 blocks stay.
- **Leave it and document the string contract** in `.context/`. Costs nothing and stays fragile.

### The "LLM calls must use `withRetry()`" rule does not match how LLM calls actually retry
**Location:** `server/src/services/llm.ts` — `createChatModel()` (`maxRetries: 3`); `server/src/lib/retry.ts` — `isRetryableError()`; LLM invoke sites in `analysis.ts`, `dedup.ts`, `bluesky.ts`, `mastodon.ts`, `socialMedia.ts`, `story.ts` (no `withRetry`) vs `newsletter.ts`, `podcastScript.ts` (wrapped)
**Category:** Convention Compliance / Error Handling
**Description:** CLAUDE.md and `.context/` say external HTTP and LLM calls must use `withRetry()`. In practice, eight LLM call sites rely only on LangChain's `maxRetries: 3`, while `newsletter.ts` and `podcastScript.ts` wrap the call in `withRetry()` as well, so up to 4 × 4 attempts can stack. `isRetryableError()` reads `err.response.status` (the axios shape). OpenAI SDK errors carry `err.status`, so a 429 or 5xx from OpenAI is never retried by `withRetry()`, only by the SDK. Around OpenAI calls, `withRetry` mostly acts on messages that happen to contain "timeout". The same applies to the embeddings calls in `embedding.ts` (OpenAI SDK default `maxRetries` 2, plus `withRetry`). An agent following the written rule would add more stacked retries, while one reading the code would conclude the rule is not followed.
**Options:**
- **Make the SDK's retries the documented mechanism for OpenAI/LangChain calls** and remove the `withRetry` wrappers around them, keeping `withRetry` for axios. Small change, plus a correction to CLAUDE.md and `.context/llm-analysis.md`. It gives one retry layer with a known attempt count.
- **Make `withRetry` the only layer**: set `maxRetries: 0` on the clients and teach `isRetryableError` the OpenAI `status` field. Behavior stays uniform with the HTTP calls, but retry tuning across every LLM site has to be re-checked.
- **Leave the code and fix only the docs.** Costs nothing, but the double-retry cost on the newsletter and podcast paths remains.

### 49 numeric environment overrides are parsed with bare `parseInt`, so a typo silently becomes `NaN`
**Location:** `server/src/config.ts` — e.g. `auth.refreshReuseGraceMs`, `database.transactionTimeoutMs`, the `rateLimit.*`, `mastodon.*` and `crawl.*` entries
**Category:** Hardcoded Values / Error Handling
**Description:** Newer settings use parsers that throw at startup (`parseEffort`, `parseSameSite`, `parseTrustProxyHops`, `parseJobLeaseTiming`), with comments explaining that a typo "would silently break every admin session". The other 49 overrides use `parseInt(process.env.X || 'n', 10)`, which returns `NaN` on a typo. For example, `AUTH_REFRESH_REUSE_GRACE_MS=60s` makes `isWithinReuseGrace` always false, so every reload during a refresh revokes the whole login session. A `NaN` `DB_TRANSACTION_TIMEOUT_MS` or rate-limit window behaves in ways nobody has tested. `MASTODON_VISIBILITY` is cast to its union type with `as` and never checked.
**Options:**
- **One `parsePositiveInt(value, fallback, name)` helper that throws, applied to all 49.** Mechanical change, plus a test that iterates the config. It gives fail-fast behavior that matches the newer settings and ADR-0033's "fails closed" stance. The behavior change: a deploy with a bad value now refuses to start instead of running degraded.
- **Validate the whole env with one Zod schema at startup.** Tidier, but a larger change, and it touches `blueprint.test.ts` assumptions.
- **Leave it.** Defensible only because the values are dashboard-set and rarely changed.

### No test anywhere runs against PostgreSQL, while correctness-critical logic lives in raw SQL
**Location:** `server/src/lib/vectors.ts` (`searchByEmbedding`, untested), `server/src/services/storyRetention.ts`, `server/src/jobs/jobLease.ts`, `server/src/services/story.ts` — `hybridSearch()` issue filter, `server/src/services/subscribeLimits.ts`
**Category:** Test Coverage
**Description:** All server tests mock Prisma (`vi.hoisted` mocks). The only integration test is `lib/podcastAudio.integration.test.ts` (real ffmpeg). Several guarantees exist only in SQL: retention keep rules, the job lease's atomic claim on the database clock (ADR-0017/0020), pgvector distance queries and the issue-plus-parent filter, and the send limits derived from rows (ADR-0022). Mocked tests confirm which SQL was sent, not that it is right. A Docker DB already exists for development (`docker-compose.yml`, port 5433).
**Options:**
- **An opt-in DB test tier**: `*.db.test.ts` files that run only when a test-database URL is set, each migrating a throwaway schema. Start with retention and the job lease. Cost: one harness (about a day) plus per-file tests, and CI or the developer needs Docker. It catches the class of bug mocks cannot.
- **Targeted SQL snapshot tests only.** Cheap, but they still do not execute the SQL.
- **Leave it.** Accept that raw-SQL changes are verified by hand on the dev DB.

## Moderate

### SSRF guard checks hostnames only
**Location:** `server/src/utils/urlValidation.ts` — `isAllowedUrl()`; callers `server/src/services/extractor.ts` — `fetchPage()`; unguarded: `server/src/services/rssParser.ts` — `parseFeed()`, `server/src/services/favicon.ts` — `fetchImage()`, `tryHtmlParsing()`
**Category:** Security
**Description:** Article URLs come from third-party RSS feeds, so their content is attacker-influenced. The guard rejects private IP literals and `.local`/`.internal` names, and redirects are re-checked. However, it never resolves DNS (a public name pointing at 10.x passes), does not block single-label hostnames (Render's private-network service names), and misses IPv4-mapped IPv6 (`[::ffff:7f00:1]`). Feed and favicon fetches have no guard at all (admin-entered URLs, but favicon HTML parsing follows `<link href>` from the fetched page).
**Suggestion:** Resolve the hostname and reject private, loopback, link-local and mapped ranges before connecting (for example a custom `lookup` on the axios/undici agent, so DNS rebinding is covered as well). Reject dotless hostnames. Route `parseFeed` and `favicon.ts` through the same check.

### Public-CORS prefix `/api/feed` also matches `/api/feedback`
**Location:** `server/src/app.ts` — `publicReadPaths`
**Category:** Security
**Description:** The comment says state-changing POSTs stay on restricted CORS, but `'/api/feedback'.startsWith('/api/feed')` is true. Feedback POSTs therefore get `Access-Control-Allow-Origin: *` and skip the origin check, so any site can submit feedback from a visitor's browser and read the response. Impact is low today (anonymous, rate-limited, HMAC'd IP), but the matcher will catch any future `/api/feed…` route too.
**Suggestion:** Match on path segments (`p === path || path.startsWith(p + '/')`), and add a test that `/api/feedback` gets the restricted policy. Check that the site's own feedback form still works under the allowed `FRONTEND_URL` origin.

### JSON-LD is written with plain `JSON.stringify`, which does not escape `</script>`
**Location:** `client/src/components/StructuredData.tsx`; `client/src/pages/StoryPage.tsx`, `IssuePage.tsx`, `HomePage.tsx` — Helmet `<script type="application/ld+json">`
**Category:** Security
**Description:** Story and episode titles and summaries (model-written from crawled text, or admin-edited) are serialized into script elements. When the page is prerendered (issue pages, home, landing pages), a value containing `</script><script>…` would break out in the static HTML. Story pages are not prerendered today, which is the only reason this is not exploitable now.
**Suggestion:** Add a `toJsonLd()` helper that replaces `<` with `<` (also `>` and `&`). Use it in `StructuredData` and in the three Helmet blocks, with one test.

### Client production dependencies carry 22 advisories through two packages
**Location:** `client/package.json` — `@scalar/api-reference-react` ^0.8.70, `tailwindcss` ^3.4.14
**Category:** Dependency Health
**Description:** See the automated findings above. The Scalar React wrapper pulls the entire Vercel `ai` SDK and Vue into the `/developers` chunk. Tailwind 3's toolchain brings the `braces` and `postcss-selector-parser` advisories, which only matter at build time.
**Suggestion:** Upgrade `@scalar/api-reference-react` to 0.9.x (breaking; verify the `/developers` prerender and the chunk boundary) and re-audit. Treat tailwind 4 as its own planned migration. As an interim step, move build-only tooling into `devDependencies` so the audit reflects runtime exposure.

### Graceful shutdown waits for bulk tasks but not for scheduled jobs it is running
**Location:** `server/src/index.ts` — `shutdown()`; `server/src/jobs/scheduler.ts` — `runningJobs`
**Category:** Error Handling
**Description:** Shutdown drains `taskRegistry` (admin bulk tasks), then releases job leases and exits, while a cron-started handler (crawl, newsletter generation, retention batch) may still be mid-run in this process. Render deploys send SIGTERM regularly. The newsletter job, for instance, can be cut between `createNewsletter()` and its cleanup `catch`, leaving a half-built issue that holds the week's slot.
**Suggestion:** Track running job promises in `runJob()` and await them, within the same force-exit deadline, before releasing leases. Alternatively, document per job which interruption points are safe. Owner question: should a deploy wait for an in-flight newsletter or podcast stage, up to the 10 s window, or is the next run's recovery enough?

### `story.ts` is a 1,185-line grab-bag
**Location:** `server/src/services/story.ts`
**Category:** Decomposition
**Description:** It mixes slug locking, CRUD, publish and status transitions, cluster cleanup, hybrid search (RRF), LLM-reranked related stories with their own cache, the homepage query and cluster lookups. That is six concerns with separate test needs, and `story.test.ts` covers mostly the first two.
**Suggestion:** Split out `storySearch.ts` (`hybridSearch`, `buildIssueCondition`), `relatedStories.ts` (re-rank plus cache) and `storyPublish.ts` (slug lock, `preparePublishData`, publish paths), keeping `story.ts` as the CRUD façade that re-exports them.

### Bluesky and Mastodon admin code is near-copied across routes, pages and panels
**Location:** `server/src/routes/admin/bluesky.ts` vs `mastodon.ts` (152 lines each, 22 differing after renaming); `client/src/pages/admin/BlueskyPage.tsx` vs `MastodonPage.tsx` (58 differing of ~380); `client/src/components/admin/BlueskyDraftPanel.tsx` vs `MastodonDraftPanel.tsx`
**Category:** Duplication
**Description:** `services/socialMedia.ts` already shares the candidate logic, but the HTTP and UI layers are parallel copies. A fix lands in one channel and is missed in the other, and a third channel would mean a third copy.
**Suggestion:** Write one route factory, `socialChannelRouter(service, schemas)`, and one `SocialChannelPage`/`SocialDraftPanel` parameterized by channel, keeping each channel's post-format differences in its service.

### Three hand-rolled in-memory caches with different eviction rules
**Location:** `server/src/lib/cache.ts` — `TTLCache`; `server/src/services/embedding.ts` — `searchEmbeddingCache`; `server/src/services/story.ts` — `relatedCache`, `evictExpiredCache()`, `evictOldestEntry()`
**Category:** Duplication
**Description:** One cache sweeps on a timer, one sweeps on write with insertion-order eviction, and one sweeps hourly on read with earliest-expiry eviction. None dedupes concurrent misses.
**Suggestion:** Give `TTLCache` a `maxEntries` option and an in-flight promise map in `cached()`, then use it for both service caches.

### The issue-or-parent-issue filter is written three times
**Location:** `server/src/services/story.ts` — `buildIssueCondition()`, the inner `buildIssueCondition` shadowing it in `getHomepageData()`, and the raw-SQL `issueFilter` in `hybridSearch()`
**Category:** Duplication
**Description:** "A story belongs to an issue if its own issue, or else its feed's issue, is that issue or a child of it" exists in three spellings: two Prisma (one shadowing the other) and one SQL. `storyRetention.ts` `loadCombinedRows` has a fourth variant (`COALESCE(s.issue_id, f.issue_id)`), with different semantics for a story whose own issue is not the slug but whose feed's issue is.
**Suggestion:** Keep one Prisma builder and one SQL fragment builder side by side in one module, with a test that the two agree. Remove the shadowing copy.

### `PublicLayout.tsx` holds the whole header, both navs and the footer in one 650-line component
**Location:** `client/src/layouts/PublicLayout.tsx` — `PublicLayoutInner()`
**Category:** Decomposition
**Description:** Menu dialog state, search panel state, scroll reset, desktop and mobile headers, issue nav and footer live in one function, with the same long button class string repeated several times.
**Suggestion:** Extract `SiteHeader` (with `SearchPanel` and `MobileMenu`) and `SiteFooter`, and a shared class constant for the header action links. Keep the `PublicLayout.test.tsx` assertions as the safety net.

### `updateStory()` takes `Record<string, any>`, and its embedding guarantee depends on the payload's shape
**Location:** `server/src/services/story.ts` — `updateStory()`, `preparePublishData()`
**Category:** Type Safety
**Description:** The service accepts any keys. It regenerates the embedding only when `title`, `titleLabel` or `summary` is present in the payload. A `PUT /api/admin/stories/:id` with only `{ status: 'published' }` publishes without `ensureEmbedding`. Retention now clears the embeddings of old unpublished stories, so such a story would be missing from semantic search and related lists. The admin form happens to always send those keys, which is the only reason this does not occur today.
**Suggestion:** Type the parameter from `updateStorySchema`'s inferred type (`Prisma.StoryUpdateInput` subset). Call `ensureEmbedding` whenever the update transitions to `published`, as `publishStory()` and `updateStoryStatus()` do.

### Untested social-network clients and admin routes
**Location:** `server/src/lib/bluesky.ts` (318 lines, eight `any` casts), `server/src/lib/mastodon.ts` (195), `server/src/routes/admin/bluesky.ts`, `server/src/routes/admin/mastodon.ts`, `server/src/services/favicon.ts`
**Category:** Test Coverage
**Description:** The publish paths that post to public accounts and the AT Protocol response parsing (`thread as any`, `post.record as any`) have no tests. `favicon.ts`'s save-any-`image/*` behavior is already a known bug in BACKLOG.md.
**Suggestion:** Add route tests (supertest + mocked services) for publish and refresh-metrics, and unit tests for `lib/bluesky.ts` response parsing with typed fixtures that replace the `any` casts.

## Nice-to-Have

### Dead exports
**Location:** `client/src/hooks/useStories.ts` — `usePreassessStories`, `useAssessStory`, `useSelectStories`, `usePublishStory`, `useRejectStory`; `client/src/lib/preferences.ts` — `getPreferredIssues`, `setPreferredIssues`, `hasSetPreferences`; `client/src/lib/reading-history.ts` — `getReadSlugs`; `server/src/services/plunk.ts` — `updateCampaign`, `listCampaigns`, `getContact`, `trackEvent`; `server/src/services/story.ts` — `getStoriesByStatus`; `shared/constants/index.ts` — `JOB_NAMES`, `FEED_REGION_LABELS`, `MAX_PAGE_SIZE`
**Category:** Dead Code
**Description:** Exported and never referenced anywhere else, tests included, and not used inside their own files.
**Suggestion:** Delete them, after a final grep that also covers `server/src/scripts/`.

### Site URL and social profile URLs hard-coded in the newsletter template and four client files
**Location:** `server/src/services/newsletter.ts` — `generateContent()` (`relevanceUrl`), `generateHtmlContent()`; `client/src/layouts/PublicLayout.tsx`, `client/src/components/SupportBanner.tsx`, `client/src/components/SupportButton.tsx`, `client/src/pages/NoAdsNoTrackingPage.tsx` — `KOFI_URL`
**Category:** Hardcoded Values / Duplication
**Description:** `config.siteUrl` exists, but the newsletter writes `https://actuallyrelevant.news` eight times. The Ko-fi URL is defined in four client files, and the Bluesky and Mastodon profile URLs exist in both the client and the server.
**Suggestion:** Use `config.siteUrl` in the newsletter. Put the profile and donation URLs in `shared/constants` and import them on both sides.

### Auth constants outside `config.ts`
**Location:** `server/src/middleware/rateLimit.ts` — `authLimiter`, `refreshLimiter`; `server/src/routes/auth.ts` — `COOKIE_MAX_AGE`; `server/src/services/auth.ts` — `REFRESH_TOKEN_EXPIRY_MS`, `ACCESS_TOKEN_EXPIRY`; `server/src/config.ts` — `storyRetention.maxAgeMonths`
**Category:** Hardcoded Values
**Description:** The 24 h refresh lifetime is defined twice (cookie and DB row) and could drift. The login and refresh limits ignore the `config.rateLimit` block that every other limiter uses. `maxAgeMonths` has no env override, unlike the convention in CLAUDE.md.
**Suggestion:** Move them into `config.auth` / `config.rateLimit`, derive the cookie max-age from the token lifetime, and decide whether retention age should be env-overridable (it is owner-set, so "no" is a fine answer; then say so in the comment).

### Small input-validation gaps on public routes
**Location:** `server/src/routes/public/stories.ts` — `GET /:slug/related` (`limit`); `server/src/app.ts` — request-ID middleware
**Category:** Security
**Description:** `limit=-3` reaches Prisma `take` as a negative number, which reverses the selection. `X-Request-Id` is copied from the request unvalidated into logs and the response header.
**Suggestion:** Validate `limit` with a Zod query schema (1-10). Accept an incoming request ID only if it matches a UUID or short token pattern, and generate one otherwise.

### Login timing reveals whether an email has an account
**Location:** `server/src/routes/auth.ts` — `POST /login`
**Category:** Security
**Description:** An unknown email returns immediately, while a known one costs a 12-round bcrypt compare, so emails can be distinguished by timing (rate limit: 5 per 15 min per IP). There are only a few admin accounts, so the impact is low.
**Suggestion:** Compare against a fixed dummy hash when the user does not exist.

### `.context/authentication.md` has two inaccuracies
**Location:** `.context/authentication.md` — "Architecture → Server" (User routes bullet), "Creating the First Admin"
**Category:** Convention Compliance
**Description:** The doc says `PUT /api/admin/users/:id/password` handles self-change with the current password, but self-change is `PUT /api/auth/password`, and the admin route never asks for one. It also tells readers to run `npx tsx …/create-admin.ts` (README too), while CLAUDE.md asks for `npm --prefix` scripts. There is no `create-admin` npm script, and `scripts/seed-jobs.ts` also has none.
**Suggestion:** Correct the bullet. Add `admin:create` (and `db:seed-jobs` if still used) to `server/package.json` and reference the scripts.

## Convention Gap Recommendations

1. **ADR-0039 says 365 days; the code and `.context/story-retention.md` say 6 months** (owner changed it 2026-10-18, commit `72ecf68`). The ADR log is append-only, so the change needs a superseding entry ("Delete unkept stories after 6 months") rather than an edit. For `ashoka-engineering:adr`.
2. **Typed service errors mapped once (`PodcastRefusedError`, `PodcastEditRejectedError` + `sendFailure()`)** are the newer pattern. Older routes match message strings. Record which one new routes follow. For `ashoka-engineering:project-context` (a "Route error handling" passage, possibly in a new `.context/server-conventions.md` or in `logging.md`).
3. **Config parsers that throw at startup** (`parseEffort`, `parseSameSite`, `parseTrustProxyHops`, `parseJobLeaseTiming`) are the newer pattern. The CLAUDE.md line "Server config — All tunable constants centralized in `server/src/config.ts` with env var overrides" does not say overrides must fail fast. For `ashoka-engineering:project-context`.
4. **The retry rule in CLAUDE.md** ("External HTTP and LLM calls must use `withRetry()`") does not describe the LangChain/OpenAI SDK retries that most LLM calls actually rely on. Correct it once the Important item above is decided. For `ashoka-engineering:project-context`.
5. **`notify()` never throws** (ADR-0028), so callers may fire-and-forget it with `.catch(() => {})`. This is followed everywhere but stated only in a code comment. Worth a line in `.context/admin-notices.md`. For `ashoka-engineering:project-context`.
6. **`_reset…()` / `_…` exports exist only for tests** (`_resetShutdownState`, `_resetApiState`). A consistent pattern, undocumented. For `ashoka-engineering:project-context` (testing patterns section of CLAUDE.md).
7. **The LLM re-rank runs on an anonymous public request path** (`getRelatedStories`), a cost and latency trade-off that is documented in `.context/embeddings.md` as behavior but never recorded as a decision. Record the choice made on the Important item. For `ashoka-engineering:adr`.

## Metrics Summary

| Lens | Critical | Important | Moderate | Nice-to-have |
|------|----------|-----------|----------|-------------|
| Security | 0 | 0 | 3 | 2 |
| Performance | 0 | 1 | 0 | 0 |
| Test Coverage | 1 | 1 | 1 | 0 |
| Convention Compliance | 0 | 1 | 0 | 1 |
| Convention Gaps | 0 | 0 | 0 | 0 (7 recommendations above) |
| Duplication | 0 | 0 | 3 | 0 |
| Decomposition | 0 | 0 | 2 | 0 |
| Dead Code | 0 | 0 | 0 | 1 |
| Type Safety | 0 | 0 | 1 | 0 |
| Error Handling | 0 | 1 | 1 | 0 |
| Dependency Health | 0 | 0 | 1 | 0 |
| Hardcoded Values | 0 | 1 | 0 | 2 |
| Stale TODOs | 0 | 0 | 0 | 0 |
| **Total** | **1** | **5** | **12** | **6** |

No TODO/FIXME/HACK comments exist in the source, so lens 13 is clean. Items already in `BACKLOG.md` (react-router-dom imports, router `errorElement`, favicon ICO conversion, `buildFilter.paths`, newsletter week uniqueness) were not repeated here.

# SEO: Sitemap and Robots

## Files

| File | Location | Type |
|------|----------|------|
| `robots.txt` | `client/public/robots.txt` | Static |
| `sitemap.xml` | `server/src/routes/public/sitemap.ts` | Dynamic (server-generated) |

## robots.txt

Static file that rarely changes. Points crawlers to the sitemap and states the AI usage preference.

```txt
User-agent: *
Allow: /
# AI usage preference (IETF AIPREF draft): AI search yes, AI model training no
Content-Usage: train-ai=n, search=y

Sitemap: https://actuallyrelevant.news/sitemap.xml
```

### AI usage preference (`Content-Usage`)

Owner decision 2026-10-25: AI search may use the site's content, AI model training may not. Stated with the IETF AIPREF drafts (draft-ietf-aipref-attach-05 for the `robots.txt` rule and the HTTP header, draft-ietf-aipref-vocab-07 for the `train-ai` and `search` categories, both August 2026), in three places that must agree:

- `robots.txt`: `Content-Usage: train-ai=n, search=y` in the catch-all group (no path prefix, so it covers the whole site).
- The API: every response carries `Content-Usage: train-ai=n, search=y` (`server/src/app.ts`, value `config.contentUsage`), which covers what the static site's rewrites proxy to it (story pages, `/sitemap.xml`, `/podcast.xml`), the RSS feeds and the JSON API.
- The static site: a `headers` rule on `/*` in `render.yaml` sends the same header with every static file and prerendered page.

`server/src/app.test.ts` holds all three to `config.contentUsage`; change the value there and in the two files together. The drafts are not RFCs yet and compliance is voluntary; if a later draft renames a category, update all three. `ai-use` (AI inference, e.g. retrieval) is left unstated on purpose. Google's robots.txt parser ignores the unknown rule, so crawling is unaffected. Record: `.context/ai-transparency.md` §10.

## sitemap.xml

Served dynamically by the backend at `GET /api/sitemap.xml`. In production, a Render rewrite rule proxies `/sitemap.xml` to the backend endpoint so crawlers see it at the canonical URL.

### How It Works

1. `GET /api/sitemap.xml` queries all published stories (slug + datePublished) and the published podcast episodes (`listPublishedEpisodeDates()`, the same "published" rule as the feed) from the database
2. Combines with the static routes from `shared/routes.json`, the same list the client prerenders (see "The static route list" below)
3. Generates XML with `<lastmod>` for stories using `datePublished`, one `/podcast/<id>/transcript` entry per published episode (`lastmod` = first publication, priority 0.5), and one `/newsletter/<slug>` entry per published newsletter issue (`listPublishedIssueDates()`, `lastmod` = first publication, priority 0.5; `.context/newsletter-podcast.md`, "Web edition")
4. Response is cached in-memory (TTL: `config.sitemap.cacheMaxAge`, default 1 hour)
5. `Cache-Control: public, max-age=3600` header allows CDN/proxy caching
6. New stories appear in the sitemap automatically within the cache TTL

### Render Rewrite Rule

| Field | Value |
|-------|-------|
| Source | `/sitemap.xml` |
| Destination | `https://api.actuallyrelevant.news/api/sitemap.xml` |
| Action | **Rewrite** |

The rule lives in the static site's `routes` in the root `render.yaml`, beside the podcast feed's below. Change them there, not in the dashboard (`.context/deployment.md`).

Both rewrites (this one and the podcast feed's below) target the API's custom domain, `https://api.actuallyrelevant.news` (ADR-0019), not the service's `*.onrender.com` host.

**Critical — Rule Order:**
- Render evaluates rewrite rules **top-to-bottom, first match wins**
- The `/sitemap.xml`, `/podcast.xml` and `/stories/*` rules, the prerendered-page rules and the dynamic-page proxies (`/newsletter/*`, `/podcast/*`, `/issues/*`, "Link previews" below) must stay **before** the SPA catch-all rule (`/*` → `/index.html`), and those three proxies **after** the prerendered pages they share a prefix with (`/newsletter`, `/podcast`, the four topic pages)
- Render merges the file's routes with rules already in the dashboard, so check the order in the static site's Redirects/Rewrites tab after a blueprint sync
- If reversed, the catch-all matches first and serves the SPA shell, which then 404s on the client

**Important:** No static `sitemap.xml` file should exist in `client/public/` — Render serves static files before applying rewrite rules.

### Podcast feed rewrite

The podcast's RSS feed is served the same way, at the canonical `https://actuallyrelevant.news/podcast.xml` (the URL submitted to Apple, Spotify and the other directories, so it must never change). The public URL never names the API host; only the rewrite's destination does.

| Field | Value |
|-------|-------|
| Source | `/podcast.xml` |
| Destination | `https://api.actuallyrelevant.news/api/podcast/feed.xml` |
| Action | **Rewrite** |

Same rules as the sitemap: above the SPA catch-all, and no static `podcast.xml` in `client/public/`. The `/podcast` page is an ordinary prerendered route (in `shared/routes.json`, below). Each episode's transcript page, `/podcast/<id>/transcript`, is dynamic like a story page: not prerendered and not in the static list, but in the server sitemap; its Helmet sets title, description, canonical and `og:*`, and it carries `PodcastEpisode` and breadcrumb JSON-LD (`buildPodcastEpisodeSchema` in `client/src/lib/structured-data.ts`); its not-found state is `noindex`. Details: `.context/podcast.md`, "Publishing, feed and page". Through the `/podcast/*` rewrite the backend serves it with the same tags in the shell for crawlers that run no JavaScript ("Link previews" below).

The newsletter's web edition follows the same split: `/newsletter`, which lists the published issues, is an ordinary prerendered route (in `shared/routes.json`; `/newsletter/archive` only redirects there client-side and is not listed), and each issue page, `/newsletter/<slug>`, is dynamic (only in `App.tsx` and the server sitemap), with title, description, canonical, `og:*`, breadcrumb JSON-LD and a `noindex` not-found state (`.context/newsletter-podcast.md`, "Web edition"). Through the `/newsletter/*` rewrite the backend serves it with its own preview tags ("Link previews" below).

### Configuration

| Config Key | Env Var | Default | Description |
|-----------|---------|---------|-------------|
| `config.sitemap.cacheMaxAge` | `SITEMAP_CACHE_MAX_AGE` | `3600` | Cache TTL in seconds |
| `config.storyPreview.shellCacheSeconds` | `STORY_PAGE_SHELL_CACHE_SECONDS` | `60` | How long the fetched `index.html` is reused before revalidation, for every link-preview page |
| `config.storyPreview.imageCacheSeconds` | `STORY_OG_IMAGE_CACHE_SECONDS` | `86400` | `Cache-Control` max-age of a story's `og.png` and of a section image |
| `config.apiUrl` | `API_URL` | `https://api.actuallyrelevant.news` | Origin in the absolute og:image URL (also the OpenAPI spec's server) |
| `config.storyPreview.shellUrl` | `SITE_URL` | `https://actuallyrelevant.news/index.html` | Where the shell is fetched from (`config.siteUrl` + `/index.html`) |

### Legacy Build-Time Generation

The build-time sitemap generator (`client/scripts/generate-sitemap.ts`) is kept for local development/testing but is no longer part of the client build command.

## Adding a New Route

When adding a page, add its entry (`path`, `priority`, `changefreq`) to **`shared/routes.json`**, its route to `App.tsx`, and its rewrite to `render.yaml` (the blueprint test prints the lines). `shared/routes.json` feeds both the prerender and the sitemap.

### The static route list

**Served at the no-slash address.** Render serves a file that exists at the requested path before any rule; the prerender writes each page to `dist/<path>/index.html`, which Render finds only at `/<path>/`, so until 2026-10-29 the catch-all answered `/<path>` (the address the sitemap, links, `og:url` and canonical use) with the prerendered homepage. Each entry except `/` has its own rewrite `/<path>` → `/<path>/index.html` in `render.yaml`, after the proxy rewrites and above the catch-all (Render allows no rule on the root and serves `dist/index.html` there). Guarantee: each prerendered page's no-slash address serves its own HTML; `/<path>/` serves the same file. `server/src/blueprint.test.ts` fails on a missing, misplaced or stale page rule and on any rule an earlier one already matches, and prints the YAML to add. Render keeps dashboard rules the file no longer names, so removing a page rule also means deleting it in the Redirects/Rewrites tab.

`shared/routes.json` is the only list of static pages (it replaced two hand-kept copies, which had drifted: the sitemap lacked `/feedback` and gave `/widgets` 0.4 against the client's 0.5; 0.4 was kept).

- **Client:** `client/src/routes.ts` imports it: `routePaths` (every entry) goes to the prerender in `vite.config.ts`; `sitemapRoutes` feeds the legacy `generate-sitemap.ts`.
- **Server:** the server's tsconfig cannot import files outside `server/src`, so `server/src/lib/staticRoutes.ts` reads the file at startup (`loadSitemapRoutes()`, the path resolves the same from `src/lib/` and `dist/lib/`) and validates it with Zod. A missing or malformed file stops the server at boot, so Render keeps the previous instance serving. This relies on the repository root being on disk beside `server/` at runtime on Render, as it is at build time (the build runs `../scripts/install-dev-deps.mjs`); if a deploy ever fails at boot on `shared/routes.json`, that assumption broke.
- **Prerendered but not in the sitemap:** an entry with `"sitemap": false` and its reason in `"sitemapNote"`. Three, on purpose: `/saved`, a personal page whose saved stories live in the visitor's browser, so there is nothing to index; `/subscribed`, the newsletter confirmation page, `noindex` in every state. The confirmation link, `/subscribed` with its `token` and `email` query, is served that page's prerendered HTML, which is its no-token state, before the script runs, so that state says the page is loading, claims nothing is confirmed and carries the `noindex` (`SubscribedPage.test.tsx`; `.context/subscription.md`, "Client Behavior"); and `/newsletter-edition`, where an issue's footer switch link leads, likewise `noindex` in every state and prerendered as a loading line, its link carrying a reader's Plunk contact id (`NewsletterEditionPage.test.tsx`; `.context/subscription.md`, "Editions").
- **Deploys:** with a root directory set, Render auto-deploys a service only for changes inside it, so a commit that changes only `shared/routes.json` redeploys neither service (`BACKLOG.md`, `buildFilter.paths`). Ship such a change with a commit that touches both, or deploy both by hand.
- **Topic pages prerender with their data.** IssuePage marks its skeleton with `data-prerender-wait` (`prerenderWaitProps()`, `lib/loadState.ts`) while the topic's first request is in flight in the prerenderer; `signalRenderComplete` waits for it within its 5 s cap, plus 100 ms for Helmet, so `dist/issues/<slug>/index.html` carries the topic's title, description and og:* above the topic's header. The stories are never asked for in the prerenderer (`useIssueStories`), so the snapshot shows their skeleton and bakes no dated story or pull quote. This needs the Render build to reach `VITE_API_URL`; CI and local builds without it bake the skeleton and the homepage head, as before.
- Held by `server/src/lib/staticRoutes.test.ts`, `server/src/routes/public/sitemap.test.ts` and `client/src/routes.test.ts`.

### Priority Guidelines

| Priority | Use For |
|----------|---------|
| 1.0 | Homepage only |
| 0.8 | Issue pages |
| 0.7 | Important static pages (methodology, about) |
| 0.6 | Individual published stories |
| 0.5 | Utility pages (imprint, privacy) |
| 0.3 | Low-priority pages (search) |
| 0.2 | Pages with `"sitemap": false` (`/saved`, `/subscribed`, `/newsletter-edition`): `shared/routes.json` requires a value, but none is published |

### Change Frequency Options

- `daily` — Homepage, search (new stories published regularly)
- `weekly` — Issue/category pages
- `monthly` — Static pages (methodology, about), individual stories
- `yearly` — Pages that rarely change (imprint, privacy)

## Head Tags: One of Each per Page

`client/index.html` carries pre-JS fallbacks for description, `og:*` and `twitter:*`, each marked `data-rh="true"`. That marker makes react-helmet-async treat them as its own: on its first commit it removes them and writes the merged Helmet state. `DefaultSeo` (`client/src/lib/seo.tsx`), rendered once by the root route of `App.tsx`'s `appRoutes`, above every page, supplies the same defaults as Helmet tags; a page's own tag with the same `name`/`property` wins (innermost Helmet instance). Result: prerendered and client-navigated pages get exactly one of each — the page's own, or the default.

- Adding a head tag to `index.html` that a page might also set: mark it `data-rh="true"` and add it to `DefaultSeo`, or prerendered pages get it twice. `client/src/lib/seo.test.tsx` loads the real `index.html` and fails on any duplicate.
- A page that sets no `og:title`, `og:description` and `og:url` of its own previews as the homepage when its link is shared (the defaults, with the homepage's URL). A page meant to be shared sets all three, from the same title and description as its `<title>` and `description`; `/developers` and `/saved` do since 2026-10-26 (`DevelopersPage.test.tsx`, `SavedPage.test.tsx`).
- `article:author` is a story-page tag only: `StoryPage`'s Helmet sets it ("RelevanceAI by Actually Relevant") and the backend injects the same for crawlers ("Story link previews" below). Neither `index.html` nor `DefaultSeo` carries it, so only story pages carry `article:author` (the newsletter issue and podcast transcript pages declare `og:type` article but set none), and it leaves the head when a visitor moves from a story to another page. Held by `seo.test.tsx`, `structured-data.test.ts` and `server/src/routes/public/storyPreview.test.ts`.
- Unmarked template tags (`charset`, `viewport`, `theme-color`, `author`, `fediverse:creator`) are never touched by Helmet; don't set those from pages. Pages the backend serves ("Link previews") keep them too, because it removes only `data-rh` tags from the shell.
- `fediverse:creator` (`@actuallyrelevant@mastodon.social`) makes Mastodon show an author byline linking the account under every preview card of a site link (`.context/mastodon.md`, "Author byline"). `seo.test.tsx` checks it matches `MASTODON_PROFILE_URL` in `client/src/config.ts`; change both together.
- The `<title>` is not duplicated: Helmet updates the existing element.
- **Not-found views are `noindex`.** Unknown addresses answer 200 (the static site's catch-all serves the app; the link-preview proxy serves the shell for a missing page, such as a story retention deleted, an unpublished issue or episode, or an unknown topic), so each public not-found view sets `<meta name="robots" content="noindex">` in its own Helmet: `StoryPage` ("Story Not Found"), `IssuePage` ("Issue Not Found"), `NewsletterIssuePage`, `PodcastTranscriptPage` and the catch-all `NotFoundPage`, as the route error page does. Only the not-found branch sets it, and Helmet removes it when the reader moves on, so a page that loads stays indexable. No status code changes (there is no real 404). Held by `StoryPage.test.tsx`, `IssuePage.test.tsx`, `NotFoundPage.test.tsx`, `NewsletterIssuePage.test.tsx` and `PodcastTranscriptPage.test.tsx`.

## Link previews

The site's pages that are not prerendered show a crawler that runs no JavaScript only `index.html`'s homepage tags, unless the backend serves them. Since 2026-11-05 one module does that for every such page. `server/src/services/linkPreview.ts` holds the shell (fetched and cached as in "Story link previews" below), the tag list, one page cache and the failure rule. `server/src/services/pagePreviews.ts` is the table of pages and what each one's tags say, each entry giving the values that page's Helmet sets. `server/src/routes/public/pagePreview.ts` serves them at `/api/page/<site path>`, and story pages keep `/api/story-page/*` through the same handler.

| Site path | Rewrite (render.yaml) | `<title>` / og:title | Description | og:image |
|---|---|---|---|---|
| `/stories/<slug>` | `/stories/*` → `…/api/story-page/*` | "Label: Headline - Actually Relevant" / "Label: Headline" | summary as plain text | the story's `og.png` |
| `/newsletter/<slug>` | `/newsletter/*` → `…/api/page/newsletter/*` | `<issue title> - Actually Relevant Newsletter` / `Week 43: <lead headline>` | the page's own sentence | `…/api/section-images/newsletter-issue.png` (the "AI" badge) when the title is the lead's AI headline, else `…/newsletter.png` |
| `/podcast/<id>/transcript` | `/podcast/*` → `…/api/page/podcast/*` | `Transcript: <episode title> - Actually Relevant` (both) | `AI: <episode summary>` (the AI label `PODCAST_TRANSCRIPT_DESCRIPTION_PREFIX`, as the page's Helmet sets it; the cuts apply to the whole string) | `…/api/section-images/podcast.png` (always with the "AI" badge) |
| `/issues/<slug>` (not the four prerendered) | `/issues/*` → `…/api/page/issues/*` | `<topic> - Actually Relevant` (both) | intro, else description | `…/api/section-images/issues/<slug>.png` |

- **Same values as the page's Helmet**, with one exception: an issue's og:title, twitter:title and og:image. Its lead is the most relevant story (stored `relevance`, ties in the issue's order, `byRelevance()` in `newsletterInbox.ts`) whose heading carries a story marker and whose story is still published with a slug. Its heading goes in through `leadLine()`, the email subject's builder. The card image is then the newsletter section image with the website's "AI" badge (`newsletter-issue.png`), the label that travels with the AI headline, as a story image's footer does (`newsletterIssueCard()` in `pagePreviews.ts`, which alone makes this choice; owner decision 2026-11-05, `.context/ai-transparency.md` §3). The description is the page's own. The public JSON has no ratings, so once the script runs Helmet replaces title and image with the page's own (issue title, plain newsletter image). An issue with no such story keeps the page title and the plain newsletter image. The email is unchanged.
- **Tags:** `<title>`; `description` (160); `rel=canonical` where the page sets one (not on topic pages); `og:type`; `og:site_name`; `og:title`; `og:description` (200); `og:url`; `og:image` (with type, width and height); `article:author` (story pages only); `article:published_time` where the page has one; `twitter:card`; `twitter:title`; `twitter:description` (200); `twitter:image`. All carry `data-rh="true"` and are HTML-escaped, and the shell's title and `data-rh` tags are removed first.
- **Paths:** `server/src/lib/linkPreviewPaths.ts` lists the sections (`stories`, `newsletter`, `podcast`, `issues`) and the mount `/api/page`. `blueprint.test.ts` fails unless each section has its rewrite with that destination, above the catch-all and below every prerendered page of the section. Only `/newsletter/<slug>`, `/podcast/<id>/transcript`, `/issues/<slug>` and `/stories/<slug>[/…]` get tags. Any other path under these prefixes gets the plain shell without a database read.
- **Reads:** an issue through `findPublishedIssueHead()` (`newsletterArchive.ts`, the archive's published rule) plus one `story.findMany` over its markers. An episode through `findPublishedEpisodeHead()` (`podcastPublish.ts`, the feed's published rule). A topic through one `issue.findFirst` by slug (any topic, as `GET /api/issues/:slug`).
- **Failure rule, headers, cost:** as for story pages below, for every page. One in-memory page cache serves all of them (200 entries, 60 s, per site path and shell version, `link-preview-pages` in the admin Clear cache list), mounted before the shared rate limiter. Every view of these pages now waits on the API instance.
- **Undo:** two steps, in this order. First delete the three rules in the dashboard (the pages fall back to the catch-all at once), then revert the commit. A revert alone leaves rules pointing at a route that no longer exists, so those pages answer the API's JSON 404; deleting the rules alone is undone by the next blueprint sync while `render.yaml` still lists them.
- **After the blueprint sync:** open the static site's Redirects/Rewrites tab and confirm the three proxies sit after the prerendered-page rules (after `/newsletter-edition`) and before `/*`. A sync adds new rules and keeps existing ones, but Render doesn't say where it puts them.
- **After the first deploy, check:** `curl -s https://actuallyrelevant.news/newsletter/<slug> | grep og:` shows the issue's tags; do the same for `/podcast/<id>/transcript` and a subtopic `/issues/<slug>`. Then check by headers that the prerendered pages are still static: `curl -sI https://actuallyrelevant.news/issues/planet-climate` (and `/newsletter`, `/podcast`) shows no `x-request-id` and `cache-control: public, max-age=0, s-maxage=300`, while `curl -sI https://actuallyrelevant.news/newsletter/<slug>` shows `x-request-id` and `cache-control: public, max-age=60`. Since the topic pages prerender with their data ("The static route list" above), `curl -s https://actuallyrelevant.news/issues/planet-climate | grep -E '<title|og:image'` shows the topic's title and `…/section-images/issues/planet-climate.png`. Last, paste an issue link in Slack or LinkedIn's Post Inspector.
- Held by `server/src/routes/public/pagePreview.test.ts` (each page's full head; story pages byte for byte against the pre-module output), `client/src/pages/PodcastTranscriptPage.test.tsx` (the transcript's labeled description in its Helmet), `storyPreview.test.ts`, `newsletterInbox.test.ts`, `blueprint.test.ts`, `routes/public/sectionImages.test.ts`, `services/sectionImage.test.ts` and `client/src/pages/IssuePage.test.tsx`.

## Section preview images

`GET /api/section-images/newsletter.png`, `/newsletter-issue.png`, `/podcast.png` and `/issues/<slug>.png` (`routes/public/sectionImages.ts`, `services/sectionPreview.ts`, drawn by `services/sectionImage.ts` with the carousel's canvas). Each is 1200x630: the logo on white, a strip of the four topic colors (`lib/topicColors.ts`, mirroring `client/src/lib/category-colors.ts`), and the name in white Roboto Bold on brand-800. A topic gets a dot in its color, and a subtopic in its parent's. `newsletter-issue.png` is the newsletter image with the website's "AI" badge after the name (as `AiBadge` draws it: outline and text in the label's color, its text half the name's size), for an issue card whose title is AI-written ("Link previews" above). `podcast.png` always carries the same badge, since the podcast is written and voiced by AI: on `/podcast` and every transcript card, whose description keeps its "AI: " prefix. Both badges are owner decisions (2026-11-05, `.context/ai-transparency.md` §3).

- **Fitting the name:** one line from 100px down to 72px, else two lines from 80px down to 52px, with an ellipsis only as a last resort (`fitLabel`). The dot's room counts on the first line, the badge's on the last.
- **Assets:** the font is Roboto Bold (Apache 2.0) with its licence, `server/assets/fonts/Roboto/`, a copy of `client/public/fonts/Roboto`. No licence on record covers drawing the site's heading font, Nexa Bold, into images on the server, so it is not used. The logo is a copy of `client/public/images/logo-text-horizontal.png` (a 500x200 JPEG), drawn no larger than its own size so it stays sharp; replace it with a larger copy to draw it larger.
- **No AI-generated content:** the images carry no XMP, and no AI mark except the badge on the issue variant and the podcast image.
- **Caching:** in memory, 30 entries for 6 h (`sectionImageCacheEntries`, registered as `section-preview-images`). Over HTTP, `Cache-Control` from `STORY_OG_IMAGE_CACHE_SECONDS` with `Cross-Origin-Resource-Policy: cross-origin`. A missing topic is 404 and not cached.
- **Access:** behind the shared rate limiter, CORS-open like the public reads.
- **Where they are used:** URLs come from `sectionImage()`/`topicImage()` (server, on `API_URL`) and `sectionOgImage()`/`topicOgImage()` (client, on `API_BASE`). Used as og:image and twitter:image, with type, width and height, on the newsletter issue, transcript and topic pages, and in the Helmet of `/newsletter` and `/podcast`. Story pages keep their `og.png`. `/issues` keeps the site image.

## Story link previews

Story pages are not prerendered, so before 2026-10-19 a crawler that does not run JavaScript (LinkedIn, X, Slack, WhatsApp, Facebook, Mastodon) saw only `index.html`'s homepage fallbacks, and every shared story link previewed as the homepage. Two parts fix that ([ADR-0040](decisions/0040-story-pages-through-backend.md)):

**1. A per-story image, `GET /api/stories/:slug/og.png`** (`server/src/routes/public/storyPreview.ts`, `services/storyPreview.ts`). 1200x630 PNG drawn by the newsletter carousel's renderer (`createStoryImage(story, OG_IMAGE_SIZE)` in `services/carousel.ts`, which takes a size since this change; the carousel keeps 1200x675): category header, AI headline, publisher and source date, AI summary cut to fit, and the pixel footer "actuallyrelevant.news · AI-generated", with the same unsigned XMP `DigitalSourceType` chunk as the slides (`.context/ai-transparency.md`). Published stories only (404 otherwise). Cached in memory (`BoundedCache`, `lib/boundedCache.ts`: at most 50 images for 6 hours, so a crawler walking every story cannot fill the memory-capped instance) and over HTTP (`Cache-Control: public, max-age=86400`, `STORY_OG_IMAGE_CACHE_SECONDS`). `Cross-Origin-Resource-Policy: cross-origin` overrides helmet's same-origin default. Behind the shared rate limiter. The absolute URL comes from `storyOgImageUrl()` (`server/src/lib/storyPreviewUrls.ts`, on `API_URL`) and, in the client, `storyOgImageUrl()` in `client/src/lib/api.ts` (on `API_BASE`): `StoryPage`'s Helmet sets it as `og:image` and `twitter:image` through `CommonOgTags({ image })`. A changed story keeps its old image for up to a day in caches; that is accepted.

**2. Story pages proxied through the backend.** A rewrite on the static site, `/stories/*` → `https://api.actuallyrelevant.news/api/story-page/*` (in `render.yaml`, above the catch-all), sends every story page view to `storyPageRouter`, which returns the built client's `index.html` with the story's tags in the head: `<title>`, `description`, `rel=canonical`, `og:type` article, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` (with type, width, height), `article:author`, `article:published_time`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`. Values come from the story exactly as `StoryPage`'s Helmet computes them (title label plus headline; the summary as plain text, or the title when it has none) and are HTML-escaped. The model is asked for plain text (`.context/llm-analysis.md`), but `StoryPage` renders the summary through `<Markdown>`; any marks that slip in would render on the page and show raw in a card, so both sides pass it through `markdownToPlainText()` (`server/src/lib/plainText.ts`, mirrored by `client/src/lib/plainText.ts`; `server/src/lib/plainText.test.ts` fails when the two copies' rules differ): link and image text stay and their URLs go, emphasis, code, heading, quote and list marks go, and whitespace becomes single spaces. The 160-character cut (`description`) and the 200-character cut (`og:description`, `twitter:description`) apply to the plain text. In the client the same helper builds the `NewsArticle` JSON-LD description, the share buttons' prefilled text and the home hero's teaser. The per-story `og.png` still draws the raw summary. Every injected tag carries `data-rh="true"`, and the shell's own title and `data-rh` tags (the prerendered homepage's description, og/twitter tags, canonical and JSON-LD) are removed first, so Helmet takes the injected ones over on its first commit and each tag appears once. The body is left as it is.

- **Render's rewrite proxies; it does not redirect.** Render's docs (Static Site Redirects and Rewrites, checked by web search on 2026-10-19; the page itself was not reachable from the build container): a rewrite serves the destination's content at the original path and the browser does not see the change; the destination may be a full public URL; a `*` in the source is inserted where the destination has `*` (their example: `/*` → `/blog/*`); a file that exists at the path is served without applying any rule; rules apply top to bottom. The `/sitemap.xml` and `/podcast.xml` rewrites have proxied to the API since before this change. The wildcard form in a rewrite to an external host has not been seen working live yet: check it after the first deploy (below).
- **Where the shell comes from: fetched from the static site, cached briefly.** The server fetches `${SITE_URL}/index.html` (`config.storyPreview.shellUrl`; that path is a real file, so no rewrite applies and nothing loops) with `withRetry` and a 5-second timeout, reuses it for 60 seconds (`STORY_PAGE_SHELL_CACHE_SECONDS`), then revalidates with `If-None-Match`/`If-Modified-Since`. A response without `</head>` and `<div id="root"` is refused. Bundling it into the server build was rejected: the two services build separately and in no fixed order from the same push (`.context/deployment.md`), so a bundled copy would name another build's hashed assets. Fetching keeps the shell the live build's; the cost is that for up to 60 seconds after a client deploy, story pages may reference the previous build's assets.
- **Failure rule: story pages never break because of this route.** A story that is missing or unpublished, a database error, or a tag-building error returns the shell unchanged with 200, and the SPA shows its own page (its not-found view is `noindex`, "Head Tags" above; a crawler that runs no JavaScript still gets the unchanged shell with no noindex). Any path under the mount gets the shell (no JSON 404). A failed revalidation keeps serving the last good shell. Only when no shell has ever been fetched since boot (the static site unreachable) does the route answer 503 with `Retry-After: 10`.
- **Headers.** The route removes helmet's `Content-Security-Policy` (its `script-src 'self'`/`connect-src 'self'` would block the analytics script and the client's calls to the API on `actuallyrelevant.news`) and `Cross-Origin-Resource-Policy`; `Cache-Control: public, max-age=60`. Rendered pages are cached in memory per slug and shell version (200 entries, 60 s).
- **Cost.** Every story page view now waits on the API instance (memory-capped, also running cron, LLM and ffmpeg work) and one extra hop. The route is mounted before the shared rate limiter, like the podcast feed: behind the rewrite every visitor may arrive from the static site's proxy address. Its work is a cache hit or one indexed query.
- **After the first deploy, check:** `curl -sI https://actuallyrelevant.news/stories/<slug>` returns 200 HTML without a CSP header; `curl -s https://actuallyrelevant.news/stories/<slug> | grep og:image` shows the story's image URL; the page loads and navigates in a browser; a missing slug shows the SPA's "Story Not Found" with `<meta name="robots" content="noindex">`; LinkedIn's Post Inspector or a Slack paste shows the story card. If the rewrite redirects instead of proxying, or the wildcard is not substituted, remove the rule (story pages fall back to the catch-all, as before) and switch to a share URL on the API host (the option set aside in ADR-0040).

## og:image and Bluesky

Bluesky does **not** auto-fetch og: metadata. Link card thumbnails are fetched and uploaded at post time. `publishPost()` (`server/src/services/bluesky.ts`) uses the story's own preview image, `storyOgImageUrl(slug)`, and the global `/images/og-image.png` only for a story without a slug. See `.context/bluesky.md`.

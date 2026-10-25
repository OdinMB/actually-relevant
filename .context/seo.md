# SEO: Sitemap and Robots

## Files

| File | Location | Type |
|------|----------|------|
| `robots.txt` | `client/public/robots.txt` | Static |
| `sitemap.xml` | `server/src/routes/public/sitemap.ts` | Dynamic (server-generated) |

## robots.txt

Static file that rarely changes. Points crawlers to the sitemap.

```txt
User-agent: *
Allow: /

Sitemap: https://actuallyrelevant.news/sitemap.xml
```

## sitemap.xml

Served dynamically by the backend at `GET /api/sitemap.xml`. In production, a Render rewrite rule proxies `/sitemap.xml` to the backend endpoint so crawlers see it at the canonical URL.

### How It Works

1. `GET /api/sitemap.xml` queries all published stories (slug + datePublished) and the published podcast episodes (`listPublishedEpisodeDates()`, the same "published" rule as the feed) from the database
2. Combines with hardcoded static routes (same list as `client/src/routes.ts`)
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
- The `/sitemap.xml`, `/podcast.xml` and `/stories/*` rules must stay **before** the SPA catch-all rule (`/*` → `/index.html`)
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

Same rules as the sitemap: above the SPA catch-all, and no static `podcast.xml` in `client/public/`. The `/podcast` page is an ordinary prerendered route (in both route lists below). Each episode's transcript page, `/podcast/<id>/transcript`, is dynamic like a story page: not prerendered and not in either static list, but in the server sitemap; its Helmet sets title, description, canonical and `og:*`, and it carries `PodcastEpisode` and breadcrumb JSON-LD (`buildPodcastEpisodeSchema` in `client/src/lib/structured-data.ts`); its not-found state is `noindex`. Details: `.context/podcast.md`, "Publishing, feed and page".

The newsletter's web edition follows the same split: `/newsletter`, which lists the published issues, is an ordinary prerendered route (in both route lists; `/newsletter/archive` only redirects there client-side and is in neither), and each issue page, `/newsletter/<slug>`, is dynamic (only in `App.tsx` and the server sitemap), with title, description, canonical, `og:*`, breadcrumb JSON-LD and a `noindex` not-found state (`.context/newsletter-podcast.md`, "Web edition").

### Configuration

| Config Key | Env Var | Default | Description |
|-----------|---------|---------|-------------|
| `config.sitemap.cacheMaxAge` | `SITEMAP_CACHE_MAX_AGE` | `3600` | Cache TTL in seconds |
| `config.storyPreview.shellCacheSeconds` | `STORY_PAGE_SHELL_CACHE_SECONDS` | `60` | How long the fetched `index.html` is reused before revalidation |
| `config.storyPreview.imageCacheSeconds` | `STORY_OG_IMAGE_CACHE_SECONDS` | `86400` | `Cache-Control` max-age of a story's `og.png` |
| `config.storyPreview.apiUrl` | `API_URL` | `https://api.actuallyrelevant.news` | Origin in the absolute og:image URL |
| `config.storyPreview.shellUrl` | `SITE_URL` | `https://actuallyrelevant.news/index.html` | Where the shell is fetched from |

### Legacy Build-Time Generation

The build-time sitemap generator (`client/scripts/generate-sitemap.ts`) is kept for local development/testing but is no longer part of the client build command.

## Adding a New Route

When adding a page, add sitemap metadata in **two places**:

1. `client/src/routes.ts` — for prerendering
2. `server/src/routes/public/sitemap.ts` `STATIC_ROUTES` array — for the dynamic sitemap

### Priority Guidelines

| Priority | Use For |
|----------|---------|
| 1.0 | Homepage only |
| 0.8 | Issue pages |
| 0.7 | Important static pages (methodology, about) |
| 0.6 | Individual published stories |
| 0.5 | Utility pages (imprint, privacy) |
| 0.3 | Low-priority pages (search) |
| 0.2 | Non-indexable pages (subscribed confirmation) |

### Change Frequency Options

- `daily` — Homepage, search (new stories published regularly)
- `weekly` — Issue/category pages
- `monthly` — Static pages (methodology, about), individual stories
- `yearly` — Pages that rarely change (imprint, privacy, subscribed)

## Head Tags: One of Each per Page

`client/index.html` carries pre-JS fallbacks for description, `og:*`, `article:author` and `twitter:*`, each marked `data-rh="true"`. That marker makes react-helmet-async treat them as its own: on its first commit it removes them and writes the merged Helmet state. `DefaultSeo` (`client/src/lib/seo.tsx`), rendered once by the root route of `App.tsx`'s `appRoutes`, above every page, supplies the same defaults as Helmet tags; a page's own tag with the same `name`/`property` wins (innermost Helmet instance). Result: prerendered and client-navigated pages get exactly one of each — the page's own, or the default.

- Adding a head tag to `index.html` that a page might also set: mark it `data-rh="true"` and add it to `DefaultSeo`, or prerendered pages get it twice. `client/src/lib/seo.test.tsx` loads the real `index.html` and fails on any duplicate.
- Unmarked template tags (`charset`, `viewport`, `theme-color`, `author`) are never touched by Helmet; don't set those from pages.
- The `<title>` is not duplicated: Helmet updates the existing element.

## Story link previews

Story pages are not prerendered, so before 2026-10-19 a crawler that does not run JavaScript (LinkedIn, X, Slack, WhatsApp, Facebook, Mastodon) saw only `index.html`'s homepage fallbacks, and every shared story link previewed as the homepage. Two parts fix that ([ADR-0040](decisions/0040-story-pages-through-backend.md)):

**1. A per-story image, `GET /api/stories/:slug/og.png`** (`server/src/routes/public/storyPreview.ts`, `services/storyPreview.ts`). 1200x630 PNG drawn by the newsletter carousel's renderer (`createStoryImage(story, OG_IMAGE_SIZE)` in `services/carousel.ts`, which takes a size since this change; the carousel keeps 1200x675): category header, AI headline, publisher and source date, AI summary cut to fit, and the pixel footer "actuallyrelevant.news · AI-generated", with the same unsigned XMP `DigitalSourceType` chunk as the slides (`.context/ai-transparency.md`). Published stories only (404 otherwise). Cached in memory (`BoundedCache`, `lib/boundedCache.ts`: at most 50 images for 6 hours, so a crawler walking every story cannot fill the memory-capped instance) and over HTTP (`Cache-Control: public, max-age=86400`, `STORY_OG_IMAGE_CACHE_SECONDS`). `Cross-Origin-Resource-Policy: cross-origin` overrides helmet's same-origin default. Behind the shared rate limiter. The absolute URL comes from `storyOgImageUrl()` (`server/src/lib/storyPreviewUrls.ts`, on `API_URL`) and, in the client, `storyOgImageUrl()` in `client/src/lib/api.ts` (on `API_BASE`): `StoryPage`'s Helmet sets it as `og:image` and `twitter:image` through `CommonOgTags({ image })`. A changed story keeps its old image for up to a day in caches; that is accepted.

**2. Story pages proxied through the backend.** A rewrite on the static site, `/stories/*` → `https://api.actuallyrelevant.news/api/story-page/*` (in `render.yaml`, above the catch-all), sends every story page view to `storyPageRouter`, which returns the built client's `index.html` with the story's tags in the head: `<title>`, `description`, `rel=canonical`, `og:type` article, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` (with type, width, height), `article:author`, `article:published_time`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`. Values come from the story exactly as `StoryPage`'s Helmet computes them (title label plus headline, summary) and are HTML-escaped. Every injected tag carries `data-rh="true"`, and the shell's own title and `data-rh` tags (the prerendered homepage's description, og/twitter tags, canonical and JSON-LD) are removed first, so Helmet takes the injected ones over on its first commit and each tag appears once. The body is left as it is.

- **Render's rewrite proxies; it does not redirect.** Render's docs (Static Site Redirects and Rewrites, checked by web search on 2026-10-19; the page itself was not reachable from the build container): a rewrite serves the destination's content at the original path and the browser does not see the change; the destination may be a full public URL; a `*` in the source is inserted where the destination has `*` (their example: `/*` → `/blog/*`); a file that exists at the path is served without applying any rule; rules apply top to bottom. The `/sitemap.xml` and `/podcast.xml` rewrites have proxied to the API since before this change. The wildcard form in a rewrite to an external host has not been seen working live yet: check it after the first deploy (below).
- **Where the shell comes from: fetched from the static site, cached briefly.** The server fetches `${SITE_URL}/index.html` (`config.storyPreview.shellUrl`; that path is a real file, so no rewrite applies and nothing loops) with `withRetry` and a 5-second timeout, reuses it for 60 seconds (`STORY_PAGE_SHELL_CACHE_SECONDS`), then revalidates with `If-None-Match`/`If-Modified-Since`. A response without `</head>` and `<div id="root"` is refused. Bundling it into the server build was rejected: the two services build separately and in no fixed order from the same push (`.context/deployment.md`), so a bundled copy would name another build's hashed assets. Fetching keeps the shell the live build's; the cost is that for up to 60 seconds after a client deploy, story pages may reference the previous build's assets.
- **Failure rule: story pages never break because of this route.** A story that is missing or unpublished, a database error, or a tag-building error returns the shell unchanged with 200, and the SPA shows its own page (not-found included). Any path under the mount gets the shell (no JSON 404). A failed revalidation keeps serving the last good shell. Only when no shell has ever been fetched since boot (the static site unreachable) does the route answer 503 with `Retry-After: 10`.
- **Headers.** The route removes helmet's `Content-Security-Policy` (its `script-src 'self'`/`connect-src 'self'` would block the analytics script and the client's calls to the API on `actuallyrelevant.news`) and `Cross-Origin-Resource-Policy`; `Cache-Control: public, max-age=60`. Rendered pages are cached in memory per slug and shell version (200 entries, 60 s).
- **Cost.** Every story page view now waits on the API instance (memory-capped, also running cron, LLM and ffmpeg work) and one extra hop. The route is mounted before the shared rate limiter, like the podcast feed: behind the rewrite every visitor may arrive from the static site's proxy address. Its work is a cache hit or one indexed query.
- **After the first deploy, check:** `curl -sI https://actuallyrelevant.news/stories/<slug>` returns 200 HTML without a CSP header; `curl -s https://actuallyrelevant.news/stories/<slug> | grep og:image` shows the story's image URL; the page loads and navigates in a browser; a missing slug shows the SPA's "Story Not Found"; LinkedIn's Post Inspector or a Slack paste shows the story card. If the rewrite redirects instead of proxying, or the wildcard is not substituted, remove the rule (story pages fall back to the catch-all, as before) and switch to a share URL on the API host (the option set aside in ADR-0040).

## og:image and Bluesky

Bluesky does **not** auto-fetch og: metadata. Link card thumbnails are fetched and uploaded at post time. `publishPost()` (`server/src/services/bluesky.ts`) uses the story's own preview image, `storyOgImageUrl(slug)`, and the global `/images/og-image.png` only for a story without a slug. See `.context/bluesky.md`.

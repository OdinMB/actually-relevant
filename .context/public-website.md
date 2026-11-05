# Public Website

The public site uses `PublicLayout` with hardcoded navigation in `client/src/layouts/public/` (link lists in `navLinks.ts`): the issue bar (`ISSUE_LINKS`), the header's Newsletter, Podcast and Saved links, in that order (desktop right of the logo, and the same three in the mobile menu dialog), and the footer's Navigate (`FOOTER_NAV`), Connect (channels: Newsletter, Podcast, RSS and the rest, written out inline) and Issues columns. A new channel goes in both the header (desktop and mobile) and Connect; each link appears once in the footer.

Saved appears only once the visitor has saved a story, and goes when the last is removed, at once and without a reload: `useSavedCount` (`client/src/hooks/`) subscribes to the saved-stories store in `lib/preferences.ts`, whose `toggleSaved` announces every change itself (other tabs through the `storage` event), so a new place that saves or removes a story needs no event of its own. Prerendered pages carry no Saved link, since the prerender's browser has nothing saved; the client adds it on its first render. Because the desktop group is anchored right, Newsletter and Podcast then sit one link further left for a visitor with saved stories. The Layout Instability API records no shift for it (0 on a prerendered page with three saved stories and the JS delayed 1.5 s, 2026-10-07), because the client replaces the prerendered nodes rather than moving them. This document covers routes, components, data flow, and static content structure.

## Routes

| Path | Component | Description |
|---|---|---|
| `/` | `HomePage` | Hero, the newest newsletter issue's card (see "Cross-links"), then the latest stories per issue |
| `/stories/:id` | `StoryPage` | Story detail with AI analysis |
| `/issues/:slug` | `IssuePage` | Issue description + paginated stories + evaluation criteria |
| `/methodology` | `MethodologyPage` | Three-criteria framework explanation |
| `/about` | `AboutPage` | Mission and approach |
| `/contact` | `ContactPage` | Email + bilingual imprint (EN/DE) |
| `/newsletter` | `NewsletterPage` | Laid out like `/podcast`: heading, AI subtitle with the inline badge (`AiSubtitle`, `AI_DISCLOSURE_COPY.newsletterSubtitle`), a Subscribe section (`SubscribeForm`), then Past issues: every published issue, newest first, paginated, loaded client-side (`NewsletterArchiveSkeleton` while loading), then the podcast offer (see "Cross-links"). The header's and the footer's Newsletter links both lead here |
| `/newsletter/archive` | redirect | `<Navigate replace>` to `/newsletter`, where the archive now lives; kept so old links work. In neither route list nor the sitemap. Its route must stay above `/newsletter/:slug`, and `archive` stays a reserved issue slug |
| `/newsletter/:slug` | `NewsletterIssuePage` | One published issue's web edition, dressed like the email (a card with its masthead, ruled category headings; `.context/newsletter-podcast.md`, "Web edition", Look): title and date, the issue's AI label, then its stored markdown with each story heading through `StoryTitleLabel` and linked to the story page, then "All issues", "Get the newsletter by email" and the podcast offer; not-found state is `noindex` (`.context/newsletter-podcast.md`, "Web edition") |
| `/podcast` | `PodcastPage` | Weekly AI podcast: AI subtitle, a Subscribe row (Apple Podcasts badge, the other listen links, Copy RSS feed, the feed address as text) and episodes with `<audio preload="none">` on the CDN (`.context/podcast.md`), then the newsletter offer. `/podcast#podcast-subscribe-heading` (`PODCAST_SUBSCRIBE_PATH`) lands on the Subscribe section |
| `/podcast/:id/transcript` | `PodcastTranscriptPage` | One published episode's readable transcript: "AI" badge and title, the `/podcast` AI subtitle, player, the conversation by "Host A"/"Host B" with a heading per story, the story list, then "All episodes", "Subscribe to the podcast" (to `PODCAST_SUBSCRIBE_PATH`) and the newsletter offer. `:id` is the episode's row id (the feed GUID), which never changes once published (`.context/podcast.md`) |

Static routes are registered in both `App.tsx` (`appRoutes`, the route tree `main.tsx` hands to react-router's data router, `createBrowserRouter`) and `shared/routes.json` (read by `client/src/routes.ts`; the server sitemap reads the same file, `.context/seo.md`), and prerendered at build time. Dynamic routes (`/stories/:slug`, `/podcast/:id/transcript`, `/newsletter/:slug`) are only in `App.tsx`: they load client-side, are not prerendered, and the server sitemap lists them (`.context/seo.md`). Story pages, newsletter issue pages, podcast transcripts and topic pages other than the four prerendered ones reach the browser through the backend, which puts each page's preview tags into the shell (`.context/seo.md`, "Story link previews").

### Cross-links

The newsletter and the podcast are the two weekly products, and each one's pages end with a one-line offer of the other (`client/src/components/CrossLinks.tsx`), after the main content, never above it. `PodcastCrossLink` on `/newsletter` and every issue page: "Prefer to listen? Try the weekly podcast, …", linking `/podcast`. `NewsletterCrossLink` on `/podcast` and every transcript page: "Prefer to read? Get the weekly newsletter by email, or read past issues on the web.", where the first is a button that opens the site's subscribe dialog (`useSubscribe()`, the `SubscribeProvider` in `PublicLayout`) and the second links `/newsletter`. Neither line uses AI wording; the pages they lead to carry the labels. On `/podcast` the offer sits after the episode list, apart from the Subscribe section.

**The end of a story page** has three groups, in this order (owner's pick of three mockups, 2026-11-05; before that one undivided column of links, with "Back to all stories" and the weekly offer above Related Stories). First, about the article: "Spotted a mistake? Report an error", small and right-aligned right under the analysis, then the issue and episode cards when there are any. Second, keep reading: Related Stories, then two centered links, "More in {issue} →" (`/issues/<slug>`) and "Find similar stories →" (a search for the headline), shown even when there are no related stories. There is no "Back to all stories": the logo does that. Last, where the reader finishes: `StoryProductButtons`, a band in the brand tint with a brand-700 top rule, its own `h2` "Get stories like this every week", and two outlined buttons side by side, centered, each with its product's icon, "Newsletter" and "Podcast" (owner's request, 2026-11-05; before that a sentence, "Get stories like this once a week. Subscribe to the newsletter, or read this week’s issue"). "Newsletter" opens the subscribe dialog, which returns focus to it on close; "Podcast" links the podcast page's Subscribe section (`PODCAST_SUBSCRIBE_PATH`). The trade-off the owner accepted: a reader who leaves during Related Stories never sees the band. All of it shows only once the story has loaded: the loading skeleton and the not-found state have none. Each is a 44px-tall box on every screen (`min-h-11`, WCAG 2.5.8 with room for a thumb); on the narrowest phones they wrap onto two lines, still centered. The dialog opens only when the button is pressed (no pop-up, no sticky bar). Story pages are not prerendered, so no static HTML carries or lacks the buttons.

**The issue and episode a story was in.** Right after "Report an error", the story page shows a card for the newsletter issue and one for the podcast episode the story appeared in (`StoryAppearances`, `client/src/components/StoryAppearances.tsx`). Each card is one link whose name is its visible text, dressed like the home page's card. The issue card has "Featured in the newsletter" above the issue's title and story count, linking `/newsletter/<slug>`. The episode card has "Featured on the podcast" above the episode's title behind the "AI" badge (announced "AI-generated", as on `/podcast`) and its length, linking its transcript page. The cards sit side by side from `sm` up when there are both, full width when there is one. Their data is `GET /api/stories/:slug/appearances` (`useStoryAppearances`, asked for by the address's slug alongside the story): the first public issue that carried the story (on its shortlist or named by a `{story:<id>}` heading marker, the stories its web edition shows) and the first published episode with the story in its `storyIds`, each earliest first. A story in neither, a request still on its way and a failed one show nothing, and the buttons below stay as they are. The cards can arrive after the story and push Related Stories and the band down; all of it sits at the end of the article, far below the first screen. There is no way yet to play only the story's part of the episode: per-story timing exists only in the chapters file on the CDN (`.context/podcast.md`, "Audio").

**The newest issue** reaches readers on the home page, from `useLatestNewsletterIssue()` (`client/src/hooks/useNewsletterArchive.ts`): the first entry of the archive's first page (`GET /api/newsletters`), the same request and cache entry as the Past issues list on `/newsletter`, asked for when the page mounts, alongside the page's own data. An issue under seven days old is "this week's"; an older one is "the latest" (the card says "Latest newsletter"). With no issue published, or the archive failing, it shows nothing (no message, no empty box). While prerendering (`isPrerendering()`) the hook asks for nothing and returns none, so no static HTML keeps a dated issue. Story pages no longer link the newest issue (they did until 2026-11-05, in the sentence the buttons replaced); a story's own issue still has its card.

- **Home page card** (`LatestIssueCard`): between the hero and the first issue section, one link whose name is its visible text: "This week’s newsletter", the issue's title and its story count, with the newsletter icon and an arrow. Label above title; the title truncates only once its line is full, and the story count stays. Full width on phones, the link alone. From `md` up the card starts 160px in, clear of the first section's illustration (which reaches up into the slot), runs to the column's right edge, and carries a "Get it by email" button beside the link that opens the signup dialog. It loads on its own and may arrive after the stories, so it has a place kept for it: `LatestIssueSlot` (`HomePage.tsx`) takes the place of the first section's top margin (`min-h-20`, `md:min-h-28`, the first `IssueSection` gets `flushTop`), and the card, at most two lines whatever the title, fits it. The card never pushes the sections down; without it the page shows the same space (on desktop exactly the old margin, on phones 24px more). The slot is rendered with the sections, only once the stories have loaded and there are some (never beside "The stories couldn't load", "No stories published yet" or the empty-mix note), and the prerendered home page shows the skeleton, so no static HTML carries it.
`PublicLayout` scrolls to the top on every page change and does not follow a `#hash`. A page that should honor one calls `useScrollToHash()` (`client/src/hooks/`), a passive effect that runs after the layout's reset; only `PodcastPage` does, for `PODCAST_SUBSCRIBE_PATH` (`client/src/lib/podcast.ts`), which names the Subscribe heading's id. Renaming that id means changing the constant; `PodcastPage.test.tsx` fails until they agree. Keyboard focus follows the hash separately: `RouteAnnouncer` moves focus to an in-app link's `#hash` target (waiting for one that renders late, and only while focus is still on the page body), while `useScrollToHash` keeps the scroll on a first load.

## Public API

- `GET /api/stories` — Paginated published stories, newest first, filterable by `issueSlug`, `emotionTags` and the incremental-sync filters below, or searched with `search` (hybrid search). Cached 60 seconds (`Cache-Control: public, max-age=60`, no server-side cache)
- `GET /api/stories/:id` — Single published story
- `GET /api/stories/:slug/appearances` — The newsletter issue and podcast episode a published story appeared in, `{ newsletterIssue, podcastEpisode }`. Each is in its own list's shape (a `GET /api/newsletters` item; a `GET /api/podcast` episode with `aiLine` and `aiGenerated`) or null, and both are null for an unknown or unpublished slug. `Cache-Control: public, max-age=300`. A site route like `/related` and `/cluster`, not in the OpenAPI spec (`server/src/services/storyAppearances.ts`).
- `GET /api/homepage` — The public issues plus, for each of the four top-level issues, its 7 newest published stories in each of three emotion buckets (uplifting, calm, negative), which the positivity slider mixes on the client. `Cache-Control: public, max-age=60`.

**The homepage data is always warm** (`server/src/services/homepage.ts`, `RefreshingValue` in `server/src/lib/refreshingValue.ts`). Every API process builds it at startup and rebuilds it every `config.homepage.refreshMs` (60 s) in the background, and a request gets the copy it holds at once, so no visitor waits for the database. Guarantees: the copy a visitor gets is at most about one interval old (a read that finds it older also starts a refresh); a failed rebuild keeps the last good copy and logs a warning, so a database outage shows the last homepage rather than an error; only a request with no copy at all (the first after start, before the startup load lands, or the first after the admin "Clear site cache") waits for the load, and if that load fails it answers 500. A story published or unpublished therefore reaches the homepage within about a minute; use "Clear site cache" for at once. Why: built on demand behind a 60-second cache, the data was cold for most visitors at the site's traffic, and a cold build took 5 to 8 s in production (measured 2026-11-01), so most first visits showed placeholders for seconds. The stories are found newest first through the `(status, date_published, date_crawled)` index on `stories`; without it the newest-first scan walked every unpublished story first, whose empty publish dates lead a descending scan.

**Incremental sync** (`publicStoryQuerySchema` in `server/src/schemas/story.ts`, applied in `getPublishedStories()`). These names are part of the public API contract: never rename them.

- `publishedSince` — ISO 8601 date-time with a zone (`Z` or an offset; a bare date is a 400), inclusive lower bound on `datePublished`
- `publishedBefore` — same format, exclusive upper bound; must be later than `publishedSince` (else 400)
- `minRelevance` — whole number 1-10, `relevance >= minRelevance`
- All three are rejected with a 400 when combined with `search`: hybrid search does not apply them, and a silent no-op would mislead a poller. `total`/`totalPages` describe the filtered set.
- Documented in the OpenAPI spec from the same Zod schemas (`requestParams.query` in `server/src/lib/openapi.ts`), with examples on `/free-api` and `/developers`.
- `GET /api/issues` — All issues (id, name, slug, description only)
- `GET /api/issues/:slug` — Single issue by slug

- `GET /api/podcast` — The podcast show and its published episodes (each with its AI line and an `aiGenerated` marker)
- `GET /api/podcast/episodes/:id` — One published episode with its readable `transcript` (404 unless published; its `aiGenerated` marker names `transcript` too)
- `GET /api/newsletters` — Published newsletter issues, newest first (paginated)
- `GET /api/newsletters/:slug` — One published issue's web edition, with its `aiLabel` and an `aiGenerated` marker (404 unless published)
- `GET /api/stories/:slug/og.png` — A published story's 1200x630 link-preview image (`.context/seo.md`)

Every story object the public JSON routes return (`/api/stories`, `/api/stories/:slug`, `/api/stories/:slug/related`, `/api/homepage`) carries a machine-readable `aiGenerated` marker, added in the route (for `/api/homepage`, where its data is built, `server/src/services/homepage.ts`) with `withAiGeneratedMarker()` (`server/src/lib/aiProvenance.ts`). A new public route that returns stories must add it too; the compliance record (`.context/ai-transparency.md`) relies on it.

The documented contract is checked in CI against a committed snapshot, against `PUBLIC_STORY_SELECT` and against real responses (`.context/ci.md`, "Public API contract"): a change to a public field or parameter needs `npm run api:snapshot --prefix server`.

API client: `client/src/lib/api.ts` (exports `publicApi` and `API_BASE`)
Hooks: `usePublicStories.ts` (story, related, cluster, appearances), `usePublicIssues.ts`

### RSS Feeds

Public RSS 2.0 feeds are available without authentication:

- `GET /api/feed` — Global feed of the 50 most recent published stories
- `GET /api/feed/:issueSlug` — Per-issue feed (e.g., `/api/feed/human-development`; the issue is a path segment, an `?issueSlug=` query on `/api/feed` is ignored)
- Both take `?minRelevance=1..10` (`feedQuerySchema`; anything else is a JSON 400). A filtered feed's channel title ends in "(relevance N+)" and its self link carries the query. The feeds take no date filter: a reader polls one fixed URL and dedupes by item GUID, so a fixed `publishedSince` would only freeze the feed.

**Caching.** Feeds are cached in memory (`feedCache`, TTL `config.feed.cacheMaxAge`) under a key that includes the variant (`feed:global`, `feed:global:minRelevance=7`, `feed:issue:<slug>:minRelevance=7`), so filtered and unfiltered feeds never share an entry; `minRelevance` has ten values, which keeps the key space bounded. A new feed parameter must join the key, and must stay bounded (an unbounded value such as a timestamp would let any caller grow the cache). Browser and Cloudflare caches key on the full URL, query string included, so the `Cache-Control` header is safe for every variant.

Feed items include: title, link to story page, AI-generated summary prefixed "[AI-generated] ", publish date, and issue category. The channel description is fixed copy that says AI writes and curates the feed (`rssChannelDescription()` in `server/src/lib/aiLabelCopy.ts`; per-issue feeds no longer use the issue's own description). RSS readers never see the site's labels, so keep the item prefix when changing the feed. Responses use `Content-Type: application/rss+xml` with a 15-minute cache (`Cache-Control: public, max-age=900`).

The newsletter has a feed of its published issues, `GET /api/newsletters/feed.xml`, each item linking the issue's web edition with the issue's AI label as description; it shares `buildFeed`/`setRssHeaders` (`server/src/lib/rssFeed.ts`) with the story feeds and is described in `.context/newsletter-podcast.md`, "Web edition". Its autodiscovery link is on `/newsletter` and every issue page, with a visible link under the signup form on `/newsletter`.

The podcast has its own hand-built feed (`GET /api/podcast/feed.xml`, public at `/podcast.xml` through a Render rewrite, mounted before the shared rate limiter); it is described in `.context/podcast.md`, "Publishing, feed and page".

**Discoverability:**
- Global RSS autodiscovery `<link>` tag is added via Helmet in `PublicLayout.tsx`
- Per-issue autodiscovery `<link>` tag is added via Helmet in `IssuePage.tsx`
- Visible RSS icon/link appears on each issue page header and in the footer Subscribe section
- All RSS hrefs use `API_BASE` (from `client/src/lib/api.ts`) so they resolve correctly in both dev (Vite proxy) and production (separate static site + API service on Render)

**Key files:**
- `server/src/routes/public/feed.ts` — RSS feed route handler (uses `feed` npm package; channel setup and headers in `server/src/lib/rssFeed.ts`, shared with the newsletter feed)
- `server/src/routes/public/index.ts` — Registers feed router at `/feed`
- `client/vite.config.ts` — Dev proxy for `/api` to `localhost:3001`

## Positivity Slider

A 5-position slider (0%, 25%, 50%, 75%, 100%) that controls the emotional tone of displayed stories. Default is 50% (balanced). Persisted in localStorage under `ar-positivity`. Filtering is done entirely client-side for instant response — no additional API requests on slider change.

- **URL parameter `mix`:** Any public page accepts `?mix=heavy|mostly-heavy|balanced|mostly-uplifting|uplifting` (or a number 0–100, snapped to the nearest position), e.g. `https://actuallyrelevant.news/?mix=uplifting`. A recognized value wins over the stored preference and is saved as the new preference; an unrecognized one is ignored. Moving the slider writes the named value into the current page's URL (history replace, no new entry), keeping other parameters, so the address bar is always a shareable link to the current mix. Plain internal links do not carry the parameter; the mix still follows through localStorage.
- **Desktop:** Positioned in the logo bar, left side
- **Mobile:** First item in the hamburger menu (centered), above issue categories
- **Scope:** Affects homepage and issue pages only. Search is not affected.
- **Architecture:** Server returns both positive and negative story buckets. Client mixes them based on slider position using helpers in `lib/mix-stories.ts`. No positivity param is sent to the server.
- **Homepage:** Server returns `storiesPerIssue` stories from each emotion bucket per issue. Client uses `mixHomepageSections()` (each issue's `mixHomepageStories()`, less the hero). An issue the mix leaves without a story (in practice at "Only uplifting") gets no section; the layout rotation, the first section's flush top, the pull-quote dividers and the support and newsletter banners count only the sections shown. When the mix shows no story though stories are published, the page says "This mix of news has no stories right now." (`role="status"`) with one link, "Show the balanced mix", to `?mix=balanced` (other parameters kept, history replaced), and no hero, newsletter card or banners.
- **Issue pages:** Server returns all stories (no emotion filtering). Client uses `filterStoriesByPositivity()` to filter and paginates locally.
- **Emojis:** Frustrated/scared (left) to calm/uplifting (right), with text labels ("All FRUSTRATING & SCARY", "Balanced", "All CALM & UPLIFTING")
- **Info tooltip:** Click info icon next to slider for explanation

**Key files:**
- `client/src/components/PositivitySlider.tsx` — Slider UI with emoji labels and info tooltip
- `client/src/contexts/PositivityContext.tsx` — React Context, `?mix=` URL parameter + localStorage persistence
- `client/src/lib/mix-stories.ts` — `mixHomepageStories()`, `mixHomepageSections()` and `filterStoriesByPositivity()` helpers
- `server/src/services/publicStories.ts` — `getHomepageData()` returns `{ positive, negative }` per issue

## Shared Components

- `BrandLogo` — the header's logo, claim and AI line (`client/src/components/BrandLogo.tsx`, used in the header and the mobile menu dialog). Phones: claim, then `HeaderAiLine` under it. From `md` up: one line, "claim · AI line [AI]", with the logo absolutely positioned and centered above it, so the home link (logo, claim) and the AI link stay separate links. The line clears the flanking controls only because they end within the logo's height (`.context/ai-transparency.md` §7). The two halves share one baseline only because both use 16px line boxes (`leading-4`) and the badge and chevron are lifted 1px onto the caps' center; change the claim's or the AI line's type size, line height or padding together, and check alignment by measuring the text (range rects, not element boxes) and looking at a zoomed screenshot
- `HeaderAiLine` — site-wide AI notice, a sibling link to `/methodology` (never inside the home link)
- `StoryTitleLabel` — "AI" badge plus title label above every card and hero headline; new story listings should render headlines through `StoryCard` or this component so they carry the badge (`.context/ai-transparency.md`)
- `StoryCard` — Story card with title, rating, summary (used on homepage + issue pages)
- `RatingDisplay` — Relevance rating with color coding
- `Pagination` — Page navigation with ellipsis
- `LoadFailure` — what a page shows when its data fails to load for any reason but a 404: "This story couldn't load" (or the stories, issue, transcript, issues, search results, saved stories, past issues, episodes), a line on why (on `/search`, after the search rate limit's 429, to try again in a few minutes), and "Try again", which refetches in place. A 404 still shows the page's not-found view, and "No stories published yet" appears only when the API answered with no stories. Used on the homepage, story, issue, newsletter issue and transcript pages, and on the lists of `/issues`, `/search`, `/saved`, `/newsletter` and `/podcast`; rules in `.context/ui-conventions.md`, "Load failures"

## Feedback

Two ways in, one form (`FeedbackForm`), one endpoint (`POST /api/feedback`, `server/src/routes/public/feedback.ts`: honeypot, per-IP rate limit, the signup's bot gate, the visitor IP stored only as an HMAC, ADR-0037):

- **`/feedback`** (prerendered page): the general form, categories Feedback, Bug, Suggestion, Other.
- **"Report an error" on every story page** (`StoryPage`, below the analysis: "Spotted a mistake? Report an error"): a button that opens `FeedbackModal` through `FeedbackProvider` (mounted once in `PublicLayout`; `useFeedback().openFeedback(story)`), bound to the story: heading "Report an error", the story's title as the page shows it, no category choice (always `correction`), a visible "What is wrong?" label, button "Send report". The dialog is `ModalDialog`, the shell the signup dialog shares (Key Files): it moves focus to the message on open, closes on Escape, backdrop click or its Close button, returns focus to the button, and stays named "Report an error" (or "Send feedback") after the thank-you replaces the form.

**Bot gate**, the newsletter signup's (`.context/subscription.md`, steps 2 to 4, and "Client Behavior"), in this order before anything is stored:

1. **Honeypot** filled → `{ success: true }`, nothing stored.
2. **Form token** from `GET /api/feedback/token` (`issueFormToken('feedback')`, `Cache-Control: no-store`, behind the shared public limiter only). Missing, forged, younger than 1.5 s, older than 30 min, or a signup token → `{ success: true }`, nothing stored (silent, as for the signup). The form holds it through `useFormToken` (`client/src/hooks/useFormToken.ts`), as the signup form does (`.context/subscription.md`, "Client Behavior"): fetched on mount with one retry, submit disabled until it arrives; replaced when the reader comes back to the page once 20 minutes old, and before posting when older than 25 minutes, a replacement posted only once 1.5 s old (the button reads "Sending..." meanwhile), so a long message is not silently dropped. If both first attempts fail, a status line under the form says "Feedback can't be sent right now. Please reload the page or try again later." ("Reports …" on a story), never while prerendering; a replacement that fails at submit shows "Something went wrong. Please try again." and posts nothing. `FeedbackModal` mounts the form only while it is open, as `SubscribeModal` does, so a page view with the dialog closed fetches no token; each open mounts a fresh form that fetches one.
3. **Turnstile** (`verifyTurnstile(..., { skipWithoutSecret: true })`): rejected or missing token → `{ success: false, message: "We couldn't verify that you're human. Please try again." }`; siteverify unreachable → `{ success: false, message: "Feedback is unavailable right now. Please try again later." }`. The form shows the message inline with `role="alert"` and keeps what the visitor wrote. **Unlike the signup, feedback skips the check while `TURNSTILE_SECRET_KEY` is empty, in production too**, so the forms keep working until the owner creates the widget; once the secret is set it fails closed like the signup. Set the secret and `VITE_TURNSTILE_SITE_KEY` together: a secret without a site key refuses every submission as failed.

On the client, as on the signup: with a site key set, Cloudflare's script loads only on submit (never on render or typing), the invisible widget runs, the button reads "Verifying..." then "Sending...", and a failed challenge shows "The human check couldn't load. Please press Send feedback (or Send report) to try again." with `role="alert"`, linked to the button by `aria-describedby`, the form still usable.

The server takes an optional `storyId` and answers 400 "That story does not exist." for an unknown one; `correction` is also accepted without a story. `feedback.story_id` is a foreign key `ON DELETE SET NULL` (migration `20261025225344_feedback_story_correction`), so a report outlives a story that retention deletes, without its link. Admin view: `.context/admin-dashboard.md`. Feedback is kept indefinitely for now (retention is a BACKLOG item).

## Static Content

Issue-specific evaluation criteria, sources, and "make a difference" links are in `client/src/data/issues-content.ts`. This data is static and doesn't come from the API. To update, edit the file directly.

Current issue slugs: `existential-threats`, `planet-climate`, `human-development`, `science-technology`

## Design

- **Colors:** Pink/magenta brand palette (`#ec268f` primary, `#661845` deep)
- **Layout:** Sticky header, dark footer, max-w-5xl content area
- **Mobile:** Hamburger menu at `lg` breakpoint

### Fonts

Self-hosted from `/fonts/`. Only these fonts are loaded (adding more increases page load):

| Font | Weight | Tailwind Class | Use For |
|------|--------|----------------|---------|
| Nexa Bold | 700 | `font-nexa font-bold` | Headings, logo text |
| Roboto Regular | 400 | (default body) | Body text |
| Roboto Bold | 700 | `font-bold` | Bold body text |

**Do NOT use:** `font-light`, `font-thin`, `font-black`, `font-medium`, or `font-nexa` without `font-bold` — these weights are not loaded and will trigger browser fallback or extra downloads.

Font definitions: `client/src/index.css` (@font-face)
Preload hints: `client/index.html`

## Key Files

- `client/src/layouts/PublicLayout.tsx` — Providers, skip link, RSS autodiscovery, scroll reset; composes the parts in `client/src/layouts/public/`:
  - `SiteHeader.tsx` — logo bar and its actions, positivity slider placement; owns menu and search state
  - `IssueNav.tsx` (desktop issue bar), `MobileMenu.tsx` (menu dialog), `SearchPanel.tsx` (search bar)
  - `SiteFooter.tsx` — color strip, brand, Navigate, Connect and Issues columns (no sign-off above it since 2026-10-27)
  - `navLinks.ts` (`ISSUE_LINKS`, `FOOTER_NAV`, `FOOTER_LEGAL`), `icons.tsx`
- `client/src/components/ModalDialog.tsx` — the shell of the signup and feedback dialogs (`SubscribeModal`, `FeedbackModal`): a native `<dialog>` that closes on Escape, a backdrop click or its Close button, gives focus back to what opened it, is named by its `title` whatever the form inside shows (its thank-you has another heading), and mounts its content only while open. Its open, Escape and focus handling is `useModalDialog` (`client/src/hooks/`), which `MobileMenu` uses too.
- `client/src/pages/HomePage.tsx` — Homepage with issue sections
- `client/src/pages/StoryPage.tsx` — Story detail
- `client/src/pages/IssuePage.tsx` — Issue page with stories + static content
- `client/src/components/PositivitySlider.tsx` — Positivity slider UI
- `client/src/contexts/PositivityContext.tsx` — Positivity state + localStorage
- `client/src/data/issues-content.ts` — Static evaluation/sources/links per issue
- `client/src/lib/api.ts` — Public API client
- `server/src/routes/public/issues.ts` — Public issues endpoint
- `server/src/routes/public/homepage.ts` — Homepage data with emotion-bucketed stories

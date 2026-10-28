# Newsletter Generation

The weekly two-speaker podcast has its own file: `.context/podcast.md`.

## Overview

Newsletters are generated from published stories through a create-assign-select-generate workflow via admin API endpoints, with template-based formatting. The `generate_newsletter` job builds the weekly issue and the `publish_newsletter` job sends it to every subscriber and publishes it (seeded disabled). A published issue is public on the website, in the archive at `/newsletter` and at `/newsletter/:slug` (see Web edition).

## Workflow

1. **Create** — `POST /api/admin/newsletters` with a title
2. **Assign stories** — `POST /:id/assign` auto-assigns recently published stories (last 7 days)
3. **Select stories** — `POST /:id/select` picks the shortlist with the LLM
4. **Generate content** — `POST /:id/generate` produces the content
5. **Edit** — `PUT /:id` to manually edit generated content
6. **Build and test** — `POST /:id/html`, then `send-test` (see Sending)
7. **Send** — `send-live` emails every subscriber and publishes the issue, once, and only after a test of its current HTML. A sent issue is frozen (see Issue lifecycle)
8. **Publish** without sending — `PUT /:id` with `status: 'published'` makes the issue public on the website (see Web edition)

## Issue lifecycle

**`server/src/services/newsletterLifecycle.ts` owns every move of an issue** (ADR-0048, owner decision 2026-10-25): it is the only code that writes `status`, `publishedAt`, `content`, `html`, `selectedStoryIds`, deletes an issue or writes a `newsletter_sends` row, held by `server/src/test/newsletterWriters.test.ts` (a source scan sharing `test/writeFence.ts` with the story status fence). Outside it: `stats` (`refreshSendStats`), the slug (`ensureNewsletterSlug`), `createNewsletter`, and `deleteStory`'s removal of a deleted story from `storyIds`. `services/newsletter.ts` builds what the moves write (`recentStoryIds`, `pickShortlist`, `buildContent`, `renderHtml`) and writes none of it. The admin routes and both jobs call the moves.

**Frozen** := an unconfirmed live send exists (a live row in `draft`, below), **or** a live non-failed send exists (`isTest = false AND status <> 'failed'`) and the issue is `published`.

| Move | Allowed when (else) | Writes |
|---|---|---|
| assign | not frozen (409) | `storyIds` |
| select | not frozen (409); longlist non-empty (400) | `selectedStoryIds` |
| generate | not frozen (409); shortlist non-empty (400) | `content` |
| html | not frozen (409); content non-empty (400) | `slug` if none, `html` |
| edit (`PUT /:id` fields: title, content, html, storyIds, selectedStoryIds) | not frozen (409); an edit with no fields is never refused | those fields |
| sendTest | HTML non-empty (400); `PLUNK_TEST_SEGMENT_ID` set (409) | test row (`sent`) after Plunk accepted |
| sendLive (job or admin) | HTML non-empty (400); no live non-failed send (409 `already_sent`); a `sent` test row whose `htmlContent` equals the current `html` (409 `no_current_test`) | claim row, then confirm and publish, or `failed` (Sending) |
| markSendFailed | a live send in `draft` (409 `not_unconfirmed`) | `failed` + `errorMessage` |
| publish | any; no-op when published | `status`, `slug` if none, `publishedAt` the first time |
| unpublish | any; no-op when draft | `status = 'draft'`; slug, `publishedAt` and sends kept |
| delete | no live non-failed send (409 `sent_issue`) | the row, cascading test and failed sends |

- **Serialized per issue.** Every write move runs in a transaction that first takes `SELECT id FROM newsletters WHERE id = $1 FOR UPDATE`, re-checks its rule, then writes. The moves that build outside the lock (select with its model call, generate with its story reads) check before building too, so a frozen issue spends nothing, and again at the write, so an issue sent meanwhile keeps its content. `ensureNewsletterSlug` runs before the lock, never inside it: it writes the row through its own connection and would wait on the lock.
- **Refusals** are `NewsletterRefusedError` (a `ConflictError`, 409 `{ error }`) with a `code` (`frozen`, `already_sent`, `no_current_test`, `sent_issue`, `not_unconfirmed`) the job maps to notices.
- **Changing a sent issue** means unpublishing it (owner decision Q1): that takes the web edition down and opens editing again; republishing shows the edited version under the same URL and date. A sent issue can never be emailed again (no override), and cannot be deleted.
- **The admin mirrors the rule** for button states only (`client/src/lib/newsletter-state.ts`, from the send list it loads; the server's 409 is the authority). A frozen issue disables the build, edit, rename, story-list and Save controls with one hint line; Send to Subscribers is disabled once sent, while a send is unconfirmed, or without a test of the current HTML. Every error toast shows the server's reason. Named debt: the rule exists twice; a server-computed lifecycle object in the responses would end that (rejected for now, plan decision 12).

## Newsletter

### Story selection (`POST /:id/select`)

The longlist is every story with status `published` whose `dateCrawled` falls within the last `config.content.storyAssignmentDays` days (default 7). Assigning with no such story fails ("No recent stories to assign"). Paywall-locked stories never reach the longlist: they are rejected at crawl (`story-pipeline.md`, "Paywall-Locked Stories"); there is no separate short-content filter here. Selection needs a non-empty longlist (otherwise 400). One LLM call (`config.newsletter.selectModelTier`, `buildNewsletterSelectPrompt`) receives every longlist story with its top-level issue name (the parent issue, or the feed's issue as a fallback, else "General"). It picks `config.newsletter.storiesPerIssue` stories (env `NEWSLETTER_STORIES_PER_ISSUE`, default 2) for each distinct top-level issue. Returned IDs that are not on the longlist are dropped. The result is stored as `selectedStoryIds` (the shortlist), while `storyIds` keeps the longlist. Content generation and the carousel need a non-empty shortlist (otherwise 400 "No stories selected").

### Content generation (`POST /api/admin/newsletters/:id/generate`)

Generates markdown content from a template alone, with no model call (`buildContent()`). For each selected story, grouped by issue with section headers:

- `# IssueName` section header (when the issue group changes)
- Title as `##` heading, with the story's id as a marker: `## <headline> {story:<id>}` (`storyHeading()` in `services/newsletterContent.ts`, which owns the content's three markers for every reader). The email shows the heading without it; the web edition matches the heading to its story by it
- Metadata line with `{feed:id}` tag, publisher name, and links (feed ID is used for favicon in HTML)
- Body text: alternates between `relevanceSummary` (2/3 of stories) and `quote` + `quoteAttribution` blockquote (1/3)

**No intro** (owner decision, 2026-10-26: the model-written intro added no value). The content opens with the first `#` section. Issues generated before then start with a 2-3 sentence intro paragraph and a `---`; that stored text is left as it is and still renders, in the email (`renderHtml()` shows any text before the first heading as an opening paragraph, which also covers an opening a person types in) and on the web edition (which renders the stored markdown). The prompt, its schema, its prompt-input builder, the `contentModelTier` setting and the eval's intro call site were removed with it.

#### Issue ordering

Selected stories are sorted by a fixed issue order, then alphabetically by title (`title`, falling back to `sourceTitle`) within each issue (`ISSUE_ORDER` in `services/newsletter.ts`). The order is Human Development, Planet & Climate, Existential Threats, Science & Technology. Issues not on the list sort last. This order decides where the `# Issue` section headers go. Body text alternates by position: every third story (`i % 3 === 2`) uses its pull-quote when `quote` and `quoteAttribution` are both present. The others use `relevanceSummary`.

### HTML email template (`POST /api/admin/newsletters/:id/html`)

Converts the markdown content into a responsive HTML email (`renderHtml()` in `newsletter.ts`, pure) and saves it to the newsletter record (the lifecycle's html move). Rendering needs `content` (otherwise 400 "No content to convert"). An issue counts as **built** once `html` is non-empty; the weekly job's guards key on this.

Template structure:
- **View in browser** — a small link above the logo to the issue's web edition, `https://actuallyrelevant.news/newsletter/<slug>`. Building the HTML assigns the slug if the issue has none (`ensureNewsletterSlug()`), so the link exists before the issue is published; it opens only once the issue is published (until then the page is "Issue Not Found"). A live send publishes the issue, so the link works from the moment the email goes out
- **Header** — Logo, tagline, four-color category strip (amber/teal/red/indigo), newsletter title (uppercase, bold)
- **AI label** — directly under the week title, before any AI text: "**AI-generated:** AI selected the stories in this issue and wrote the headlines and summaries." (`NEWSLETTER_TOP_LABEL` in `server/src/lib/aiLabelCopy.ts`; owner reworded it 2026-10-26 when the intro was removed, and issues generated before then keep their intro under the same label)
- **Opening text** — any text before the first heading, as paragraphs: the intro of an issue generated before 2026-10-26, or an opening a person wrote. New issues have none
- **Issue sections** — Centered category headers with colored dot and decorative lines
- **Story blocks** — Title (linked), publisher favicon + name + "original article" / "relevance analysis" links, body text or blockquote
- **Support Us** — Ko-fi link with "Free. Independent. Without ads." tagline
- **AI disclaimer** — "Curated and written with care by AI" + bug/mistake notice
- **Footer** — Website link. Our template carries no unsubscribe link (removed in February); Plunk adds its own footer unsubscribe link and, since 2026-08-09, one-click unsubscribe headers

### Carousel images (`POST /api/admin/newsletters/:id/carousel`)

Generates a downloadable ZIP containing:
- One 1200x675 PNG per story (category header, title, publisher, date, summary; footer "actuallyrelevant.news · AI-generated" drawn into the pixels)
- A PDF with all images as landscape pages
- `post-text.txt` — the post text line ("The headlines and summaries in these slides are AI-generated.") and one alt text per slide file, each starting "AI-generated summary: ". The carousel is posted by hand, so this file is how the labels reach the post (`buildCarouselPostText()`)

Uses `@napi-rs/canvas` for image generation, `pdfkit` for PDF, `archiver` for ZIP.

The slides render AI-written text, so both formats are marked as AI-generated in unsigned metadata (`server/src/lib/xmp.ts`): each PNG gets an XMP `iTXt` chunk with the IPTC `DigitalSourceType` `trainedAlgorithmicMedia`, and the PDF gets the same XMP plus Info fields naming the application (never the admin who exported it). The XMP stream needs `pdfVersion: '1.4'` or later; PDFKit omits it for its 1.3 default. Keep the marks when changing the layout; details in `.context/ai-transparency.md`.

Category-specific header colors/images are mapped by keyword matching on the category name (human, planet, science, general, existential).

### Asset files

Located in `server/assets/`:
- `images/` — Header images (1200x80) and logo (112x80). Placeholders used until branded versions are provided.
- `fonts/` — Inter Bold and Inter Regular TTF files for image text rendering.

### Automated generation (`generate_newsletter` cron job)

The `generate_newsletter` job (default: Saturday 4am, `0 4 * * 6`) chains the full pipeline automatically:

1. Pre-checks for recent published stories (crawled in the last `STORY_ASSIGNMENT_DAYS`, 7). If there are none it skips the week and records a `newsletter` / `warning` notice "No newsletter this week" pointing at the Jobs page (key `newsletter-no-stories:<weekKey>`, so a retry that week reopens the one row; `.context/admin-notices.md`): a stalled pipeline would otherwise mean a silent week without a newsletter. Overlap within one process is prevented by the scheduler's `runningJobs`. `week_key` has no unique constraint (deferred), so two server processes could still race and build two issues for one week
2. Weekly guard, keyed by `newsletters.week_key` (ISO week `YYYY-Www`, set only by this job, so hand-made newsletters are never touched). An issue counts as **built** once its HTML exists. Skips if a built automatic issue has this week's key or was created within `config.newsletter.minHoursBetweenIssues` (156 h, 6.5 days), so a Sunday catch-up (previous ISO week, as early as 00:00, 148 h before the next Saturday 04:00 run) doesn't produce a second issue the next Saturday. A previous Saturday run created up to 16:00 (e.g. a 12:00 retry, 160 h earlier) still lets the next Saturday run proceed; one created after 16:00 Saturday blocks it
3. This week's unbuilt automatic draft: skips if it was updated within `abandonedDraftMinutes` (30, another run is building it); otherwise it is a run killed mid-pipeline, so it is deleted (warning logged) and the run proceeds
4. Creates the newsletter with the title `Week N, YYYY` (`getWeekTitle()`, same ISO week as the key) and `weekKey`, then runs the lifecycle's assign, select, generate and html moves. On failure in these steps: deletes the draft (the delete move, which an unsent issue passes) and re-throws to the scheduler
5. Sends the test email **after** that cleanup step: if it fails, the built issue is kept (resend from the admin; later runs that week skip) and the error still fails the job, so the scheduler records a job-failure notice (filed under Newsletter)

**Test sends need `PLUNK_TEST_SEGMENT_ID`.** Without it, `sendTest` refuses before any Plunk call (`TestSegmentNotConfiguredError`; the admin `send-test` route answers 409), and the Saturday job fails and alerts every week. It never falls back to all subscribers (owner decision 2026-10-06).

Handler: `server/src/jobs/generateNewsletter.ts`. Registered in `server/src/jobs/handlers.ts`.

### Automated sending (`publish_newsletter` cron job)

The `publish_newsletter` job (default: Saturday 4:30am, `30 4 * * 6`, 30 minutes after `generate_newsletter`; seeded **disabled** by migration `20261025120000_publish_newsletter_job`) sends the week's issue to everyone:

1. Looks for this ISO week's automatic issue (`weekKey` from `getWeekKey()`, so hand-made newsletters are never sent) that is built (`html` non-empty), still `draft`, and has no live non-failed send. An issue an admin already sent live or published by hand is skipped; a failed live send proves nothing went out, so a later run retries it.
2. None found: sends nothing and says why. An unconfirmed live send records a "Newsletter not sent" warning asking for a check in Plunk. This week's automatic issue already sent live or published records an `info` notice "Newsletter already sent" (key `newsletter-already-sent:<weekKey>`). An issue not built yet (generation still running at 04:30, or stuck), or no automatic issue at all, records a `newsletter` / `warning` notice "Newsletter not sent" (key `newsletter-not-sent:<weekKey>`) naming the reason.
3. Found: calls the lifecycle's `sendLive`, which sends (audience `ALL`) and publishes in one move, then records an `info` notice "Newsletter sent". The move's refusals become notices: `no_current_test` (no `sent` test whose HTML is the current HTML) the same "Newsletter not sent" warning, asking for the test first (owner decision 2026-10-25: an issue goes to subscribers only after its `[TEST]` email went out); `already_sent` (an editor's send won the race) the "Newsletter already sent" info. A failed send fails the run (job-failure notice under Newsletter) and leaves the issue a draft. So every run leaves a notice, whatever the outcome (owner decision 2026-10-25).

Enabling it is refused while `PLUNK_SECRET_KEY` is unset (the scheduler's enable checks). The 30-minute gap is a schedule, not a dependency: moving `generate_newsletter` on the Jobs page means moving this job too.

Handler: `server/src/jobs/publishNewsletter.ts`.

### Sending (Plunk)

Both sends need the stored `html` (400 "No HTML content — generate HTML first"). Each send has a `NewsletterSend` row: `plunkCampaignId`, `isTest`, `status`, a snapshot of `htmlContent`, `sentAt`, `errorMessage`, and `stats` (`{}` until first refreshed).

- **Test** (`sendTest`, allowed in any state): name and subject are `[TEST] <title>`. The audience is the Plunk segment `PLUNK_TEST_SEGMENT_ID` only. The row is written after Plunk accepted the send, so a row means the test went out: `isTest: true`, `status: sent`, `sentAt: now`. Without a segment the send is refused (see the test-segment note above). A test unlocks the live send only while its `htmlContent` equals the issue's `html`; regenerating or editing the HTML needs a new test (re-rendering identical HTML keeps it valid).
- **Live** (`sendLive`, optional `scheduledFor`; the job and `POST /:id/send-live` alike): name and subject are the title, audience `ALL`. Claimed before Plunk is called (owner decision 2026-10-25):
  1. **Claim**, under the issue's row lock: refuse without HTML, with a live non-failed send (`already_sent`) or without a current test (`no_current_test`); else insert the live row with `status: draft` and no campaign id. A second caller (double click, second editor, the job) waits for the lock, then sees the claim and is refused.
  2. Create the campaign and store its id on the row (so stats work even if later steps fail). A failure here sent nothing: the row becomes `failed` with the error.
  3. Send it. A failure that proves nothing went out (no connection, `isConnectionNotEstablished()`, or a 4xx) marks the row `failed`. Any other (timeout, reset, 5xx: Plunk may have accepted it) leaves the row `draft` with `errorMessage` "Plunk may have accepted this send; check the campaign in Plunk, then mark it not sent if it was not". The error is rethrown either way.
  4. **Confirm and publish** in one transaction: the row becomes `sending` (`sentAt: now`) or `scheduled` (`sentAt: null`), and the issue is published with the publish move's fields (its `publishedAt` the send's time). A scheduled send publishes at confirm, not at the scheduled time (the admin never schedules).
- **Unconfirmed** = a live row still in `draft`: the claim went in, the confirmation did not (an ambiguous Plunk failure, or the process died after step 1). It blocks another send and freezes the issue (owner decision Q3: nobody gets two emails, at the cost of a blocked week if nobody looks). The admin shows it as "Unconfirmed" with its message; **Mark as not sent** (`POST /:id/sends/:sendId/mark-failed`, `markSendFailed`) turns it `failed` after an editor checked Plunk, which releases the issue. Resolving it by reading Plunk's campaign status is not built.
- **Retries.** Creating the campaign is retried on any transient error (a lost response leaves at most an orphan draft campaign in Plunk). Sending it (`sendCampaign()` in `services/plunk.ts`) is retried only when no connection was made: after a timeout, a reset or a 5xx Plunk may already have accepted the send, and a retry would email the whole audience twice.
- **Stats** (`refreshSendStats`): fetches Plunk campaign stats for the send's `plunkCampaignId` and stores them in `stats`. A send without a campaign ID gets 400. Open and click tracking is off in Plunk (Settings → Tracking, owner, 2026-10-28), so `opened` and `clicked` stay at zero for later sends; delivered, bounced and complained still count. The privacy page says emails are untracked: switching tracking back on needs that page changed first.

### Web edition (public archive)

**An issue is public on the website exactly while its admin status is `published`** (ADR-0041; there is no separate switch). A live send publishes it (owner decision Q2), and so does `PUT /:id` with `status: 'published'`. The admin's publish control says so ("Publishing makes this issue public on the website…", and for a published issue its public address; `PublishHint` in `client/src/components/admin/NewsletterDetail.tsx`). Unpublishing (`status: 'draft'`) takes it off the archive, the issue page, the API and the sitemap at once (API responses are cached for 5 minutes), and opens a sent issue for editing (Issue lifecycle).

- **Slug.** `newsletters.slug` (unique), from the title by `newsletterSlugBase()` ("Week 42, 2026" → `week-42-2026`; `archive` is reserved for the old archive URL, which redirects to `/newsletter`, and becomes `archive-issue`; a taken slug gets `-2`, `-3`, …). Assigned on the first HTML build or the first publish, whichever comes first, and never changed afterwards, renaming included, so a URL in a sent email keeps working. Issues already published when the column was added were backfilled by the migration with the same rule.
- **Date.** `newsletters.published_at`, set by the first publish and kept on unpublish and republish; the archive orders and dates issues by it. An issue that was already emailed takes the date of its earliest live, not-failed send (`sent_at`, or `created_at` for a scheduled send), so an older issue published on the web later keeps its own week; otherwise the publish time. Migration `20261025140000_newsletter_published_at_from_sends` moved the issues published before this rule back to their send dates.
- **What is shown.** The stored `content` markdown (so a person's edits show), without the template's machine markers (`toWebMarkdown()` in `newsletterContent.ts`: `{story:<id>}` after each `##` heading, `{feed:<id>}`, and the ` {issue-slug}` after each `#` heading). The issue page puts the issue's AI label (`NEWSLETTER_TOP_LABEL`, served as `aiLabel`, the same wording as at the top of the email) under the title before any AI text; each `##` story heading gets the "AI" badge and title label through `StoryTitleLabel` and links to the story page when the story is still published; absolute links to the site stay in the app; other links open in a new tab.
- **Look.** The page is dressed like the email (`renderHtml()`), which stays the reference: a white card, as wide as the email, on a tinted page, edge to edge on phones; from `sm` up the email's masthead (logo, the site's claim in italics, the four-color strip of the category colors), left out on phones because the site header right above shows all three; the title in small capitals with the date and the AI label under it; each `#` section as a centered ruled heading with its category's dot (`getCategoryColor`), the category found by the section's name among `GET /api/issues`, else by slugifying the name (`sectionSlug()` in `client/src/lib/newsletter-issue.ts`), since the web text has no ` {slug}` marker; story headlines dark, not link-colored; the publisher line in small type, without the email's favicon (the web text has no `{feed:}` marker, and the API serves no feed id); a quote in italics with its attribution under it (`parseQuote()`); the `---` between sections draws nothing; "All issues", "Get the newsletter by email" and the podcast offer in the card's footer. The page's own footer line ("Curated with care by AI.") is the site's; the card repeats none of the email's footer.
- **Story matching.** `getPublishedIssue` loads the stories the content's markers name plus the shortlist. A marked story's `headline` is its heading as it stands in the content, so a title edited after generation or a heading edited by hand keeps the story's label and link. An unmarked heading (issues generated before 2026-10-25; no backfill, plan decision 11) is matched by the story's `title || sourceTitle`, which is what was generated then; one edited by hand still gets the badge, without a label or link. The client matches `##` text to `headline` (`NewsletterIssuePage.tsx`).
- **Public API.** `GET /api/newsletters` (paginated, `page`, `pageSize` up to 50; slug, title, publishedAt, storyCount) and `GET /api/newsletters/:slug` (404 unless published; `aiLabel`, web `content`, `stories` with headline, title, titleLabel, sourceTitle, sourceUrl, publisher and a slug only while the story is published, and an `aiGenerated` marker with `fields: ['content', 'stories']`, `AI_GENERATED_NEWSLETTER_FIELDS`). Both behind the shared rate limiter, `Cache-Control: public, max-age=300`, open to any origin like the other public read APIs (`publicReadPaths`, `server-conventions.md` "CORS"), documented in the OpenAPI spec. Code: `server/src/services/newsletterArchive.ts`, `server/src/routes/public/newsletters.ts`.
- **RSS feed.** `GET /api/newsletters/feed.xml` (routed before `/:slug`, behind the shared rate limiter): RSS 2.0 built with the `feed` package like the story feeds (`server/src/lib/rssFeed.ts`), the newest `config.feed.size` (50) published issues from `listPublishedIssues`, one item each with the issue title, `link` and `guid` = its web address, `pubDate` = `publishedAt`, and as description the issue's AI label (`NEWSLETTER_TOP_LABEL`, lead and text), because RSS readers never see the site's labels. The channel links `/newsletter`, described by `rssChannelDescription('Weekly newsletter')`. No in-process cache (two cheap queries); `Cache-Control: public, max-age=900`. Linked from `/newsletter` (autodiscovery `<link rel="alternate">` and a visible "Follow new issues by RSS" under the signup form), from each issue page (autodiscovery), and listed on `/free-api`. The client's URL is `NEWSLETTER_FEED_URL` in `client/src/lib/api.ts` (`API_BASE`, so no Render rewrite is involved).
- **Pages.** The issue list is the Past issues section of `/newsletter` (prerendered, `NewsletterPage`, below the signup form; `/newsletter/archive` redirects there), and each issue is at `/newsletter/:slug` (dynamic, `NewsletterIssuePage`, in the server sitemap), whose "All issues" link leads back to `/newsletter`. The newest issue is one tap from the home page (a card above the first section) and from the end of every story page (a link in the newsletter line), both from the archive's first page and hidden when no issue is published or the archive fails (`.context/public-website.md`, "Cross-links").

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/newsletters` | Public: published issues, newest first |
| GET | `/api/newsletters/feed.xml` | Public: RSS feed of the published issues (see Web edition) |
| GET | `/api/newsletters/:slug` | Public: one published issue's web edition (404 unless published) |
| GET | `/api/admin/newsletters` | List (paginated, filterable by status) |
| POST | `/api/admin/newsletters` | Create |
| GET | `/api/admin/newsletters/:id` | Get single |
| PUT | `/api/admin/newsletters/:id` | Update: the fields (edit move, 409 when frozen), then `status` (publish or unpublish) |
| DELETE | `/api/admin/newsletters/:id` | Delete (409 once sent) |
| POST | `/api/admin/newsletters/:id/assign` | Auto-assign recent stories (409 when frozen) |
| POST | `/api/admin/newsletters/:id/select` | LLM shortlist selection (409 when frozen) |
| POST | `/api/admin/newsletters/:id/generate` | Generate text content (409 when frozen) |
| POST | `/api/admin/newsletters/:id/html` | Build and store the HTML email (409 when frozen) |
| POST | `/api/admin/newsletters/:id/carousel` | Generate carousel ZIP (download) |
| POST | `/api/admin/newsletters/:id/send-test` | Send to the test segment (409 without `PLUNK_TEST_SEGMENT_ID`) |
| POST | `/api/admin/newsletters/:id/send-live` | Send or schedule to all subscribers, and publish (409 once sent or without a test of the current HTML) |
| GET | `/api/admin/newsletters/:id/sends` | List sends |
| POST | `/api/admin/newsletters/:id/sends/:sendId/refresh-stats` | Refresh Plunk campaign stats |
| POST | `/api/admin/newsletters/:id/sends/:sendId/mark-failed` | Mark an unconfirmed live send as not sent (409 for any other send) |

## Files

| File | Purpose |
|------|---------|
| `server/src/services/newsletterLifecycle.ts` | Every move of an issue: the transition rules, row lock, claimed live sends, freeze, publish/unpublish, delete (the only writer of status, content, HTML and sends) |
| `server/src/services/newsletter.ts` | Reads, create, the non-writing builders (longlist, LLM shortlist, markdown, HTML template), carousel, send list and stats. Named debt: still both the LLM builders and the HTML template and parser |
| `server/src/services/newsletterContent.ts` | The stored content's markers (`{story:}`, `{feed:}`, section slug) for the email and the web edition |
| `server/src/services/newsletterArchive.ts` | Web edition: slugs, public queries, story matching |
| `client/src/lib/newsletter-state.ts` | The lifecycle rule mirrored for the admin's button states |
| `server/src/routes/public/newsletters.ts` | Public archive and issue endpoints |
| `client/src/pages/NewsletterPage.tsx`, `NewsletterIssuePage.tsx` | The signup-and-archive page and the issue pages |
| `server/src/services/carousel.ts` | Canvas image generation, PDF creation, ZIP bundling (also the story og:image, `.context/seo.md`) |
| `server/src/services/plunk.ts` | Plunk campaigns, sends and stats |
| `server/src/routes/admin/newsletters.ts` | Newsletter admin API endpoints |
| `server/src/schemas/newsletter.ts` | Newsletter request validation schemas |
| `server/src/schemas/llm.ts` | `newsletterSelectResultSchema` for LLM structured output |
| `server/src/prompts/newsletter-select.ts` | `buildNewsletterSelectPrompt` for story selection |
| `server/src/jobs/generateNewsletter.ts` | Automated weekly newsletter generation cron job |
| `server/src/jobs/publishNewsletter.ts` | Automated weekly send to all subscribers and publish |

## Modifying

- **To change newsletter format:** Edit the template loop in `newsletter.ts:buildContent()` and the HTML parser in `renderHtml()`; a new marker goes in `newsletterContent.ts`
- **To change what an issue may do in a state:** the move's rule in `newsletterLifecycle.ts`, and its mirror in `client/src/lib/newsletter-state.ts`
- **To add new carousel image layouts:** Edit `createStoryImage()` in `carousel.ts`
- **To use real branded assets:** Replace placeholder files in `server/assets/images/` and `server/assets/fonts/`

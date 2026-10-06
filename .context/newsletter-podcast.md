# Newsletter Generation

The weekly two-speaker podcast has its own file: `.context/podcast.md`.

## Overview

Newsletters are generated from published stories through a create-assign-generate workflow via admin API endpoints, with template-based formatting.

## Workflow

1. **Create** — `POST /api/admin/newsletters` with a title
2. **Assign stories** — `POST /:id/assign` auto-assigns recently published stories (last 7 days)
3. **Select stories** — `POST /:id/select` picks the shortlist with the LLM
4. **Generate content** — `POST /:id/generate` produces the content
5. **Edit** — `PUT /:id` to manually edit generated content
6. **Build and send** — `POST /:id/html`, then `send-test` / `send-live` (see Sending)
7. **Publish** — `PUT /:id` with `status: 'published'`

## Newsletter

### Story selection (`POST /:id/select`)

The longlist is every story with status `published` whose `dateCrawled` falls within the last `config.content.storyAssignmentDays` days (default 7). Assigning with no such story fails ("No recent stories to assign"). Selection needs a non-empty longlist (otherwise 400). One LLM call (`config.newsletter.selectModelTier`, `buildNewsletterSelectPrompt`) receives every longlist story with its top-level issue name (the parent issue, or the feed's issue as a fallback, else "General"). It picks `config.newsletter.storiesPerIssue` stories (env `NEWSLETTER_STORIES_PER_ISSUE`, default 2) for each distinct top-level issue. Returned IDs that are not on the longlist are dropped. The result is stored as `selectedStoryIds` (the shortlist), while `storyIds` keeps the longlist. Content generation and the carousel need a non-empty shortlist (otherwise 400 "No stories selected").

### Content generation (`POST /api/admin/newsletters/:id/generate`)

Generates markdown content in two phases:

1. **LLM editorial intro** — Calls the `contentModelTier` LLM with `buildNewsletterIntroPrompt()` to generate a 2-3 sentence warm, conversational opening that weaves together the edition's key themes. Falls back gracefully to no intro on failure.
2. **Template-based story blocks** — For each selected story, grouped by issue with section headers:
   - `# IssueName` section header (when the issue group changes)
   - Title as `##` heading
   - Metadata line with `{feed:id}` tag, publisher name, and links (feed ID is used for favicon in HTML)
   - Body text: alternates between `relevanceSummary` (2/3 of stories) and `quote` + `quoteAttribution` blockquote (1/3)

#### Issue ordering

Selected stories are sorted by a fixed issue order, then alphabetically by title (`title`, falling back to `sourceTitle`) within each issue (`ISSUE_ORDER` in `services/newsletter.ts`). The order is Human Development, Planet & Climate, Existential Threats, Science & Technology. Issues not on the list sort last. This order decides where the `# Issue` section headers go, and the intro receives the issue names in the same order. Body text alternates by position: every third story (`i % 3 === 2`) uses its pull-quote when `quote` and `quoteAttribution` are both present. The others use `relevanceSummary`.

### HTML email template (`POST /api/admin/newsletters/:id/html`)

Converts the markdown content into a responsive HTML email and saves it to the newsletter record. The function both generates and persists the HTML (callers do not need to save separately). Rendering needs `content` (otherwise 400 "No content to convert"). An issue counts as **built** once `html` is non-empty; the weekly job's guards key on this.

Template structure:
- **Header** — Logo, tagline, four-color category strip (amber/teal/red/indigo), newsletter title (uppercase, bold)
- **AI label** — directly under the week title, before any AI text: "**AI-generated:** AI selected the stories in this issue and wrote the intro, headlines, and summaries." (`NEWSLETTER_TOP_LABEL` in `server/src/lib/aiLabelCopy.ts`)
- **Intro** — Editorial intro paragraph(s) if present
- **Issue sections** — Centered category headers with colored dot and decorative lines
- **Story blocks** — Title (linked), publisher favicon + name + "original article" / "relevance analysis" links, body text or blockquote
- **Support Us** — Ko-fi link with "Free. Independent. Without ads." tagline
- **AI disclaimer** — "Curated and written with care by AI" + bug/mistake notice
- **Footer** — Website link, Plunk `{{plunk_id}}` unsubscribe link

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

1. Pre-checks for recent published stories (last 7 days); skips silently if none. Overlap within one process is prevented by the scheduler's `runningJobs`. `week_key` has no unique constraint (deferred), so two server processes could still race and build two issues for one week
2. Weekly guard, keyed by `newsletters.week_key` (ISO week `YYYY-Www`, set only by this job, so hand-made newsletters are never touched). An issue counts as **built** once its HTML exists. Skips if a built automatic issue has this week's key or was created within `config.newsletter.minHoursBetweenIssues` (156 h, 6.5 days), so a Sunday catch-up (previous ISO week, as early as 00:00, 148 h before the next Saturday 04:00 run) doesn't produce a second issue the next Saturday. A previous Saturday run created up to 16:00 (e.g. a 12:00 retry, 160 h earlier) still lets the next Saturday run proceed; one created after 16:00 Saturday blocks it
3. This week's unbuilt automatic draft: skips if it was updated within `abandonedDraftMinutes` (30, another run is building it); otherwise it is a run killed mid-pipeline, so it is deleted (warning logged) and the run proceeds
4. Creates the newsletter with the title `Week N, YYYY` (`getWeekTitle()`, same ISO week as the key) and `weekKey`, assigns stories, runs LLM selection, generates content + HTML. On failure in these steps: deletes the draft and re-throws to the scheduler
5. Sends the test email **after** that cleanup step: if it fails, the built issue is kept (resend from the admin; later runs that week skip) and the error still fails the job, so the scheduler alerts

**Test sends need `PLUNK_TEST_SEGMENT_ID`.** Without it, `sendTest` refuses before any Plunk call (`TestSegmentNotConfiguredError`; the admin `send-test` route answers 409), and the Saturday job fails and alerts every week. It never falls back to all subscribers (owner decision 2026-10-06).

Handler: `server/src/jobs/generateNewsletter.ts`. Registered in `server/src/jobs/handlers.ts`.

### Sending (Plunk)

Both sends need the stored `html` ("No HTML content — generate HTML first"). Each successful send creates a `NewsletterSend` row: `plunkCampaignId`, `isTest`, `status` (`sent | scheduled | sending`), a snapshot of `htmlContent`, `sentAt`, and `stats` (`{}` until first refreshed).

- **Test** (`sendTest`): name and subject are `[TEST] <title>`. The audience is the Plunk segment `PLUNK_TEST_SEGMENT_ID` only. The row is `isTest: true`, `status: sent`, `sentAt: now`. Without a segment the send is refused (see the test-segment note above).
- **Live** (`sendLive`, optional `scheduledFor`): name and subject are the title, and the audience is `ALL` subscribers. The row is `isTest: false`. Status is `scheduled` with `sentAt: null` when `scheduledFor` is given; otherwise status is `sending` with `sentAt: now`. A live send does **not** change the newsletter's `status`. Publishing is the separate `PUT /:id` step.
- **Stats** (`refreshSendStats`): fetches Plunk campaign stats for the send's `plunkCampaignId` and stores them in `stats`. A send without a campaign ID gets 400.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/newsletters` | List (paginated, filterable by status) |
| POST | `/api/admin/newsletters` | Create |
| GET | `/api/admin/newsletters/:id` | Get single |
| PUT | `/api/admin/newsletters/:id` | Update |
| DELETE | `/api/admin/newsletters/:id` | Delete |
| POST | `/api/admin/newsletters/:id/assign` | Auto-assign recent stories |
| POST | `/api/admin/newsletters/:id/select` | LLM shortlist selection |
| POST | `/api/admin/newsletters/:id/generate` | Generate text content |
| POST | `/api/admin/newsletters/:id/html` | Build and store the HTML email |
| POST | `/api/admin/newsletters/:id/carousel` | Generate carousel ZIP (download) |
| POST | `/api/admin/newsletters/:id/send-test` | Send to the test segment (409 without `PLUNK_TEST_SEGMENT_ID`) |
| POST | `/api/admin/newsletters/:id/send-live` | Send or schedule to all subscribers |
| GET | `/api/admin/newsletters/:id/sends` | List sends |
| POST | `/api/admin/newsletters/:id/sends/:sendId/refresh-stats` | Refresh Plunk campaign stats |

## Files

| File | Purpose |
|------|---------|
| `server/src/services/newsletter.ts` | Newsletter CRUD, story assignment, content generation, carousel orchestration |
| `server/src/services/carousel.ts` | Canvas image generation, PDF creation, ZIP bundling |
| `server/src/services/plunk.ts` | Plunk campaigns, sends and stats |
| `server/src/routes/admin/newsletters.ts` | Newsletter admin API endpoints |
| `server/src/schemas/newsletter.ts` | Newsletter request validation schemas |
| `server/src/schemas/llm.ts` | `newsletterSelectResultSchema`, `newsletterIntroSchema` for LLM structured output |
| `server/src/prompts/newsletter-intro.ts` | `buildNewsletterIntroPrompt` for editorial intro generation |
| `server/src/prompts/newsletter-select.ts` | `buildNewsletterSelectPrompt` for story selection |
| `server/src/jobs/generateNewsletter.ts` | Automated weekly newsletter generation cron job |

## Modifying

- **To change newsletter format:** Edit the template loop in `newsletter.ts:generateContent()` and the HTML parser in `generateHtmlContent()`
- **To change newsletter intro prompt:** Edit `buildNewsletterIntroPrompt()` in `prompts/newsletter-intro.ts`
- **To change newsletter intro output structure:** Update `newsletterIntroSchema` in `schemas/llm.ts` AND the prompt
- **To add new carousel image layouts:** Edit `createStoryImage()` in `carousel.ts`
- **To use real branded assets:** Replace placeholder files in `server/assets/images/` and `server/assets/fonts/`

# Newsletter Generation

> **Spec:** [`.specs/newsletter-and-podcast.allium`](../.specs/newsletter-and-podcast.allium) -- workflow rules (assign, select, generate, send), entity models, issue ordering. This file covers implementation details, templates, API endpoints, and modification guides.

The weekly two-speaker podcast has its own file: `.context/podcast.md`.

## Overview

Newsletters are generated from published stories through a create-assign-generate workflow via admin API endpoints, with template-based formatting.

## Workflow

1. **Create** — `POST /api/admin/newsletters` with a title
2. **Assign stories** — `POST /:id/assign` auto-assigns recently published stories (last 7 days)
3. **Generate content** — `POST /:id/generate` produces the content
4. **Edit** — `PUT /:id` to manually edit generated content
5. **Publish** — `PUT /:id` with `status: 'published'`

## Newsletter

### Content generation (`POST /api/admin/newsletters/:id/generate`)

Generates markdown content in two phases:

1. **LLM editorial intro** — Calls the `contentModelTier` LLM with `buildNewsletterIntroPrompt()` to generate a 2-3 sentence warm, conversational opening that weaves together the edition's key themes. Falls back gracefully to no intro on failure.
2. **Template-based story blocks** — For each selected story, grouped by issue with section headers:
   - `# IssueName` section header (when the issue group changes)
   - Title as `##` heading
   - Metadata line with `{feed:id}` tag, publisher name, and links (feed ID is used for favicon in HTML)
   - Body text: alternates between `relevanceSummary` (2/3 of stories) and `quote` + `quoteAttribution` blockquote (1/3)

### HTML email template (`POST /api/admin/newsletters/:id/html`)

Converts the markdown content into a responsive HTML email and saves it to the newsletter record. The function both generates and persists the HTML (callers do not need to save separately).

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

1. Pre-checks for recent published stories (last 7 days); skips silently if none
2. Weekly guard, keyed by `newsletters.week_key` (ISO week `YYYY-Www`, set only by this job, so hand-made newsletters are never touched). An issue counts as **built** once its HTML exists. Skips if a built automatic issue has this week's key or was created within `config.newsletter.minHoursBetweenIssues` (156 h, 6.5 days), so a Sunday catch-up (previous ISO week, as early as 00:00, 148 h before the next Saturday 04:00 run) doesn't produce a second issue the next Saturday. A previous Saturday run created up to 16:00 (e.g. a 12:00 retry, 160 h earlier) still lets the next Saturday run proceed; one created after 16:00 Saturday blocks it
3. This week's unbuilt automatic draft: skips if it was updated within `abandonedDraftMinutes` (30, another run is building it); otherwise it is a run killed mid-pipeline, so it is deleted (warning logged) and the run proceeds
4. Creates the newsletter with title and `weekKey`, assigns stories, runs LLM selection, generates content + HTML. On failure in these steps: deletes the draft and re-throws to the scheduler
5. Sends the test email **after** that cleanup step: if it fails, the built issue is kept (resend from the admin; later runs that week skip) and the error still fails the job, so the scheduler alerts

**Test sends need `PLUNK_TEST_SEGMENT_ID`.** Without it, `sendTest` refuses before any Plunk call (`TestSegmentNotConfiguredError`; the admin `send-test` route answers 409), and the Saturday job fails and alerts every week. It never falls back to all subscribers (owner decision 2026-10-06).

Handler: `server/src/jobs/generateNewsletter.ts`. Registered in `server/src/jobs/handlers.ts`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/newsletters` | List (paginated, filterable by status) |
| POST | `/api/admin/newsletters` | Create |
| GET | `/api/admin/newsletters/:id` | Get single |
| PUT | `/api/admin/newsletters/:id` | Update |
| DELETE | `/api/admin/newsletters/:id` | Delete |
| POST | `/api/admin/newsletters/:id/assign` | Auto-assign recent stories |
| POST | `/api/admin/newsletters/:id/generate` | Generate text content |
| POST | `/api/admin/newsletters/:id/carousel` | Generate carousel ZIP (download) |

## Files

| File | Purpose |
|------|---------|
| `server/src/services/newsletter.ts` | Newsletter CRUD, story assignment, content generation, carousel orchestration |
| `server/src/services/carousel.ts` | Canvas image generation, PDF creation, ZIP bundling |
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

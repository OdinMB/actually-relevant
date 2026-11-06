# Newsletter Generation

The weekly two-speaker podcast has its own file: `.context/podcast.md`.

## Overview

Newsletters are generated from published stories through a create-assign-select-generate workflow via admin API endpoints, with template-based formatting. The `generate_newsletter` job builds the weekly issue and the `publish_newsletter` job sends it to every subscriber and publishes it (seeded disabled). A published issue is public on the website, in the archive at `/newsletter` and at `/newsletter/:slug` (see Web edition). There are two editions, the full one and Actually Uplifting, each issue of one of them; until the owner opens the editions everything behaves as with one (see Editions).

## Workflow

1. **Create** — `POST /api/admin/newsletters` with a title and optionally an `edition` (`full`, the default, or `uplifting`)
2. **Assign stories** — `POST /:id/assign` auto-assigns recently published stories (last 7 days; an Actually Uplifting issue only the uplifting ones, see Editions)
3. **Select stories** — `POST /:id/select` picks the shortlist with the LLM (an Actually Uplifting issue: all of up to 10 without a model call), then swaps a pick for a later story of the same event the issue can carry, within its section (see Newer coverage)
4. **Generate content** — `POST /:id/generate` produces the content
5. **Edit** — `PUT /:id` to manually edit generated content
6. **Build and test** — `POST /:id/html`, then `send-test` (see Sending)
7. **Send** — `send-live` emails every subscriber and publishes the issue, once, and only after a test of its current HTML. A sent issue is frozen (see Issue lifecycle)
8. **Publish** without sending — `PUT /:id` with `status: 'published'` makes the issue public on the website (see Web edition)

## Issue lifecycle

**`server/src/services/newsletterLifecycle.ts` owns every move of an issue** (ADR-0048, owner decision 2026-10-25): it is the only code that writes `status`, `publishedAt`, `content`, `html`, `selectedStoryIds`, deletes an issue or writes a `newsletter_sends` row, held by `server/src/test/newsletterWriters.test.ts` (a source scan sharing `test/writeFence.ts` with the story status fence). Outside it: `stats` (`refreshSendStats`), the slug (`ensureNewsletterSlug`), `createNewsletter`, and `deleteStory`'s removal of a deleted story from `storyIds`. `services/newsletter.ts` builds what the moves write (`recentStoryIds`, `pickShortlist`, `buildContent`, `renderHtml`), `services/storyFreshness.ts` the shortlist's swaps for newer coverage (`preferNewerCoverage`), and `services/newsletterInbox.ts` the sends' subject and the HTML's preview text; none of them writes any of it. The admin routes and both jobs call the moves.

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
- **Refusals** are `NewsletterRefusedError` (a `ConflictError`, 409 `{ error }`) with a `code` (`frozen`, `already_sent`, `no_current_test`, `sent_issue`, `not_unconfirmed`, `no_audience`) the job maps to notices.
- **Changing a sent issue** means unpublishing it (owner decision Q1): that takes the web edition down and opens editing again; republishing shows the edited version under the same URL and date. A sent issue can never be emailed again (no override), and cannot be deleted.
- **The admin mirrors the rule** for button states only (`client/src/lib/newsletter-state.ts`, from the send list it loads; the server's 409 is the authority). A frozen issue disables the build, edit, rename, story-list and Save controls with one hint line; Send to Subscribers is disabled once sent, while a send is unconfirmed, or without a test of the current HTML. Every error toast shows the server's reason. Named debt: the rule exists twice; a server-computed lifecycle object in the responses would end that (rejected for now, plan decision 12).

## Editions

**Two editions, one subscriber list** (ADR-0052, spec 2026-11-06): each subscriber gets either the full newsletter (Actually Relevant) or **Actually Uplifting**, never both; each issue is of one edition (`newsletters.edition`, `full` or `uplifting`, default `full`; every issue before the editions is `full`). What differs between the two lives in `services/newsletterEdition.ts`: the display name, the subject and campaign label ("Actually Uplifting · "), the slug prefix (`actually-uplifting-`), the email's masthead line and tagline, the footer switch link, and the audience.

- **Which edition a subscriber gets** is the Plunk contact data field `edition` (`uplifting` or `full`). Confirming a signup writes it (with the edition chosen at signup, `.context/subscription.md`, "Editions"), and the footer switch link writes it; nothing else does, and nothing writes it in bulk. A contact with no `edition` field (every subscriber from before the editions) gets the full edition.
- **The audience of a live send** (`editionAudience()`, called by `sendLive` before the claim, so a refusal claims nothing):
  - **editions open** (`config.newsletter.editionsOpen`: both `PLUNK_FULL_EDITION_SEGMENT_ID` and `PLUNK_UPLIFTING_SEGMENT_ID` set; `parseEditionSegments` refuses to start with only one, the two equal, or either equal to `PLUNK_TEST_SEGMENT_ID`): each edition's own Plunk segment, `audienceType: 'SEGMENT'`. The owner creates both segments in Plunk's dashboard: *Full edition* = subscribed contacts matching `edition notEquals uplifting` OR `edition notExists` (two OR-ed groups: `notEquals` alone does not match a contact without the field), *Actually Uplifting* = `edition equals uplifting`.
  - **closed**: the full edition goes to `ALL`, exactly as before the editions, unless a confirmed signup chose Actually Uplifting (`pending_subscriptions.edition = uplifting`, possible only while the editions were open); then it is refused, since `ALL` would reach that reader too. An Actually Uplifting send is always refused. A refusal is `NewsletterRefusedError('no_audience')`, which the publish jobs record as "not sent".
- **The switch is the two variables, set together in one step.** Until then the signup form offers no choice and records `full`, issues carry no switch link, the full issue goes to `ALL`, and an Actually Uplifting issue cannot be sent; so deploying the editions changed nothing readers or the Saturday send see. The full email rendered while closed is byte-for-byte the email from before the editions (`newsletter.test.ts` snapshot).
- **Owner steps to open them:** create the two segments; compare the Full segment's count with the admin Subscribers page's "Subscribed by edition" (full) count; set both variables in Render together; send a `[TEST]` of each edition and check its footer link carries a contact id, not `{{id}}`; then enable `generate_uplifting_newsletter` and `publish_uplifting_newsletter` on the Jobs page (both refuse to be enabled while the editions are closed).
- **The footer switch link** (only while open, both editions): "Get Actually Uplifting instead" (full issue) or "Get the full picture instead" (Actually Uplifting issue), in brand pink above the website link, to `https://actuallyrelevant.news/newsletter-edition?c={{id}}&to=<other edition>`. `{{id}}` is Plunk's per-recipient contact id, filled into campaign bodies at send (Plunk's Liquid templates; `{{contact.id}}` does not exist; never name a contact data field `id` or `email`). The page switches only on a button click (`.context/subscription.md`, "Editions").
- **The Actually Uplifting email** keeps the raster logo and adds, in HTML text under it, the line "Actually Uplifting" (bold, `#b01a6a`) and the tagline "Only positive news from Actually Relevant." in place of "News that matter to humanity". The AI label, the donation ask and the AI disclaimer are the full issue's. Its subject reads "Actually Uplifting · Week 45: <lead headline>" (the label inside the 95-character budget), its Plunk campaign name "Actually Uplifting · Week 45, 2026", so complaint and bounce notices name the edition; its title stays "Week 45, 2026".
- **An Actually Uplifting issue's stories** (`services/upliftingIssue.ts`; owner decision 2026-11-06, which replaced the plan's reach-back rule):
  - **Longlist** (assign move): the published stories tagged `uplifting` (`emotionTag`) crawled in the last `storyAssignmentDays` (7) that no other built Actually Uplifting issue carries on its shortlist, most relevant first (`relevance` descending, unrated last), then newest. Only this window: it never reaches back to an earlier week. None: the assign move refuses ("No uplifting stories to assign this week", 400).
  - **Shortlist** (select move): up to `config.newsletter.uplifting.maxStories` (10, code-only) stories, all of them, in longlist order, with **no model call**. More than 10: one model call picks 10 (`buildUpliftingSelectPrompt` in `prompts/uplifting-select.ts`, the selection tier `config.newsletter.selectModelTier`, structured output `newsletterSelectResultSchema`, the stories listed most relevant first with their section; ids not on the longlist dropped, duplicates dropped, cut at 10). Then the newer-coverage swap, as for the full edition, inside the uplifting longlist. So the issue's selection is AI-made only above 10 stories (`.context/ai-transparency.md`, row 13).
  - Any count from 1 builds an issue (a short week is a short issue); 0 means no issue that week (Automated generation).
  - Content, HTML, test and live sends, freeze and publish are the lifecycle's moves unchanged (`assignStories`/`selectStories` pick the edition's builder, a ternary each), so the same safety rules hold: a test of the current HTML first, the live send claimed once, a sent issue frozen.
- **Admin:** the newsletter list shows a pink "Actually Uplifting" badge, the create dialog offers the edition, the issue page names the audience on its send button ("Send to Actually Uplifting subscribers"; the full edition's stays "Send to Subscribers").

## Newsletter

### Story selection (`POST /:id/select`)

For a full issue (an Actually Uplifting issue's rule is in Editions), the longlist is every story with status `published` whose `dateCrawled` falls within the last `config.content.storyAssignmentDays` days (default 7). Assigning with no such story fails ("No recent stories to assign"). Paywall-locked stories never reach the longlist: they are rejected at crawl (`story-pipeline.md`, "Paywall-Locked Stories"); there is no separate short-content filter here. Selection needs a non-empty longlist (otherwise 400). One LLM call (`config.newsletter.selectModelTier`, `buildNewsletterSelectPrompt`) receives every longlist story with its top-level issue name (the parent issue, or the feed's issue as a fallback, else "General"). It picks `config.newsletter.storiesPerIssue` stories (env `NEWSLETTER_STORIES_PER_ISSUE`, default 2) for each distinct top-level issue. Returned IDs that are not on the longlist are dropped. A pick with a later story of the same event the issue can carry, in the pick's own section, is then replaced by it (Newer coverage, below). The result is stored as `selectedStoryIds` (the shortlist), while `storyIds` keeps the longlist. Content generation and the carousel need a non-empty shortlist (otherwise 400 "No stories selected").

### Newer coverage

A selected story may have been overtaken by later events by the time the issue goes out. `server/src/services/storyFreshness.ts` (reads only, no model call) finds a story's newer coverage:
- a story in its dedup cluster (`dedup.md`) reported at least `config.freshness.sameEventMinGapHours` (24) after it (`same_event`), so other outlets' same-day reports of one event do not count; or
- a nearly identical later headline from its own feed, however soon (`same_source`): the two `sourceTitle`s share at least `sameSourceMinSharedWords` (3) words and a Dice similarity of at least `sameSourceMinSimilarity` (0.7), ignoring case, punctuation and filler words.

A later story counts once it reached analysis: `analyzed`, `selected`, `published`, or rejected as a `duplicate` (dedup files a later report of an event whose story is already published as a duplicate of it). Trashed stories and other rejections never count. "Reported" is the source's publication date, else the crawl date; a source date after the crawl is not believed. The constants are code-only (no environment overrides). The dedup prompt keeps "a different development of the same ongoing story" out of a cluster, so such a follow-up is found only by the same-feed headline rule; an LLM check of each pick is an open backlog item.

- **Swap at selection**: the select move (`POST /:id/select` and the `generate_newsletter` run alike) replaces each model pick, in its place, with the newest of its `same_event` stories the issue can carry: `published`, on the issue's longlist under the pick's own top-level section (as `pickShortlist` resolves it for the prompt, so a swap never moves a story between sections), and not already on the shortlist or taken by an earlier pick (`preferNewerCoverage`, before the write, so the content, the email and the web edition are built from the newer story). A `same_source` match is never taken, only flagged: a nearly identical headline from one feed can be another story (the same kind of disaster in another country), and the same-feed pairs a swap could carry are mostly ones dedup judged different. A pick without such a story stays. Stories are never combined and no text is written; a person's own shortlist edits (`PUT /:id`) are never swapped. Each swap is logged ("replaced a pick with newer coverage") and named in the admin's select toast ("Stories selected. Replaced with newer coverage: <title>"); nothing stores it, so the weekly run's swaps show only in the log.
- **How often**: rarely. The election keeps the earliest-published member primary, dedup files later reports as `duplicate` rejections, and the publish job publishes only primaries and unclustered stories, so a cluster's later member is published only when two stories published apart were clustered afterwards (formation keeps published members) or an editor published it by hand; it must also fall under the pick's section.
- **Admin flags**: the issue page's Selected Stories list shows "Newer coverage:" under a selected story that still has newer coverage (one the swap could not take, or one reported after selection ran), linking each newer story's admin page with its publisher, date and reason ("same event" or "same publisher"), at most `maxNewerPerStory` (3), newest first (`NewerCoverageNote`, from `GET /api/admin/stories/newer-coverage?ids=…`, at most 100 ids). Nothing is blocked or disabled, and no notice is raised.

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
- **Inbox preview text** — a hidden block first in the body, for an issue with at least one story (see Subject and inbox preview)
- **View in browser** — a small link above the logo to the issue's web edition, `https://actuallyrelevant.news/newsletter/<slug>`. Building the HTML assigns the slug if the issue has none (`ensureNewsletterSlug()`), so the link exists before the issue is published; it opens only once the issue is published (until then the page is "Issue Not Found"). A live send publishes the issue, so the link works from the moment the email goes out
- **Header** — Logo, tagline (an Actually Uplifting issue: the edition line and its own tagline, see Editions), four-color category strip (amber/teal/red/indigo), newsletter title (uppercase, bold)
- **AI label** — directly under the week title, before any AI text: "[AI] selected the stories in this issue and wrote the headlines and summaries.", an inline "AI" badge as the sentence's subject (`NEWSLETTER_TOP_LABEL` in `server/src/lib/aiLabelCopy.ts`: `lead` is the badge, `text` the rest; plain-text surfaces join them with a space. Owner reworded it 2026-10-26 when the intro was removed, and issues generated before then keep their intro under the same label; on 2026-11-05 he dropped the "AI-generated:" lead-in so the badge is the line's only "AI")
- **Opening text** — any text before the first heading, as paragraphs: the intro of an issue generated before 2026-10-26, or an opening a person wrote. New issues have none
- **Issue sections** — Centered category headers with colored dot and decorative lines
- **Story blocks** — Title (linked), publisher favicon + name + "original article" / "relevance analysis" links, body text or blockquote. The favicon is the API's stored PNG, `config.apiUrl` + `/api/feeds/<id>/favicon` (`feedFaviconUrl()`); a feed without one shows a broken image, so run "Fetch All Favicons" before a send if feeds lack one (`feed-management.md`, "Favicons")
- **Donation ask** — "Actually Relevant is free, with no ads and no investors, but running it costs money. If this issue was worth something to you, please chip in." and a Ko-fi button "Donate $5 toward running the site". The wording is `config.donation`, shared with the podcast show notes and feed (owner, 2026-11-01: never name the actual running costs)
- **AI disclaimer** — "Curated and written with care by AI" + bug/mistake notice
- **Footer** — While the editions are open, the switch link to the other edition (Editions); the website link. Our template carries no unsubscribe link (removed in February); Plunk adds its own footer unsubscribe link and, since 2026-08-09, one-click unsubscribe headers

### Subject and inbox preview (`services/newsletterInbox.ts`)

What the inbox shows before the email is opened, built from the stored content and the stories' stored `relevance` (the final rating), with no model call. The stories are the `##` headings the email shows, in the content's order (`storyHeadings()`), each matched to its story by its `{story:<id>}` marker; an unmarked heading (an issue generated before the marker, or one typed by hand) and a deleted story count as unrated. The archive, the web edition, the RSS feed and the Plunk campaign name (which the admin notices show) keep the issue title.

- **Subject**: `<label>: <lead headline>`, e.g. "Week 43: Cities cut smog by a third" (an Actually Uplifting issue: "Actually Uplifting · Week 43: …", the edition's label in front, inside the same budget), however many stories the issue has (no count of the others since 2026-11-01). The label is "Week 43" when the title is a weekly title ("Week 43, 2026", `getWeekTitle()`), else the whole title. The lead is the most relevant story; ties, and unrated stories (ranked below every rated one), keep the content's order. No story: the title, as before. A subject over 95 characters gets its lead headline shortened at a word, ending in "…"; behind a long title the headline still gets at least 30 characters of room (the cut at a word can keep fewer). Plain text on one line: line breaks and control characters become spaces, nothing is HTML-escaped. The test email's subject is the same with `[TEST] ` in front.
- **Preview text** (preheader): `AI-curated: <second> · <third>`, the AI marker (`NEWSLETTER_PREVIEW_AI_MARKER` in `server/src/lib/aiLabelCopy.ts`, owner-approved 2026-11-01; `.context/ai-transparency.md`) and the next two stories by the same ranking, as a hidden block first in the body (`display: none`, `mso-hide: all`), HTML-escaped. With one story the block holds the email's own top label instead, in plain text "AI selected the stories in this issue and wrote the headlines and summaries." (`NEWSLETTER_TOP_LABEL`, no new wording), so the subject's AI headline always has a label in the preview. With no story there is no block, so such an issue renders exactly as before. Nothing pads it: a client that shows more preview text than that goes on with the email's opening text ("View in browser", the tagline, the title, the AI label).
- **When each is built**: the preview text by the html move, into the stored HTML, so the test of the current HTML shows it; the subject by each send, from the content and ratings as they are then (the live send reads it before claiming, so a failed read claims nothing). Editing the content without rebuilding the HTML can make the subject name a heading the email does not show, as it already makes the email and the content disagree. Likewise an issue whose HTML was built before the preview text existed goes out with the new subject but no preview block until its HTML is rebuilt.
- **The live subject is not the tested one by rule**: it is rebuilt at send time, so a re-rating or a content edit between the test and the live send can change it from the subject the `[TEST]` email carried (the test unlocks the live send by its HTML alone).

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
- `fonts/Roboto/` (Roboto Bold with its Apache 2.0 licence) and `images/logo-text-horizontal.jpg` for the section preview images (`.context/seo.md`, "Section preview images").
- The Inter fonts and the header images and logo named above are not in the repository, and no code loads a header image or that logo. The carousel checks for each Inter file and falls back, so story images (slides and `og.png`) render in a system font.

### Automated generation (`generate_newsletter` cron job)

The `generate_newsletter` job (default: Saturday 4am, `0 4 * * 6`) chains the full pipeline automatically:

1. Pre-checks for recent published stories (crawled in the last `STORY_ASSIGNMENT_DAYS`, 7). If there are none it skips the week and records a `newsletter` / `warning` notice "No newsletter this week" pointing at the Jobs page (key `newsletter-no-stories:<weekKey>`, so a retry that week reopens the one row; `.context/admin-notices.md`): a stalled pipeline would otherwise mean a silent week without a newsletter. Overlap within one process is prevented by the scheduler's `runningJobs`. `week_key` has no unique constraint (deferred), so two server processes could still race and build two issues for one week
2. Weekly guard, keyed by `newsletters.week_key` (ISO week `YYYY-Www`, set only by this job, so hand-made newsletters are never touched). An issue counts as **built** once its HTML exists. Skips if a built automatic issue has this week's key or was created within `config.newsletter.minHoursBetweenIssues` (156 h, 6.5 days), so a Sunday catch-up (previous ISO week, as early as 00:00, 148 h before the next Saturday 04:00 run) doesn't produce a second issue the next Saturday. A previous Saturday run created up to 16:00 (e.g. a 12:00 retry, 160 h earlier) still lets the next Saturday run proceed; one created after 16:00 Saturday blocks it
3. This week's unbuilt automatic draft: skips if it was updated within `abandonedDraftMinutes` (30, another run is building it); otherwise it is a run killed mid-pipeline, so it is deleted (warning logged) and the run proceeds
4. Creates the newsletter with the title `Week N, YYYY` (`getWeekTitle()`, same ISO week as the key) and `weekKey`, then runs the lifecycle's assign, select, generate and html moves. On failure in these steps: deletes the draft (the delete move, which an unsent issue passes) and re-throws to the scheduler
5. Sends the test email **after** that cleanup step: if it fails, the built issue is kept (resend from the admin; later runs that week skip) and the error still fails the job, so the scheduler records a job-failure notice (filed under Newsletter)

**Test sends need `PLUNK_TEST_SEGMENT_ID`.** Without it, `sendTest` refuses before any Plunk call (`TestSegmentNotConfiguredError`; the admin `send-test` route answers 409), and the Saturday job fails and alerts every week. It never falls back to all subscribers (owner decision 2026-10-06).

**`generate_uplifting_newsletter`** (default Saturday 04:10, `10 4 * * 6`, 10 minutes after the full build; seeded **disabled** by migration `20261106120000_newsletter_editions`, and refused enabling while the editions are closed) runs the same steps for an Actually Uplifting issue (`generateWeeklyIssue(edition)` behind both handlers). Its weekly guard and draft cleanup look only at Actually Uplifting issues, so neither edition's issue blocks the other's; the guard runs before the story count, because the count leaves out stories a built Actually Uplifting issue carries and would read 0 once this week's issue is built. A week with no uplifting story to carry builds nothing and records a `newsletter` / **`info`** notice "No Actually Uplifting issue this week" (key `newsletter-uplifting-no-stories:<weekKey>`): skipping is the designed behavior (spec), so it is not a warning. Any count from 1 builds an issue.

Handler: `server/src/jobs/generateNewsletter.ts`. Registered in `server/src/jobs/handlers.ts`.

### Automated sending (`publish_newsletter` cron job)

The `publish_newsletter` job (default: Saturday 4:30am, `30 4 * * 6`, 30 minutes after `generate_newsletter`; seeded **disabled** by migration `20261025120000_publish_newsletter_job`) sends the week's issue to everyone:

1. Looks for this ISO week's automatic issue (`weekKey` from `getWeekKey()`, so hand-made newsletters are never sent) that is built (`html` non-empty), still `draft`, and has no live non-failed send. An issue an admin already sent live or published by hand is skipped; a failed live send proves nothing went out, so a later run retries it.
2. None found: sends nothing and says why. An unconfirmed live send records a "Newsletter not sent" warning asking for a check in Plunk. This week's automatic issue already sent live or published records an `info` notice "Newsletter already sent" (key `newsletter-already-sent:<weekKey>`). An issue not built yet (generation still running at 04:30, or stuck), or no automatic issue at all, records a `newsletter` / `warning` notice "Newsletter not sent" (key `newsletter-not-sent:<weekKey>`) naming the reason.
3. Found: calls the lifecycle's `sendLive`, which sends (audience `ALL` while the editions are closed, the Full edition segment once open; Editions) and publishes in one move, then records an `info` notice "Newsletter sent". The move's refusals become notices: `no_current_test` (no `sent` test whose HTML is the current HTML) the same "Newsletter not sent" warning, asking for the test first (owner decision 2026-10-25: an issue goes to subscribers only after its `[TEST]` email went out); `already_sent` (an editor's send won the race) the "Newsletter already sent" info. A failed send fails the run (job-failure notice under Newsletter) and leaves the issue a draft. So every run leaves a notice, whatever the outcome (owner decision 2026-10-25).

Enabling it is refused while `PLUNK_SECRET_KEY` is unset (the scheduler's enable checks). The 30-minute gap is a schedule, not a dependency: moving `generate_newsletter` on the Jobs page means moving this job too. A `no_audience` refusal (the editions closed after a reader chose Actually Uplifting) is a "Newsletter not sent" warning naming the reason.

**`publish_uplifting_newsletter`** (default Saturday 04:40, `40 4 * * 6`, seeded **disabled** by the same migration; enabling needs the editions open and `PLUNK_SECRET_KEY`) does the same for this week's automatic Actually Uplifting issue (`publishWeeklyIssue(edition)` behind both handlers; each edition's lookups find only its own issue), sending to the Actually Uplifting segment. Its notices carry the edition: "Actually Uplifting issue not sent" (key `newsletter-uplifting-not-sent:<weekKey>`), "… already sent" (`newsletter-uplifting-already-sent:<weekKey>`), "… sent"; the full edition's titles and keys are unchanged. A week with no issue and no uplifting story to carry records the generate job's "No Actually Uplifting issue this week" info again (same key, so one row), not a warning.

Handler: `server/src/jobs/publishNewsletter.ts`.

### Sending (Plunk)

Both sends need the stored `html` (400 "No HTML content — generate HTML first"). Each send has a `NewsletterSend` row: `plunkCampaignId`, `isTest`, `status`, a snapshot of `htmlContent`, `sentAt`, `errorMessage`, and `stats` (`{}` until first refreshed).

- **Test** (`sendTest`, allowed in any state): name `[TEST] <title>` (an Actually Uplifting issue's title with its label, Editions), subject `[TEST] <subject>` (Subject and inbox preview). The audience is the Plunk segment `PLUNK_TEST_SEGMENT_ID` only. The row is written after Plunk accepted the send, so a row means the test went out: `isTest: true`, `status: sent`, `sentAt: now`. Without a segment the send is refused (see the test-segment note above). A test unlocks the live send only while its `htmlContent` equals the issue's `html`; regenerating or editing the HTML needs a new test (re-rendering identical HTML keeps it valid).
- **Live** (`sendLive`, optional `scheduledFor`; the job and `POST /:id/send-live` alike): name the title (with the edition's label), subject as in Subject and inbox preview, audience from `editionAudience()` (`ALL` while the editions are closed; Editions). Claimed before Plunk is called (owner decision 2026-10-25):
  0. **Audience**, before the claim: a refused audience (`no_audience`, 409) claims nothing and sends nothing.
  1. **Claim**, under the issue's row lock: refuse without HTML, with a live non-failed send (`already_sent`) or without a current test (`no_current_test`); else insert the live row with `status: draft` and no campaign id. A second caller (double click, second editor, the job) waits for the lock, then sees the claim and is refused.
  2. Create the campaign and store its id on the row (so stats work even if later steps fail). A failure here sent nothing: the row becomes `failed` with the error.
  3. Send it. A failure that proves nothing went out (no connection, `isConnectionNotEstablished()`, or a 4xx) marks the row `failed`. Any other (timeout, reset, 5xx: Plunk may have accepted it) leaves the row `draft` with `errorMessage` "Plunk may have accepted this send; check the campaign in Plunk, then mark it not sent if it was not". The error is rethrown either way.
  4. **Confirm and publish** in one transaction: the row becomes `sending` (`sentAt: now`) or `scheduled` (`sentAt: null`), and the issue is published with the publish move's fields (its `publishedAt` the send's time). A scheduled send publishes at confirm, not at the scheduled time (the admin never schedules).
- **Unconfirmed** = a live row still in `draft`: the claim went in, the confirmation did not (an ambiguous Plunk failure, or the process died after step 1). It blocks another send and freezes the issue (owner decision Q3: nobody gets two emails, at the cost of a blocked week if nobody looks). The admin shows it as "Unconfirmed" with its message; **Mark as not sent** (`POST /:id/sends/:sendId/mark-failed`, `markSendFailed`) turns it `failed` after an editor checked Plunk, which releases the issue. Resolving it by reading Plunk's campaign status is not built.
- **Retries.** Creating the campaign is retried on any transient error (a lost response leaves at most an orphan draft campaign in Plunk). Sending it (`sendCampaign()` in `services/plunk.ts`) is retried only when no connection was made: after a timeout, a reset or a 5xx Plunk may already have accepted the send, and a retry would email the whole audience twice.
- **Stats** (`refreshSendStats`): fetches Plunk campaign stats for the send's `plunkCampaignId` and stores them in `stats`. A send without a campaign ID gets 400. Open and click tracking is off in Plunk (Settings → Tracking, owner, 2026-10-28), so `opened` and `clicked` stay at zero for later sends; delivered, bounced and complained still count. The privacy page says emails are untracked: switching tracking back on needs that page changed first.

### Web edition (public archive)

**An issue is public on the website exactly while its admin status is `published`** (ADR-0041; there is no separate switch). A live send publishes it (owner decision Q2), and so does `PUT /:id` with `status: 'published'`. The admin's publish control says so ("Publishing makes this issue public on the website…", and for a published issue its public address; `PublishHint` in `client/src/components/admin/NewsletterDetail.tsx`). Unpublishing (`status: 'draft'`) takes it off the archive, the issue page, the API and the sitemap at once (API responses are cached for 5 minutes), and opens a sent issue for editing (Issue lifecycle).

- **Slug.** `newsletters.slug` (unique), from the title by `newsletterSlugBase()` ("Week 42, 2026" → `week-42-2026`; an Actually Uplifting issue's prefixed `actually-uplifting-week-42-2026`, so the two issues of a week never collide; `archive` is reserved for the old archive URL, which redirects to `/newsletter`, and becomes `archive-issue`; a taken slug gets `-2`, `-3`, …). Assigned on the first HTML build or the first publish, whichever comes first, and never changed afterwards, renaming included, so a URL in a sent email keeps working. Issues already published when the column was added were backfilled by the migration with the same rule.
- **Date.** `newsletters.published_at`, set by the first publish and kept on unpublish and republish; the archive orders and dates issues by it. An issue that was already emailed takes the date of its earliest live, not-failed send (`sent_at`, or `created_at` for a scheduled send), so an older issue published on the web later keeps its own week; otherwise the publish time. Migration `20261025140000_newsletter_published_at_from_sends` moved the issues published before this rule back to their send dates.
- **What is shown.** The stored `content` markdown (so a person's edits show), without the template's machine markers (`toWebMarkdown()` in `newsletterContent.ts`: `{story:<id>}` after each `##` heading, `{feed:<id>}`, and the ` {issue-slug}` after each `#` heading). The issue page puts the issue's AI label (`NEWSLETTER_TOP_LABEL`, served as `aiLabel`, the same wording as at the top of the email) under the title before any AI text; each `##` story heading gets the "AI" badge and title label through `StoryTitleLabel` and links to the story page when the story is still published; absolute links to the site stay in the app; other links open in a new tab.
- **Look.** The page is dressed like the email (`renderHtml()`), which stays the reference: a white card, as wide as the email, on a tinted page, edge to edge on phones; from `sm` up the email's masthead (logo, the site's claim in italics, the four-color strip of the category colors), left out on phones because the site header right above shows all three; the title in small capitals with the date and the AI label under it; each `#` section as a centered ruled heading with its category's dot (`getCategoryColor`), the category found by the section's name among `GET /api/issues`, else by slugifying the name (`sectionSlug()` in `client/src/lib/newsletter-issue.ts`), since the web text has no ` {slug}` marker; story headlines dark, not link-colored; the publisher line in small type, without the email's favicon (the web text has no `{feed:}` marker, and the API serves no feed id); a quote in italics with its attribution under it (`parseQuote()`); the `---` between sections draws nothing; "All issues", "Get the newsletter by email" and the podcast offer in the card's footer. The page's own footer line ("Curated with care by AI.") is the site's; the card repeats none of the email's footer.
- **Story matching.** `getPublishedIssue` loads the stories the content's markers name plus the shortlist. A marked story's `headline` is its heading as it stands in the content, so a title edited after generation or a heading edited by hand keeps the story's label and link. An unmarked heading (issues generated before 2026-10-25; no backfill, plan decision 11) is matched by the story's `title || sourceTitle`, which is what was generated then; one edited by hand still gets the badge, without a label or link. The client matches `##` text to `headline` (`NewsletterIssuePage.tsx`).
- **Editions on the web.** Both editions' issues are in the archive, the RSS feed and the sitemap. `/newsletter`'s Past issues has a two-option filter, "All issues" / "Actually Uplifting" (toggle buttons, `aria-pressed`), kept in `?edition=uplifting` or `?edition=all`; without the parameter it opens on Actually Uplifting inside that edition (the dial at "Only uplifting") and on All elsewhere (owner); the prerendered page is the All view (`client/src/lib/newsletterArchiveFilter.ts`). Each Actually Uplifting issue carries a pink "Actually Uplifting" tag in the list and above its title on the issue page (`NewsletterEditionTag`), and its page title and link-preview title start "Actually Uplifting · ". The home page's newest-issue card inside the edition is the newest Actually Uplifting issue. The RSS item of an Actually Uplifting issue is titled "Actually Uplifting · <title>".
- **Public API.** `GET /api/newsletters` (paginated, `page`, `pageSize` up to 50, optional `edition` = `full` | `uplifting`; slug, title, edition, publishedAt, storyCount) and `GET /api/newsletters/:slug` (404 unless published; `edition`, `aiLabel`, web `content`, `stories` with headline, title, titleLabel, sourceTitle, sourceUrl, publisher and a slug only while the story is published, and an `aiGenerated` marker with `fields: ['content', 'stories']`, `AI_GENERATED_NEWSLETTER_FIELDS`). Both behind the shared rate limiter, `Cache-Control: public, max-age=300`, open to any origin like the other public read APIs (`publicReadPaths`, `server-conventions.md` "CORS"), documented in the OpenAPI spec. Code: `server/src/services/newsletterArchive.ts`, `server/src/routes/public/newsletters.ts`.
- **RSS feed.** `GET /api/newsletters/feed.xml` (routed before `/:slug`, behind the shared rate limiter): RSS 2.0 built with the `feed` package like the story feeds (`server/src/lib/rssFeed.ts`), the newest `config.feed.size` (50) published issues from `listPublishedIssues`, one item each with the issue title, `link` and `guid` = its web address, `pubDate` = `publishedAt`, and as description the issue's AI label (`NEWSLETTER_TOP_LABEL`, lead and text), because RSS readers never see the site's labels. The channel links `/newsletter`, described by `rssChannelDescription('Weekly newsletter')`. No in-process cache (two cheap queries); `Cache-Control: public, max-age=900`. Linked from `/newsletter` (autodiscovery `<link rel="alternate">` and a visible "Follow new issues by RSS" under the signup form), from each issue page (autodiscovery), and listed on `/free-api`. The client's URL is `NEWSLETTER_FEED_URL` in `client/src/lib/api.ts` (`API_BASE`, so no Render rewrite is involved).
- **Pages.** The issue list is the Past issues section of `/newsletter` (prerendered, `NewsletterPage`, below the signup form; `/newsletter/archive` redirects there), and each issue is at `/newsletter/:slug` (dynamic, `NewsletterIssuePage`, in the server sitemap), whose "All issues" link leads back to `/newsletter`. The newest issue is one tap from the home page (a card above the first section) and from the end of every story page (a link in the newsletter line), both from the archive's first page and hidden when no issue is published or the archive fails (`.context/public-website.md`, "Cross-links"). Every story page also links the first public issue the story was in, as a card above its newsletter line (`findFirstIssueWithStory` in `newsletterArchive.ts`; `.context/public-website.md`, "Cross-links").
- **Link previews.** The backend serves each issue page with its own preview tags for crawlers that run no JavaScript; its og:title is the email subject's lead line and its og:image the lead story's preview image (`.context/seo.md`, "Link previews").

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/newsletters` | Public: published issues, newest first (`?edition=` for one edition's) |
| GET | `/api/newsletters/feed.xml` | Public: RSS feed of the published issues (see Web edition) |
| GET | `/api/newsletters/:slug` | Public: one published issue's web edition (404 unless published) |
| GET | `/api/admin/newsletters` | List (paginated, filterable by status and edition) |
| POST | `/api/admin/newsletters` | Create (title, optional `edition`) |
| GET | `/api/admin/newsletters/:id` | Get single |
| PUT | `/api/admin/newsletters/:id` | Update: the fields (edit move, 409 when frozen), then `status` (publish or unpublish) |
| DELETE | `/api/admin/newsletters/:id` | Delete (409 once sent) |
| POST | `/api/admin/newsletters/:id/assign` | Auto-assign recent stories (409 when frozen) |
| POST | `/api/admin/newsletters/:id/select` | LLM shortlist selection, picks swapped for a later story of the same event; answers the issue with `replacedWithNewer` (409 when frozen) |
| POST | `/api/admin/newsletters/:id/generate` | Generate text content (409 when frozen) |
| POST | `/api/admin/newsletters/:id/html` | Build and store the HTML email (409 when frozen) |
| POST | `/api/admin/newsletters/:id/carousel` | Generate carousel ZIP (download) |
| POST | `/api/admin/newsletters/:id/send-test` | Send to the test segment (409 without `PLUNK_TEST_SEGMENT_ID`) |
| POST | `/api/admin/newsletters/:id/send-live` | Send or schedule to the edition's audience, and publish (409 once sent, without a test of the current HTML, or with no audience) |
| GET | `/api/admin/newsletters/:id/sends` | List sends |
| POST | `/api/admin/newsletters/:id/sends/:sendId/refresh-stats` | Refresh Plunk campaign stats |
| POST | `/api/admin/newsletters/:id/sends/:sendId/mark-failed` | Mark an unconfirmed live send as not sent (409 for any other send) |

## Files

| File | Purpose |
|------|---------|
| `server/src/services/newsletterLifecycle.ts` | Every move of an issue: the transition rules, row lock, claimed live sends, freeze, publish/unpublish, delete (the only writer of status, content, HTML and sends) |
| `server/src/services/newsletter.ts` | Reads, create, the non-writing builders (longlist, LLM shortlist, markdown, HTML template), carousel, send list and stats. Named debt: still both the LLM builders and the HTML template and parser |
| `server/src/services/newsletterEdition.ts` | Everything that differs between the two editions of an issue: names, labels, slug prefix, masthead, switch link, `editionAudience()` |
| `server/src/services/upliftingIssue.ts` | Which stories an Actually Uplifting issue carries (longlist; all up to 10, else the model picks 10) |
| `server/src/prompts/uplifting-select.ts` | `buildUpliftingSelectPrompt`, the pick of 10 from more than 10 uplifting stories |
| `server/src/services/newsletterContent.ts` | The stored content's markers (`{story:}`, `{feed:}`, section slug) for the email and the web edition |
| `server/src/services/newsletterInbox.ts` | The email's subject and inbox preview text, from the content's headings and the stories' relevance |
| `server/src/services/newsletterArchive.ts` | Web edition: slugs, public queries, story matching, the first issue a story was in |
| `server/src/services/storyFreshness.ts` | Newer coverage of chosen stories (no model call): a later story in the same dedup cluster, or a nearly identical later headline from the same feed; the issue page's flags and the select move's swaps |
| `client/src/components/admin/NewerCoverageNote.tsx` | The newer-coverage line under a selected story in the admin issue view |
| `client/src/lib/newsletter-state.ts` | The lifecycle rule mirrored for the admin's button states |
| `server/src/routes/public/newsletters.ts` | Public archive and issue endpoints |
| `client/src/pages/NewsletterPage.tsx`, `NewsletterIssuePage.tsx` | The signup-and-archive page and the issue pages |
| `server/src/services/carousel.ts` | Canvas image generation, PDF creation, ZIP bundling (also the story og:image, `.context/seo.md`) |
| `server/src/services/plunk.ts` | Plunk campaigns, sends and stats |
| `server/src/routes/admin/newsletters.ts` | Newsletter admin API endpoints |
| `server/src/schemas/newsletter.ts` | Newsletter request validation schemas |
| `server/src/schemas/llm.ts` | `newsletterSelectResultSchema` for LLM structured output |
| `server/src/prompts/newsletter-select.ts` | `buildNewsletterSelectPrompt` for story selection |
| `server/src/jobs/generateNewsletter.ts` | Automated weekly generation, one handler per edition (`generateWeeklyIssue`) |
| `server/src/jobs/publishNewsletter.ts` | Automated weekly send and publish, one handler per edition (`publishWeeklyIssue`) |

## Modifying

- **To change newsletter format:** Edit the template loop in `newsletter.ts:buildContent()` and the HTML parser in `renderHtml()`; a new marker goes in `newsletterContent.ts`
- **To change the subject or inbox preview text:** `newsletterInbox.ts` (`inboxPreview()` is pure; its tests hold each case)
- **To change what an issue may do in a state:** the move's rule in `newsletterLifecycle.ts`, and its mirror in `client/src/lib/newsletter-state.ts`
- **To change what differs between the editions:** `newsletterEdition.ts`; which stories Actually Uplifting carries: `upliftingIssue.ts` (and `ai-transparency.md`, row 13)
- **To add new carousel image layouts:** Edit `createStoryImage()` in `carousel.ts`
- **To use real branded assets:** Replace placeholder files in `server/assets/images/` and `server/assets/fonts/`

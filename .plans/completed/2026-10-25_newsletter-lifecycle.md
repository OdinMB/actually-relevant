---
status: implemented
type: feature
complexity: complex
---

# One owner for newsletter issue moves: claimed live sends, freeze after sending, story ids in content

> Written by a planning subagent: the handbook's `plan-decisions` skill is not loaded here, so the header has this workflow's keys only and the decisions live in `## Approach`. Research, the approach comparison and the review were done in one context (no explorer, architect or reviewer agents), at the caller's request.

Sources: `/mnt/project-files/codebase-scans/2026-10-25_arch-issues.md` N1 and N2, `/mnt/project-files/codebase-scans/2026-10-25_improvement-opportunities.md` F2 and F3, the story-lifecycle plan `.plans/completed/2026-10-19_story-lifecycle-and-db-tests.md` (ADR-0045). Code verified on branch `claude/project-thread-1af2ed` at `d8f685a`. Functions are named, never line numbers.

## Problem

An issue's state is spread over `newsletters.status`, `publishedAt`, `slug` and the presence of test and live `newsletter_sends` rows, and every writer applies its own subset of the rules. "Never send live twice" and "send live only after a test" exist only in the `findFirst` of `runPublishNewsletter`: `POST /:id/send-live` checks nothing but the HTML, so a double click, a second editor or the job running beside a manual send emails every subscriber twice. `sendLive` records its row only after Plunk accepted the send, so a lost row lets the next run send again (F3); any old test counts as approval even after the HTML changed (F2); select, generate, HTML and `PUT` silently rewrite a sent, published issue's web edition; deleting a sent issue cascades its sends, the record the weekly guard reads. Separately, the web edition joins `##` headings to stories by the story's *current* title, so a title edit after generation, or a hand edit of a heading, unlinks the story (N2).

## Approach

**`server/src/services/newsletterLifecycle.ts` owns every move of an issue** (owner, 2026-10-25), on the `storyLifecycle.ts` model: a from-rule per move, conditional writes, typed refusals, one module that writes the lifecycle fields, held by a fence test. The weekly `publish_newsletter` job, the `generate_newsletter` job and the admin routes all call it. `services/newsletter.ts` keeps reads, `createNewsletter`, carousel, send listing and stats, and its content builders become non-writing functions the module calls (shortlist pick, markdown build, HTML render). No schema change and no migration.

### Transition table

**Frozen** := an unconfirmed live send exists (a live row in `draft`, below), **or** a live non-failed send exists and `status = 'published'`. "Live non-failed" is `isTest = false AND status <> 'failed'`, the same predicate the archive's `firstLiveSendDate` already uses.

| Move | Allowed when (else) | Writes |
|---|---|---|
| assign | not frozen (409) | `storyIds` |
| select | not frozen (409); longlist non-empty (400) | `selectedStoryIds` |
| generate | not frozen (409); shortlist non-empty (400) | `content` |
| html | not frozen (409); content non-empty (400) | `slug` if none, `html` |
| edit (`PUT /:id` fields: title, content, html, storyIds, selectedStoryIds) | not frozen (409) | those fields |
| sendTest | HTML non-empty (400); `PLUNK_TEST_SEGMENT_ID` set (409, unchanged) | test row (`sent`) after Plunk accepted, as today |
| sendLive (job or admin) | HTML non-empty (400); no live non-failed send (409 `already_sent`); a `sent` test row whose `htmlContent` equals the current `html` (409 `no_current_test`) | claim row → campaign id → confirm + publish, or `failed` (below) |
| markSendFailed (new) | a live send in `draft` (409 otherwise) | `failed` + `errorMessage` |
| publish | any; no-op when published | `status`, `slug` if none, `publishedAt` the first time (first live send date, else now: today's `publicationFields` rule, moved in) |
| unpublish | any; no-op when draft | `status = 'draft'`; `slug`, `publishedAt` and sends kept |
| delete | no live non-failed send (409) | the row, cascading test and failed sends |

Every write move runs in a transaction that first takes `SELECT id FROM newsletters WHERE id = $1 FOR UPDATE`, re-checks its rule, then writes; so moves on one issue serialize. The LLM moves (select, generate) check the rule before the model call too, so a frozen issue spends nothing, and again at the write, so an issue sent while the model ran is not overwritten (the `recordAnalysis` pattern). Refusals are `NewsletterRefusedError extends ConflictError` with a `code` (`frozen`, `already_sent`, `no_current_test`, `sent_issue`, `not_unconfirmed`) that the job maps to notices; the body stays `{ error }`. The "No HTML content" refusal becomes a `BadRequestError` (today a plain `Error`, so a 500).

### sendLive, claimed before Plunk (owner, 2026-10-25)

1. **Claim**, in one transaction under the row lock: check HTML, no live non-failed send, a current test; insert a live row `status: 'draft'`, `htmlContent: html`, no campaign id. A second caller (double click, second editor, the job) blocks on the lock, then sees the claim and is refused `already_sent`.
2. `plunk.createCampaign`, then store `plunkCampaignId` on the row (so stats work even if later steps fail). A failure here sent nothing: row → `failed` with the error, rethrow.
3. `plunk.sendCampaign(id, scheduledFor)`. A failure that proves nothing went out (`isConnectionNotEstablished(err)` from `lib/retry.ts`, or a 4xx answer) → `failed`, rethrow. Any other failure (timeout, reset, 5xx: Plunk may have accepted it) leaves the row `draft` with `errorMessage` "Plunk may have accepted this send; check the campaign in Plunk, then mark it not sent if it was not", and rethrows. The row keeps blocking a second send and freezes the issue.
4. **Confirm and publish** in one transaction: row → `sending` (`sentAt` now) or `scheduled`; issue → published with the publish move's fields. If this transaction fails, or the process dies anywhere after step 1, the row stays `draft`: blocked and frozen, never resent.
5. `markSendFailed` (`POST /:id/sends/:sendId/mark-failed`) is how an editor releases an unconfirmed row after checking Plunk.

The job's two separate steps (`sendLive`, then `updateNewsletter(status)`) become this one move.

### Decisions

Recorded as ADR-0048 (ref: `.context/decisions/0048-newsletter-lifecycle-owner.md`), decisions 1, 2 and 5 at its core.

Owner (Odin), 2026-10-25:
1. **A full `newsletterLifecycle` module** owns assign, select, generate, html, sendTest, sendLive, publish, unpublish, delete, each with a from-rule; job and routes go through it; other code may not write status or sends (fence test). *Alternatives:* guard only the send (N1 option B: covers the duplicate email, leaves edits after sending and deletes unguarded); leave it to the UI confirm dialog.
2. **sendLive claims its row before calling Plunk** and refuses with a live non-failed send or without a successful test of the current HTML; manual sends need a test too.
3. **Freeze after sending**: select, generate, html, assign refuse once the issue has gone out; changing it means unpublish, edit, republish.
4. **Story ids in generated content**, so the web edition stops matching by title.

Defaults taken by this plan (owner can overrule):
5. **Claim by row lock, not a partial unique index.** *Alternative:* `CREATE UNIQUE INDEX ... ON newsletter_sends (newsletter_id) WHERE NOT is_test AND status <> 'failed'` would hold even against a writer that bypasses the module. Rejected: Prisma 6 cannot declare a partial index in `schema.prisma`, so like `stories_embedding_idx` every later `db:migrate:create`/`db:migrate:diff` would propose dropping it and `check:migrations` would need a second guard rule; the fence test already keeps every writer inside the module, and the lock gives the same serialization there.
6. **"Current test" compares the stored `htmlContent`** of a `sent` test row with `newsletters.html` (exact string equality, in the query). *Alternative:* a content-hash column on the send row: a migration and a backfill for nothing the existing snapshot cannot already answer. Re-rendering identical HTML keeps the test valid, which is correct.
7. **The unconfirmed state reuses the existing, unused `draft` send status** (shown as "unconfirmed" in the admin). *Alternative:* a new enum value: a migration for a name.
8. **Frozen also covers the title and every `PUT` field**, not only the four build moves, since `PUT` content/html would otherwise bypass the freeze. `deleteStory`'s cleanup of `storyIds` (`storyWrites.ts`) is exempt: it removes a reference to a deleted story from the unpublished longlist.
9. **A sent issue (any live non-failed send) cannot be deleted** (409, "unpublish it to take it off the website"). Deleting an issue with only test or failed sends still works, so the generate job's cleanup of its own unbuilt drafts (two `prisma.newsletter.delete` calls in `generateNewsletter.ts`) goes through the delete move unchanged in effect.
10. **sendTest is allowed in any state** (it changes nothing the public sees) and keeps writing its row after Plunk accepted it: "a row means the test went out".
11. **Old issues fall back to title matching** per heading without a marker. *Alternative:* a backfill that rewrites stored content, including sent issues' content, matched by the same title heuristic: more risk, same result for old issues.
12. **Admin buttons are disabled from state the client derives from the send list it already loads** (`htmlContent`, `isTest`, `status` are in it), with the server's 409 as the authority. *Alternative:* the server adds a computed `lifecycle` object to `GET /:id` and every move's response: no mirrored rule, but a shared-type change and every response touched. Rejected to keep the client change minimal; the mirror is named as debt (N7) and pinned by a client test.
13. **A scheduled live send publishes the web edition at confirm**, not at the scheduled time. The admin never schedules today (`handleSendLive` passes no `scheduledFor`), so this is the simple rule until someone does.

### Owner questions (behavioral), answered

Odin answered all three on 2026-10-25 with the recommended option (Q1 A, Q2 yes, Q3 A) and approved the plan the same day.

The plan is written on the recommended answer to each; a different answer changes the named rows only.

- **Q1. What unpublishing a sent issue does.** (A, recommended) It takes the web edition down *and* re-opens editing; the issue can never be emailed again; republishing shows the edited version under the same URL and date. (B) It only takes the web edition down; a sent issue stays frozen for good, so a typo can never be fixed on the web. (C) Editing a sent issue is allowed without unpublishing. A is decision 3's wording; B changes the frozen rule to "any live non-failed send".
- **Q2. Does a manual "Send to Subscribers" also publish, as the job does?** (Yes, recommended) Sending and publishing are one move, the "View in browser" link works at once, and the freeze applies to every sent issue. (No) Publishing stays a separate click; a sent issue that was never published stays editable until it is, since the freeze's second clause needs `published`.
- **Q3. A Plunk failure after which the send may or may not have gone out (timeout, reset, 5xx).** (A, recommended) The issue is blocked as "unconfirmed" until an editor checks Plunk and presses "Mark as not sent"; a week can pass without a newsletter if nobody looks, but nobody gets two. (B) Mark it failed automatically, so the next run or click resends: no stuck issue, but a possible duplicate email to everyone (today's behavior is this, without a row). (C) Block, with no admin action: release only by a database edit.

### Story ids in content (decision 4)

`generateContent` writes each story heading as `## <headline> {story:<id>}`. A new grammar module, `services/newsletterContent.ts`, owns the three markers (`{story:<id>}`, `{feed:<id>}`, ` {issue-slug}`) for every reader:

| Reader | Today | After |
|---|---|---|
| `generateHtmlContent` (email) | `trimmed.slice(3)` as the headline | `parseStoryHeading(line).headline`, so the marker never reaches the email |
| `toWebMarkdown` (`newsletterArchive.ts`) | strips `{feed:}` and the issue slug | moved to `newsletterContent.ts`, also strips `{story:}` |
| `getPublishedIssue` (`newsletterArchive.ts`) | `headline: story.title \|\| sourceTitle` | stories loaded by the marker ids plus `selectedStoryIds`; `headline` is the heading text as it stands in `content` for a marked heading, `title \|\| sourceTitle` for an unmarked one |
| `NewsletterIssuePage.tsx` `issueComponents` | matches `##` text to `headline` | unchanged: `headline` now comes from the same content, so a title edited after generation or a hand-edited heading stays linked with its label |

The public API shape is unchanged (`headline` keeps its documented meaning, "the `##` heading this story has in `content`", which becomes literally true). The admin content preview shows the raw markers, as it already does for `{feed:}`.

### Placement

`newsletterLifecycle.ts`: "whether and how an issue's state may change", the only writer of the lifecycle fields. `newsletter.ts` keeps "what an issue says" (reads, create, LLM shortlist, markdown, HTML, carousel, stats); its builders lose their writes, so `newsletter.test.ts`'s HTML cases lose their Prisma mocks. `newsletterContent.ts`: the stored content's marker grammar, a separate reason to change shared by three readers in two modules. `newsletterArchive.ts` keeps slugs and the public queries; `publicationFields` moves into the lifecycle as the publish move's private rule. **Named debt:** `newsletter.ts` still holds both the LLM builders and the 270-line HTML template and parser (N2's structured-blocks option A would end the line parser); this plan only moves its writes out.

## Changes

| File | Change |
|------|--------|
| `server/src/services/newsletterLifecycle.ts` | **New.** The table above; claim-before-send `sendLive`; `markSendFailed`; `isFrozen`; row lock helper; `NewsletterRefusedError`. |
| `server/src/services/newsletterContent.ts` | **New.** `storyHeading(headline, storyId)`, `parseStoryHeading(line)`, `storyHeadlines(content)`, `toWebMarkdown(content)` (moved). |
| `server/src/services/newsletter.ts` | `updateNewsletter`, `deleteNewsletter`, `assignStories`, `sendTest`, `sendLive` removed (now moves). `selectStoriesForNewsletter` → `pickShortlist(newsletter)` returning ids; `generateContent` → `buildContent(selectedStoryIds)` returning markdown, headings via `storyHeading`; `generateHtmlContent` → `renderHtml(newsletter, webUrl)` returning HTML, headings via `parseStoryHeading`. `TestSegmentNotConfiguredError` moves to the lifecycle with `sendTest`. |
| `server/src/services/newsletterArchive.ts` | `publicationFields` and `firstLiveSendDate` move to the lifecycle; `toWebMarkdown` moves to `newsletterContent.ts`; `getPublishedIssue` loads stories by marker ids ∪ `selectedStoryIds` and takes `headline` from `storyHeadlines(content)`, falling back to `title \|\| sourceTitle`. |
| `server/src/routes/admin/newsletters.ts` | Every write route calls its move. `PUT /:id`: fields through `edit`, then `status` through `publish`/`unpublish` (two steps, as stories' `PUT /:id`). New `POST /:id/sends/:sendId/mark-failed`. |
| `server/src/jobs/publishNewsletter.ts` | Finds this week's issue, keeps its pre-checks (none, not built, already published or sent → the same notices), then calls `sendLive` and maps `already_sent` → "Newsletter already sent" info and `no_current_test` → "Newsletter not sent" warning ("no test email of its current HTML"). The `updateNewsletter` call goes. Header comment updated. |
| `server/src/jobs/generateNewsletter.ts` | Calls the lifecycle moves (assign, select, generate, html, sendTest); both deletes go through the delete move. |
| `server/src/test/writeFence.ts` | **New.** The scanner of `statusWriters.test.ts` (`sourceFiles`, `balanced`, `topLevelKeys`, `writtenObjects`), parameterized by model, operations and keys. *Exports:* `sourceFiles`, `prismaWrites`, `rawWrites`. Two callers, ~90 lines that must not drift. |
| `server/src/test/statusWriters.test.ts` | Uses `writeFence.ts`; same assertions. |
| `server/src/test/newsletterWriters.test.ts` | **New fence.** Outside `newsletterLifecycle.ts` (and `scripts/`, `test/`): no `newsletter.create/update/updateMany/upsert` with `status`, `publishedAt`, `content`, `html` or `selectedStoryIds`; no `newsletter.delete/deleteMany`; no `newsletterSend` create/createMany/upsert/delete/deleteMany, nor update/updateMany with `status`, `htmlContent`, `sentAt` or `plunkCampaignId`; no raw `UPDATE newsletters SET status…`, `INSERT INTO newsletter_sends`, `UPDATE newsletter_sends SET status…`. `refreshSendStats` (writes `stats`), `ensureNewsletterSlug` (`slug`), `createNewsletter` (`title`, `weekKey`) and `deleteStory` (`storyIds`) pass. |
| `server/src/test/fakePlunk.ts` | **New.** In-memory Plunk for `vi.mock('../services/plunk.js')` in db tests: records campaigns and accepted sends, scripted failures (refused before connecting, 4xx, ambiguous after acceptance). |
| `server/src/test/db/harness.ts` | Fixtures `createNewsletter({ status, html, content, selectedStoryIds, weekKey })`, `createSend({ isTest, status, htmlContent })`. |
| `shared/types/index.ts` | Comment on `PublicNewsletterIssue.stories[].headline` (from the content's marker; old issues: the story title). |
| `client/src/lib/newsletter-state.ts` | **New.** `newsletterSendState(newsletter, sends)` → `{ liveSent, unconfirmed, frozen, testCurrent }`, the server's rule mirrored for button states only. |
| `client/src/components/admin/NewsletterDetail.tsx` | When `frozen`: disable Generate Longlist, Select Stories, Generate Content, Generate HTML, both Edit buttons, Rename, the story list actions and Save, with one hint line ("Sent to subscribers. Unpublish to edit; it cannot be sent again."). Send to Subscribers disabled when `liveSent` ("Already sent") or not `testCurrent` ("Send a test of the current HTML first"). Every move's error toast shows `ApiError.message` (the 409 reason) instead of the fixed text. `SendHistory`: a live `draft` row shows an "Unconfirmed" badge, its `errorMessage`, and "Mark as not sent" behind a confirm ("Only if Plunk shows this campaign was not sent"). |
| `client/src/hooks/useNewsletters.ts` | `useSendLiveNewsletter` also invalidates `['newsletter', id]` and `['newsletters']` (it now publishes); new `useMarkSendFailed` (invalidates the sends). `testCurrent` needs nothing more: HTML changes already refresh `['newsletter', id]`, and test sends already refresh the sends. |
| `client/src/lib/admin-api.ts` | `newsletters.markSendFailed(id, sendId)`. |
| `.context/newsletter-podcast.md` | New "Issue lifecycle" section (the table, frozen, claim-before-send, unconfirmed sends); Workflow, Automated sending (steps 1–4), Sending (row order, `draft` = unconfirmed, retries), Web edition (story markers, matching, freeze), API table (mark-failed, 409s), Files. |
| `.context/decisions.md` + `.context/decisions/0048-newsletter-lifecycle-owner.md` | ADR (next free number): one module writes newsletter status and sends; live sends claimed under the row lock before Plunk; no partial index (decision 5). |
| `.context/ai-transparency.md` | Newsletter web edition row: story headings are matched by the story id in the content, so a hand-edited heading keeps its label and link; old issues by title. |
| `CLAUDE.md` | `newsletter-podcast.md` row: mention the lifecycle owner and freeze-after-send. |

## Tests

DB boundary tests with the fake Plunk replace the mocked send and job tests. **Sequencing:** the replaced mock tests count towards the unit coverage floor today; land this after the plan that makes coverage count db tests, or keep the old mock cases until then (never lower a threshold).

`server/src/services/newsletterLifecycle.db.test.ts` (new; `llm.js` mocked as in `storyLifecycle.db.test.ts`):
- a second live send is refused (`already_sent`), and Plunk sent once;
- two concurrent `sendLive` calls: one Plunk send, one refusal;
- a send whose outcome is unknown is not repeated: Plunk accepts, then the call fails ambiguously → row stays `draft`, issue frozen, the next `sendLive` is refused, no second Plunk send; after `markSendFailed` (and with the test still current) it sends;
- a send refused before connecting, or with a 4xx, is marked `failed` and a retry sends; a `createCampaign` failure is marked `failed`;
- a stale test does not unlock live send: test, then `PUT` html (or regenerate content and html) → `no_current_test`; a new test unlocks it; no test at all is refused too;
- `sendLive` publishes: status `published`, `publishedAt` equals the send's `sentAt`, slug assigned;
- a sent issue refuses regenerate, select, assign, html and `edit` (409), content unchanged; after unpublish they work; republish keeps `publishedAt` and slug;
- an issue sent while `generate`'s model call runs (the mock calls `sendLive` mid-call) keeps its content;
- an unconfirmed send freezes the issue even when unpublished;
- delete: a sent issue is refused and its sends stay; an unsent issue is deleted with its test sends;
- `markSendFailed` refuses a confirmed send and a test send;
- publish/unpublish: first publish of an emailed issue takes the send date; unpublish keeps `publishedAt` (cases moved from `newsletterArchive.test.ts` `publicationFields`);
- `sendTest` refuses without a segment and never calls Plunk, and targets only the segment (moved from `newsletter.test.ts`).

`server/src/jobs/publishNewsletter.db.test.ts` (new, replaces `publishNewsletter.test.ts`; notices read from `admin_notices`): sends and publishes this week's built draft and records "Newsletter sent"; a stale or missing test sends nothing and warns once per week; no issue, still being built, already sent or published → the existing notices; a Plunk failure fails the run and leaves the issue a draft with a `failed` row; a run after an unconfirmed send sends nothing. `newsletterSendProblem` moves with it.

`server/src/services/newsletterContent.test.ts` (new, unit): a marked heading parses to headline and id; an unmarked one to the headline and null; `toWebMarkdown` strips all three markers (case moved from `newsletterArchive.test.ts`); `storyHeadlines` pairs each marked heading with its id.

`server/src/routes/public/newsletters.test.ts`: a marked heading whose story was renamed after generation still gets that story (headline = the heading text); an unmarked heading falls back to the title.

`server/src/services/newsletter.test.ts`: the HTML cases call `renderHtml` without Prisma mocks; a marked heading renders without the marker; the `sendTest` cases are deleted (moved).

`server/src/routes/admin/newsletters.test.ts`: mock the lifecycle module; each route calls its move with the right arguments, a `NewsletterRefusedError` answers 409 `{ error }`, `PUT` with fields and status calls `edit` then the move. Delete the assign/generate/select/html cases that drove service logic through Prisma mocks (now in the db tests).

`server/src/jobs/generateNewsletter.test.ts`: repoint the mocks to the lifecycle; the cleanup assertions expect the delete move.

`server/src/test/newsletterWriters.test.ts`: no offenders; the scan finds each guarded shape and ignores `stats`, `slug`, `storyIds` and filters.

`client/src/lib/newsletter-state.test.ts`: frozen when unconfirmed or (sent and published), not when sent and unpublished; `testCurrent` only for a `sent` test whose `htmlContent` equals `html`.

## Out of Scope

- Structured issue blocks instead of markdown (N2 option A), and splitting the HTML template out of `newsletter.ts`.
- `deleteStory` cleaning `selectedStoryIds`, transactions and P2003 there (old candidate 3).
- A unique constraint on `newsletters.week_key` (deferred in the docs).
- Reading Plunk's campaign status to resolve an unconfirmed send automatically (F1's second option).
- A deliberate resend of a sent issue: refused by decision 2 with no override.
- Server-computed lifecycle state in API responses (decision 12's alternative).
- Counting db tests in coverage (separate plan).

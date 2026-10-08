---
plan-id: 2026-10-08-admin-notices
title: Keep every owner alert as an admin notice with an unseen badge, and poll Plunk for spam complaints and bounces
status: implemented
created: 2026-10-08
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [personal-data, vendor]
decisions:
  - ref: .context/decisions/0028-admin-notices-store-every-owner-alert.md
  - ref: .context/decisions/0029-poll-plunk-activity-for-complaints-and-bounces.md
type: feature
complexity: complex
---

# Admin notices

The owner's request (2026-10-08): keep `WEBHOOK_URL` optional, collect the notifications on our side, show them in the admin with a label on the ones not yet seen, and give newsletter and podcast problems the same treatment through one shared mechanism. The trigger is Plunk: the next spam complaint before about 5,800 total sends disables the account again (`DOCS/2026-10-08_plunk-suspension-review.md`, section 1), and today nobody would hear of one.

The agent made the design calls below (stubs ADR-0028 and ADR-0029, and the list under "Behavior choices for the owner"). The owner was shown them (including the reviewer's corrections) and approved the plan in session.

Confirmed by Odin Mühlenbein on 2026-10-08: ADR-0028, ADR-0029

Related plans: `.plans/completed/2026-10-06_scheduler-hardening.md` (where `notifyJobFailure` is called), `.plans/completed/2026-10-06_autonomous-two-speaker-podcast.md` (`notifyEvent` and the podcast notices), `.plans/completed/2026-10-08_newsletter-signup-hardening.md` (the signup cap alert). `.plans/2026-10-08-paywalled-stories.md` touches none of the same files.

Planning note: the plan skill asks for parallel explorer, architect and reviewer agents on a complex task. This plan was written by a sub-agent with no agent tool, so the research, the comparison of alternatives and the review against the simplicity criteria were done in one context.

## Problem

`server/src/lib/notify.ts` posts job failures (`notifyJobFailure`, 2 callers in `scheduler.ts`) and events (`notifyEvent`, 6 callers: podcast ready, published, waiting, missed week, configuration incomplete, signup cap), 8 call sites in all, to `WEBHOOK_URL`, and drops them when it is unset. That is the production setup, so these alerts reach nobody. Several workarounds make up for it: the Jobs page's `AlertChannelWarning`, `GET /api/admin/jobs/alert-channel`, a warning logged at boot, and a Friday podcast slot that fails again so that the Jobs page keeps showing the error. Plunk spam complaints and bounces never reach our side at all (review, section 3).

## Approach

**One store, one entry point.** A new `admin_notices` table holds every alert. `notify(input)` in `lib/notify.ts` replaces `notifyJobFailure` and `notifyEvent`. It records the notice and then, when `WEBHOOK_URL` is set, posts it to the webhook as today (`content`, `text`, `title`, `message`, plus `source`, `severity`, and the absolute link appended to the text). The two steps fail independently: each logs and never throws, so the scheduler's boot alert, sent while the database is down, still reaches the webhook. Without a webhook that alert cannot be stored (the database is what is down), so `attemptStart` also records a `jobs` / `warning` notice once it does start after an alert ("scheduler started after N failed attempts: <first reason>", key `job-failure:scheduler`, the success branch that today only logs). Without that, production, which has no webhook, would never learn the scheduler was down. With `WEBHOOK_URL` unset nothing else changes: it stays optional and nothing checks for it.

**Fields** (Prisma model `AdminNotice`, table `admin_notices`):

| Field | Notes |
|---|---|
| `id` | uuid |
| `source` | text, one of `jobs`, `newsletter`, `podcast`, `subscriptions`, `plunk` (a TypeScript union checked in `recordNotice`, not a Postgres enum, so a new source, which the owner expects, needs no migration) |
| `severity` | text, one of `critical`, `warning`, `info` (same) |
| `title` | short, fixed per kind of notice |
| `message` | plain text, truncated to 2,000 characters (job errors can carry Prisma meta) |
| `link` | optional admin path, relative (`/admin/podcasts/<id>`); the page renders it as a router link, and the webhook text gets `config.clientUrl` + link |
| `dedupeKey` | optional, unique where set |
| `count` | occurrences folded into this row, default 1 |
| `firstOccurredAt`, `lastOccurredAt` | database clock |
| `seenAt` | null = unseen |

Indexes: unique on `dedupe_key`; `(seen_at, last_occurred_at)` for the badge and the list.

**Dedupe rule** (ADR-0028). A notice without a key always makes a new row. A notice with a key that already has a row updates that row: `count + 1`, new `lastOccurredAt`, new message and severity, and `seenAt = null`, so a recurring problem comes back as unseen but stays one row. This is a single upsert (`INSERT … ON CONFLICT (dedupe_key) DO UPDATE`), so two processes cannot create two rows. `recordNotice(input, { reopen: false })` uses `ON CONFLICT DO NOTHING` instead, for events that must be recorded once and never reopened (the Plunk poll). Rejected: a new row per occurrence (a failing crawl every 6 hours fills the list), and collapsing only while unseen (needs a partial unique index and gives two rules to explain).

**Seen state is global** (ADR-0028): one `seenAt` per notice, not one per admin. The admin is effectively one person. Editors also reach the admin API, and if one of them marks a notice seen, it is seen for the owner too. Per-admin state would need a join table for a case that does not occur today.

**Retention.** `recordNotice` deletes seen notices whose `lastOccurredAt` is older than 90 days (`config.notices.retentionDays`) in the same call. Writes are a handful a week, so this costs nothing and needs no job. Unseen notices are never pruned. When no notices arrive, nothing is pruned, which is harmless because nothing grows either.

**No personal data.** No caller puts a subscriber's address into a notice, following the convention for the signup cap alert (`.context/subscription.md`, step 7). The Plunk poller drops `contactEmail` and `contactId`, and also the bounce `error` text, because an SES diagnostic can quote the address. It keeps only the activity id, type, timestamp, `subject`, `campaignName` and `sourceType`. The activity id (`<emailId>_complaint`) is Plunk's reference to one recipient's email, so the dedupe key is pseudonymous personal data: it is needed to record each event once, it never leaves the table, and it goes with the row under the retention rule. `.context/admin-notices.md` says so.

**Plunk complaints and bounces** (ADR-0029). A new job, `poll_plunk_activity`, seeded enabled at `20 * * * *` (hourly):
1. With no `PLUNK_SECRET_KEY` it logs at info level and returns.
2. Window: every run reads the trailing 30 days (`config.plunk.activityLookbackDays`), whatever happened on earlier runs. No high-water mark: a run that failed, a job disabled for a week, a run that returned early without a key, or a complaint Plunk records hours late are all caught by the next run, and the first run needs no special case. Events are recorded once by id, so the overlap costs only the fetch (a few pages; 26 complaint and bounce events in the account's whole history). Rejected: starting at `lastSucceededAt` minus a day. `last_succeeded_at` also advances on a run that returned early without a key, and after a long pause the window would reach past the 90-day retention and recreate pruned notices.
3. It pages `GET /activity?types=email.complaint,email.bounced&startDate=…&limit=20&cursor=…` through a new `listActivity()` in `plunk.ts`, wrapped in `withRetry` like every Plunk call, with a 5 MB response cap for this call only (per-request `maxContentLength`). Each item carries the email's `body` in `metadata`, and the client's 1 MB cap would cut off a page of newsletter bodies. The poller stops after 20 pages and logs a warning when it hits that limit. The shared client's response interceptor replaces a body shaped `{ success, data, … }` with its `data`, which would drop a sibling `cursor` or `hasMore`; `listActivity` must read the pagination fields before that happens (its own request without the interceptor, or the raw response), or paging silently stops after page one.
4. For each item it records, insert-only (`recordNotice(…, { reopen: false })`, dedupe key `plunk:<activity id>`), so an event fetched again is skipped and a seen notice is never reopened:
   - **complaint**: severity `critical`, source `plunk`, title "Spam complaint in Plunk", and a message naming the email (campaign name, or "transactional: <subject>"), the time, and the stakes ("one more complaint before about 5,800 total sends disables the Plunk project; see DOCS/2026-10-08_plunk-suspension-review.md"). Link `/admin/subscribers`.
   - **bounce**: severity `warning`, title "Email bounced (permanent)", the same fields.
5. A failure throws, so the scheduler records it as a `jobs` notice like any other job failure.

Plunk sets `bouncedAt`, the field this activity type reads, only for a permanent bounce or one of unknown type. A transient bounce never appears in this feed, so no filter is needed (Plunk source: `apps/api/src/controllers/Webhooks.ts`, Bounce branch). The response shape comes from Plunk's open-source code (`ActivityService.getActivities`: `{ data: Activity[], cursor?, hasMore }`, items `{ id: "<emailId>_complaint", type, timestamp, contactEmail, contactId, metadata }`). The hosted API at `config.plunk.baseUrl` has not been checked against it, so the implementation includes a live, read-only call (see "Order of work"). Besides the shape, that call settles whether `startDate` filters on the event's time (`complainedAt`/`bouncedAt`) or on the email's send time. A recipient can mark a newsletter as spam days after it went out; the 30-day window covers that in either case, but `.context/admin-notices.md` should record which it is. `parseActivityResponse` reads the shape tolerantly in the way `parseContactsResponse` does: a bare array, or `data`/`items`/`activities`, with `cursor`/`nextCursor`. When it finds no array, it logs a warning naming the keys it got and then fails the run, so a changed shape shows up as a job-failure notice instead of passing silently as "no complaints". The hosted API allows `GET` while the project is disabled (`middleware/auth.ts`: only POST, PUT, PATCH and DELETE are refused), so the poll keeps working during a suspension.

Rejected for ADR-0029:
- **A Plunk webhook workflow.** It is not retried, it is cancelled once the project is disabled (exactly when it matters), and it would need a public endpoint with its own secret.
- **Email alerts through Plunk** (BACKLOG.md line 21). They cannot report that Plunk itself is disabled, and they count toward the reputation they would be guarding.
- **Polling `/campaigns/:id/stats`.** It gives counts per campaign, and transactional confirmation emails have no campaign.

**Where the existing alerts go**, with the source and severity each gets:

| Caller | Source / severity | Dedupe key | Link |
|---|---|---|---|
| `scheduler.ts` `runJob` failure | by job: `generate_newsletter` → `newsletter`, `generate_podcast`/`publish_podcast` → `podcast`, else `jobs` / `warning` | `job-failure:<jobName>` | `/admin/podcasts` or `/admin/newsletters` for those, else `/admin/jobs` |
| `scheduler.ts` boot retry (cannot start) | `jobs` / `critical` | `job-failure:scheduler` | `/admin/jobs` |
| `podcastWeekly.ts` episode ready | `podcast` / `info` | none | `/admin/podcasts/<id>` |
| `publishPodcast.ts` episode published | `podcast` / `info` | none | episode |
| `generatePodcast.ts` waiting for you | `podcast` / `info` | none (already once per episode) | episode |
| `podcastMissedWeek.ts` missed week | `podcast` / `warning` | none (already claimed per week) | episode or list |
| `podcastBootCheck.ts` configuration incomplete | `podcast` / `warning` | `podcast-config` | `/admin/jobs` |
| `subscribeLimits.ts` signup cap | `subscriptions` / `warning` | `signup-cap` | `/admin/subscribers` |

Callers that today embed `Open: <url>` in the message pass `link` instead. The job-to-source mapping is a small private function in `notify.ts`, `jobFailureNotice(jobName, error)`, exported for the scheduler.

**New newsletter and podcast notices.** Only one new failure point is both actionable and silent today:
- `generateNewsletter.ts`: "no recent published stories, skipping" returns quietly, so a stalled pipeline means a week with no newsletter and no word about it. It now records `newsletter` / `warning` "No newsletter this week", with the message "no story was published in the last N days; check the Jobs page (crawl, assess, publish)", N being `config.content.storyAssignmentDays` (default 7, the window the count uses), dedupe key `newsletter-no-stories:<weekKey>` (compute `getWeekKey(now)` before the early return; today it is computed after it), and link `/admin/jobs`.

Considered and left out: a "newsletter ready" notice, since the job's test send already puts the built issue in the owner's inbox (a failed test send fails the job and becomes a notice); generation, selection and test-send failures, a missing `PLUNK_TEST_SEGMENT_ID`, and a Plunk `PROJECT_DISABLED` answer on send. All of them already fail the job, so they arrive as job-failure notices with the error text. Podcast blocks (spend cap, ElevenLabs credits or refusal, too few stories, invalid dialogue, missing configuration) also fail `generate_podcast` once on the cron trigger. On an admin-triggered run the person sees them in the toast and the banner. The newsletter's intro fallback is cosmetic and its fix is not obvious, so it is not actionable.

**What the admin now has, so the "no channel" workarounds go.** A notice now always has somewhere to go, so this plan removes:
- `AlertChannelWarning` and its test;
- `useAlertChannel`, `adminApi.jobs.alertChannel` and `GET /api/admin/jobs/alert-channel` with its test;
- `hasAlertChannel()`;
- the boot warning in `podcastBootCheck.ts`;
- the `stillBlocked && !hasAlertChannel()` rethrow in `generatePodcast.ts`. Later Friday slots now skip a blocked episode quietly, as they already did with a webhook set. The block's notice stays unseen until the owner opens it.

`stillBlocked` stays on the `runWeeklyEpisode` result only if another reader remains. The implementer removes it when nothing reads it.

**Admin UI** (`.context/admin-dashboard.md` patterns):
- **Notices page** `/admin/notices`. A list ordered by `lastOccurredAt` desc, paginated at 25, with filters in the URL: `?source=` (all, or one of the five) and `?show=unseen|all` (default `all`). Each row shows a severity chip (critical red, warning amber, info neutral), the source, title, message (expandable as on the Feedback page), "×N" when `count > 1`, relative time with the full time as `title`, and the link. An unseen row gets a tinted background and an **"Unseen"** `Badge`, so the state is carried by text and not by color alone. Actions: **Mark seen** per row, and expanding a row also marks it, as Feedback does. **Mark all seen** in the header applies to the current source filter and sits behind no confirm, because it is reversible in effect: a recurrence reopens the notice. No delete, since retention handles cleanup.
- **Nav badge.** "Notices" in the sidebar with the unseen count, polled every 60 s as the feedback count is. The badge is red while any unseen notice is `critical` and brand-colored otherwise; because color alone must not carry that, the link gets an accessible name such as "Notices, 3 unseen, 1 critical" (`.context/accessibility.md`). `NavItems` gets a `badgeCounts` map in place of its single `unreadFeedbackCount` prop, so Feedback and Notices share the one badge element.
- **Dashboard card.** "Unseen notices" at the top of `DashboardPage`, above "Stories by Status": up to 5 unseen notices (severity chip, title, time) and a link to the page. The card is hidden when there are none.

**API** (`routes/admin/notices.ts`, under the admin router's existing `requireAuth` + `requireRole('admin','editor')`):
- `GET /api/admin/notices?source&show&page&limit` → `{ items, total, page, limit, unseenCount }`
- `GET /api/admin/notices/count` → `{ unseen, unseenCritical }`
- `POST /api/admin/notices/:id/seen` → the row (404 for an unknown id)
- `POST /api/admin/notices/seen` with an optional `{ source }` → `{ affected }`

These are not public endpoints, so `openapi.ts` does not change.

**Order of work.**
1. Schema, migration and store, then `notify()` and the callers.
2. **The job, then verify Plunk's activity API (read-only).** Add `listActivity`, `parseActivityResponse` and `poll_plunk_activity` (handler and seeded row: the Run button needs both, and `claimJobRun` throws for a job without a row). Ask the user to restart the dev server so `db:prepare` applies the migration and regenerates the client, then run the job once from the Jobs page with the local server's Plunk key. The run logs at info level the raw response's top-level keys (before the interceptor), the item keys, the `metadata` keys and the count, never an item's values, and whether the items' timestamps fall inside `startDate` by event time or send time. It only sends GET requests to Plunk. If the shape differs from the open-source one, adjust the parser and its tests before going on, and remove the key log once the shape is confirmed (the unrecognized-shape warning stays). If the local environment has no Plunk key, the owner runs it once on the production API via the Run button after deploy and reads the log line; the failure on a bad shape (above) covers the gap until then.
3. The admin API and UI, then removing the workarounds, then the docs.

## Changes

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `AdminNotice` model (`source` and `severity` as `String`) |
| `server/prisma/migrations/<ts>_admin_notices/migration.sql` | Create the table with its indexes; seed the `poll_plunk_activity` job row (enabled, `20 * * * *`, `ON CONFLICT DO NOTHING`). Seeding it enabled departs from the podcast rows, which were seeded disabled; it is read-only and does nothing without `PLUNK_SECRET_KEY`. No `last_completed_at` is needed: `estimateCronIntervalMs` returns null for an hour field of `*`, so the boot catch-up never runs it. Authored with `db:migrate:create`; delete any `DROP INDEX "stories_embedding_idx"` |
| `server/src/services/adminNotices.ts` (new) | *Responsibility:* the `admin_notices` table: record with the dedupe upsert (or insert-only with `{ reopen: false }`) and pruning, list, count, mark seen. *Exports:* `recordNotice`, `listNotices`, `countUnseenNotices`, `markNoticeSeen`, `markNoticesSeen`, `NoticeInput`, `NoticeSource`, `NoticeSeverity` |
| `server/src/lib/notify.ts` | Replace `notifyJobFailure`/`notifyEvent`/`hasAlertChannel` with `notify(input)` (record, then forward to the webhook; each step logs and never throws) and `jobFailureNotice(jobName, error)` (source, link and dedupe key by job) |
| `server/src/config.ts` | `notices: { retentionDays: 90 }`; `plunk.activityLookbackDays` (30), `plunk.activityPageLimit` (20), `plunk.activityMaxPages` (20), `plunk.activityMaxResponseBytes` (5 MB) |
| `server/src/jobs/scheduler.ts` | The two calls go through `notify(jobFailureNotice(…))`; the boot alert passes `severity: 'critical'`; a start after an alert records the "scheduler started after N failed attempts" notice |
| `server/src/services/podcastWeekly.ts`, `jobs/publishPodcast.ts`, `jobs/generatePodcast.ts`, `services/podcastMissedWeek.ts`, `jobs/podcastBootCheck.ts`, `services/subscribeLimits.ts` | Call `notify()` with the source, severity, link and key from the table; `generatePodcast.ts` drops the `stillBlocked` rethrow; `podcastBootCheck.ts` drops the channel warning |
| `server/src/jobs/generateNewsletter.ts` | The no-stories skip records the "No newsletter this week" notice |
| `server/src/services/plunk.ts` | `listActivity({ types, startDate, cursor, limit })` with `withRetry`, the per-call response cap and pagination read before the `{ success, data }` interceptor unwraps the body, `parseActivityResponse` (exported for tests), and `PlunkActivity` type. Same responsibility as the file: Plunk API access |
| `server/src/jobs/pollPlunkActivity.ts` (new) | *Responsibility:* turn new Plunk complaints and permanent bounces into notices without personal data. *Exports:* `runPollPlunkActivity`, `activityNotice` (pure mapping, for tests) |
| `server/src/jobs/handlers.ts` | Register `poll_plunk_activity`; add it last in `JOB_PIPELINE_ORDER` |
| `shared/types/index.ts`, `shared/constants/index.ts` | `poll_plunk_activity` in `JobName` and `JOB_NAMES` (the server keeps its own lists and does not import `shared/`); the client's `AdminNotice` type in `admin-api.ts`, as `FeedbackItem` is |
| `server/src/routes/admin/notices.ts` (new) | *Responsibility:* admin HTTP API for notices. *Exports:* default router |
| `server/src/routes/admin/index.ts` | Mount `/notices` |
| `server/src/routes/admin/jobs.ts` | Remove `/alert-channel` |
| `client/src/lib/admin-api.ts` | `notices.list/count/markSeen/markAllSeen`; remove `jobs.alertChannel` |
| `client/src/lib/constants.ts` | `JOB_DISPLAY_NAMES.poll_plunk_activity = 'Plunk Complaints'`; `JOB_PIPELINE_ORDER` |
| `client/src/hooks/useNotices.ts` (new) | *Responsibility:* TanStack Query hooks for notices. *Exports:* `useNotices`, `useNoticeCount`, `useMarkNoticeSeen`, `useMarkNoticesSeen` (both mutations invalidate `['admin','notices']` and `['noticeCount']`) |
| `client/src/hooks/useJobs.ts` | Remove `useAlertChannel` |
| `client/src/pages/admin/NoticesPage.tsx` (new) | *Responsibility:* the notices list with filters and seen actions. *Exports:* default page |
| `client/src/components/admin/UnseenNoticesCard.tsx` (new) | *Responsibility:* the dashboard's unseen-notices summary. *Exports:* `UnseenNoticesCard` |
| `client/src/pages/admin/DashboardPage.tsx` | Render `UnseenNoticesCard` |
| `client/src/App.tsx` | Lazy route `notices` |
| `client/src/layouts/AdminLayout.tsx` | Nav item "Notices" (`BellAlertIcon`); `badgeCounts` map; the notice count query |
| `client/src/components/admin/AlertChannelWarning.tsx` + test, `client/src/pages/admin/JobsPage.tsx` | Delete the warning; remove its use |
| `server/env.example` | `WEBHOOK_URL` comment: optional, forwards notices that are always kept in the admin |
| `.context/admin-notices.md` (new) | The store, fields, sources and severities, dedupe and reopen rule, global seen, retention, no personal data, webhook forward, the caller table, the Plunk poll (window, idempotency, shape check, what it drops), troubleshooting ("no complaint notices": key unset, job disabled, a shape-warning notice) |
| `.context/scheduler.md` | "Failure notifications" → notices; remove the alert-channel endpoint and warning; add `poll_plunk_activity` to Registered Jobs; Key Files row for `notify.ts` |
| `.context/podcast.md` | Lines 74, 76, 82, 83, 85, 217 and Troubleshooting: notices in the admin, optional webhook; the "still blocked" refail and `AlertChannelWarning` removed |
| `.context/subscription.md` | Step 7: the cap alert is a notice (`subscriptions`), forwarded when `WEBHOOK_URL` is set |
| `.context/newsletter-podcast.md` | Automated generation step 1: the no-stories notice |
| `.context/admin-dashboard.md` | Route list (`/admin/notices`), nav badges, the dashboard card, the page's patterns |
| `CLAUDE.md` | Context table row for `admin-notices.md` |
| `BACKLOG.md` | Delete line 21 (email alerts through Plunk): notices cover it, and email through Plunk could not report a disabled Plunk |
| Tests | See below; update mocks in `scheduler.test.ts`, `podcastWeekly.test.ts`, `publishPodcast.test.ts`, `generatePodcast.test.ts`, `podcastMissedWeek.test.ts`, `podcastBootCheck.test.ts`, `subscribeLimits.test.ts`, `routes/admin/jobs.test.ts` |

## Tests

Server (Vitest, `vi.hoisted()` mocks, `supertest` + `authHeader()` for routes):
- `services/adminNotices.test.ts`: a notice without a key inserts each time; one with a key inserts once, then a repeat raises `count`, moves `lastOccurredAt`, replaces the message and clears `seenAt`; with `{ reopen: false }` a repeat changes nothing (a seen row stays seen); an unknown source or severity is refused; the message is truncated at 2,000; pruning deletes seen rows older than the retention and keeps unseen ones of any age and seen recent ones; `markNoticesSeen` with a source touches only that source.
- `lib/notify.test.ts`: records and forwards when `WEBHOOK_URL` is set; records and does not post without it; a failed record still posts and a failed post still resolves (neither throws); the webhook text carries the absolute link. `jobFailureNotice`: newsletter and podcast jobs map to their source and link, others to `jobs`; the key is `job-failure:<name>`.
- `services/plunk.test.ts` (`parseActivityResponse`): the open-source shape, a bare array, `items`, `nextCursor`, missing `hasMore`; an unrecognized shape is reported as such. `listActivity`: a `{ success, data, cursor, hasMore }` body keeps its cursor.
- `jobs/pollPlunkActivity.test.ts`: no secret key → no call; `startDate` is now − 30 days on every run; pages until `hasMore` is false and stops at the page cap with a warning; every notice is recorded insert-only (`reopen: false`); a complaint becomes `critical` and a bounce `warning`; the notice holds no `contactEmail`, no `contactId` and no `error` text (assert that the address in the fixture appears nowhere in the recorded input); an unrecognized shape fails the run.
- `jobs/generateNewsletter.test.ts`: no recent stories → one notice with the week's key and no newsletter row.
- `jobs/scheduler.test.ts`: after the boot alert, a later successful start records the "scheduler started after earlier failures" notice; a start with no earlier alert records none.
- `jobs/generatePodcast.test.ts`: a still-blocked episode on a later slot returns without throwing (replaces the two `hasAlertChannel` cases).
- `routes/admin/notices.test.ts`: list filters by source and `show=unseen`, paginates, returns `unseenCount`; count returns `unseen` and `unseenCritical`; mark one seen (404 unknown id); mark all with and without a source; an unauthenticated request gets 401.
- Existing caller tests: assert `notify` is called with the source, severity and key from the table in place of the old `notifyEvent` payload assertions.

Client (Vitest + RTL, `renderAdminRoutes`):
- `NoticesPage.test.tsx`: an unseen row shows the "Unseen" label and a seen row does not; changing the source filter writes `?source=` and refetches; Mark seen and Mark all seen call the API and invalidate the count.
- `AdminLayout` badge: the count shows on Notices, and the critical variant shows when `unseenCritical > 0`. The existing Feedback badge still shows.
- `UnseenNoticesCard`: hidden with none, lists at most 5.

## Out of Scope

- Replacing `podcast_missed_week_alerts` or `review_reminder_sent_at` with dedupe keys. Both already make their notice once-only and work.
- Detecting that the Plunk project is disabled from a read-only call. A failed newsletter send already arrives as a job-failure notice.
- Tracking unsubscribes, opens or the running complaint rate from the activity feed.
- Per-admin seen state, deleting notices by hand, and email or push delivery of notices.
- Redacting addresses inside arbitrary job error text. No current error message carries one. `.context/admin-notices.md` states the rule for new callers.

## Behavior choices for the owner

- Seen state is shared by everyone with admin access (global), not per person.
- A recurring problem with the same key stays one row with a count and comes back as unseen, rather than adding a row each time.
- Seen notices are deleted after 90 days; unseen ones are kept until seen.
- Every spam complaint is a separate `critical` notice; every permanent bounce is a separate `warning` notice (no daily summary). Transient bounces never appear (Plunk does not list them).
- Plunk is polled hourly (at :20); a complaint can take up to about an hour to show.
- Every poll looks back 30 days, so the six complaints from May never appear as notices, and a complaint missed while the job was down or disabled shows up on the next run as long as it is less than 30 days old.
- The Notices badge counts all unseen notices, `info` ones (episode ready or published) included, and turns red only while a `critical` one is unseen.
- "Mark all seen" asks for no confirmation and applies to the current source filter.
- The "no alert channel" workarounds go: the Jobs page warning, the boot warning, and the Friday slot that fails again for a still-blocked episode (the block's notice stays unseen instead).
- Job failures are filed under Newsletter or Podcast when the job belongs to them, otherwise under Jobs.
- New: a "No newsletter this week" warning when the Saturday job finds no story published in the last 7 days (today it skips silently).
- Editors, who can already open the admin, see the notices and can mark them seen.
- The "Unseen notices" card is the first thing on the Dashboard, above the story counts.
- When the scheduler could not start (database down at boot), an "it started again after N failed attempts" warning is recorded once it does start, since the alert itself could not be stored then.

# Admin notices

Every owner alert (job failures, podcast and newsletter notices, the signup cap, Plunk spam complaints and bounces) is kept as a row in `admin_notices` and shown in the admin with an unseen badge (ADR-0028). `WEBHOOK_URL` is optional: when set, each notice is also forwarded there; nothing checks for it. Admin UI patterns: `.context/admin-dashboard.md`.

## Rules and guarantees

- **One entry point.** Code raises an alert only through `notify(input, options?)` (`server/src/lib/notify.ts`). It records the notice (`recordNotice`, `services/adminNotices.ts`), then forwards it to `WEBHOOK_URL` if set. The two steps fail independently and neither throws: an alert sent while the database is down (the scheduler's boot alert) still reaches the webhook, and a failed post never loses the stored notice.
- **Fields**: `source` (`jobs`, `newsletter`, `podcast`, `subscriptions`, `plunk`), `severity` (`critical`, `warning`, `info`), `title` (fixed per kind of notice), `message` (plain text, cut at 2,000 characters), `link` (a relative admin path, rendered as a router link; the webhook gets `config.clientUrl` + link), `dedupeKey`, `count`, `firstOccurredAt`, `lastOccurredAt` (database clock, UTC), `seenAt` (null = unseen). Source and severity are plain text checked in TypeScript, not Postgres enums, so a new source needs code only (add it to `NOTICE_SOURCES` on the server and `ADMIN_NOTICE_SOURCES` in `client/src/lib/admin-api.ts`, plus its label in `NoticeDisplay.tsx`).
- **Dedupe and reopen.** No key: every call is a new row. With a key, one row per key: a repeat raises `count`, moves `lastOccurredAt`, replaces severity, title, message and link, and sets `seenAt` back to null, so a recurring problem comes back unseen but stays one row. It is one `INSERT … ON CONFLICT (dedupe_key) DO UPDATE`, so two processes cannot make two rows. **Insert-only** (`notify(n, { reopen: false })`, `ON CONFLICT DO NOTHING`): a repeat changes nothing and is not forwarded again; for events recorded once and never reopened (the Plunk poll).
- **Seen is global**, one `seenAt` per notice: anyone with admin access (admins and editors) who marks a notice seen marks it for everyone.
- **Retention**: each `recordNotice` call deletes seen notices whose `lastOccurredAt` is older than `config.notices.retentionDays` (90). Unseen notices are never pruned. No job is needed.
- **No personal data in a notice.** No caller puts a subscriber's address (or any other person's data) in a title or message. A new caller must keep it that way, and must not pass arbitrary third-party error text that can quote an address (an SES bounce diagnostic does). Job error text is passed as it is: no current job error carries an address. The Plunk activity id in a Plunk notice's dedupe key (`plunk:<emailId>_complaint`) is Plunk's reference to one recipient's email, so it is pseudonymous personal data: it is needed to record each event once, it never leaves the table and the admin, and it goes with the row under the retention rule.

## Who raises which notice

| Caller | Source / severity | Dedupe key | Link |
|---|---|---|---|
| `scheduler.ts` `runJob` failure (`jobFailureNotice`) | `generate_newsletter` → `newsletter`; `generate_podcast`, `publish_podcast` → `podcast`; else `jobs`; `warning` | `job-failure:<jobName>` | `/admin/newsletters`, `/admin/podcasts`, else `/admin/jobs` |
| `scheduler.ts` boot retry: cannot start | `jobs` / `critical` | `job-failure:scheduler` | `/admin/jobs` |
| `scheduler.ts`: started after that alert | `jobs` / `warning` ("scheduler started after N failed attempts: …") | `job-failure:scheduler` | `/admin/jobs` |
| `podcastWeekly.ts` episode ready | `podcast` / `info` | none | `/admin/podcasts/<id>` |
| `publishPodcast.ts` episode published | `podcast` / `info` | none | episode |
| `generatePodcast.ts` waiting for you | `podcast` / `info` | none (claimed once per episode) | episode |
| `podcastMissedWeek.ts` missed week | `podcast` / `warning` | none (claimed once per week) | episode or list |
| `podcastBootCheck.ts` configuration incomplete | `podcast` / `warning` | `podcast-config` | `/admin/jobs` |
| `subscribeLimits.ts` signup cap | `subscriptions` / `warning` | `signup-cap` | `/admin/subscribers` |
| `generateNewsletter.ts` no stories this week | `newsletter` / `warning` | `newsletter-no-stories:<weekKey>` | `/admin/jobs` |
| `pollPlunkActivity.ts` spam complaint | `plunk` / `critical` | `plunk:<activity id>` (insert-only) | `/admin/subscribers` |
| `pollPlunkActivity.ts` permanent bounce | `plunk` / `warning` | `plunk:<activity id>` (insert-only) | `/admin/subscribers` |

## The Plunk complaint and bounce poll (ADR-0029)

Why: one more spam complaint before about 5,800 total sends disables the Plunk project (`DOCS/2026-10-08_plunk-suspension-review.md`). Plunk's webhooks are unretried dashboard workflow steps that stop once the project is disabled, so the job polls instead.

- Job `poll_plunk_activity`, `20 * * * *` (hourly), seeded **enabled** by migration `20261008130214_admin_notices`. Without `PLUNK_SECRET_KEY` it logs at info level and returns.
- **Window**: every run reads the trailing `config.plunk.activityLookbackDays` (30), whatever earlier runs saw. No high-water mark: a failed run, a job disabled for a week, a run without a key or an event Plunk records late is caught by the next run. Events are recorded once by id (insert-only), so the overlap costs only the fetch, and a seen notice is never reopened. Complaints older than 30 days (the six from May 2026) never appear.
- **Fetch**: `listActivity` (`services/plunk.ts`) sends `GET /activity?types=email.complaint,email.bounced&startDate=…&limit=20&cursor=…` with `withRetry`, through its own axios client: the shared client's response interceptor unwraps `{ success, data }` and would drop a `cursor` beside `data`, silently ending paging after page one. That client allows 5 MB responses (`activityMaxResponseBytes`), since each item carries the email's body. A run that reaches `activityMaxPages` (20) pages **fails** (notices already recorded are kept), so a complaint beyond the cap, for example if the hosted API ignored the `types` filter, shows up as a job-failure notice instead of passing as "nothing new". GET works while the project is disabled.
- **Shape**: `parseActivityResponse` reads Plunk's open-source shape (`{ data: Activity[], cursor?, hasMore }`, items `{ id: "<emailId>_complaint", type, timestamp, contactEmail, contactId, metadata }`) tolerantly: a bare array, or `data`/`items`/`activities`, with `cursor`/`nextCursor`, once nested in an envelope. When it finds no array it logs a warning naming the keys and **fails the run**, so a changed shape shows up as a job-failure notice instead of passing as "no complaints". An item without an id also fails the run.
- **What it keeps**: the activity id (in the key), type, timestamp and the email's `campaignName`, or `sourceType` and `subject` for a transactional email. It drops `contactEmail`, `contactId`, the body and a bounce's `error` text.
- **Only permanent bounces**: Plunk sets `bouncedAt`, which this activity type reads, only for a permanent bounce or one of unknown type, so a transient bounce never appears.
- **Not yet confirmed against the hosted API** (2026-10-08). Each page logs at info level `listActivity: page shape`: the response's top-level keys, the first item's keys and `metadata` keys, the count, `startDate` and the oldest item timestamp, never an item's values. Once a live run confirms the shape, remove that log (the unrecognized-shape warning stays) and record here whether `startDate` filters on the event's time or the email's send time. Either way the 30-day window covers a recipient who marks a newsletter as spam days later.

## Troubleshooting

- **No complaint notices**: `PLUNK_SECRET_KEY` unset (the run logs `PLUNK_SECRET_KEY not set`), the job disabled on the Jobs page, or an unrecognized-shape failure (a `jobs` notice "Job poll_plunk_activity failed" naming the keys).
- **A notice keeps coming back unseen**: its key recurs (a job failing every run, the signup cap). Fix the cause; marking it seen only hides it until the next occurrence.
- **A problem but no notice**: recording failed (logged `failed to record admin notice`, e.g. the database was down); with `WEBHOOK_URL` set the forward still went out.

## Key files

| File | Role |
|---|---|
| `server/src/services/adminNotices.ts` | The table: record (dedupe upsert or insert-only, prune), list, count, mark seen |
| `server/src/lib/notify.ts` | `notify()` and `jobFailureNotice()` |
| `server/src/jobs/pollPlunkActivity.ts` | Plunk complaints and bounces → notices |
| `server/src/routes/admin/notices.ts` | `GET /api/admin/notices?source&show&page&limit`, `GET /count`, `POST /:id/seen` (404 for an unknown id), `POST /seen` with optional `{ source }` |
| `client/src/pages/admin/NoticesPage.tsx`, `components/admin/UnseenNoticesCard.tsx`, `hooks/useNotices.ts` | The admin page, the Dashboard card, the query hooks |

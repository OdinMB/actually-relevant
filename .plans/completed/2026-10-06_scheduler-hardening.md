---
plan-id: scheduler-hardening
title: Keep the scheduler alive through database errors, and fix the social candidate filter and the weekly newsletter guards
status: implemented
created: 2026-10-06
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: []
decisions: []
type: bugfix
complexity: complex
---

# Scheduler and weekly-job hardening

Owner-approved scope of 2026-10-06. It lands before `.plans/autonomous-two-speaker-podcast.md`. The evidence is the verified scheduler audit of 2026-10-06; its line references are restated here where a change depends on them.

## Problem

A database error at the wrong moment can crash the whole server. The start write in `runJob` (`server/src/jobs/scheduler.ts:153`) sits outside the `try`, and the error-path write (`:173`) can throw too. Cron and boot callbacks (`:35-37`, `:44`, `:205-207`) drop the promise, so the rejection goes unhandled and Node exits. If the database is still down at restart, `initScheduler` fails once (`server/src/index.ts:21-23`), is never retried, and no job runs until the next deploy. Nothing alerts anyone. Three smaller faults sit in the same jobs:
- With one social channel enabled, the auto-post job can pick a story it already posted there, post nothing, and still report success.
- A newsletter run that is killed mid-pipeline blocks the rest of its ISO week.
- A Sunday catch-up run produces a second issue six days later.
- When `PLUNK_TEST_SEGMENT_ID` is unset, the "[TEST]" email goes to every subscriber.

## Approach

### 1. Scheduler: `runJob` never rejects, and boot retries

- **`runJob` contract: it resolves, always.** The start write (`lastStartedAt`, `lastError: null`) moves inside the `try`.
  - When the start write, the handler or the completion write throws, the `catch` builds the error message as it does today and logs it. It then calls a new private `recordFailure(jobName, errorMsg)`, which wraps the error-path `jobRun.update` in its own try/catch and logs `failed to record job failure` at error level. Finally it calls `notifyJobFailure`.
  - The `finally` always removes the job from `runningJobs`.
  - A failed start write therefore never runs the handler, raises the alert, and leaves nothing stuck.
  - The admin manual-run path (`routes/admin/jobs.ts:58`) gets the same guarantee with no route change. A missing row (P2025) now ends as a logged, alerted failure rather than a job shown as "Running" for good.
- **One launcher for every trigger.** A private `launchJob(jobName, handler)` calls `runJob(...).catch(err => log.error(...))`. The cron callbacks in `initScheduler` and `reloadJob` and the boot catch-up call it. This is the `.catch` the scope asks for. It is defensive, since `runJob` no longer rejects, and it removes the three copies of the same callback.
- **Boot retry with backoff.** A new exported `startScheduler()` in `scheduler.ts` calls `initScheduler()`.
  - On failure it logs an error and retries on an unref'd timer: the delay starts at `config.scheduler.initRetryBaseMs` (5 s) and doubles up to `initRetryMaxMs` (5 min). It retries until it succeeds.
  - After `initAlertAfterAttempts` (3) failures it sends one `notifyJobFailure('scheduler', 'scheduler could not start: <error>; retrying every N min')`. It sends no further alerts.
  - When the scheduler finally starts after an alert, that is logged at info level.
  - `stopScheduler()` also clears a pending retry timer and sets a stopped flag, so a shutdown during the retry window cannot start the scheduler afterwards.
  - A retry cannot register twice: `initScheduler`'s only throwing call (`findMany`) comes before any `cron.schedule`.
  - `index.ts` calls `startScheduler()` in the `listen` callback in place of the one-shot promise chain.
- **No process-level `unhandledRejection` handler.** Once the scheduler paths stop rejecting, a remaining unhandled rejection is a real bug. Node's default crash with a stack trace is the visible failure the resilience conventions rely on, and Render restarts the process. A log-and-continue handler would mask crashes. A log-then-exit handler would only duplicate what Node already prints. The agent decided this; it is reversible in one line.

### 2. Social candidates: enabled channels only

`findAutoPostCandidates(lookbackHours, channels)` takes the names of the enabled channels (`'bluesky' | 'mastodon'`). It queries only those channels' post tables. A story is a candidate when at least one enabled channel has no post for it.

"No post" means no row in any status, not just no published row. `generateDraft` refuses a story that already has any post on the channel (`.specs/social-posting.allium` `GenerateDraft` requires `not exists SocialPost`). A story with a draft or failed post on the only enabled channel would therefore still be picked and post nothing, which is the same outcome the scope forbids. The channel adapter's `hasPost` in `socialAutoPost.ts` uses the same any-status test, so the skip is logged as a skip, not as an error.

This is the agent's reading of the scope. The alternative was to keep `status: 'published'` and fix only the channel set. It was rejected because the "posts nothing, reports success" path would stay open through drafts. A failed post's story was already never retried automatically, because `generateDraft` refuses it, so no behaviour is lost.

`socialAutoPost.ts` passes `channels.map(c => c.name)`. The spec already says "enabled channels"; only its post-status condition changes.

### 3. Newsletter: a week key and two guards

The `Newsletter` row gets a nullable `weekKey` (`YYYY-Www`, ISO week in UTC). Only the `generate_newsletter` job sets it, so the job's guard never touches a newsletter an admin made by hand. An issue counts as **built** once its HTML exists (`html <> ''`). The test send is no longer part of what makes an issue exist.

`runGenerateNewsletter` then:

1. keeps the recent-stories pre-check as it is;
2. **skips** when a built auto issue exists with this week's key, or was created within `config.newsletter.minDaysBetweenIssues` (6 days). The second condition fixes the Sunday case: a Sunday catch-up belongs to ISO week N, and the next Saturday (week N+1, six days later) now skips. A midweek catch-up behaves as before (Saturday skips). A normal Saturday-to-Saturday gap is 7 days and proceeds;
3. **skips** when this week's auto draft is unbuilt but was updated within `config.newsletter.abandonedDraftMinutes` (30). That means another process is building it right now. Overlap within one process is already stopped by `runningJobs`;
4. **deletes** this week's unbuilt auto draft once it is older than that, logging a warning. That is a run killed mid-pipeline. The run then proceeds;
5. creates the newsletter with `title` and `weekKey`, and runs assign → select → content → HTML inside the existing cleanup `try`, which deletes the draft and rethrows on failure;
6. calls `sendTest` **after** that `try`. If the send fails (a Plunk outage, or the refusal in section 4), the built issue is kept and the error propagates, so `runJob` alerts. The admin can press "Send test" or send live, and later runs that week skip instead of paying for the LLM calls again.

The ISO-week arithmetic in `getWeekTitle` moves into a private helper shared with a new exported `getWeekKey(date)`. Both titles keep their current output.

The migration adds `week_key` and backfills it for rows whose title matches `^Week (\d+), (\d{4})$` and whose `html <> ''`. A built issue from before the deploy then still blocks its own week. Unbuilt legacy rows are left alone, so the cleanup in step 4 can never reach a row the job did not create.

This decision is the agent's. It was chosen over three alternatives:
- **Matching the title pattern alone, with no new column.** That could delete or block on an admin's hand-made "Week N" draft.
- **Treating any test send as "built".** That would discard a finished issue because of a Plunk outage.
- **Anchoring the issue to the next Saturday.** That ties the guard to the current cron weekday, while the cron can be edited in the admin.

`weekKey` gets no unique constraint here. The owner deferred that protection (unique newsletter title), and it goes to the backlog.

### 4. Test send: refuse without a test segment

This is the owner's decision of 2026-10-06: never fall back to all subscribers.

- `sendTest` throws a new exported `TestSegmentNotConfiguredError` before any Plunk call when `config.plunk.testSegmentId` is empty, and logs it at error level. The campaign is always `audienceType: 'SEGMENT'`.
- In the cron path, the throw reaches `runJob`, which alerts through `notifyJobFailure`, and the built issue stays (section 3, step 6).
- In the admin path, `POST /:id/send-test` maps the error to 409 with its message, so the admin sees why.

### Effect on the podcast plan

This change makes five statements in `.plans/autonomous-two-speaker-podcast.md` untrue, and only those are edited:
- Line 92, the list of scheduler weaknesses the plan leaves in place, still names the start write outside the `try`.
- Line 126 says the generic scheduler fixes are deferred, but some of them are now done.
- Line 322, Out of Scope, still names the start write outside the `try`.
- Line 216 says the two ISO-week helpers "serve different formats". The newsletter's `getWeekKey` now has the podcast's `YYYY-Www` format.
- Line 289 corrects `jobService.ts`, which this change already corrects.

## Changes

| File | Change |
|------|--------|
| `server/src/jobs/scheduler.ts` | `runJob`: start write inside the `try`, and a never-reject contract through a new private `recordFailure`. New private `launchJob`, used by both `cron.schedule` callbacks and the boot catch-up. New exported `startScheduler` (retry loop, single alert). `stopScheduler` also cancels a pending retry. |
| `server/src/index.ts` | The `listen` callback calls `startScheduler()`. |
| `server/src/config.ts` | New `scheduler` block: `initRetryBaseMs: 5000`, `initRetryMaxMs: 300000`, `initAlertAfterAttempts: 3`. The `newsletter` block gains `minDaysBetweenIssues: 6` and `abandonedDraftMinutes: 30`. All are constants with no env override; nothing here is tuned per environment. |
| `server/src/services/socialMedia.ts` | `findAutoPostCandidates(lookbackHours, channels)`: query only the enabled channels' tables, with no status filter. Update the doc comment. |
| `server/src/jobs/socialAutoPost.ts` | Pass the enabled channel names. `hasPost` checks for any post, not only published ones. |
| `server/src/scripts/eval/fixtures.ts` | The "Mirrors socialMedia.ts findAutoPostCandidates" comment (`:411`) now says the reconstruction assumes both channels enabled and counts published posts only. The eval logic is unchanged, and its frozen fixtures stay comparable. |
| `server/prisma/schema.prisma` | `Newsletter.weekKey String? @map("week_key")`, commented "set only by the generate_newsletter job". |
| `server/prisma/migrations/<ts>_newsletter_week_key/migration.sql` | Created with `npm run db:migrate:create --prefix server -- --name newsletter_week_key`. Delete any `DROP INDEX "stories_embedding_idx"`, then append the backfill `UPDATE` described in Approach §3. |
| `server/src/jobs/generateNewsletter.ts` | `getWeekKey` export and a shared private ISO-week helper. The guard sequence becomes a private `checkWeeklySlot(now, weekKey)` that returns proceed or skip, with the reason logged. `sendTest` moves out of the cleanup `try`. `createNewsletter` receives `weekKey`. |
| `server/src/services/newsletter.ts` | `createNewsletter` accepts an optional `weekKey`. `sendTest` refuses with `TestSegmentNotConfiguredError` when no segment is set, and always targets the segment. |
| `server/src/routes/admin/newsletters.ts` | `send-test`: `TestSegmentNotConfiguredError` → 409 with its message. |
| `server/src/index.test.ts` | Add `startScheduler` to the scheduler mock. |
| `.specs/scheduler.allium` | Replace the day-of-week note (`:60-68`) with the real rule: the estimate is multiplied by 7 ÷ (days per week in the day-of-week field), and `*`, a single day, ranges, wrap-around ranges and lists are understood. `InitScheduler` retries with backoff and alerts once after the threshold. `ExecuteJob` and `JobFails`: a bookkeeping write that fails counts as a job failure, a failed error-path write is logged, and the running mark is always removed. Add an invariant that running a job never crashes the process. |
| `.specs/social-posting.allium` | `FindCandidates` and `PickBestStory`: "no post on that channel in any status" in place of `status = published`. Note why: `GenerateDraft` refuses any existing post. |
| `.specs/newsletter-and-podcast.allium` | `Newsletter.week_key`. A new `GenerateWeeklyIssue` rule (the pre-check, guards 2-4, build, then test send, with "built" defined as HTML present). `SendTest` requires `config.test_segment_id != null`, the audience is the segment only, and the comment at `:107-108` is fixed. Config gains the two newsletter constants. |
| `.context/scheduler.md` | Reliability: error tracking covers bookkeeping failures, and boot retry and its alert are added. Line 25: hot reload stops and re-registers **only the updated job**. Line 78: `jobService.ts` → `server/src/services/job.ts` ("job list with running state, and job updates"; manual triggering is in `routes/admin/jobs.ts`). |
| `.context/newsletter-podcast.md` | "Automated generation" steps 2-4 are rewritten for the week key, the 6-day spacing, abandoned-draft cleanup, and the test send outside cleanup. State that a test send without `PLUNK_TEST_SEGMENT_ID` is refused. |
| `.context/mastodon.md` | `:41`: candidates are stories with no post, in any status, on at least one **enabled** channel. |
| `.context/ai-transparency.md` | Row `:141` (q1): an unset `PLUNK_TEST_SEGMENT_ID` now refuses the test send and alerts (owner decision 2026-10-06). It stays open only as "confirm it is set in production, otherwise the Saturday test email fails every week". Row `:61`'s "q1 still open" stays accurate. |
| `BACKLOG.md` | Add the five deferred items (see Out of Scope) as open items under `## Code`. |
| `.plans/autonomous-two-speaker-podcast.md` | Only the five statements listed under Approach, "Effect on the podcast plan". |

## Tests

Existing patterns: `vi.hoisted` mocks, Prisma mocked per model, and fake timers for the retry.

- `server/src/jobs/scheduler.test.ts`
  - The start write rejects: the handler is not called, `runJob` resolves, `runningJobs` no longer holds the job, and `notifyJobFailure` is called.
  - The handler throws and the error-path write also rejects: `runJob` resolves, the job is removed from `runningJobs`, and the alert is sent.
  - The handler succeeds but the completion write rejects: `runJob` resolves, the job is cleared, and the alert is sent.
  - The registered cron callback, invoked while every Prisma write rejects, produces no rejected promise. Assert that an `unhandledRejection` listener added in the test is not called.
  - `startScheduler`: `findMany` rejects twice, then resolves. The scheduler registers exactly once and the delays double. Below the threshold no alert is sent; at the threshold exactly one is sent, and none after it. `stopScheduler()` during the wait prevents any later `findMany`.
- `server/src/services/socialMedia.test.ts`: with `['bluesky']` only, a story published on Bluesky is excluded although it is missing on Mastodon, and the Mastodon table is not queried. A story with a `draft` or `failed` Bluesky post is excluded. With both channels, the existing either-missing behaviour holds. Update the existing calls to pass channels.
- `server/src/jobs/generateNewsletter.test.ts`
  - Skips when a built issue has this week's key.
  - Skips when a built auto issue is 6 days old: a Sunday catch-up followed by the next Saturday, with dates pinned.
  - Proceeds when the last built issue is 7 days old.
  - Skips when this week's unbuilt draft is fresh.
  - Deletes a stale unbuilt draft for this week, then runs the pipeline.
  - A failure before HTML deletes the draft; a `sendTest` failure keeps it and rethrows.
  - `createNewsletter` receives `weekKey`.
  - `getWeekKey`: the year-boundary and week-53 cases mirror the existing `getWeekTitle` tests, with zero padding (`2026-W07`).
- `server/src/services/newsletter.test.ts`: `sendTest` with an empty `testSegmentId` throws `TestSegmentNotConfiguredError` and never calls `plunk.createCampaign`. With a segment set, it sends `audienceType: 'SEGMENT'` and that segment id.
- `server/src/routes/admin/newsletters.test.ts`: `send-test` returns 409 with the message on `TestSegmentNotConfiguredError`.
- The migration backfill is checked once by hand against the local database: a "Week 7, 2026" row with HTML gets `2026-W07`, and a row without HTML stays null. `server/src/test/migrations.test.ts` keeps guarding the pgvector index.

## Implementation notes (2026-10-06)

Implemented by the implementer agent; deviations from the text above:
- The podcast plan's untrue statements were at lines 96, 220, 293 and 326 when edited (four, not five: the "line 92" and "line 126" items were the same paragraph). Each was corrected in place.
- The local Docker database was down, so `db:migrate:create` could not run; the migration `20261006120000_newsletter_week_key` was written by hand (no `DROP INDEX` line to remove). The backfill has not been checked against a database yet.
- `getWeekKey` uses the same calendar-day arithmetic as `getWeekTitle` (the date's local day; Render runs in UTC), so title and key always agree.
- `startScheduler` also stops the scheduler again if a shutdown arrived while an attempt was in flight.
- No ADR: the plan carries no stubs, and the planner judged that none of its decisions is hard or costly to reverse (DOC-006).

## Out of Scope

Deferred by the owner, and added to `BACKLOG.md` as open items:
- A database lease or claim in `runJob` for every job (the overlap guard is per process only, which matters during zero-downtime deploys).
- Whether a failed run should write `lastCompletedAt` (or a separate `lastSucceededAt`).
- The boot catch-up policy for jobs whose `lastCompletedAt` is null (today they run at boot).
- An environment flag that disables the scheduler, for a second process against the production database.
- A unique constraint on the automatic newsletter's week (`newsletters.week_key`, or the title), so two overlapping instances cannot both create the weekly issue.

Also not done here:
- Making `social_auto_post` fail, and alert, when every channel attempt failed. Today per-channel errors are only logged, which is by design.
- Sequencing the boot catch-up jobs.
- Waiting for cron jobs in the SIGTERM drain.
- Removing the dead `blueskyAutoPost.ts`.
- The admin run route returning 409 when the job is already running.

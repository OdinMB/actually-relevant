# Job Scheduler

The scheduler runs jobs in-process using `node-cron`, with configuration and run history stored in the `job_runs` database table. No external job queue infrastructure is needed.

## How It Works

On server startup, `index.ts` calls `startScheduler()`, which runs `initScheduler()`:
1. Loads all job definitions from the `job_runs` table
2. For each enabled job with a valid cron expression, registers a cron task. A job is skipped (logged) if it is disabled, has no handler in `JOB_HANDLERS`, or has a cron expression that fails `cron.validate`. The expression is read on the server's clock (UTC on Render), except for a job listed in `jobs/jobTimeZones.ts`, which is registered with node-cron's `timezone` option and read on that zone's clock, summer and winter time included. Today that is only `publish_podcast` (Europe/Berlin). `GET /api/admin/jobs` returns each job's `timeZone` (null for the server's clock), and the Jobs page shows it beside the schedule.
3. Checks for overdue jobs (never completed, or more than 2× the estimated interval since `lastCompletedAt`; see Overdue detection) and runs them immediately
4. Logs which jobs were registered, skipped, or triggered

**Boot retry**: if step 1 fails (database down at restart), `startScheduler()` retries on an unref'd timer — 5 s doubling to a 5 min cap, forever (`config.scheduler`). After 3 failed attempts it sends one `notifyJobFailure('scheduler', …)`, and logs at info level when it finally starts. `stopScheduler()` cancels a pending retry. Without this the web service would look healthy while no job ran until the next deploy.

## Reliability Features

**Overlap prevention**: Running state lives in memory only (`runningJobs`, a `Set<string>` in `server/src/jobs/scheduler.ts`), never in the database. `job_runs` stores only `lastStartedAt`, `lastCompletedAt` and `lastError`. Every trigger path goes through `runJob`: cron ticks, the boot catch-up and the admin manual run. If the job is already in `runningJobs`, the new run is skipped with a warning log, and nothing is queued. A manual run of a busy job still gets "triggered" back from the API but does nothing. Overlap is prevented within one process only.

**Overdue detection**: At startup, after a job is registered, it runs immediately if it never completed (`lastCompletedAt` is null), or if more than **2×** its estimated interval has passed since `lastCompletedAt` (`isOverdue`). The interval comes from `estimateCronIntervalMs`, a heuristic and not a full cron evaluator. It reads the hour field first:
- `*/N` means N hours.
- A comma list `H1,H2,…` means 24 ÷ (number of hours).
- A single hour means 24 h.
- Anything else (`*`, ranges) gives no estimate, so the job is **never** overdue.

That figure is then multiplied by 7 ÷ (days per week in the day-of-week field), so `0 4 * * 6` comes out at 168 h and `0 9 * * 1-5` at 24 h × 7/5. The day-of-week parser understands `*`, single days (0 and 7 are both Sunday), ranges, wrap-around ranges (`5-2` = Fri to Tue) and comma lists. An unrecognized pattern (e.g. `*/2`) falls back to a multiplier of 1.

**Error tracking**: Each job run updates `lastStartedAt` at start, then `lastCompletedAt` (and `lastError` on failure) when it finishes — both the success and caught-error paths write `lastCompletedAt`. Failed jobs don't block subsequent runs. `runJob` never rejects: a failed start or completion write counts as a job failure (a failed start write means the handler never runs), a failed error-path write is logged (`failed to record job failure`), and the job always leaves `runningJobs`. Cron ticks and boot catch-up go through `launchJob`, which adds a defensive `.catch`. A rejection escaping here used to crash the process (Node exits on unhandled rejections); there is deliberately no process-wide `unhandledRejection` handler, so any other escape still crashes visibly. A **hard kill** (OOM, SIGKILL) bypasses the finish writes, leaving `lastStartedAt` newer than `lastCompletedAt`; the admin Jobs table surfaces that as an **Incomplete** (red) status rather than a stale **OK**, so a crashed run is visible (see `JobStatusBadge.tsx`).

**Run bookkeeping**: A run starts by adding the job to `runningJobs`, then writes `lastStartedAt = now` and clears `lastError`. The handler is called only after that write succeeds. On success the run writes `lastCompletedAt`. On failure it writes `lastError` and `lastCompletedAt` and calls `notifyJobFailure(jobName, error)`. Either way the job leaves `runningJobs` in a `finally`.

**Failure notifications**: When a job fails, `notifyJobFailure()` sends a POST to the URL in the `WEBHOOK_URL` environment variable (if set) with the job name, error message, and timestamp. See `server/src/lib/notify.ts`.

**Hot reload**: When a job's cron expression or enabled flag is updated via the admin API (`PUT /api/admin/jobs/:jobName`), the scheduler reloads only that job (`reloadJob`) — stopping its cron task and re-registering it from the database. It does not run an overdue check. No server restart needed. On reload, the job is registered again only if it is still enabled, has a handler in `JOB_HANDLERS`, and has an expression that passes `cron.validate`; otherwise it stays unregistered. `PUT /api/admin/jobs/:jobName` rejects an invalid cron expression with 400 before saving.

**Manual triggers**: Every job can be triggered via `POST /api/admin/jobs/:jobName/run`, which runs the job in the background regardless of schedule.

## Registered Jobs

| Job Name | Handler | Default Schedule |
|----------|---------|-----------------|
| `crawl_feeds` | `runCrawlFeeds` | `0 */6 * * *` (every 6h) |
| `preassess_stories` | `runPreassessStories` | Configurable |
| `assess_stories` | `runAssessStories` | Configurable |
| `select_stories` | `runSelectStories` | Configurable |
| `publish_stories` | `runPublishStories` | Configurable |
| `social_auto_post` | `runSocialAutoPost` | Configurable |
| `bluesky_update_metrics` | `runBlueskyUpdateMetrics` | Configurable |
| `mastodon_update_metrics` | `runMastodonUpdateMetrics` | Configurable |
| `generate_newsletter` | `runGenerateNewsletter` | `0 4 * * 6` (Saturday 4am) |
| `generate_podcast` | `runGeneratePodcast` | `0 2,6,10,14,18 * * 5` (Friday slots, UTC); seeded disabled |
| `publish_podcast` | `runPublishPodcast` | `0 7 * * 6` (Saturday 07:00 Europe/Berlin); seeded disabled |

**The podcast jobs** keep their retry policy in podcast code, not here (ADR-0013; `.context/podcast.md`, "Automation"). `generate_podcast` does nothing outside its UTC Friday window (00:00 until 20:00), so a boot catch-up on another day, or a manual Run then, never starts an episode. Inside it, each slot resumes the week's episode; failures are counted on the episode, and at 3 (or on an error a retry cannot fix) the episode is blocked and the run fails once, so `notifyJobFailure` alerts once and later slots skip. `publish_podcast` does nothing on any day that is not a Saturday in Berlin, publishes only an episode that has been ready for 8 hours, and re-reads its own row's `enabled` flag before publishing. When it finds nothing to publish on its Saturday while enabled, it sends the missed-week alert through `notifyEvent` ("No podcast episode ready to publish this Saturday", with the reason), at most once per ISO week: the week is claimed in `podcast_missed_week_alerts` first, so a retry, a manual Run or a boot catch-up that day stays silent. Their migration seeds both rows with `last_completed_at` set, so neither runs at boot just for never having completed; that seed is more than two weeks old by the time the owner enables them, and `seed-jobs.ts` leaves it null on a fresh dev database, so a boot catch-up can still launch either job on any day: the Friday window and the Saturday guard are what make that harmless. At boot, when either row is enabled, `checkPodcastConfigAtBoot` (`index.ts`) reports missing podcast settings through `notifyEvent`.

## Adding a New Job

1. Create handler in `server/src/jobs/yourJob.ts` exporting an `async function runYourJob(): Promise<void>`
2. Register handler in `server/src/jobs/handlers.ts` by adding to the `JOB_HANDLERS` map
3. Add a row to `job_runs` table (via migration or seed) with `jobName`, `cronExpression`, and `enabled`
4. Add the name to `JobName` (`shared/types`), `JOB_NAMES` (`shared/constants`) and the admin's `JOB_DISPLAY_NAMES` and `JOB_PIPELINE_ORDER` (`client/src/lib/constants.ts`)

## Admin API

| Endpoint | Description |
|----------|-------------|
| `GET /api/admin/jobs` | List all jobs with status, last run times, errors |
| `PUT /api/admin/jobs/:jobName` | Update cron expression or enabled flag |
| `POST /api/admin/jobs/:jobName/run` | Manually trigger a job (runs in background) |

## Concurrency

LLM-powered jobs (preassess, assess, select) process work items in parallel using a counting semaphore to cap concurrent LLM calls. Default concurrency is 10 per job type, configurable via environment variables:

| Env Var | Default | Controls |
|---------|---------|----------|
| `CONCURRENCY_PREASSESS` | 10 | Max concurrent pre-assessment batches |
| `CONCURRENCY_ASSESS` | 10 | Max concurrent full assessments |
| `CONCURRENCY_SELECT` | 10 | Max concurrent selection groups |
| `LLM_DELAY_MS` | 500 | Minimum delay between LLM calls (serialized) |

Set any concurrency to `1` for sequential processing (original behavior). The rate limiter serializes delays across all concurrent workers via a timestamp-based approach (`nextAvailableTime` in `llm.ts`), so each LLM call waits at least `LLM_DELAY_MS` after the previous one regardless of concurrency level. All jobs use `Promise.allSettled` so individual failures don't abort the batch.

The Semaphore utility is at `server/src/lib/semaphore.ts`.

## Key Files

| File | Role |
|------|------|
| `server/src/jobs/scheduler.ts` | Core scheduler: init and boot retry, cron registration, overlap prevention, hot reload |
| `server/src/jobs/handlers.ts` | Shared `JOB_HANDLERS` map (job name → handler function) |
| `server/src/jobs/jobTimeZones.ts` | The jobs whose cron expression is read on a fixed zone's clock (`jobTimeZone()`) |
| `server/src/services/job.ts` | Job list with running state, and job updates (manual triggering is in `routes/admin/jobs.ts`) |
| `server/src/lib/notify.ts` | Webhook notification for job failures |
| `server/src/jobs/crawlFeeds.ts` | RSS crawl job handler |
| `server/src/jobs/preassessStories.ts` | Pre-assessment job handler |
| `server/src/jobs/assessStories.ts` | Full assessment job handler |
| `server/src/jobs/selectStories.ts` | Selection job handler |
| `server/src/jobs/publishStories.ts` | Publish job handler |
| `server/src/jobs/socialAutoPost.ts` | Unified social media auto-post job handler |
| `server/src/jobs/blueskyAutoPost.ts` | Legacy Bluesky-only auto-post (unused) |
| `server/src/jobs/blueskyUpdateMetrics.ts` | Bluesky metrics update job handler |
| `server/src/jobs/mastodonUpdateMetrics.ts` | Mastodon metrics update job handler |
| `server/src/jobs/generateNewsletter.ts` | Automated weekly newsletter generation job handler |
| `server/src/jobs/generatePodcast.ts`, `publishPodcast.ts`, `podcastBootCheck.ts` | Weekly podcast episode and automatic publication handlers; the boot configuration check |
| `server/src/routes/admin/jobs.ts` | Admin API for job management |

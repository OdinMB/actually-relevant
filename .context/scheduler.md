# Job Scheduler

The scheduler runs jobs in-process using `node-cron`, with configuration and run history stored in the `job_runs` database table. No external job queue infrastructure is needed.

## How It Works

On server startup, `index.ts` calls `startScheduler()`, which runs `initScheduler()`:
1. Loads all job definitions from the `job_runs` table
2. For each enabled job with a valid cron expression, registers a cron task. A job is skipped (logged) if it is disabled, has no handler in `JOB_HANDLERS`, or has a cron expression that fails `cron.validate`. The expression is read on the server's clock (UTC on Render), except for a job listed in `jobs/jobTimeZones.ts`, which is registered with node-cron's `timezone` option and read on that zone's clock, summer and winter time included. Today that is only `publish_podcast` (Europe/Berlin). `GET /api/admin/jobs` returns each job's `timeZone` (null for the server's clock), and the Jobs page shows it beside the schedule.
3. Collects the overdue jobs (more than 2× the estimated interval since `lastCompletedAt`; see Overdue detection) and starts one catch-up chain that runs them one after another, in pipeline order
4. Logs which jobs were registered, skipped, or queued for catch-up

**Boot retry**: if step 1 fails (database down at restart), `startScheduler()` retries on an unref'd timer — 5 s doubling to a 5 min cap, forever (`config.scheduler`). After 3 failed attempts it sends one `notifyJobFailure('scheduler', …)`, and logs at info level when it finally starts. `stopScheduler()` cancels a pending retry. Without this the web service would look healthy while no job ran until the next deploy.

## Reliability Features

**Overlap prevention** (ADR-0017; lease timing ADR-0020): two guards, and every trigger path goes through `runJob`: cron ticks, the boot catch-up and the admin manual run.
- **In this process**, `runningJobs` (a `Set<string>` in `scheduler.ts`) is the fast path: a job already in it is skipped with a warning log, without touching the database.
- **Across processes** (old and new instance during a zero-downtime deploy, or a second process on the same database), the **job lease** on the job's `job_runs` row (`locked_by`, `locked_until`; `jobs/jobLease.ts`). `claimJobRun` takes it and starts the run in one conditional `UPDATE` on the database clock: it sets `locked_by` to this process's id (`hostname:pid:8 hex chars`), `locked_until` to now + `config.scheduler.leaseSeconds` (120), `last_started_at` to now and clears `last_error`, only where no live lease exists (`locked_until` null or past, or already this process's). One row: the run proceeds. No row while the job's row exists: another process holds it, and the run is skipped with an info log (`held by another process, skipping`): nothing recorded, no alert. A missing row is a failure, alerted like any other.
- While the handler runs, `withJobLeaseHeartbeat` renews the lease every `leaseRenewMs` (30 s), fenced on `locked_by = me`. A renewal matching no row logs `lost the job lease` once and stops renewing; a renewal that throws (pool timeout, database blip) is logged and the next tick tries again. The handler is not aborted (handlers are not cancellable; the podcast's own writes stay fenced by its episode lease). So a crashed holder blocks its job for at most 2 minutes, whatever the job's length.
- **Lease timing** (ADR-0020): `JOB_LEASE_SECONDS` (default 120) and `JOB_LEASE_RENEW_SECONDS` (default 30), parsed by `parseJobLeaseTiming` in `config.ts`, which refuses to start on a non-positive or fractional value or a renewal interval above half the lease. The defaults give four renewal chances per lease, so a live run loses its lease only if its event loop stalls, or its renewals fail, for about 90 s on end. Nothing in the jobs blocks the loop for anywhere near that: every database, LLM, HTTP and ElevenLabs call is async, ffmpeg runs as a child process, and the longest synchronous work is one JSDOM/Readability or cheerio parse of a page capped at `crawl.maxParseBytes` (2 MB) or one `rss-parser` parse of a feed capped at 5 MB, seconds at most even on the 0.5 vCPU instance. A renewal is one single-row `UPDATE`; Prisma's pool timeout (10 s by default) fails a starved one well inside the 30 s tick. Raise both values together (keeping the renewal at most half the lease) if a job ever gains long synchronous work, such as an in-process parse of a much larger document.
- `finishJobRun` always records the finish and clears `locked_by`/`locked_until` only where this process still holds them, so another holder's lease is never cleared. On graceful shutdown `index.ts` calls `releaseHeldJobLeases()` (beside the podcast's `releaseHeldLeases()`), so the next instance can run those jobs at once instead of up to 2 minutes later.
- The lease is raw SQL on purpose: the database clock for every comparison, and it works whether or not the generated Prisma client knows the columns. Rejected: `pg_try_advisory_lock` (Prisma's pool may unlock on another connection, ADR-0003), a fixed per-job lease with no heartbeat, a separate leases table.
- The admin manual run asks first (`isJobRunning`, async: in `runningJobs`, or a live lease on the database clock in any process) and answers 409 "already running", which the Jobs page and the Dashboard show as an error toast. `GET /api/admin/jobs` reports `running` the same way and leaves `lockedBy`/`lockedUntil` out of the response.

**Overdue detection**: At startup, a registered job is overdue if more than **2×** its estimated interval has passed since `lastCompletedAt` (`isOverdue`). A job that never finished (`lastCompletedAt` null: a fresh or newly seeded row) is **not** overdue; it waits for its first cron tick. Catch-up keys on `lastCompletedAt` (last finished), not `lastSucceededAt`: it exists to make up runs missed while no server was up, and keying it on success would rerun and re-alert a persistently failing job on every deploy.

**Sequenced catch-up**: the overdue jobs run as one fire-and-forget chain, **one after another**, in `JOB_PIPELINE_ORDER` (`jobs/handlers.ts`: crawl, preassess, assess, select, publish, social, Bluesky and Mastodon metrics, newsletter, generate and publish podcast; a job missing from the list runs last). Before each step the chain re-reads the job's row and skips it if it is no longer registered or enabled (disabled meanwhile) or no longer overdue (its cron tick ran it meanwhile). `stopScheduler()` ends the chain before its next step. Cron ticks keep firing in parallel; `runningJobs` and the lease keep them from overlapping the chain.

The interval comes from `estimateCronIntervalMs`, a heuristic and not a full cron evaluator. It reads the hour field first:
- `*/N` means N hours.
- A comma list `H1,H2,…` means 24 ÷ (number of hours).
- A single hour means 24 h.
- Anything else (`*`, ranges) gives no estimate, so the job is **never** overdue.

That figure is then multiplied by 7 ÷ (days per week in the day-of-week field), so `0 4 * * 6` comes out at 168 h and `0 9 * * 1-5` at 24 h × 7/5. The day-of-week parser understands `*`, single days (0 and 7 are both Sunday), ranges, wrap-around ranges (`5-2` = Fri to Tue) and comma lists. An unrecognized pattern (e.g. `*/2`) falls back to a multiplier of 1.

**Error tracking**: Each job run updates `lastStartedAt` at start, then `lastCompletedAt` when it finishes, either way ("Last Finished" on the Jobs page), plus `lastSucceededAt` on success or `lastError` on failure ("Last Success"; migration `20261007200000_job_run_lease_and_success` backfilled it from `last_completed_at` where `last_error` was null). The status badge stays as it was: a failed run already shows **Error**. All three times come from the database clock, so the "Incomplete" comparison below compares like with like. Failed jobs don't block subsequent runs. `runJob` never rejects: a failed start or completion write counts as a job failure (a failed start write means the handler never runs), a failed error-path write is logged (`failed to record job failure`), and the job always leaves `runningJobs`. Cron ticks go through `launchJob`, which adds a defensive `.catch`, and the catch-up chain has its own `.catch` (a failed re-read ends the chain; the remaining jobs wait for their schedule). A rejection escaping here used to crash the process (Node exits on unhandled rejections); there is deliberately no process-wide `unhandledRejection` handler, so any other escape still crashes visibly. A **hard kill** (OOM, SIGKILL) bypasses the finish writes, leaving `lastStartedAt` newer than `lastCompletedAt`; the admin Jobs table surfaces that as an **Incomplete** (red) status rather than a stale **OK**, so a crashed run is visible (see `JobStatusBadge.tsx`).

**Run bookkeeping**: A run starts by adding the job to `runningJobs`, then claims the lease, which in the same statement writes `lastStartedAt = now` and clears `lastError`. The handler is called only after that claim succeeds, under the heartbeat. On success the run writes `lastCompletedAt` and `lastSucceededAt`. On failure it writes `lastError` and `lastCompletedAt` and calls `notifyJobFailure(jobName, error)`. Both finish writes release this process's lease. Either way the job leaves `runningJobs` in a `finally`.

**Disabling the scheduler**: `SCHEDULER_ENABLED=false` (also `0`, `no`, `off`, case-insensitive; default on; `config.scheduler.enabled`) is for a second process run against the production database. That process schedules nothing: `startScheduler()` logs `scheduler disabled (SCHEDULER_ENABLED)` and loads no job, `reloadJob` saves nothing into the schedule (an enable or schedule change made through that process is saved to the row and picked up by the scheduling process at its next restart), and `index.ts` skips `checkPodcastConfigAtBoot`, whose alert concerns scheduled podcast runs. The admin **Run** button still works there: it is a person's explicit action, and the lease keeps it from overlapping the main instance.

**Failure notifications**: When a job fails, `notifyJobFailure()` sends a POST to the URL in the `WEBHOOK_URL` environment variable (if set) with the job name, error message, and timestamp. See `server/src/lib/notify.ts`.

**Hot reload**: When a job's cron expression or enabled flag is updated via the admin API (`PUT /api/admin/jobs/:jobName`), the scheduler reloads only that job (`reloadJob`) — stopping its cron task and re-registering it from the database. It does not run an overdue check. No server restart needed. On reload, the job is registered again only if it is still enabled, has a handler in `JOB_HANDLERS`, and has an expression that passes `cron.validate`; otherwise it stays unregistered. `PUT /api/admin/jobs/:jobName` rejects an invalid cron expression with 400 before saving.

**Enable checks**: a request that sets `enabled: true` first asks `jobEnableRefusal` (`jobs/jobEnableChecks.ts`), a map of job name to precondition. A job whose every run would block on a missing setting is refused with 422 and nothing is saved; the error names what is missing, and the Jobs page shows it in the error toast. Today only `generate_podcast` and `publish_podcast` have a check: the podcast configuration as the automatic run needs it (voices, `ELEVENLABS_API_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD` outside a dry run, i.e. in production, and `WEBHOOK_URL`). Disabling a job or changing only its schedule checks nothing.

**Manual triggers**: Every job can be triggered via `POST /api/admin/jobs/:jobName/run`, which runs the job in the background regardless of schedule, or answers 409 while it is already running in this or another process.

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

**The podcast jobs** keep their retry policy in podcast code, not here (ADR-0013; `.context/podcast.md`, "Automation"). `generate_podcast` does nothing outside its UTC Friday window (00:00 until 20:00), so a boot catch-up on another day, or a manual Run then, never starts an episode. Inside it, each slot resumes the week's episode; failures are counted on the episode, and at 3 (or on an error a retry cannot fix) the episode is blocked and the run fails once, so `notifyJobFailure` alerts once and later slots skip. `publish_podcast` does nothing on any day that is not a Saturday in Berlin, publishes only an episode that has been ready for 8 hours, and re-reads its own row's `enabled` flag before publishing. When it finds nothing to publish on its Saturday while enabled, it sends the missed-week alert through `notifyEvent` ("No podcast episode ready to publish this Saturday", with the reason), at most once per ISO week: the week is claimed in `podcast_missed_week_alerts` first, so a retry, a manual Run or a boot catch-up that day stays silent. A never-completed row never runs at boot, so their freshly seeded rows wait for a cron tick; the `last_completed_at` their migration seeds (from before that rule) goes stale after two weeks, so a boot catch-up can still launch either job on any day once it has run: the Friday window and the Saturday guard are what make that harmless. A `generate_podcast` run holds the job lease, and `advanceEpisode` still claims the episode lease inside it: the two are independent (`.context/podcast.md`, "The lease"). At boot, when either row is enabled, `checkPodcastConfigAtBoot` (`index.ts`) reports missing podcast settings through `notifyEvent`; enabling either from the Jobs page is refused while a setting is missing (Enable checks, above).

## Adding a New Job

1. Create handler in `server/src/jobs/yourJob.ts` exporting an `async function runYourJob(): Promise<void>`
2. Register handler in `server/src/jobs/handlers.ts` by adding to the `JOB_HANDLERS` map, and add the name to `JOB_PIPELINE_ORDER` there (the boot catch-up order) at its place in the pipeline
3. Add a row to `job_runs` table (via migration or seed) with `jobName`, `cronExpression`, and `enabled`
4. Add the name to `JobName` (`shared/types`), `JOB_NAMES` (`shared/constants`) and the admin's `JOB_DISPLAY_NAMES` and `JOB_PIPELINE_ORDER` (`client/src/lib/constants.ts`)

## Admin API

| Endpoint | Description |
|----------|-------------|
| `GET /api/admin/jobs` | List all jobs with status, last run times, errors |
| `PUT /api/admin/jobs/:jobName` | Update cron expression or enabled flag (422 when an enable check refuses) |
| `POST /api/admin/jobs/:jobName/run` | Manually trigger a job (runs in background; 409 while it is running in any process) |

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
| `server/src/jobs/scheduler.ts` | Core scheduler: init and boot retry, cron registration, sequenced boot catch-up, `runJob` (overlap guard and bookkeeping), hot reload, `SCHEDULER_ENABLED` |
| `server/src/jobs/jobLease.ts` | The cross-instance job lease: claim-and-start, heartbeat, fenced finish, live-lease query, release at shutdown |
| `server/src/jobs/handlers.ts` | Shared `JOB_HANDLERS` map (job name → handler function) and `JOB_PIPELINE_ORDER` (catch-up order) |
| `server/src/jobs/jobTimeZones.ts` | The jobs whose cron expression is read on a fixed zone's clock (`jobTimeZone()`) |
| `server/src/services/job.ts` | Job list with running state, and job updates (manual triggering is in `routes/admin/jobs.ts`) |
| `server/src/lib/notify.ts` | Webhook notification for job failures |
| `server/src/jobs/crawlFeeds.ts` | RSS crawl job handler |
| `server/src/jobs/preassessStories.ts` | Pre-assessment job handler |
| `server/src/jobs/assessStories.ts` | Full assessment job handler |
| `server/src/jobs/selectStories.ts` | Selection job handler |
| `server/src/jobs/publishStories.ts` | Publish job handler |
| `server/src/jobs/socialAutoPost.ts` | Unified social media auto-post job handler |
| `server/src/jobs/blueskyUpdateMetrics.ts` | Bluesky metrics update job handler |
| `server/src/jobs/mastodonUpdateMetrics.ts` | Mastodon metrics update job handler |
| `server/src/jobs/generateNewsletter.ts` | Automated weekly newsletter generation job handler |
| `server/src/jobs/generatePodcast.ts`, `publishPodcast.ts`, `podcastBootCheck.ts` | Weekly podcast episode and automatic publication handlers; the podcast configuration check (at boot, and `podcastConfigProblem` for the enable check) |
| `server/src/jobs/jobEnableChecks.ts` | Preconditions for enabling a job from the admin API (`jobEnableRefusal`) |
| `server/src/routes/admin/jobs.ts` | Admin API for job management |

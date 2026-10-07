---
plan-id: scheduler-lease-and-catch-up
title: Cross-instance job lease, lastSucceededAt, quieter and sequenced boot catch-up, a scheduler off switch, and the .ico feed favicon
status: implemented
created: 2026-10-07
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: []
decisions:
  - ref: .context/decisions/0017-job-run-lease.md
type: feature
complexity: complex
---

# Scheduler: job lease, last success, catch-up policy, off switch

Scope approved by the owner (Odin Mühlenbein) in session on 2026-10-07: the five scheduler items
from `BACKLOG.md` and the `.ico` feed favicon. Every design choice below is the planning agent's
(AI); ADR-0017 is the one hard-to-reverse choice.

## Problem

The overlap guard (`runningJobs`) lives in one process, so during a zero-downtime deploy the old
and new instance can both run the same job (a boot catch-up on the new one while the old one's cron
run is mid-flight). A failed run writes `lastCompletedAt`, so "last completed" cannot tell success
from failure. Boot catch-up runs every never-completed job (a fresh or newly enabled row) and
launches all overdue jobs at once, out of pipeline order. There is no way to run a second process
against production without it running jobs too. Separately, one feed favicon is an `.ico` saved as
`.png`, which aborts `images:info`.

## Approach

### 1. Job lease (ADR-0017)

`job_runs` gets `locked_by TEXT NULL` and `locked_until TIMESTAMP(3) NULL` (UTC, like the podcast's
`lease_until`). In `runJob`, after the in-memory fast path:

- **Claim and start in one statement** (raw SQL, database clock, as `claimEpisode` does):
  `UPDATE job_runs SET locked_by = $me, locked_until = now() AT TIME ZONE 'UTC' + leaseMinutes,
  last_started_at = now() AT TIME ZONE 'UTC', last_error = NULL WHERE job_name = $name AND
  (locked_until IS NULL OR locked_until < now() AT TIME ZONE 'UTC')`. One row: proceed. Zero rows:
  look the row up; missing → throw (the failure path, as P2025 does today); present → log
  `held by another process, skipping` at info, do not run, record and alert nothing.
- **Heartbeat**: while the handler runs, an unref'd interval (`leaseRenewMs`, 2 min) extends
  `locked_until` `WHERE job_name = $name AND locked_by = $me`. Zero rows → warn once
  (`lost the job lease`) and stop renewing; the handler is not aborted (handlers are not
  cancellable, and the podcast's own writes stay fenced by the episode lease). Cleared in `finally`.
- **Finish** in one statement: success writes `last_completed_at` and `last_succeeded_at`; failure
  (`recordFailure`) writes `last_error` and `last_completed_at`. Both release with
  `locked_by = CASE WHEN locked_by = $me THEN NULL ELSE locked_by END` (same for `locked_until`), so
  the timestamps are always recorded but another holder's lease is never cleared. All three
  timestamps now come from the database clock, so the Jobs page's `lastStartedAt > lastCompletedAt`
  "Incomplete" check compares like with like.
- **Lease length**: `config.scheduler.leaseMinutes = 10`, renewed every 2 min. A crashed holder
  blocks the job for at most 10 min, whatever the job's duration, so no per-job sizing is needed.
- **Process id**: `${hostname()}:${pid}:${8 chars of randomUUID}` in `scheduler.ts`, readable in the
  row when debugging.
- **Shutdown**: new exported `releaseHeldJobLeases()` (`WHERE locked_by = $me`), called in
  `index.ts` beside `releaseHeldLeases()`. The process exits right after, so the window in which a
  cut-off handler and the next instance overlap is the same few milliseconds the podcast accepts.
- **Admin**: `isJobRunning` becomes async: in-memory set, or a live lease
  (`locked_until > now()` on the database clock). The run route awaits it, so a run held by the
  other instance answers 409 as a local one does. `getJobs` reports `running` the same way
  (`lockedUntil > new Date()`; app clock is good enough for display) and omits `lockedBy`/`lockedUntil`
  from the response.

Alternatives: `pg_try_advisory_lock` (rejected for the reason ADR-0003 gives: Prisma's pool may run
the unlock on another connection); a lease sized per job with no heartbeat (rejected: crawl and
assess durations vary with feed volume, and a long fixed lease blocks a crashed job for hours);
a separate `job_leases` table (rejected: one row per job already exists).

**With the podcast lease.** The two are independent and nest: a `generate_podcast` run holds the job
lease, and `advanceEpisode` still claims the episode lease inside it. The job lease stops two
instances from running the cron job; the episode lease still orders cron runs against admin
resumes, rewinds and edits, which never touch the job lease (ADR-0009 unchanged). `publish_podcast`
and the missed-week claim are unaffected; the job lease just means only one instance reaches them.

### 2. `lastSucceededAt`

New nullable `last_succeeded_at`; the migration backfills it from `last_completed_at` where
`last_error IS NULL`. `lastCompletedAt` keeps meaning "last finished, either way". **Boot catch-up
keeps using `lastCompletedAt`**: catch-up exists to make up a run missed while no server was up,
not to retry failures; keying it on success would rerun (and re-alert) a persistently failing job
on every deploy. The Jobs page adds a **Last Success** column (table, `lg` and up) and row in the
edit panel, and renames "Last Completed" to **Last Finished**. The status badge is unchanged (a
failed run already shows **Error**). The Dashboard keeps its single time column.

### 3. Never-completed jobs don't run at boot

`isOverdue` returns false when `lastCompletedAt` is null. A newly enabled or freshly seeded job waits
for its first cron tick. This also makes the podcast migration's seeded `last_completed_at` no
longer necessary for that purpose (the docs say so; the seed stays).

### 4. `SCHEDULER_ENABLED`

`config.scheduler.enabled`: false when `SCHEDULER_ENABLED` is `false`, `0`, `no` or `off`
(case-insensitive); default on. When off, `startScheduler()` logs `scheduler disabled
(SCHEDULER_ENABLED)` and registers nothing, `reloadJob` registers nothing (an admin enable or
schedule change on that process is saved but scheduled only by the scheduling process), and
`index.ts` skips `checkPodcastConfigAtBoot` (its alert concerns scheduled podcast runs). The admin
**Run** button still works there: it is an explicit person's action and the lease keeps it from
overlapping the main instance. Documented in `server/env.example`.

### 5. Sequenced catch-up

`initScheduler` registers every job as today but collects overdue ones instead of launching them,
then starts one fire-and-forget chain (`runCatchUp`) that runs them **one after another** in
pipeline order (`JOB_PIPELINE_ORDER` in `handlers.ts`: crawl → preassess → assess → select →
publish → social → metrics → newsletter → podcast; unknown names last). Before each step it re-reads
the row and skips a job that is no longer registered (disabled meanwhile) or no longer overdue (its
cron tick ran it meanwhile). `stopScheduler()` ends the chain. Cron ticks keep running in parallel
as today; the in-memory set and the lease prevent overlap with the chain.

The order list is server-side because the server does not import `shared/`; it is the same order as
the client's `JOB_PIPELINE_ORDER`, and `scheduler.md`'s "Adding a New Job" gains the server list.

### 6. Feed favicon and `images.mjs`

- `client/public/images/feeds/29cded6e-b5ef-4053-bc5f-d2d10b7238b7.png` is an ICO. Copy it to the
  scratchpad as `.ico`; convert the largest embedded entry to PNG with ImageMagick
  (`magick "<file>.ico[<largest index>]" out.png`, `magick identify` lists entries) if it is on PATH,
  otherwise with a scratchpad script using `sharp-ico` installed **into the scratchpad**
  (`npm install --prefix <scratchpad> sharp-ico sharp`). Overwrite the original file name. Check with
  sharp metadata that `format` is `png`.
- No optimized variants exist under `client/public/images/optimized/feeds/` (none for any feed), so
  there is nothing to regenerate; do not run `images:optimize`, which would create variants for
  every image.
- `images.mjs`: in `showInfo` and `optimizeAll`, wrap `analyzeImage` in try/catch; on failure
  `console.warn('Skipping <relativePath>: <message>')`, count it, continue. The report's totals line
  adds `Skipped (unreadable): N` when N > 0. `optimizeSingle` keeps failing loudly (one named file).
- Run `npm run images:info --prefix client`: it completes and lists the favicon with its real size.

## Changes

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | `JobRun`: `lastSucceededAt`, `lockedBy`, `lockedUntil` (all nullable, `@map` snake_case). |
| `server/prisma/migrations/<ts>_job_run_lease_and_success/migration.sql` | `npm run db:migrate:create --prefix server -- --name job_run_lease_and_success`; delete any `DROP INDEX "stories_embedding_idx"`; append the `last_succeeded_at` backfill. Applies on the next dev-server restart (report it; `db:generate` needs the server stopped). |
| `server/src/config.ts` | `scheduler`: `enabled` (from `SCHEDULER_ENABLED`), `leaseMinutes: 10`, `leaseRenewMs: 120_000`. |
| `server/src/jobs/scheduler.ts` | `runJob`: claim/start, heartbeat, fenced finish (new private `claimJob`, `renewJobLease`, `finishJob`; `recordFailure` releases too). `isOverdue`: null → false. `initScheduler`: collect overdue, new private `runCatchUp`. `startScheduler`/`reloadJob`: honour `config.scheduler.enabled`. `isJobRunning` async. New export `releaseHeldJobLeases`. |
| `server/src/jobs/handlers.ts` | Export `JOB_PIPELINE_ORDER` (the registry's run order, used by catch-up). |
| `server/src/services/job.ts` | `getJobs`: `running` includes a live lease; omit `lockedBy`/`lockedUntil`. |
| `server/src/routes/admin/jobs.ts` | `await isJobRunning(...)` before 409. |
| `server/src/index.ts` | Shutdown calls `releaseHeldJobLeases()`; skip `checkPodcastConfigAtBoot` when the scheduler is disabled. |
| `server/env.example` | `# SCHEDULER_ENABLED=false` with a comment: for a second process against the production database; admin Run still works there. |
| `shared/types/index.ts` | `JobRun.lastSucceededAt: string \| null`. |
| `client/src/components/admin/JobsTable.tsx` | "Last Success" column and panel row; "Last Completed" → "Last Finished". |
| `client/scripts/images.mjs` | Skip unreadable files with a warning in `showInfo` and `optimizeAll`. |
| `client/public/images/feeds/29cded6e-b5ef-4053-bc5f-d2d10b7238b7.png` | Real PNG, largest ICO entry. |
| `.context/scheduler.md` | Rewrite Overlap prevention (lease, heartbeat, release, admin 409 across instances), Overdue detection (null never overdue; sequenced chain, order, re-check), Error tracking/Run bookkeeping (`lastSucceededAt`, DB clock, catch-up keys on `lastCompletedAt`), new "Disabling the scheduler" (`SCHEDULER_ENABLED`), the podcast paragraph's boot-catch-up sentences, Adding a New Job (server order list), Key Files. |
| `.context/podcast.md` | Automation: the seeded `last_completed_at` and "a fresh dev row has none" sentences now read that a never-completed row never runs at boot; one sentence on the job lease nesting around the episode lease ("The lease"). |
| `.context/deployment.md` | Short "Scheduler during deploys" section: the job lease covers the overlap window; `SCHEDULER_ENABLED=false` for any extra process. |
| `CLAUDE.md` | `scheduler.md` row: "Job registry, overlap prevention (job lease), catch-up, concurrency, admin API". |
| `BACKLOG.md` | Delete the `images:info` item and the five scheduler items. |

`seed-jobs.ts`, the podcast job handlers and `podcastGuards.ts` need no change (they read
`enabled` only).

## Tests

`server/src/jobs/scheduler.test.ts` (mock `$executeRaw`/`$queryRaw` on `mockPrisma`; fake timers):
- Claim returns 1: handler runs; finish statement carries the job name and this process id; success
  writes `last_succeeded_at`, failure does not and writes `last_error`.
- Claim returns 0 with the row present: handler not called, no alert, `runningJobs` cleared. Row
  missing: failure path, alert.
- Heartbeat renews every `leaseRenewMs` while the handler is pending and stops after; a renewal
  matching 0 rows warns once and the handler still completes.
- `isOverdue` with null `lastCompletedAt` → not run at boot (replaces the current tests that expect
  a run).
- Catch-up: rows returned as assess then crawl, both overdue → crawl's handler is called first, and
  assess's only after crawl's promise resolves; a job whose re-read row is no longer overdue is
  skipped; `stopScheduler()` mid-chain prevents the next step.
- `config.scheduler.enabled = false`: `startScheduler` never calls `findMany`; `reloadJob` schedules
  nothing.
- `releaseHeldJobLeases` fences on this process id.

`server/src/routes/admin/jobs.test.ts`: run route answers 409 when only the database lease is live.
GET reports `running: true` for a live lease and omits the lock fields.

`server/src/index.test.ts`: shutdown calls `releaseHeldJobLeases`; boot skips the podcast config
check when the scheduler is disabled.

No tests for `images.mjs` (CLI script; verified by running `images:info`) or the Jobs page labels.

## Implementation notes (2026-10-07)

- The lease lives in its own module, `server/src/jobs/jobLease.ts` (claim-and-start, heartbeat,
  fenced finish, live-lease query, shutdown release), rather than in `scheduler.ts`;
  `releaseHeldJobLeases` is exported from there.
- The claim also succeeds where `locked_by` is already this process (a lease its own failed finish
  left behind), so a process never locks itself out for 10 minutes; `runningJobs` still guards
  same-process overlap.
- `getJobs` and `isJobRunning` read live leases with one raw query on the database clock
  (`jobsWithLiveLease`), not `lockedUntil > new Date()`.
- Seven feed favicons, not one, were ICO or BMP files saved as `.png`; all seven are converted.

## Out of Scope

- Converting `.ico` (and other non-PNG) favicons to PNG when `favicon.ts` saves them: it writes the
  raw bytes of any `image/*` response to `<id>.png`, which is how this file arrived. Follow-up.
- Aborting a handler whose job lease was lost (handlers are not cancellable).
- Waiting for cron jobs in the SIGTERM drain.
- The newsletter week unique constraint (separate backlog item).
- Running catch-up when a job is enabled from the admin (still waits for its schedule).

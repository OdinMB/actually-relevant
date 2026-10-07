---
id: ADR-0017
title: Fence every job run with a heartbeat-renewed lease on its job_runs row, claimed atomically on the database clock
status: superseded
superseded-by: ADR-0020
date: 2026-10-07
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [handover]
tags: ["scheduler"]
---

# ADR-0017 · Fence every job run with a heartbeat-renewed lease on its job_runs row, claimed atomically on the database clock

## Context

The scheduler runs every job in-process with node-cron, and its only overlap guard was
`runningJobs`, a set in the memory of one process. During a zero-downtime deploy on Render the old
and the new instance run side by side, both with the scheduler on, so the new instance's boot
catch-up could start a job while the old instance's cron run of the same job was still under way.
A second process pointed at the production database would have done the same.

Each job already has one row in `job_runs`. Job durations vary widely and with load: a crawl or an
assessment run can take minutes or much longer as feed volume grows, while the podcast job holds
its own episode lease (ADR-0003), which orders cron runs against admin actions (ADR-0009). Prisma's
connection pool may run consecutive queries on different connections, which is why ADR-0003 ruled
out session-level advisory locks for the podcast.

## Decision

Every run of every job, whatever triggers it (cron tick, boot catch-up, admin Run), claims a lease
on its job's row: `locked_by` (the process id, `hostname:pid:random`) and `locked_until`. The claim
and the start of the run are one conditional `UPDATE` on the database clock that succeeds only
where no live lease exists. The lease lasts 10 minutes and is renewed every 2 minutes while the
handler runs, fenced on `locked_by`. Finishing a run always records its times but clears the lease
only where this process still holds it, and a graceful shutdown releases every lease the process
holds. A run that finds the lease held elsewhere is skipped quietly, with no record and no alert.
The in-memory set stays as the fast path within one process. The job lease and the podcast's
episode lease are independent: a `generate_podcast` run holds both, nested, and admin podcast
actions take only the episode lease.

## Consequences

Two processes can no longer run the same job at once, and the admin Run button answers 409 and the
Jobs page shows "Running" while any process runs the job. A crashed holder blocks its job for at
most 10 minutes, whatever the job's length, so no job needs its lease sized.

What got worse: every run now costs a few more writes (the claim, a renewal every 2 minutes, the
fenced finish), and the bookkeeping is raw SQL rather than the typed Prisma client, so a column
rename is not caught by the type checker. A handler whose lease is lost (a database outage longer
than the lease, or a process paused past it) is not aborted, because handlers are not cancellable;
another process may then start the same job and the two overlap until the first finishes. A cut-off
handler and the next instance can overlap for the few milliseconds between the shutdown release and
the process exit. Revisit if jobs move to a real queue, if handlers become cancellable, or if a
renewal interval of 2 minutes proves too coarse.

## Alternatives considered

- **`pg_try_advisory_lock`** — a session-level lock held by one connection, which Prisma's pool
  does not guarantee; the reason ADR-0003 gives for the podcast lease.
- **A fixed lease sized per job, without renewal** — crawl and assess durations vary with feed
  volume, so a lease long enough for the slowest run would block a crashed job for hours, and one
  too short would let a second instance start a run still under way.
- **A separate `job_leases` table** — one row per job already exists in `job_runs`; a second table
  adds a join and a seed for nothing.
- **Do nothing** — the overlap window is short, but a double crawl or double assessment spends LLM
  money twice and a double newsletter or social run publishes twice.

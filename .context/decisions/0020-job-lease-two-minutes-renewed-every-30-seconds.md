---
id: ADR-0020
title: Hold the job-run lease for 2 minutes and renew it every 30 seconds, both overridable, as ADR-0017 otherwise
status: accepted
date: 2026-10-07
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
supersedes: ["ADR-0017"]
themes: [handover]
tags: ["scheduler"]
---

# ADR-0020 · Hold the job-run lease for 2 minutes and renew it every 30 seconds, both overridable, as ADR-0017 otherwise

## Context

ADR-0017 fenced every job run with a lease on its `job_runs` row, claimed atomically on the
database clock and renewed by a heartbeat while the handler ran. It set the lease to 10 minutes,
renewed every 2 minutes, both hard-coded in `config.ts`. The lease length is how long a crashed or
killed holder blocks its job: a deploy whose old instance died without its SIGTERM release left
the next instance unable to run that job for up to 10 minutes.

Reviewing ADR-0017 on 2026-10-07, the owner asked, as the coordinating session relayed it, whether
10 minutes were necessary: "Why not, say, 2 minutes + renewed if job is still running?". With a
heartbeat, the lease only has to outlast the longest gap between two renewals that a live run can
suffer, not the run itself. The coordinating session settled on 2 minutes renewed every 30
seconds, unless a job could stall its process's event loop, or a renewal's database round trip
could take, longer than about 90 seconds, in which case 3 minutes renewed every 45 seconds.

What can delay a renewal, as the code stood: the renewal is a `setInterval` callback, so only
synchronous work on the event loop or a slow database write delays it. Every database (Prisma),
LLM (LangChain/OpenAI), HTTP (axios), ElevenLabs and Bunny call in the jobs is async; ffmpeg runs
as a child process. The longest synchronous sections are one JSDOM + Readability or cheerio parse
of an article page, which the extractor skips above `crawl.maxParseBytes` (2 MB), and one
`rss-parser` parse of a feed, whose fetch is capped at 5 MB; on the production instance's 0.5 vCPU
these take seconds at most, and the crawl runs at most two at once with awaits between them. A
renewal is a single-row `UPDATE` on `job_runs`; when the connection pool is starved, Prisma's pool
timeout (10 seconds by default) fails it well inside one 30-second tick, and a failed renewal is
logged and retried at the next tick. Nothing found came near 90 seconds.

## Decision

We hold the job-run lease for 2 minutes and renew it every 30 seconds while the handler runs,
which gives a live run four renewal chances before its lease can run out. Both are environment
overridable in whole seconds, `JOB_LEASE_SECONDS` (default 120) and `JOB_LEASE_RENEW_SECONDS`
(default 30), parsed by `parseJobLeaseTiming` in `server/src/config.ts`, which refuses to start on
a value that is not a positive whole number or on a renewal interval longer than half the lease.
The lease is computed on the database clock as `make_interval(secs => …)`.

Everything else ADR-0017 decided stands unchanged: every run of every job, whatever triggers it,
claims the lease on its job's `job_runs` row (`locked_by`, `locked_until`) in one conditional
`UPDATE` on the database clock that also starts the run; renewal is fenced on `locked_by`;
finishing clears the lease only where this process still holds it; graceful shutdown releases
every lease the process holds; a run that finds the lease held elsewhere is skipped quietly; the
in-memory set stays as the fast path within one process; and the job lease is independent of the
podcast's episode lease.

## Consequences

A crashed or killed holder now blocks its job for at most 2 minutes instead of 10, so a deploy
that loses its SIGTERM release delays the next run of a job by at most 2 minutes. Deployments
need set nothing.

What got worse: renewals are four times as frequent, one single-row write every 30 seconds per
running job instead of every 2 minutes. The margin against a stall is smaller: a live run whose
event loop stalls, or whose renewals all fail, for about 90 seconds on end now loses its lease,
where before it took about 8 minutes, and another process may then start the same job while the
first is still running (ADR-0017's accepted overlap, now reachable by a shorter stall). Revisit,
raising both values together through the environment, if a job gains long synchronous work, such
as an in-process parse of a much larger document, if `lost the job lease` warnings appear in the
logs, or if the database is moved somewhere a single-row write can take tens of seconds.

## Alternatives considered

- **Keep 10 minutes renewed every 2 minutes (ADR-0017)** — a safe margin against stalls that the
  code does not produce, paid for with a 10-minute block after every unreleased crash.
- **3 minutes renewed every 45 seconds** — the fallback the coordinating session named for the
  case where a job could stall the event loop or a renewal for more than about 90 seconds; the
  investigation found no such case, so it buys margin nothing needs.
- **A lease shorter than 2 minutes** — cuts the crash block further but leaves less room for a
  pool timeout plus a slow parse to cost a renewal, for a gain that matters little against the
  jobs' cron spacing.
- **Hard-coded values without an override** — the prior form; an override lets an operator widen
  the margin without a release if `lost the job lease` ever shows up.

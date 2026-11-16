---
id: ADR-0059
title: "Run the story pipeline as chains of steps from one start time, with per-job OpenAI flex processing that falls back to standard, and record each run's cost"
status: accepted
date: 2026-11-16
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, cost]
tags: ["scheduler", "chains", "flex", "openai", "cost"]
---

# ADR-0059 · Run the story pipeline as chains of steps from one start time, with per-job OpenAI flex processing that falls back to standard, and record each run's cost

## Context

The pipeline ran as separately timed jobs (select 02:05, research 02:20, publish 02:45 UTC), each
timed to finish before the next started. OpenAI's flex processing halves token prices for the same
models but publishes no wait times and may refuse calls (429, not charged) when busy, so guessed
gaps between jobs would break under it. The owner asked on 2026-11-16 for grouped jobs, a flexible
publication time, flex as an option per job, and each job's last-run cost and duration on the Jobs
page (design: pm project files, `story-directions/2026-11-16_pipeline-chains-and-flex.md`).

## Decision

- **A chain is a job whose run is its steps in order** (`jobs/chains.ts`): it reuses the job row,
  lease, overdue catch-up, failure notice and interrupted-run resume; its steps are ordinary jobs
  that never run on their own schedule. Two chains: Intake (crawl, pre-assess, assess) four times a
  day, and the Daily edition (select, research, publish) at 23:00 UTC.
- **Each step is On, Off or Review**, stored as the step's own `enabled` plus `pause_for_review`, so
  every reader of a step's flag (enable checks, research's switch, the publish gate) keeps working.
  Review pauses the chain until a person continues it. A failed step stops the chain; the next
  scheduled run starts from the first step again (every step works off what is left), and the Jobs
  page can resume from the failed step. Only a run cut off by a restart resumes mid-chain on its own.
- **Flex is applied in one place, the OpenAI client's fetch** (`services/openaiFetch.ts`), driven by
  an AsyncLocalStorage run scope the scheduler opens around each job (`lib/runUsage.ts`). No call
  site changes. A refused flex call is tried three times, then sent at standard price; after a
  chain's flex cut-off (03:30 for the daily edition) everything goes at standard price; after its
  deadline (05:00) research starts no further story. Calls outside a job (admin clicks) are standard.
- **Cost is recorded from the same fetch**: tokens from each answer at the tier OpenAI answered at,
  priced at list prices (`config.llm.modelPrices`), plus research's web searches, stored per job in
  `job_runs.last_run_usage`.

## Consequences

- Stories publish when the daily edition's research is done, between about 23:30 and 05:00 UTC,
  instead of at 02:45.
- Flex starts on for pre-assess and assess only (a week's measurement); the other jobs are one switch
  away.
- The recorded cost is an estimate from list prices, not the invoice; research's own cap keeps
  pricing calls at standard, an upper bound.
- Not built from the design: per-step monthly budget caps, an item-failure threshold that stops a
  chain, auto-continue after a review timeout, and the Weekly and Monthly chains (their jobs keep
  their fixed times; they have the Flex switch and costs).

## Alternatives considered

- **Only add flex to today's jobs and widen the gaps.** Simpler, but timing stays guessed, and
  review points would need building separately later.
- **A separate chains table.** Rejected: a chain needs everything a job row already has (schedule,
  lease, catch-up, resume, notices).
- **Wrapping every model call site for flex and fallback.** Rejected: a dozen call sites, and
  LangChain's fallbacks do not compose with `withStructuredOutput`.

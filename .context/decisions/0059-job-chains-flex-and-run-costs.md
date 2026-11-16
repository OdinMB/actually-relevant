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
  that never run on their own schedule. The Daily edition, from 23:00 UTC: pre-assess,
  assess, select, research, publish, social post. Crawling stays its own job four times a day, since a
  feed lists only its newest articles and a once-a-day crawl would lose a busy feed's articles;
  assessing several times a day bought nothing while selection runs once a day (owner, 2026-11-16).
- **Two weekly chains** (owner, 2026-11-16): the Weekly Newsletter (Saturday 04:00 UTC: build and
  send the full edition, then Actually Uplifting) and the Weekly Podcast (Friday's slots build both
  shows' episodes, then publish both on Saturday 07:00 Berlin).
- **A step can be held until a time** (`not_before`, "HH:MM" or "Sat 07:00", on the step's own clock):
  the chain ends its run there and a timer goes on at that time, set again from the row at startup.
  The social post waits for 11:30 UTC, when readers are awake, instead of posting at night (owner
  decision 2026-11-16); the podcast's publish steps wait for Saturday morning in Berlin.
- **Every step has the same Enabled switch as any job**, plus a Review switch.
- **Each step is enabled or not, and may be set to Review**, stored as the step's own `enabled` plus `pause_for_review`, so
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

- Stories publish when the daily edition's research is done, by 05:00 UTC at the latest, instead of
  at 02:45; the social post goes out at 11:30 as before.
- Flex is on for every job from the start (owner, 2026-11-16), each one switch away from standard
  price. The day's assessment is one batch at night instead of four smaller ones.
- In a weekly chain a failed step now stops the steps after it: a full newsletter whose test email
  fails holds back the Actually Uplifting issue until someone resumes the chain.
- Another installation can put Review on any step, assess and select included, for a full flow with
  several review points.
- The recorded cost is an estimate from list prices, not the invoice; research's own cap keeps
  pricing calls at standard, an upper bound.
- Not built from the design: per-step monthly budget caps, an item-failure threshold that stops a
  chain, auto-continue after a review timeout, and a Monthly chain (the cleanup keeps its fixed time).

## Alternatives considered

- **Only add flex to today's jobs and widen the gaps.** Simpler, but timing stays guessed, and
  review points would need building separately later.
- **A separate Intake chain (crawl, pre-assess, assess) four times a day.** Built first, then dropped
  on review: assessing before a once-a-day selection gains nothing, and two chains are harder to read.
- **Holding the chain's lease while it waits for the social post's time.** Rejected: hours of a
  running chain on the Jobs page, and a restart would cut the wait short or lengthen it.
- **A separate chains table.** Rejected: a chain needs everything a job row already has (schedule,
  lease, catch-up, resume, notices).
- **Wrapping every model call site for flex and fallback.** Rejected: a dozen call sites, and
  LangChain's fallbacks do not compose with `withStructuredOutput`.

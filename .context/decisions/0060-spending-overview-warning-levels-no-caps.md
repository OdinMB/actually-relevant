---
id: ADR-0060
title: "Spending: monthly spend per job with warning levels and notices instead of caps"
status: accepted
date: 2026-11-16
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, cost]
tags: ["scheduler", "spending", "cost", "notices", "jobs"]
---

# ADR-0060 · Spending: monthly spend per job with warning levels and notices instead of caps

## Context

ADR-0059 records each run's cost in `job_runs.last_run_usage`, which only holds the last run. The
story context design (pm project files, `story-directions/`; plan `2026-11-16_story-context.md`)
first proposed a monthly budget cap per step that pauses the step when reached. The owner decided
on 2026-11-16 against caps: project limits are already set in OpenAI, so a second cap per step
guards little and would stop a feature mid-month. What he wants instead is to see what each job
spends this month and in the months before, and to be told when a job, or all of them together,
passes a level he sets or is heading past it.

## Decision

- **Every finished job run adds its usage to its job's month** in `job_month_spend` (`job_name`,
  the UTC month, cost as billed, standard-price cost, web search USD and credits, runs), in the same
  transaction as the finish write (`finishJobRun`), on success and failure alike. A chain's run adds
  nothing: its steps' runs carry its spend. An interrupted run's spend is lost, as its
  `last_run_usage` already is, a gap of at most one run.
- **Research started by an editor** runs outside any job, so its spend is read from its own
  `story_research_runs` rows (trigger `editor`), the upper bound research's cap counts. Its cap
  stays as it is: web search is not covered by OpenAI's limits.
- **Warning levels, not caps.** `spend_warnings` holds a whole-dollar level per job, for editor
  research and for the total, set on the Dashboard's Spending card. After each job run (and each
  editor research run) the scope's month and the total are compared with their levels. A level
  passed, or a month heading past it at this pace from day 8 on, records one warning notice per
  scope and month (`spend-warn:<scope>:<YYYY-MM>`, insert-only). Nothing pauses or stops on cost.
  No level is seeded.
- **The overview** (`GET /api/admin/spending`) lists every job that uses models (and any other that
  spent) grouped as the Jobs page groups them, with AI and web search spend, the month at this
  pace, the two months before and each level, plus the podcast's voice characters against its cap.
- **Run usage counts items** (`recordItems`, the current scope only) and web search credits, and a
  generic warning on the Jobs page says when more than 20% of at least 20 checked items failed in
  the last run. No job reports items yet; story context will be the first.

## Consequences

- The owner sees the month's spend per job and in total on the Dashboard, and a notice tells him
  once a month when a level is passed or about to be. Jobs keep running whatever they spend.
- Spend is the app's own estimate from list prices (ADR-0059), not the invoice; runs outside the
  app and admin AI actions other than editor research (bulk re-assessing, say) are not counted.
- A month is a UTC month, so the pace and the notices turn over at 00:00 UTC on the 1st.
- Adding a model job to `MODEL_JOBS` (`jobs/modelJobs.ts`) lists it on the card with a dash until
  it spends.

## Alternatives considered

- **A monthly cap per step with an automatic pause**, the earlier design. Rejected by the owner:
  OpenAI's project limits already bound model spend, and a pause stops a feature mid-month. Web
  search, which those limits don't cover, keeps research's own cap and story context's per-run
  bound.
- **Monthly spend in two columns on `job_runs`, reset when the month changes.** Simpler, but it
  keeps no history, and the card shows the two months before.
- **Spend read from OpenAI's usage API.** It would include runs outside the app, but it knows
  nothing of jobs or of Tavily.

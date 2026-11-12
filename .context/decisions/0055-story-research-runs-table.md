---
id: ADR-0055
title: Keep each story research run in its own table, story_research_runs, every run kept, story_id SET NULL on delete, its cost reserved at start against a monthly cap
status: accepted
date: 2026-11-12
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [data, architecture]
tags: ["story-research", "database", "cost", "admin"]
---

# ADR-0055 · Keep each story research run in its own table, story_research_runs, every run kept, story_id SET NULL on delete, its cost reserved at start against a monthly cap

## Context

Story research, the admin action (`.context/story-research.md`), runs a pipeline of about 30-90 s per story that spends real money (OpenAI tokens and Tavily credits). Its result must not touch the story or anything public, editors compare re-runs, and a monthly cap must hold under concurrent starts and restarts. The owner approved the feature on 2026-11-12; the storage choice is the planner's, accepted by the coordinating session.

## Decision

Each run is a row in `story_research_runs` (`story_id` nullable with `ON DELETE SET NULL`, `status` running/completed/failed, `verdict`, `cost_usd`, `tavily_credits`, `result` jsonb with the step models and prices, `error`, `started_at`, `finished_at`), added by migration `20261112050114_story_research_runs`. Every run is kept; the admin lists a story's latest 10. A run is inserted with `cost_usd = $0.25` (the per-run ceiling) as a reservation, inside one transaction with the in-progress and cap checks under the advisory lock `RESEARCH_RESERVATION_LOCK`; on finish the measured cost replaces it, conditional on the row still running. The month's spend is the sum of `cost_usd` over the UTC month's runs, deleted stories' included.

Rule: a run writes only its own row; never add research fields to `stories`.

## Consequences

- Nothing that reads `stories` sees research; public selects stay unchanged.
- Concurrent starts can't overrun the cap or run one story twice. A run cut off by a restart is marked failed after 60 minutes and keeps its reservation.
- A deleted story's runs stay as orphans, reached only by the month's sum, so the cap never undercounts.
- The table grows by one row per run (the default cap bounds it to a few hundred a month); no retention job prunes it yet.

## Alternatives considered

- **Columns on `stories`:** next to published fields and every public select.
- **One JSON blob per story with only the latest run:** no history, and the cap would undercount on re-runs.
- **Recording tokens only and pricing them at display time:** the cap needs a stored USD figure, and prices change.

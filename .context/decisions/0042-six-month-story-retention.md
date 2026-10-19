---
id: ADR-0042
title: Delete unkept stories after 6 months, and repair the clusters the deletion touches
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
supersedes: ["ADR-0039"]
themes: [data]
---

# ADR-0042 · Delete unkept stories after 6 months, and repair the clusters the deletion touches

## Context

ADR-0039 set the retention cutoff at 365 days. On 2026-10-18 the owner shortened it to 6 months (commit `72ecf68`, `config.storyRetention.maxAgeMonths`, `.context/story-retention.md`), so the first run on 2026-11-01 covers about half the corpus instead of the oldest few months. The ADR log is append-only, so the change needs its own entry. A review the same day (`.plans/2026-10-18_improvement-opportunities.md`) also found that the bulk delete left clusters in states `deleteStory()` never leaves them: deleting an old primary nulls `primary_story_id` and nothing re-elects one, and a cluster can be left with a single member. With a 6-month window such clusters become likelier.

## Decision

Everything in ADR-0039 stands except the age: stories crawled more than 6 calendar months ago (on the database clock, `make_interval(months => 6)`) are deleted under the same status and keep rules, counted into `story_archive_counts` in the same statement, and old unpublished stories that are kept lose their embedding. In addition, the delete statement returns the cluster ids of the stories it deleted, and the job repairs those clusters with `repairClusters()`, the helper `deleteStory()` now uses too: a cluster left with one member or none is dissolved, and one that keeps members but lost its primary gets a new one by `updatePrimary()`. The retention SQL and the repair are covered by PostgreSQL integration tests (`storyRetention.db.test.ts`).

## Consequences

Twice as much of the corpus is eligible for deletion, and the "no story reaches `analyzed` without an embedding" guarantee holds only for stories younger than 6 months. Deleted text stays unrecoverable. Clusters stay consistent after a cleanup, and a change to the keep rules now fails a test against a real database before it can delete the wrong rows (when the db tests are run: they are opt-in). Revisit with the same triggers as ADR-0039.

## Alternatives considered

- **Keep 365 days** — fewer deletions, but the owner chose 6 months to stop the growth sooner.
- **Repair every broken cluster in the database on each run** — would also heal clusters broken some other way, but touches clusters the run never changed; limiting it to the touched ones keeps the job's effect explainable from its notice.
- **Skip the repair, since kept members are rejected anyway** — leaves clusters without a primary, which selection and auto-reject treat as having none.

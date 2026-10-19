---
id: ADR-0040
title: Delete unkept stories after 6 months instead of a year
status: accepted
date: 2026-10-18
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [data]
supersedes: ADR-0039 (the 365-day cutoff only)
---

# ADR-0040 · Delete unkept stories after 6 months instead of a year

## Context

ADR-0039 set the `cleanup_old_stories` cutoff at 365 days. On the same day the owner shortened it to 6 months (commit `72ecf68`), to slow the database's growth further. The code and `.context/story-retention.md` say 6 months, while ADR-0039 still says a year; the log is append-only, so the change is recorded here rather than by editing ADR-0039.

## Decision

The cutoff is `config.storyRetention.maxAgeMonths` = 6, applied as a calendar-month interval on the database clock (`make_interval(months => …)`). It governs both what ADR-0039's job does: deleting unkept stories (`fetched`, `pre_analyzed`, `rejected`, `trashed`, with ADR-0039's exceptions) and clearing the embedding of every older unpublished story. The value is owner-set and has no env override, so changing it is a reviewed code change; the admin Jobs page shows it (`jobs/jobSettings.ts`). Everything else in ADR-0039 stands.

## Consequences

Unkept stories are gone after half a year rather than a year, and the "no story reaches `analyzed` without an embedding" guarantee holds only for stories younger than 6 months. Lifetime totals in `story_archive_counts` are unaffected. Revisit together with ADR-0039's triggers (storage limit reached again, or per-story history needed for research).

## Alternatives considered

- **Keep 365 days** — the original decision; the owner judged it too slow to stop growth.
- **An env override for the cutoff** — would let a dashboard edit change what the site deletes for good, with no review.

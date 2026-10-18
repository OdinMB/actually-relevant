---
id: ADR-0039
title: Delete unkept stories after a year, counting them into an append-only summary table in the same statement
status: accepted
date: 2026-10-18
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data]
---

# ADR-0039 · Delete unkept stories after a year, counting them into an append-only summary table in the same statement

## Context

Render warned that the production database is approaching its storage limit. Until now rejected and trashed stories were kept indefinitely (`.context/story-pipeline.md`), each with its full article text and, when fully assessed, a 1536-dimension embedding. Most crawled stories are never published. The owner wants the database to stop growing, not to shrink, and still wants to say "we looked at X stories, Y were rated Z". The owner approved the plan in session on 2026-10-18 and added that old unpublished stories that are kept should lose their embeddings, with a way to get one back on publish.

## Decision

A monthly job (`cleanup_old_stories`, 03:00 UTC on the 1st, seeded enabled) deletes stories crawled more than 365 days ago whose status is `fetched`, `pre_analyzed`, `rejected` or `trashed`, except those a social post, newsletter or podcast names and those sharing a cluster with a published story. Each batch selects, deletes and inserts its grouped counts into `story_archive_counts` in one SQL statement. The job then clears the embedding and its content hash of every unpublished story older than the cutoff; publishing regenerates it through the existing `ensureEmbedding` safety net. Every run records an admin notice.

## Consequences

Old unkept stories are gone for good: they cannot be re-assessed or republished, and their text is not recoverable. Lifetime totals by month, feed, issue, status, both ratings and emotion tag remain. The story pipeline's "no story reaches `analyzed` without an embedding" guarantee now holds only for stories younger than a year. Revisit if the storage limit is reached again (shorten the age, or also strip `source_content` from kept stories) or if per-story history is ever needed for research.

## Alternatives considered

- **Strip `source_content` and embeddings but keep every row** — keeps per-story history, but the rows, indexes and AI text fields keep growing.
- **One summary row per combination, upserted** — tidier, but the nullable dimensions need expression indexes Prisma cannot model, and its migration diffing would fight them; append-only rows summed on read avoid both.
- **Count first, delete in a second statement** — a failure or concurrent change between the two could leave counts and deletions out of step.
- **Shrink the database (`VACUUM FULL`)** — not needed: the owner only wants growth to stop, and it locks the table.

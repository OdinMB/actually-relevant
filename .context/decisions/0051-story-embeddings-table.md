---
id: ADR-0051
title: Keep story vectors in their own table, story_embeddings, so writes to stories never touch the HNSW index
status: accepted
date: 2026-11-02
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data, architecture]
tags: ["embeddings", "pgvector", "database", "story-pipeline"]
---

# ADR-0051 · Keep story vectors in their own table, story_embeddings, so writes to stories never touch the HNSW index

## Context

Each story's 1536-dimension embedding sat on `stories` (`embedding`, `embedding_content_hash`, `embedding_generated_at`), covered by the HNSW index `stories_embedding_idx`. The `select_stories` job kept failing with Prisma P2028 (the 15 s interactive-transaction timeout) even after status moves were cut into 100-story chunks (`config.database.moveChunkSize`).

The cause: Postgres can skip index maintenance on an UPDATE only when it writes no indexed column (a HOT update). `status` is indexed, so every status move writes a new row version and adds an entry for it to every index of the table, the HNSW index included: the story's unchanged vector is inserted into the graph again. Measured locally on 30,000 stories with 1536-dim vectors, that cost about 13 ms per story: a 100-story status UPDATE took 1.3 s and a 100-story publish (status, slug and date in one statement) 2.4 s. In production it exceeded 15 s per 100 stories.

## Decision

The vectors live in their own table, `story_embeddings` (`story_id` primary key and foreign key to `stories` with `ON DELETE CASCADE`, `embedding vector(1536) NOT NULL`, `content_hash`, `generated_at`), with the HNSW index `story_embeddings_embedding_idx` on it. A row is written only when a vector is saved (an upsert) or removed (the retention job's delete); writes to `stories` never touch the vector index. The index covers every embedded story, whatever its status.

Migration `20261102120000_story_embeddings_table` copies every stored vector (a missing hash becomes `''`, which matches no content and is regenerated on the next ensure), builds the index after the copy, adds the foreign key, then drops the old index and columns. Readers join the table; `lib/vectors.ts` keeps the row shapes (`embedding_content_hash` aliased from the join) and function signatures. The migration guard (`check:migrations`, `migrations.test.ts`) now protects `story_embeddings_embedding_idx`.

Rule: never put the vector back on `stories` or add an index on a vector there.

## Consequences

- Status moves and publishes no longer pay for the vector index: on the same 30k-story data the 100-story status UPDATE and publish take 3-7 ms (from 1.3 s and 2.4 s).
- At deploy the migration copies one row per embedded story and builds the HNSW index over all of them in one pass (the old index covered the same rows); the deploy waits on that build while the previous server keeps serving. Locally for 30k stories: copy 2.3 s, build 6.5 min at the default `maintenance_work_mem` (64MB), about 1 min at 1GB. The foreign key is added last, under a lock on `stories`, so the server's writes to `stories` are blocked only for the final steps. A vector the previous server saves after the copy is lost with the old column; that story is re-embedded on its next publish or ensure.
- Every vector query is a join; the HNSW index still serves the `ORDER BY e.embedding <=> …` shapes (search, related stories, dedup), with the status filter applied to the index scan's output as before.
- "Has an embedding" now means "has a `story_embeddings` row"; clearing an embedding deletes the row, and deleting a story deletes it by cascade.
- Prisma cannot model the HNSW index, so every generated migration proposes `DROP INDEX "story_embeddings_embedding_idx"` and must have that line deleted, as before with the old name.

## Alternatives considered

- **Smaller chunks.** Bounds each transaction but not the work: the per-story cost stays, and production was already over the timeout at 100.
- **A partial HNSW index on published stories only.** Removes the cost for moves between unpublished statuses, but a publish still inserts into it (the 2.4 s measured), and dedup needs `analyzed` and `selected` vectors too.
- **A longer transaction timeout.** Hides the cost and pins a connection from the small pool for longer.

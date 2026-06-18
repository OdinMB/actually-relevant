# Fix Publish Job Void-Deserialization Crash + Render OOM

- **Date**: 2026-06-18
- **Status**: completed
- **Type**: bugfix
- **Complexity**: simple

## Problem

Every publish path is crashing with Prisma `P2010: Failed to deserialize column of type 'void'`. The `withSlugLock` helper (`server/src/services/story.ts:59`, added in commit `bdfb1ac`) acquires the slug advisory lock with `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\``. `pg_advisory_xact_lock()` returns Postgres type `void`; `$queryRaw` deserializes result columns and cannot map `void`, so it throws. This breaks the publish cron, the admin bulk-status endpoint, and single-story publish.

Because every publish rolls back, nothing drains `status = selected` while crawl→assess→select keeps feeding it, so the backlog grows without bound. The publish path processes that entire backlog in one unbounded pass (`getStoryIdsByStatus('selected')` has no limit; `bulkUpdateStatus` → `ensureEmbeddings` → `fetchStoriesForEmbedding` loads every row in one `IN (...)`, plus a single slug transaction over all ids). That unbounded peak is the Render "memory limit" OOM. Fixing the void bug alone is unsafe: the first successful run over the accumulated backlog would OOM or blow the 15s transaction timeout and re-strand everything.

## Approach

Two coupled changes, both required to ship safely:

1. **Crash fix** — change the advisory-lock acquisition in `withSlugLock` from `$queryRaw` to `$executeRaw`. `$executeRaw` executes the statement (the lock is still acquired server-side) but returns a row count instead of deserializing the `void` column, so the P2010 cannot occur. The return value is already discarded. This matches the existing house pattern (`story.ts:473`, `vectors.ts:102`) and fixes single-story publish outright.

2. **Memory bound** — make `bulkUpdateStatus`'s `published` branch process ids in bounded chunks (`config.publish.chunkSize`, default 100). For each chunk: `ensureEmbeddings(chunk)` then the existing `withSlugLock` transaction (slug batch + status `updateMany`) scoped to that chunk; sum the counts. Because `bulkUpdateStatus` is the **only** caller of `ensureEmbeddings`, chunking here bounds `fetchStoriesForEmbedding`'s `IN (...)`, the embedding `results[]`/`toProcess[]` arrays, and each slug transaction — for every caller (cron *and* the admin bulk-status route) — from a single place.

**Why this placement (alternatives considered):** The initial sketch chunked `ensureEmbeddings` internally *and* added a drain-loop with infinite-loop guards to the cron job — three chunking sites for one concern. Since `ensureEmbeddings` has exactly one caller and `bulkUpdateStatus` already owns "publish this set of ids safely," chunking inside `bulkUpdateStatus` is the deep-module choice: one site, callers unchanged, the cron job and `getStoryIdsByStatus` need no edit (an id-only list is cheap; the OOM driver was the per-row fetch + vectors + transaction, all now chunked). The chunk loop iterates a fixed in-memory array, so there is no re-query and no infinite-loop risk — no guards needed.

**Behavioral nuance (intended):** bulk publish is no longer one transaction across the whole id set — it commits per chunk. There is no cross-batch atomicity requirement in `.specs/story-pipeline.allium` (the `Publish` rule is per-story), and per-chunk commit is strictly better for recovery: a transient failure on a later chunk keeps earlier chunks published, and the next run continues from the remaining `selected`. The per-chunk slug advisory lock preserves the slug-collision guarantee `bdfb1ac` added. Net publish behavior per run is unchanged (all `selected` still get published), so the spec is unchanged.

## Changes

| File | Change |
|------|--------|
| `server/src/services/story.ts` | (a) `withSlugLock` (~line 59): `tx.$queryRaw` → `tx.$executeRaw` for the `pg_advisory_xact_lock` acquisition (keep the tagged template + `::bigint` cast). (b) `bulkUpdateStatus` `published` branch (448-499): wrap the existing `ensureEmbeddings` + `withSlugLock` work in a loop over `config.publish.chunkSize`-sized slices of `ids`, accumulating `count`. The non-`published` branch is unchanged. |
| `server/src/config.ts` | Add `publish: { chunkSize: parseInt(process.env.PUBLISH_CHUNK_SIZE || '100', 10) }` to the config object. |
| `server/src/jobs/publishStories.ts` | No code change (delegates to `bulkUpdateStatus`, now bounded). Add a one-line comment noting bounded chunking happens in `bulkUpdateStatus`. |
| `server/src/routes/admin/stories.test.ts` | Update lock-call assertions for the `$queryRaw`→`$executeRaw` switch: lines ~327/360/389 assert the lock via `$executeRaw` (not `$queryRaw`); line ~362 — `$executeRaw` is now called once (the lock) for the no-slug case; line ~391 — `$executeRaw` is now called twice (lock + batched slug `UPDATE`). |
| `server/src/services/story.test.ts` | Add a chunking test for `bulkUpdateStatus(ids, 'published')`: with a small `chunkSize` (injected via `vi.mock('../config.js')`) and ids spanning >1 chunk, assert `ensureEmbeddings` and the `$transaction`/lock run once per chunk and `count` sums across chunks. Falls back to a route-level test with `chunkSize+1` ids if the config mock proves fragile. |
| `server/src/jobs/publishStories.test.ts` | **New.** Minimal regression test for the previously-untested cron: empty `selected` → `bulkUpdateStatus` not called; non-empty → called once with the fetched ids and the published count logged. *Responsibility:* guard the publish-job wiring. *Exports:* none (test file). |
| `.context/story-pipeline.md` | Update the `selected → published` paragraph (line 34): bulk publish now processes `selected` in bounded chunks (`config.publish.chunkSize`), each chunk in its own slug-locked transaction (no longer one transaction for the whole set). Add a one-line gotcha at the `withSlugLock` description: the advisory lock uses `$executeRaw`, not `$queryRaw`, because `pg_advisory_xact_lock()` returns `void` (which `$queryRaw` cannot deserialize → P2010). Note `PUBLISH_CHUNK_SIZE` env override. |

## Tests

Logic-bearing tests only:

- **`story.ts:59` void fix** — cannot be caught by a unit test: the `void` deserialization happens only in the Prisma query engine against real Postgres; every existing test mocks Prisma (`$queryRaw` is `vi.fn().mockResolvedValue([])`). The route-test assertion updates verify the lock is now issued via `$executeRaw`, but **not** that the real `void` failure is gone. Documented as a known gap — only an integration test against real Postgres (e.g. testcontainers/PGlite) would guard this class; standing up that harness is **out of scope** (follow-up).
- **`bulkUpdateStatus` chunking** (`story.test.ts`) — branch/loop logic: >1 chunk runs `ensureEmbeddings` + lock transaction per chunk; `count` sums across chunks; single-chunk path matches today's behavior.
- **`publishStories` job** (`publishStories.test.ts`) — empty vs non-empty `selected` branch; delegates to `bulkUpdateStatus` with the fetched ids.
- **Route assertion updates** (`stories.test.ts`) — keep the existing N+1/timeout guards (slugs written in one batched `$executeRaw`, no per-story `story.update`) intact while switching the lock assertions to `$executeRaw`.

## Out of Scope

- **Integration test harness** (testcontainers/PGlite) to catch the `void`/`$queryRaw` deserialization class against real Postgres — noted as the only thing that would have caught this; deferred to a dedicated follow-up.
- **Bounding the admin bulk-status request size at the HTTP layer** — chunking inside `bulkUpdateStatus` already bounds memory/transaction per chunk regardless of request size; an explicit max-ids cap on the endpoint is a separate hardening.
- **`.specs/story-pipeline.allium` changes** — the `Publish` rule contract is preserved (bounded chunking + per-chunk commit are implementation details).
- **Refactoring the embedding accumulation in `batchGenerateEmbeddings`** (still builds a full `results[]` per call) — now always called with a bounded chunk, so it is no longer a memory risk; deeper streaming is unnecessary.
- **Operational backlog drain** — no separate script: after deploy, the next publish cron run (or a manual trigger) drains the accumulated `selected` backlog in bounded chunks. Plan only documents: deploy → trigger publish → watch Render memory.

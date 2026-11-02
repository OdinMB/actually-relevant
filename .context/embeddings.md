# Semantic Search & Embeddings

## Overview

Stories get vector embeddings generated from their content (titleLabel + title + summary) using OpenAI's `text-embedding-3-small` model. These embeddings power hybrid semantic+text search and related stories on the public API.

## Embedding Generation

### Content Format
```
[Title Label]: [Title]
[Summary]
```
Missing fields are omitted gracefully. If `titleLabel` is null, the title is used alone.

### Content Hash Tracking
A SHA-256 hash of the embedding input string is stored with the vector (`story_embeddings.content_hash`; read back as `embedding_content_hash` / `embeddingContentHash` by `lib/vectors.ts`, null when the story has no embedding). This detects stale embeddings when content changes. An empty hash (a vector copied by the 2026-11-02 migration without one) matches no content, so the next ensure regenerates it.

### Trigger Points

Embeddings are generated **before** the state change is committed during assessment. If embedding generation fails (after the OpenAI SDK's 3 retries; `llm-analysis.md`, "Retries"), the assess operation rolls back. No story reaches `analyzed` without a valid embedding, and since publish requires a prior `analyzed` state, published stories are guaranteed to have embeddings. The exception is age: the monthly `cleanup_old_stories` job deletes the embedding row of every unpublished story crawled more than 6 months ago (`story-retention.md`), and the publish safety net below generates it again.

1. **On assessment** (`assessStory`): Embedding generated from LLM analysis results, saved atomically with the analysis data
2. **On admin edit** (`updateStory`): when the story is or becomes published, the embedding is brought up to date from the merged content and saved atomically with the edit. An edit of title/titleLabel/summary fails if generation fails; a publish without such an edit (e.g. a body of only `{ status: 'published' }`) generates a missing or stale embedding and, like the other publish paths, goes ahead without it if generation fails. No embedding call when nothing changed (the content hash matches)
3. **Backfill script**: `npm run migration:backfill-embeddings --prefix server` for existing stories

The publish step uses `ensureEmbedding()` / `ensureEmbeddings()` as a safety net. These check if an embedding exists and generate one only if missing (e.g., when an admin manually publishes an unassessed story, or an old story whose embedding the retention job cleared). For stories that went through the normal pipeline, this is a no-op.

## Hybrid Search (RRF)

When `getPublishedStories` gets a `search` query (the `search` parameter of `GET /api/stories`, set from the stories list page), it switches from the normal chronological listing to **Reciprocal Rank Fusion** (`hybridSearch()` in `server/src/services/storySearch.ts`). The two legs run in parallel, both limited to published stories and both honouring the optional `issueSlug` filter (an issue and its child issues, or the feed's issue when the story has none):

- **Semantic leg:** embeds the query, then takes the top `RRF_FETCH_LIMIT` (50) published stories by cosine distance (`story_embeddings` joined to `stories`, `e.embedding <=> query_vector`). If the embedding or the query fails, this leg returns nothing and search falls back to text-only.
- **Text leg:** a case-insensitive `contains` match on `title` or `summary`, ordered by `datePublished` desc then `dateCrawled` desc, top 50.

RRF score: `score(d) = Σ 1/(RRF_K + rank)` with `RRF_K = 60` and 1-based ranks. A story found by both legs scores higher, and one found by only one leg still gets a score. Results are sorted by score descending (`fuseRankings()`, a pure function with its own unit tests; a tie keeps the semantic leg's order first) and paginated (`page`, `pageSize`, default 25). The positivity slider does not apply to search.

## Related Stories

`GET /api/stories/:slug/related` (`getRelatedStories()` in `server/src/services/relatedStories.ts`):

1. **Cache check:** a hit fetches the source and the cached IDs in one query limited to `published`. If the source is no longer published the entry is dropped and the result is empty; otherwise the cached stories that are still published come back in cached order, sliced to `limit`. An unpublished story therefore never appears in a server answer, whenever it was cached.
2. **Source check:** the source story must exist, be published and have an embedding (a `story_embeddings` row). Otherwise the result is empty.
3. **Candidate pool:** `displayCount × candidateMultiplier` (4 × 3 = 12) nearest published stories with embeddings by cosine distance to the source's vector, excluding the source.
4. **Small pool:** if there are no more candidates than `displayCount`, the LLM is skipped and all candidates are returned in cosine order.
5. **LLM re-rank:** otherwise the LLM picks the most editorially relevant candidates, using title label and title. Returned IDs not in the candidate pool are discarded. If the LLM call fails or no valid IDs come back, the top `displayCount` in cosine order are used instead.

The result is always computed and cached for `displayCount` IDs, then sliced to the requested `limit` (the route validates `limit` as an integer 1-10, else 400). The model tier is `relatedStories.modelTier` (`small`). Config is under `relatedStories` in `server/src/config.ts`: `displayCount` 4, `candidateMultiplier` 3, `cacheHours` 72, `httpCacheSeconds` 259200. Prompt: `server/src/prompts/related-stories.ts`. Schema: `relatedStoriesResultSchema` in `server/src/schemas/llm.ts`.

### Cache

A `TTLCache` (`server/src/lib/cache.ts`) in `relatedStories.ts`, per process and lost on restart. The key is the source story's slug and the value is the source's id with the ordered list of related story IDs. Each entry expires after `relatedStories.cacheHours` (72h). At `MAX_RELATED_CACHE_SIZE` (500) entries, setting a new slug drops the expired entries, then the oldest. Concurrent misses for one slug share one computation, so a burst of first visitors costs one LLM call. A source with no candidates is not cached.

When a story leaves `published` (any editor status move, or a duplicate auto-rejection, in `storyLifecycle.ts`) or is deleted (`deleteStory`), its own entry is dropped (`forgetRelatedStories`); other paths are covered by the published check on every hit. Other stories' lists that name it simply leave it out until they expire.

**HTTP cache:** the route still sends `Cache-Control: public, max-age=259200` (`httpCacheSeconds`, 72 h), so a browser or CDN that cached a response can show a now-unpublished story's link for up to that long (it leads to a 404). Kept on purpose: the long lifetime is what spares the LLM re-rank on repeat visits; shorten `httpCacheSeconds` if unpublished stories must vanish from every client sooner. Why the re-rank runs on the public request path at all, and when to revisit that: ADR-0043.

The search-query embedding cache in `embedding.ts` (`generateSearchEmbedding`) is the same `TTLCache`: 50 entries, 1 hour, keyed by the trimmed lowercased query, concurrent identical queries sharing one call.

## Database

### Table `story_embeddings` (Prisma `StoryEmbedding`, `story.embedding`)
One row per embedded story; a story with no row has no embedding.
- `story_id` — primary key, foreign key to `stories.id` (`ON DELETE CASCADE`: deleting a story deletes its embedding)
- `embedding` — `vector(1536)` via pgvector, not null
- `content_hash` — `VARCHAR(64)`, SHA-256 hex of input content (empty when unknown)
- `generated_at` — `TIMESTAMP(3)`

Saves are upserts (`INSERT … ON CONFLICT (story_id) DO UPDATE`, `lib/vectors.ts`); clearing an embedding deletes the row (`story-retention.md`). Readers join `stories` for status and content.

### Index
HNSW index for cosine similarity: `story_embeddings_embedding_idx` (`vector_cosine_ops`), over every embedded story whatever its status. HNSW was chosen over IVFFlat because it does not require training data and maintains good recall regardless of when it is created. The query must order by the `<=>` (cosine distance) operator to use this index.

**The status filter runs after the index scan.** An HNSW scan hands over about `hnsw.ef_search` nearest rows (pgvector's default: 40) and only then do the query's own filters (published, issue, date window) drop rows, so a filtered query can return far fewer than its limit: measured on 30k stories with 30% published, search asked for 50 and got 15. Two rules follow:
- **Every vector query with a structural filter** (search, which may also filter by issue; related stories; the eval's related fixture) goes through `queryNearest()` / `nearestSettings()` (`lib/vectors.ts`), scoped to its transaction with `SET LOCAL`. On pgvector 0.8+ (production runs 0.8.0) it sets `hnsw.iterative_scan = strict_order`: the scan keeps going until the LIMIT is filled, in exact distance order, up to `hnsw.max_scan_tuples` (20,000 by default, more than the 14,494 vectors production held on 2026-11-02), so a narrow filter such as one issue still gets its full results. It also raises the first batch, `hnsw.ef_search`, to `config.embedding.efSearch` (400), which is all an older pgvector gets: there the same search returned all 50 (about 45 ms), but an issue holding 3% of the vectors would get about 12. The version is read once per process (`hasIterativeScan`).
- **Dedup** never uses the index: its 14-day window would drop nearly all of an index scan's candidates (measured: 1 of 6 returned). `findNearestCandidates()` filters into a `MATERIALIZED` CTE first and computes exact distances over the window (about 18 ms for the window locally). Exact beats even the iterative scan here: the window is small and bounded, and an iterative scan would walk vectors from all time to find six recent ones. The eval's dedup fixtures do the same (`ORDER BY (a <=> b) + 0`, an order the index cannot serve).
A new vector query either filters little (and uses `queryNearest`) or bounds its rows first (and computes exact distances, as dedup does).

**Why the vectors have their own table (ADR-0051).** Postgres adds an entry to every index of a row for each UPDATE that writes an indexed column, and `status` is indexed. While the vector was a column of `stories` (until 2026-11-02, index `stories_embedding_idx`), every status move re-inserted the unchanged vector into the HNSW graph: about 13 ms per story locally on 30k stories (a 100-story status UPDATE 1.3 s, a 100-story publish 2.4 s), over 15 s per 100 in production, so `select_stories` failed with P2028. With the vectors in `story_embeddings`, the same 100-story UPDATEs take 3-7 ms on the same data, and the search, related-stories and dedup queries still use the index (EXPLAIN ANALYZE, 5-10 ms). **Never put the vector back on `stories` or add a vector index there**; anything that writes a vector writes `story_embeddings`.

**Migration cost.** `20261102115900_drop_stories_embedding_idx` drops the old index on its own first, so its 148 MB are free before the copy (in one migration they would return only at commit; production was 900 MB of 1 GB on 2026-11-02). `20261102120000_story_embeddings_table` then copies one row per embedded story and builds the index over all of them. Locally, for 30k stories: copy about 2.3 s; index build 6.5 min at Postgres's default `maintenance_work_mem` (64MB: the graph stops fitting after about 10k vectors) and about 1 min at 1GB; the index is 234 MB. A rebuild of the index costs the same.

**Prisma** cannot model the index, so every generated migration proposes `DROP INDEX "story_embeddings_embedding_idx"`: delete it (`database-migrations.md`; `check:migrations` fails on it). All vector reads and writes are raw SQL (`$queryRaw`/`$executeRaw`) since Prisma's `Unsupported` type has limited query support.

## Configuration

In `server/src/config.ts` under `embedding`:
- `model` — OpenAI model name (default: `text-embedding-3-small`)
- `dimensions` — Vector dimensions (default: `1536`)
- `batchSize` — Stories per API batch call (default: `100`)
- `concurrency` — Parallel batch limit for backfill (default: `5`)
- `delayMs` — Rate limit delay between API calls (default: `100`)

All configurable via `EMBEDDING_*` environment variables.

## Backfill Script

```bash
npm run migration:backfill-embeddings --prefix server              # process all missing
npm run migration:backfill-embeddings:test --prefix server         # dry run (first 3)
npm run migration:backfill-embeddings --prefix server -- --override  # regenerate all
```

Uses raw SQL for fetching (bypasses Prisma type limitations), processes in batches with semaphore-controlled concurrency.

## Key Files

| File | Purpose |
|------|---------|
| `server/src/services/embedding.ts` | Core embedding service (generate, hash, batch) |
| `server/src/services/embedding.test.ts` | Unit tests |
| `server/src/lib/vectors.ts` | Raw SQL embedding persistence and reads (`saveEmbedding`, `saveEmbeddingTx`, `searchByEmbedding`) |
| `server/src/services/storyLifecycle.ts` | Embeddings ensured on publish (outside the transaction), re-embedding of refreshed published stories |
| `server/src/services/storyWrites.ts` | Embeddings on edits of published stories |
| `server/src/services/storySearch.ts` | Hybrid (RRF) search |
| `server/src/services/relatedStories.ts` | Related stories, their re-rank and cache |
| `server/src/prompts/related-stories.ts` | Related-stories re-rank prompt |
| `server/src/services/analysis.ts` | Assessment with atomic embedding save |
| `server/src/scripts/migrations/backfill-embeddings.ts` | Backfill script |
| `server/src/config.ts` | Embedding configuration |
| `server/prisma/schema.prisma` | `StoryEmbedding` model (pgvector field) |
| `server/prisma/migrations/20261102120000_story_embeddings_table/migration.sql` | The table, the copy from `stories`, the HNSW index |
| `server/src/scripts/check-migrations/rules.ts` | Guard against a migration dropping the index |

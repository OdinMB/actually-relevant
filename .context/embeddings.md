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
A SHA-256 hash of the embedding input string is stored as `embedding_content_hash`. This detects stale embeddings when content changes.

### Trigger Points

Embeddings are generated **before** the state change is committed during assessment. If embedding generation fails (after 3 retries via `withRetry`), the assess operation rolls back. No story reaches `analyzed` without a valid embedding, and since publish requires a prior `analyzed` state, published stories are guaranteed to have embeddings.

1. **On assessment** (`assessStory`): Embedding generated from LLM analysis results, saved atomically with the analysis data
2. **On edit of published story** (`updateStory`): Regenerates if title/titleLabel/summary changed, saved atomically with the edit
3. **Backfill script**: `npm run migration:backfill-embeddings --prefix server` for existing stories

The publish step uses `ensureEmbedding()` / `ensureEmbeddings()` as a safety net. These check if an embedding exists and generate one only if missing (e.g., when an admin manually publishes an unassessed story). For stories that went through the normal pipeline, this is a no-op.

## Hybrid Search (RRF)

When `getPublishedStories` gets a `search` query (the `search` parameter of `GET /api/stories`, set from the stories list page), it switches from the normal chronological listing to **Reciprocal Rank Fusion** (`hybridSearch()` in `server/src/services/story.ts`). The two legs run in parallel, both limited to published stories and both honouring the optional `issueSlug` filter (an issue and its child issues, or the feed's issue when the story has none):

- **Semantic leg:** embeds the query, then takes the top `RRF_FETCH_LIMIT` (50) by cosine distance (`embedding <=> query_vector`). If the embedding or the query fails, this leg returns nothing and search falls back to text-only.
- **Text leg:** a case-insensitive `contains` match on `title` or `summary`, ordered by `datePublished` desc then `dateCrawled` desc, top 50.

RRF score: `score(d) = Σ 1/(RRF_K + rank)` with `RRF_K = 60` and 1-based ranks. A story found by both legs scores higher, and one found by only one leg still gets a score. Results are sorted by score descending and paginated (`page`, `pageSize`, default 25). The positivity slider does not apply to search.

## Related Stories

`GET /api/stories/:slug/related` (`getRelatedStories()` in `server/src/services/story.ts`):

1. **Cache check:** a hit returns the cached IDs, sliced to `limit`.
2. **Source check:** the source story must exist, be published and have an embedding. Otherwise the result is empty.
3. **Candidate pool:** `displayCount × candidateMultiplier` (4 × 3 = 12) nearest published stories with embeddings by cosine distance, excluding the source.
4. **Small pool:** if there are no more candidates than `displayCount`, the LLM is skipped and all candidates are returned in cosine order.
5. **LLM re-rank:** otherwise the LLM picks the most editorially relevant candidates, using title label and title. Returned IDs not in the candidate pool are discarded. If the LLM call fails or no valid IDs come back, the top `displayCount` in cosine order are used instead.

The result is always computed and cached for `displayCount` IDs, then sliced to the requested `limit`. The model tier is `relatedStories.modelTier` (`small`). Config is under `relatedStories` in `server/src/config.ts`: `displayCount` 4, `candidateMultiplier` 3, `cacheHours` 72, `httpCacheSeconds` 259200. Prompt: `server/src/prompts/related-stories.ts`. Schema: `relatedStoriesResultSchema` in `server/src/schemas/llm.ts`.

### Cache

An in-memory, per-process map in `story.ts`. The key is the source story's slug and the value is the ordered list of related story IDs. Each entry expires after `relatedStories.cacheHours` (72h). Expired entries are swept at most once an hour, on the next request. At `MAX_RELATED_CACHE_SIZE` (500) entries, the entry with the earliest expiry is evicted before a new slug is inserted. The cache is lost when the server restarts.

## Database

### Schema Fields (on `stories` table)
- `embedding` — `vector(1536)` via pgvector
- `embedding_content_hash` — `VARCHAR(64)`, SHA-256 hex of input content
- `embedding_generated_at` — `TIMESTAMP(3)`

### Index
HNSW index for cosine similarity: `stories_embedding_idx`. HNSW was chosen over IVFFlat because it does not require training data and maintains good recall regardless of when it is created. The query must use the `<=>` (cosine distance) operator to use this index.

**Note**: These fields use raw SQL queries (`$queryRaw`/`$executeRaw`) since Prisma's `Unsupported` type has limited query support.

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
| `server/src/lib/vectors.ts` | Raw SQL embedding persistence (`saveEmbedding`, `saveEmbeddingTx`) |
| `server/src/services/story.ts` | Lifecycle hooks, hybrid search, related stories and their cache |
| `server/src/prompts/related-stories.ts` | Related-stories re-rank prompt |
| `server/src/services/analysis.ts` | Assessment with atomic embedding save |
| `server/src/scripts/migrations/backfill-embeddings.ts` | Backfill script |
| `server/src/config.ts` | Embedding configuration |
| `server/prisma/schema.prisma` | Schema with pgvector fields |
| `server/prisma/migrations/20260206120000_add_embedding_fields/migration.sql` | DB migration |

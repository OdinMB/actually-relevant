/**
 * Typed wrapper for pgvector raw SQL operations.
 *
 * Vectors live in `story_embeddings` (one row per story, `.context/embeddings.md`), never on
 * `stories`: a status write to `stories` would otherwise re-insert the vector into the HNSW
 * index (ADR-0051). Prisma's `Unsupported("vector(1536)")` doesn't generate typed fields, so all
 * embedding operations use `$queryRaw` / `$executeRaw`. This module centralizes those queries.
 */

import { Prisma } from '@prisma/client'
import prisma from './prisma.js'

// ──── Types ────────────────────────────────────────────────────────────────

export interface StoryEmbeddingRow {
  id: string
  title: string | null
  titleLabel: string | null
  summary: string | null
  /** The stored embedding's content hash; null when the story has no embedding. */
  embeddingContentHash: string | null
}

/** Raw SQL returns snake_case — mapped to camelCase by the functions below. */
interface RawStoryRow {
  id: string
  title: string | null
  title_label: string | null
  summary: string | null
  embedding_content_hash: string | null
}

function mapRow(row: RawStoryRow): StoryEmbeddingRow {
  return {
    id: row.id,
    title: row.title,
    titleLabel: row.title_label,
    summary: row.summary,
    embeddingContentHash: row.embedding_content_hash,
  }
}

type RawExecutor = { $executeRaw: typeof prisma.$executeRaw }

// ──── Vector Helpers ───────────────────────────────────────────────────────

/** Convert a number array to a pgvector literal string, e.g. "[0.1,0.2,...]" */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/** Insert or replace a story's embedding row; never writes to `stories`. */
async function upsertEmbedding(client: RawExecutor, storyId: string, embedding: number[], contentHash: string): Promise<void> {
  await client.$executeRaw`
    INSERT INTO story_embeddings (story_id, embedding, content_hash, generated_at)
    VALUES (${storyId}, ${toVectorLiteral(embedding)}::vector, ${contentHash}, NOW())
    ON CONFLICT (story_id) DO UPDATE
    SET embedding = EXCLUDED.embedding,
        content_hash = EXCLUDED.content_hash,
        generated_at = EXCLUDED.generated_at
  `
}

// ──── Queries ──────────────────────────────────────────────────────────────

/** Fetch a single story's embedding-relevant fields (any status). */
export async function fetchStoryForEmbedding(storyId: string): Promise<(StoryEmbeddingRow & { status: string }) | null> {
  const rows = await prisma.$queryRaw<(RawStoryRow & { status: string })[]>`
    SELECT s.id, s.status, s.title, s.title_label, s.summary, e.content_hash AS embedding_content_hash
    FROM stories s
    LEFT JOIN story_embeddings e ON e.story_id = s.id
    WHERE s.id = ${storyId}
  `
  const [row] = rows
  if (!row) return null
  return { ...mapRow(row), status: row.status }
}

/** Fetch multiple stories' embedding-relevant fields. */
export async function fetchStoriesForEmbedding(storyIds: string[]): Promise<StoryEmbeddingRow[]> {
  if (storyIds.length === 0) return []
  const rows = await prisma.$queryRaw<RawStoryRow[]>`
    SELECT s.id, s.title, s.title_label, s.summary, e.content_hash AS embedding_content_hash
    FROM stories s
    LEFT JOIN story_embeddings e ON e.story_id = s.id
    WHERE s.id IN (${Prisma.join(storyIds)})
  `
  return rows.map(mapRow)
}

/** Save a story's embedding vector + content hash. */
export async function saveEmbedding(storyId: string, embedding: number[], contentHash: string): Promise<void> {
  await upsertEmbedding(prisma, storyId, embedding, contentHash)
}

/** Save an embedding vector + content hash inside an interactive transaction. */
export async function saveEmbeddingTx(tx: RawExecutor, storyId: string, embedding: number[], contentHash: string): Promise<void> {
  await upsertEmbedding(tx, storyId, embedding, contentHash)
}

/** Search published stories by embedding cosine distance. */
export async function searchByEmbedding(
  queryEmbedding: number[],
  options?: {
    limit?: number
    issueFilter?: Prisma.Sql
  },
): Promise<{ id: string }[]> {
  const limit = options?.limit ?? 50
  const issueFilter = options?.issueFilter ?? Prisma.empty
  const vectorStr = toVectorLiteral(queryEmbedding)

  return prisma.$queryRaw<{ id: string }[]>`
    SELECT s.id
    FROM story_embeddings e
    JOIN stories s ON s.id = e.story_id
    WHERE s.status = 'published'
      ${issueFilter}
    ORDER BY e.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `
}

/**
 * Cursor-based fetch for backfill scripts. Uses its own PrismaClient if provided. Without
 * `overrideMode`, only stories with no embedding, or one whose hash is unknown (the empty hash the
 * 20261102120000 migration gave a vector stored without one).
 */
export async function fetchEmbeddingBackfillBatch(
  cursor: string | undefined,
  limit: number,
  overrideMode: boolean,
  client: { $queryRaw: typeof prisma.$queryRaw } = prisma,
): Promise<StoryEmbeddingRow[]> {
  const hashFilter = overrideMode ? Prisma.empty : Prisma.sql`AND (e.story_id IS NULL OR e.content_hash = '')`
  const cursorFilter = cursor ? Prisma.sql`AND s.id > ${cursor}` : Prisma.empty

  const rows = await client.$queryRaw<RawStoryRow[]>`
    SELECT s.id, s.title, s.title_label, s.summary, e.content_hash AS embedding_content_hash
    FROM stories s
    LEFT JOIN story_embeddings e ON e.story_id = s.id
    WHERE s.status = 'published'
    ${hashFilter}
    ${cursorFilter}
    ORDER BY s.id ASC
    LIMIT ${limit}
  `
  return rows.map(mapRow)
}

/** Save an embedding using a custom PrismaClient (for scripts with their own client). */
export async function saveEmbeddingWithClient(client: RawExecutor, storyId: string, embedding: number[], contentHash: string): Promise<void> {
  await upsertEmbedding(client, storyId, embedding, contentHash)
}

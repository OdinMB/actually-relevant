-- Story vectors move out of "stories" into their own table (ADR-0051, .context/embeddings.md).
--
-- Why: Postgres adds an entry to every index of a row for each UPDATE that writes an indexed column
-- (no HOT update), and "status" is indexed. With the vector on "stories", every status move
-- re-inserted the story's unchanged vector into the HNSW graph of "stories_embedding_idx": about
-- 13 ms per story measured locally on 30k stories (a 100-story status UPDATE took 1.3 s, a
-- 100-story publish 2.4 s), and over 15 s per 100 in production, where select_stories kept failing
-- with P2028 (the 15 s interactive-transaction timeout). In "story_embeddings" a row is written only
-- when its vector changes, so writes to "stories" never touch the vector index.
--
-- Hand-written. Prisma cannot model the HNSW index: a generated migration proposes
-- DROP INDEX "story_embeddings_embedding_idx", which must be deleted (check:migrations fails on it).
--
-- Cost at deploy: one row copied per embedded story, then the HNSW index built over all of them
-- (the old index covered the same rows). The deploy waits on that build. The script
-- runs as one transaction; the previous server keeps serving meanwhile, and a vector it saves to
-- "stories" after the copy is lost with the column: that story has no embedding row, so the next
-- publish or ensure generates it again.

-- CreateTable
CREATE TABLE "story_embeddings" (
    "story_id" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_embeddings_pkey" PRIMARY KEY ("story_id")
);

-- Copy every stored vector. A vector without a hash gets an empty one: it matches no content hash,
-- so the next ensureEmbedding regenerates it (and the backfill script picks it up), as before.
INSERT INTO "story_embeddings" ("story_id", "embedding", "content_hash", "generated_at")
SELECT "id", "embedding", COALESCE("embedding_content_hash", ''), COALESCE("embedding_generated_at", CURRENT_TIMESTAMP)
FROM "stories"
WHERE "embedding" IS NOT NULL;

-- Built after the copy: one bulk build is far faster than inserting row by row into the graph.
-- HNSW needs no training data (unlike IVFFlat). Queries must order by <=> (cosine distance).
CREATE INDEX "story_embeddings_embedding_idx" ON "story_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey: deleting a story deletes its embedding. Added after the copy and the index build:
-- the constraint locks "stories" against writes until the migration commits, so the running server
-- keeps writing stories while the index builds and is blocked only for the steps below. Lock first,
-- then drop the vectors of stories deleted while the index built, so the constraint cannot fail.
LOCK TABLE "stories" IN SHARE ROW EXCLUSIVE MODE;
DELETE FROM "story_embeddings" e WHERE NOT EXISTS (SELECT 1 FROM "stories" s WHERE s."id" = e."story_id");
ALTER TABLE "story_embeddings" ADD CONSTRAINT "story_embeddings_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The old columns (their index went in 20261102115900_drop_stories_embedding_idx).
-- reviewed-destructive: the vectors, hashes and dates were copied into "story_embeddings" above, in this same migration, and no code reads these columns any more
ALTER TABLE "stories" DROP COLUMN "embedding",
DROP COLUMN "embedding_content_hash",
DROP COLUMN "embedding_generated_at";

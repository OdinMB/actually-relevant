-- Written by hand. First of two steps that move story vectors into "story_embeddings" (ADR-0051).
--
-- Drops the old HNSW index on "stories" in a migration of its own, so its disk space (148 MB in
-- production on 2026-11-02, on a 1 GB database 90% full) is released when this commits, before
-- the next migration writes the new table and builds its index. Within one migration the space
-- would come back only at the end. Until the next migration commits, vector queries on the
-- running server scan the ~14,500 stored vectors without an index: slower, still correct.
DROP INDEX "stories_embedding_idx";

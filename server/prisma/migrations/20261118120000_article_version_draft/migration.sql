-- A version keeps its article with each section's cited pool facts (the draft's fact ids), which the
-- reader projection in "research" keeps only one per source: a later research pass judges and
-- rewrites the current version from it (`.context/research-passes.md`, "The later pass"). Null for a
-- legacy version, whose sections take their facts from the projection's citations. Additive: one
-- nullable column on a table no running job writes yet.
-- Written by hand (no index on story_embeddings is touched, so no `story_embeddings_embedding_idx`
-- drop to remove, and `article_versions_one_current` stays as it is).

ALTER TABLE "article_versions" ADD COLUMN "draft" JSONB;

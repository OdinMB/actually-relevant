-- The reader side of story research (.context/story-research.md, "Reader format"), dormant: nothing
-- writes these yet. `stories.research` holds the researched version readers see (cited text and
-- sources); `stories.pre_research` the single-source fields an applied run replaced, for a revert.
-- `source_favicons` stores research sources' favicons by host, a null png meaning "none found".
-- Additive only: two nullable columns (no table rewrite) and a new table.
-- Written by hand in the shape db:migrate:create emits, since the authoring environment had no local
-- database; it carries no DROP INDEX, the story embeddings index included.

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "research" JSONB,
ADD COLUMN     "pre_research" JSONB;

-- CreateTable
CREATE TABLE "source_favicons" (
    "host" TEXT NOT NULL,
    "png" BYTEA,
    "source_url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_favicons_pkey" PRIMARY KEY ("host")
);

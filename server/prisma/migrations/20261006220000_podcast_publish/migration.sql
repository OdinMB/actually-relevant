-- Two-speaker podcast, phase 3: publishing.
-- `published_at` is the first publication (once set, the episode is never regenerated or deleted:
-- its feed GUID and enclosure URL are permanent); `unpublished_at` the last takedown (the
-- automatic publish job never republishes such an episode).
-- Written by hand from the schema change (no `stories_embedding_idx` drop to remove).

-- AlterTable
ALTER TABLE "podcasts" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "unpublished_at" TIMESTAMP(3);

-- Until now "ever published" was a non-legacy row with status `published`; keep such rows permanent.
UPDATE "podcasts" SET "published_at" = "updated_at" WHERE "stage" <> 'legacy' AND "status" = 'published';

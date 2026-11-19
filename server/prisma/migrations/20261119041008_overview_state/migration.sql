-- The overview facts the upkeep, the reviews and Undo read, kept as columns written by the lifecycle
-- in the same transaction as the change they follow, instead of folded from the decision log at each
-- read (.context/overviews.md, "Records"): the story whose end-event report began the current closing
-- and when its closure review ran; who froze the overview and when; when a person last reopened it;
-- where the burst check starts counting; and the OUT entries an editor's undo locked out. Every
-- automated and editor write is a change set over these and the older columns, so Undo inverts them
-- as ordinary fields. Additive: nothing in production holds overview rows yet.

-- AlterTable
ALTER TABLE "overviews" ADD COLUMN     "closing_story_id" TEXT,
ADD COLUMN     "closure_reviewed_at" TIMESTAMP(3),
ADD COLUMN     "frozen_at" TIMESTAMP(3),
ADD COLUMN     "frozen_by" TEXT,
ADD COLUMN     "joins_counted_from" TIMESTAMP(3),
ADD COLUMN     "locked_out" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reopened_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "overviews" ADD CONSTRAINT "overviews_closing_story_id_fkey" FOREIGN KEY ("closing_story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

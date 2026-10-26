-- "Report an error" on story pages: a correction category and the story it was sent from.
-- The FK sets story_id to NULL when retention deletes the story, so the report itself stays.

-- AlterEnum
ALTER TYPE "FeedbackCategory" ADD VALUE 'correction';

-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "story_id" TEXT;

-- CreateIndex
CREATE INDEX "feedback_story_id_idx" ON "feedback"("story_id");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

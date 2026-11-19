-- The overview page a reader's "Report an error" was sent from, and whether that report queued the
-- overview's review (at most one per overview per `overviews.reportReviewEveryDays`). Additive.

-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "overview_id" TEXT,
ADD COLUMN     "queues_review" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "feedback_overview_id_idx" ON "feedback"("overview_id");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_overview_id_fkey" FOREIGN KEY ("overview_id") REFERENCES "overviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "stories_status_date_published_date_crawled_idx" ON "stories"("status", "date_published", "date_crawled");

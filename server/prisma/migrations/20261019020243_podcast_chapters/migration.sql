-- Podcast chapters (.context/podcast.md, "Audio" and "Storage"): the Podcasting 2.0 JSON chapters
-- file written at `ready`, beside the MP3 and VTT. Null on episodes made before chapters existed;
-- the feed leaves their <podcast:chapters> out. "stories_embedding_idx" drop removed.

-- AlterTable
ALTER TABLE "podcasts" ADD COLUMN     "chapters_path" TEXT,
ADD COLUMN     "chapters_url" TEXT;

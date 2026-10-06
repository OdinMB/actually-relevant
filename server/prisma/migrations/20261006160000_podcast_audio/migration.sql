-- Two-speaker podcast, phase 2: audio fields on the episode, voiced chunks kept until upload, and the TTS spend ledger.

-- AlterTable
ALTER TABLE "podcasts" ADD COLUMN     "audio_bytes" INTEGER,
ADD COLUMN     "audio_path" TEXT,
ADD COLUMN     "audio_url" TEXT,
ADD COLUMN     "duration_sec" INTEGER,
ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "transcript_path" TEXT,
ADD COLUMN     "transcript_url" TEXT,
ADD COLUMN     "tts_model_id" TEXT,
ADD COLUMN     "voice_ids" JSONB;

-- CreateTable
CREATE TABLE "podcast_audio_chunks" (
    "id" TEXT NOT NULL,
    "podcast_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "request_id" TEXT,
    "chars" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "podcast_audio_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- The ledger survives episode deletion (SET NULL), so the monthly cap still sees the spend.
CREATE TABLE "podcast_tts_usage" (
    "id" TEXT NOT NULL,
    "podcast_id" TEXT,
    "chars" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "podcast_tts_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "podcast_audio_chunks_podcast_id_index_key" ON "podcast_audio_chunks"("podcast_id", "index");

-- CreateIndex
CREATE INDEX "podcast_tts_usage_created_at_idx" ON "podcast_tts_usage"("created_at");

-- AddForeignKey
ALTER TABLE "podcast_audio_chunks" ADD CONSTRAINT "podcast_audio_chunks_podcast_id_fkey" FOREIGN KEY ("podcast_id") REFERENCES "podcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "podcast_tts_usage" ADD CONSTRAINT "podcast_tts_usage_podcast_id_fkey" FOREIGN KEY ("podcast_id") REFERENCES "podcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

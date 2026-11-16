-- What a job's last finished run did, in a few words ("12 new stories", "nothing to do"), shown on the
-- Jobs page and the dashboard beside its time and cost, so a run with nothing to do no longer looks
-- like a broken one (owner, 2026-11-16). Null until a run reports it.
-- Written by hand (no index on story_embeddings is touched, so no `story_embeddings_embedding_idx` drop to remove).

ALTER TABLE "job_runs" ADD COLUMN "last_run_summary" TEXT;

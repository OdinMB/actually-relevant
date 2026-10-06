---
id: ADR-0003
title: Produce episodes as a stage machine on the Podcast row, fenced by a DB lease, with TTS chunks in Postgres until upload
status: accepted
date: 2026-10-06
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: ["cost"]
---

# ADR-0003 · Produce episodes as a stage machine on the Podcast row, fenced by a DB lease, with TTS chunks in Postgres until upload

## Context

The weekly two-speaker podcast (plan `.plans/autonomous-two-speaker-podcast.md`) produces an
episode in steps that take minutes and, from the audio phase on, spend money per call: an LLM
selection and dialogue, then several billed text-to-speech calls, then an upload. Production runs
in-process on one Render web service whose filesystem is lost on every deploy, and zero-downtime
deploys briefly run two processes side by side. The shared scheduler guards overlap per process
only and never retries a failed run.

Admin pages, routes, the story-deletion cleanup and the shared type all key on the existing
`Podcast` table, which holds a title, a script, story ids and a publication status. Rows from the
old hand-voiced workflow had to keep working. Prisma's connection pool may run consecutive queries
on different connections.

## Decision

Production is a forward-only `stage` on the `Podcast` row (`legacy` for old rows, then `created`,
`scripted`, `voiced`, `ready`), kept separate from the publication `status`. Each stage's output
is persisted before the next stage starts, so a run resumes from the stored stage. A failure never
moves the stage: it sets `lastError` and `failedAt`; blocks and automatic attempts live in their own
fields (`blockedAt`, `blockedReason`, `attempts`). A cross-process lease (`leaseOwner`,
`leaseUntil`) is claimed with an `UPDATE … WHERE lease_until IS NULL OR lease_until < now()` on the
database clock, renewed before every stage, checked on every stage write
(`updateMany where id and leaseOwner = me`, aborting when nothing matches), and released in
`finally` and at shutdown. From the audio phase on, each voiced chunk is stored in a
`podcast_audio_chunks` bytea table before the next call and deleted once the final MP3 is uploaded.

## Consequences

A crash, deploy or pause costs at most the stage in progress, and stored chunks are never paid for
twice. Two processes cannot both advance an episode, and a process that lost its lease after a
pause cannot overwrite the new owner's stage.

What got worse: `Podcast` now mixes content (title, dialogue, show notes) with operations (stage,
lease, error, block, attempts) and will grow audio metadata, about 30 columns in all, and list
queries must select their columns explicitly so they never load the dialogue. Postgres holds a few
megabytes of audio per episode for minutes to hours. The lease relies on raw SQL that compares a
`timestamp without time zone` column with `now() AT TIME ZONE 'UTC'`, which a later change of the
column type would have to follow.

Revisit when a second episode kind or show arrives (then split the operational columns into a
`PodcastRun` table), or when audio files grow large enough that keeping chunks in Postgres strains
the database plan.

As of 2026-10-06 the plan's phase 1 implements the stages up to `scripted` and the lease; the
chunk table arrives with the audio phase.

## Alternatives considered

- **A new `PodcastEpisode` table, or a 1:1 `PodcastRun` table for the operational columns** —
  every admin page, route and the story-deletion cleanup key on `Podcast`, and legacy rows coexist
  as `stage = legacy`; deferred until a second episode kind makes the split pay.
- **`pg_try_advisory_lock` instead of a lease** — a session lock is not reliably held by the code
  that took it when Prisma's pool can run each query on a different connection.
- **A lease without renewal or owner (simplicity review)** — a process paused past the lease could
  overwrite the new owner's stage after billing; the correctness case won.
- **`stage = failed` or `stage = blocked`** — a stage value loses the resume point; error and block
  fields sit beside the stage instead.
- **Chunks in `os.tmpdir()` or in the storage bucket under a work prefix** — tmp is lost on every
  deploy and would re-bill; the bucket would make dry runs and tests depend on storage and expose
  unreleased audio.

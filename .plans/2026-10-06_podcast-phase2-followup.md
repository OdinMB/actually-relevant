# Follow-up: two-speaker podcast, Phase 2 (audio and storage)

Plan: `.plans/completed/2026-10-06_autonomous-two-speaker-podcast.md` (every phase done; archived with Phase 4).

## Controversial Decisions

- **Audio stages in their own module.** `voiceEpisode`/`finishEpisode` live in `services/podcastAudioStages.ts`, not in `podcastPipeline.ts` as the plan's table said; the stage machine keeps the lease and passes the stages a context with `renewLease` and a lease-fenced `storeChunk`. Chunking, continuity and the VTT live in a pure `services/podcastChunks.ts` instead of `podcastDialogue.ts`. Reason: each is a separate reason to change; the pipeline would otherwise have grown TTS, spend, ffmpeg and upload logic beside the lease.
- **Timeouts are not retried** by the ElevenLabs client (a timed-out call may have been billed, and a retry would exceed the chunk's cap reservation). Only a non-quota 429 or a 5xx is retried once. The plan said "withRetry with retries: 1 and a retryOn that refuses every 4xx". Alternative: retry timeouts once and reserve again per attempt. Recorded in ADR-0007.
- **Dry run without loudnorm.** Found at implementation: ffmpeg's `loudnorm` on pure digital silence produces samples that crash LAME. The dry-run stub (silence) is assembled without it; live episodes always get it. Alternative: a near-silent noise stub, which loudnorm would boost to -16 LUFS of audible noise.
- **Assembly with `filter_complex`** (`apad` on every chunk but the last, `concat`, `loudnorm`) instead of the spike's concat demuxer with a silence file.
- **"Ever published" = non-legacy row with `status = published`** until Phase 3 adds `publishedAt`. Regenerate and Delete refuse such rows and rows with a live lease (409); a published legacy (Buzzsprout-era) row stays deletable.
- **Regenerate resets and immediately writes and voices a new episode** (202, background), rather than only resetting and waiting for a Resume. In production that spends TTS characters at once; the confirm dialog says so.
- **Ready notice on any trigger.** `notifyEvent('Podcast episode ready', …)` is sent from `runWeeklyEpisode` whenever a run takes an episode to `ready`, admin runs included, so the Phase 4 cron handler needs none of its own.
- **Configuration check is dry-run aware and trigger-aware**: a dry run needs no ElevenLabs or Bunny credentials (it stops at `voiced` without Bunny, as the plan says); `WEBHOOK_URL` is required only on the cron trigger. Admin actions in production need the three credentials even to write a script (the check runs before any stage).
- **`ttsChars` on the single-row admin response** (episode characters from the ledger) and `GET /api/admin/podcasts/usage` for the month; the admin shows both.
- **Dry-run stub length** = characters / 16 per second (`stubCharsPerSecond`), so a dry-run episode is about as long as a real one.
- **Spike deleted.** Its proven parts moved into `lib/elevenlabs.ts` (endpoint, headers, `character-cost`, `request-id`, continuity) and `lib/podcastAudio.ts` (ffmpeg); the voice-listing, ledger and blind-listening commands were trial tooling and were not kept. The spike's outputs stay in `DOCS/`.

## Decisions to Review

None: ADR-0005 and ADR-0007 name the owner beside the agent, from the plan's confirmation line ("Confirmed by Odin Mühlenbein on 2026-10-06: every decision this plan states"). ADR-0007 was reserved as ADR-0002 and renumbered at promotion, because the log had already reached ADR-0003; the plan's stub and its mentions now say ADR-0007. Its one refinement beyond the plan (timeouts not retried) is stated in the entry as the agent's.

## Records to Refresh

None kept by `ashoka-engineering:records` in this repository. `.context/ai-transparency.md` (the project's own EU AI Act record) was updated: new row 11 (podcast audio, ElevenLabs `eleven_v4`, voices, destination), the MP3's ID3 marks in §3 (interim, unsigned), §4 reliance row with S7 pending, "no AI-generated audio" removed, q3 open item rewritten. The privacy notice (Bunny and ElevenLabs as recipients) is Phase 3 work, before the first publish.

## User Input Needed

- **Restart the server dev process** (stop, then `npm run dev --prefix server`). The running server holds the Prisma query-engine DLL, so the agent did not run `db:generate`: it generated the client into the scratchpad and copied only the type declarations (`node_modules/.prisma/client/index.d.ts`) so the type checks could run. The restart applies migration `20261006160000_podcast_audio` and regenerates the client properly (the schema stamp no longer matches). Until then, the running server's podcast pages fail on the missing columns.
- **Render environment variables** (API service), if not set yet: `ELEVENLABS_API_KEY` (dedicated key: text-to-speech/dialogue and **user read**, which the balance check needs; a 401 there blocks the episode), `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`. `WEBHOOK_URL` is already set. Locally the same three in `server/.env` make dev dry runs upload to `dry-run/`; without the Bunny pair, dev stops at `voiced` by design.
- **Try it in dev** (dry run, no credits): Admin → Podcasts → "Start this week's episode" (or Resume on this week's scripted row). Expect stages scripted → voiced → ready (ready only with the Bunny pair locally), a silent MP3 in the player from `https://audio.actuallyrelevant.news/dry-run/episodes/...`, and a "Podcast episode ready" webhook message. Not run end to end by the agent (needs the migrated database).
- **First real episode** happens only in production (a dry run never calls ElevenLabs): after deploy, Start this week's episode in the production admin, listen, check the joins and the 700 ms pause.
- **S7**: run one real episode MP3 through ElevenLabs' AI Speech Classifier before and after assembly, and record the result in `.context/ai-transparency.md` §4 (needed before the first publish).
- **Re-measure credits per character** after 2026-10-12 with one call (the `character-cost` header is logged per chunk as `characterCost`), then confirm or change `monthlyTtsCharCap` (32,000, provisional).

## DB Migrations

- `server/prisma/migrations/20261006160000_podcast_audio/` (written from `db:migrate:diff`, whose output also carried `DROP INDEX "stories_embedding_idx"`, left out). Adds nine audio columns to `podcasts`, and the tables `podcast_audio_chunks` (cascade on episode delete) and `podcast_tts_usage` (set null on delete). Not applied anywhere by the agent; it applies to the local database on the next server dev start (`predev` → `db:prepare`) and to production on the next deploy.

## Implementation Issues

- The implementer had no sub-agent tool, so the TDD guide, the check worker and the three code reviewers were not spawned; tests were written alongside the code, the checks run directly, and the agent reviewed its own diff against the structure guidelines. A second-person review of the diff is advisable before merging.
- Guarantees checked by disabling them (each turned its test red, then restored): the reservation's advisory lock (two concurrent reservations near the cap both passed without it), the dry-run stub (a dry run called ElevenLabs without it), and the cron-only job-row re-check.

## Suggested Follow-Up Work

- `podcastGuards.ts` now holds the errors, the configuration check, the job re-check, the spend ledger (reserve and two reads) and the change guard. Cohesive enough today ("may we spend or change now"); if Phase 3's publish guards land there too, split the ledger (`podcastSpend.ts`: reserve, month and episode sums) from the admission checks.
- Orphaned CDN objects: an upload followed by a lost lease or a failed `ready` write leaves unreferenced files under `episodes/`. Rare and harmless (fresh names), but a periodic listing against stored paths could clean them.
- The admin month-usage figure refreshes on mount and focus only; after a long voicing run, reopen the page to see it move.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `main`, push only (commit made locally on `main` as instructed). Pull-request case: none switched on by the rule index; remote protection: check at landing. The push deploys migration `20261006160000_podcast_audio` to production.

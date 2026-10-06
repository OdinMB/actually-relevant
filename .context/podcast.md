# Podcast (weekly two-speaker episode)

The plan with the later phases (publishing, feed, automation): `.plans/autonomous-two-speaker-podcast.md` (archived to `.plans/completed/` once every phase is done).

## Status

Phases 1 and 2 are built: the admin starts this week's episode, the pipeline selects 4-5 stories, writes a two-speaker dialogue, voices it with ElevenLabs, assembles one MP3 with ffmpeg and uploads it and a VTT transcript to Bunny Storage. The admin plays the result from the CDN. Nothing is published: no feed, no public page and no publish button until Phase 3; the weekly cron and both job rows arrive in Phase 4.

## Two axes on `Podcast`

- **`stage`** (production, forward-only): `legacy` (rows from before this pipeline; read-only, never advanced), `created` → `scripted` → `voiced` (every TTS chunk stored in `podcast_audio_chunks`) → `ready` (MP3 and VTT uploaded, URLs, paths, bytes, duration and `readyAt` stored, chunks deleted). A failure never moves the stage: it sets `lastError` and `failedAt`, and the next run resumes from the stage.
- **`status`** (`ContentStatus`, shared with newsletters): publication. Nothing in Phases 1-2 changes it; `PUT /api/admin/podcasts/:id` accepts only `title` (`.strict()`, so `status` or `script` in the body is a 400). Until Phase 3 adds `publishedAt`, "ever published" means a non-legacy row with `status = published` (`wasPublished()` in `podcastGuards.ts`).

`weekKey` is the ISO week in **UTC** (`isoWeekKey()` in `podcastWeekly.ts`, not the newsletter job's local-time `getWeekKey`), unique, so a week has one episode and a concurrent create loses on P2002 and reads the winner's row. `weekKey` is null on legacy rows.

The only way back down the stage axis is `resetEpisode(id, { dryRun })` (`podcastPipeline.ts`, the admin **Regenerate script**). It refuses an episode in progress, a legacy row and a published one (`PodcastRefusedError`, 409). It deletes the stored chunks, sets `stage = created` and the given `dryRun`, clears the script, snapshot, show notes and every audio field, then deletes the previous MP3 and VTT from Bunny best-effort. `runWeeklyEpisode` calls it to clear a dry-run row left over before running live.

## Modules

| File | Responsibility |
|------|----------------|
| `server/src/services/podcastWeekly.ts` | This week's episode and its retry/block policy: `runWeeklyEpisode({ trigger })`, `findOrCreateWeekEpisode()`, `resumeEpisode(id)`, `isoWeekKey()`; the configuration check and the "ready" notice |
| `server/src/services/podcastPipeline.ts` | The stage machine and its lease: `advanceEpisode(id, { trigger })`, `resetEpisode(id, { dryRun })`, `releaseHeldLeases()` (called from the SIGTERM/SIGINT handler in `index.ts`) |
| `server/src/services/podcastAudioStages.ts` | The audio stages the machine runs with its fenced operations: `voiceEpisode` (scripted → voiced), `finishEpisode` (voiced → ready), `deleteEpisodeObjects`; decides dry run (stub voice) |
| `server/src/services/podcastChunks.ts` | Pure: `chunkTurns`, `chunkContinuity`, `buildTranscriptVtt` |
| `server/src/services/podcastScript.ts` | The two LLM calls (`selectEpisodeStories`, `writeEpisodeScript`) and `buildShowNotes` |
| `server/src/services/podcastDialogue.ts` | Pure dialogue rules: `validateDialogue`, `assembleSpokenSegments` (adds the opener and sign-off), `renderScript`, `dialogueCharBudget` |
| `server/src/services/podcastGuards.ts` | May we spend or change now: `assertPodcastRunnable`, `assertJobEnabled`, `reserveTtsChars`, `assertBalanceCovers`, `monthToDateChars`, `episodeTtsChars`, `assertChangeable`; `PodcastBlockedError`, `PodcastStoppedError`, `PodcastRefusedError` |
| `server/src/services/podcast.ts` | CRUD; lists select list columns, rows carry a derived `inProgress`, the single row `ttsChars`; `deletePodcast` with its guards |
| `server/src/lib/elevenlabs.ts` | ElevenLabs HTTP contract: `textToDialogue`, `getRemainingCharacters`, `ElevenLabsQuotaError` |
| `server/src/lib/podcastAudio.ts` | ffmpeg: `assembleEpisodeMp3`, `silentMp3`, `AI_PROVENANCE_FRAMES` |
| `server/src/lib/bunnyStorage.ts` | Bunny Storage: `putObject`, `deleteObject`, `publicUrl` |
| `server/src/prompts/podcast.ts`, `podcast-select.ts` | The dialogue and selection prompts |
| `server/src/schemas/llm.ts` | `podcastDialogueSchema`, `podcastSelectResultSchema`, `PODCAST_AUDIO_TAGS` |
| `server/src/lib/aiLabelCopy.ts` | `PODCAST_OPENER` (spoken) and `PODCAST_EPISODE_AI_LINE` (show notes, ID3 comment), owner-approved wording |

Settings: `config.podcast` in `server/src/config.ts`, with no environment overrides; credentials in `config.elevenlabs` and `config.bunny` (`''` = unset).

## The lease

`advanceEpisode` claims the row with raw SQL on the database clock (`lease_until < now() AT TIME ZONE 'UTC'`; the column is `timestamp without time zone` holding UTC), renews it before every stage and before every TTS chunk, and writes every stage with `updateMany({ where: { id, leaseOwner: me } })`, aborting with `LeaseLostError` when that matches nothing. A voiced chunk is inserted in a transaction that first locks the row `WHERE lease_owner = me FOR UPDATE`. Release is `WHERE lease_owner = me`, in `finally` and at shutdown. A second claimant gets `{ status: 'busy' }` and returns quietly. Chosen over `pg_try_advisory_lock` because Prisma's pool can run each query on another connection (ADR-0003).

`inProgress` on a row means `leaseUntil > now`. A run whose lease is taken over or expires mid-stage writes nothing further and ends as `skipped`, recording no `lastError` of its own.

## Weekly run and blocks

`runWeeklyEpisode` first runs `assertPodcastRunnable`, then advances. Outcomes: `done`, `skipped` (ready or published, blocked on the cron trigger, lease held elsewhere), `stopped` (cron only: the `generate_podcast` row was disabled mid-run; nothing counted, nothing alerted, the stage and stored chunks stay for the next slot or a Resume), `retry-later`, `blocked`. A `PodcastBlockedError` blocks at once: configuration missing, the monthly cap reached, ElevenLabs credits too low, an ElevenLabs 401/402/403 or quota refusal, or the dialogue still invalid after its one regeneration. Other failures count as `attempts` only on the cron trigger and block at `maxAttemptsPerWeek` (3). The admin trigger never counts and clears a block and the attempts first, so **Start this week's episode** on a blocked week behaves like Resume.

When a run takes an episode to `ready`, `notifyEvent('Podcast episode ready', …)` posts the title, duration, the episode's and the month's TTS characters and the admin link to `WEBHOOK_URL` (any trigger). A missing Saturday notice is itself a signal once the cron runs.

## Selection and dialogue

- **Pool**: `published` stories crawled in the last `config.content.storyAssignmentDays` (7) days, most relevant first, the same window as the newsletter. Fewer than 4 → error before any call.
- **Selection** (`large` tier): ids outside the pool and duplicates are dropped, at most 5 kept, fewer than 4 → error (retryable). The order the model returns is the episode order. The selection prompt (`podcast-select.ts`) asks for normally at most one story per top-level issue; a second from the same issue only when that issue has two clearly outstanding stories (then 5 stories) or another issue has no suitable article (then 4).
- **Dialogue** (`large` tier, `withStructuredOutput(..., { includeRaw: true })`, usage logged): segments `intro`, one `story` per story in order (`storyRef` = 1-based ref), `outro`. An invalid or unparsable answer gets one regeneration with the problems listed in `<PREVIOUS_DRAFT_PROBLEMS>`; a second failure is a `PodcastBlockedError`. Never truncated or patched. Story text goes into the prompt as untrusted input (`<STORIES>`).
- **Hosts**: the two speakers, `HOST_A` and `HOST_B`, are generic AI hosts and are never modelled on a real person.
- **Validation** (`validateDialogue`): every story exactly once; intro first, outro last; the intro exactly one HOST_A turn that welcomes and leads straight into the first story (owner, 2026-10-06: HOST_B's line after the welcome was superfluous); no speaker three times in a row (the code-added opener and sign-off, both HOST_A, count, so the first story segment must open with HOST_B); 4,200-6,200 spoken characters including the opener, sign-off and tags (the top, about 6.5 minutes, was raised from 5,600 by the owner on 2026-10-06, because gpt-6-sol writes about 20% over the length it is asked for; the prompt asks for `config.podcast.spokenCharAim`, 4,900, deliberately below the band's middle, `podcastLengthTargets`, `.context/prompting.md`); turns ≤ 400 characters; tags only from `PODCAST_AUDIO_TAGS`, at most 2 per turn (they are billed as characters); no URLs, markdown or speaker prefixes (the episode's own publisher names are exempt from the URL check, so "Phys.org" passes); episode title non-empty and ≤ `maxTitleChars` (80), title and summary free of URLs and markdown. A band miss is fed back in the prompt's terms (the model's own turns against `dialogueCharBudget()`), not the whole-episode total.
- **Segues** (owner, 2026-10-06): audio is voiced one segment per TTS request, so every segment after the intro must open with its own bridge: a first turn of at least 40 characters that is not just the headline (for the first story, HOST_B picking up the story the intro led into), and no two consecutive story segments opening with the same first five words. Keep this rule in the prompt, the schema description and validation together.
- **Snapshot**: `episodeStories` (ref, id, title, publisher, sourceUrl, slug, issue) is frozen at scripting; show notes and the later feed read it, never `storyIds`, so story deletion (which strips `storyIds`) cannot shift references.
- **Stored at `scripted`**: `dialogue` (the model's segments), `episodeStories`, `storyIds`, `title` (= episode title), `episodeSummary`, `showNotes` (AI line first, then the summary, then each story with our analysis link and its source), `script` (the rendered spoken episode), `scriptModelId`. A successful stage write also clears `lastError`.

The opener and sign-off are code, not prompt: `PODCAST_OPENER` ("Everything you're about to hear was written and voiced by AI from this week's news.", owner-approved 2026-10-06) is the first spoken turn of every episode. Don't move it into the prompt. Changing its wording needs the owner (`.context/ai-transparency.md`).

## Audio

- **Chunks** (`chunkTurns`): the spoken segments (opener and sign-off included) are packed whole into chunks of at most `chunkMaxChars` (1,800); a segment longer than that alone is split at turn boundaries only. Turns are never split, so a chunk that starts a segment starts with its bridge. About 5 chunks per episode, one per story. The chunking is rebuilt from the stored dialogue on every run, so a resume finds the same indices.
- **Voicing** (`voiceEpisode`, ADR-0002): chunks are voiced in order with `POST /v1/text-to-dialogue`, `model_id` `eleven_v4` (`ttsModelId`), the fixed `ttsSeed`, `mp3_44100_128`, HOST_A → `voiceIdA` (Darian), HOST_B → `voiceIdB` (Talia), and text continuity: `previous_text`/`future_text`, the last and first 100 characters of the neighbouring chunks, absent on the first and last chunk (Phase 0 S1: request ids gave no audible gain, text context is stateless). Each chunk's bytes, request id, characters and CBR duration are stored before the next call; a resume skips stored chunks, so nothing is paid twice. The `character-cost` response header is logged per chunk (the per-call truth of what was billed).
- **Retries** (`lib/elevenlabs.ts`): only a 429 that is not a quota refusal, or a 5xx, is retried once. A 401/402/403 or a quota/paused refusal is `ElevenLabsQuotaError` → `PodcastBlockedError`. A timeout is never retried, because ElevenLabs may have billed it.
- **Assembly** (`assembleEpisodeMp3`, ADR-0005): one ffmpeg process (`ffmpeg-static`, pinned) on temp files in `os.tmpdir()`, always removed: each chunk padded with `segmentPauseMs` (700) of silence except the last, concatenated, `loudnorm` to -16 LUFS, re-encoded to 128 kbps CBR mono MP3, ID3v2.3 title, artist and album "Actually Relevant", comment = `PODCAST_EPISODE_AI_LINE`, and the AI-provenance `TXXX` frames `AI-generated=true` and `digitalSourceType=…/trainedAlgorithmicMedia`. Duration = bytes × 8 / 128 kbps (no ffprobe). Nothing checks the duration against a limit; if a gate is ever added, put it at about 7.5 minutes or more.
- **Transcript** (`buildTranscriptVtt`): one cue per turn, voice spans `<v Host A>`/`<v Host B>`, timed proportionally to characters within each chunk and offset by the preceding chunks' measured durations plus the pauses. Approximate by design; audio tags are left out of the cue text.

## Storage (Bunny)

`putObject`/`deleteObject` talk to `https://storage.bunnycdn.com/<zone>/<path>` with the zone password as `AccessKey` and a SHA-256 `Checksum` header on uploads; both are idempotent and retried. Paths are ASCII only (`[A-Za-z0-9._-]` segments): `episodes/<weekKey>-<8 hex>.mp3` and `.vtt`, under `dry-run/` for a dry run. The public URL is `config.podcast.audioBaseUrl` (`https://audio.actuallyrelevant.news`, the pull zone's custom hostname, Phase 0 S4) plus the path. `.vtt` is served as `text/vtt` by an edge rule on the pull zone.

**Never reuse a file name.** The CDN caches a deleted file for up to 30 days and nothing here purges it (owner decision, 2026-10-06: a takedown removes an episode from the feed and the page; a CDN purge is a manual step in the Bunny dashboard). Every render gets a fresh random suffix, so an old file can never appear under a new episode's URL. Regenerate and delete remove the old objects best-effort; a failure leaves an unreferenced file, logged, never fatal. A run that uploaded but then lost its lease leaves its files unreferenced the same way.

## Spend controls

- **On/off**: the `generate_podcast` and `publish_podcast` job rows (Phase 4). On the cron trigger the pipeline re-reads `generate_podcast`'s `enabled` flag before every TTS call (`assertJobEnabled`) and stops with `PodcastStoppedError` when it is off. Admin actions (Start, Resume, Regenerate) are not gated by the toggles, but by the configuration check, the cap and the credit block like every run.
- **Configuration check** (`assertPodcastRunnable`): the two voice ids always; on a live run (production) `ELEVENLABS_API_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`; on the cron trigger `WEBHOOK_URL`. A missing one blocks the episode with the names in the reason.
- **Monthly cap** (`reserveTtsChars`): before each TTS call, a short transaction takes `pg_advisory_xact_lock`, sums `podcast_tts_usage` for the UTC calendar month and inserts the chunk's characters if the sum stays within `monthlyTtsCharCap` (32,000, provisional until one call is re-measured after 2026-10-12); otherwise `PodcastBlockedError`. The row is kept whatever the call's outcome and survives episode deletion (`podcastId` set null). Regenerations count. A dry run reserves nothing.
- **Balance pre-check** (`assertBalanceCovers`): before the first pending chunk of a live run, `GET /v1/user/subscription` (`character_limit - character_count`) must cover the remaining chunks' characters. ElevenLabs credits reset on the subscription anniversary and the counter lags a few calls, so this is coarse; the ledger cap is the guard that holds when the vendor's numbers are wrong. The key needs "user read" for it; a refusal blocks.

## Dry run

`config.podcast.dryRun` is `NODE_ENV !== 'production'`, never set, and stored on the row at creation. A dry-run episode always voices with the silent stub (`silentMp3`, as long as the characters would take at `stubCharsPerSecond`), spends no credits and reserves nothing, assembles without `loudnorm` (loudnorm on pure digital silence crashes the encoder), and uploads under `dry-run/`; without Bunny credentials it stops at `voiced` with "storage not configured". LLM calls stay real. Publishing will refuse the row (Phase 3).

## Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/podcasts` | List (paginated; `status`, `stage` filters; list columns only, plus `inProgress`) |
| POST | `/api/admin/podcasts/weekly` | Find or create this week's row, answer 202 with it, then `runWeeklyEpisode({ trigger: 'admin' })` in the background |
| GET | `/api/admin/podcasts/usage` | `{ monthToDateChars, monthlyCap }` |
| GET | `/api/admin/podcasts/:id` | Single row with `inProgress` and `ttsChars` |
| POST | `/api/admin/podcasts/:id/resume` | 202, then `resumeEpisode` in the background (404 unknown, 409 legacy) |
| POST | `/api/admin/podcasts/:id/regenerate` | `resetEpisode`, 202, then `resumeEpisode` in the background (404 unknown, 409 in progress, published or legacy) |
| PUT | `/api/admin/podcasts/:id` | Title only |
| DELETE | `/api/admin/podcasts/:id` | 409 for an episode in progress or published (a published legacy row is deletable); chunks cascade, ledger rows stay, Bunny objects deleted best-effort. Deleting an unpublished weekly episode frees its week key, so the week's next run makes a new one |

The POSTs sit behind `expensiveOpLimiter`. The UI (`PodcastsPage`, `PodcastDetail`, `PodcastAudioSection`, `PodcastStageBadge`): "Start this week's episode", a stage column, the stage badge with "In progress" and "Blocked", the block reason, the last error, attempts, a dry-run badge, Resume (blocked, failed or not yet scripted), Regenerate script with a confirm (scripted or later, hidden once published or while in progress), the audio player on `audioUrl` (`preload="none"`, streamed from the CDN), the duration, TTS characters for the episode and the month against the cap, the episode's stories, the read-only script and show notes. The detail polls every 5 s only while `inProgress`. Legacy rows show their old script read-only.

## Owner setup and environment

Exactly three variables, on Render (API service) and in the local `server/.env`, documented in `server/env.example`: `ELEVENLABS_API_KEY` (a dedicated key limited to text-to-speech/dialogue and user read, with a key-level credit limit and Auto Top Up off), `BUNNY_STORAGE_ZONE` and `BUNNY_STORAGE_PASSWORD` (the storage zone's password, not the account API key). `WEBHOOK_URL` (already set) carries the notices. Everything else (voices, model, cap, pause, CDN base URL) is a constant in `config.podcast`. Bunny setup (storage zone in Frankfurt, pull zone, custom hostname `audio.actuallyrelevant.news` with SSL, `.vtt` → `text/vtt` edge rule, log anonymisation, CORS for `.vtt`) is done (Phase 0 S4, 2026-10-06).

## Evaluating prompt changes

`checkDialogue` (eval `checks.ts`) runs production's `validateDialogue` plus the long-sentence share and publisher coverage; the large-tier suite and `eval:recalibrate --steps podcast` use it (`.context/model-eval.md`).

## Troubleshooting

- **Episode stuck "In progress"**: a process died without releasing; the lease expires after `leaseMinutes` (30) and the next Resume takes it over.
- **Blocked with "the dialogue is still invalid…"**: the reason lists the rule each draft broke. Resume tries again (two more calls); repeated failures point at the prompt or the band.
- **Blocked with "podcast configuration missing: …"**: set the named variables on the host and Resume.
- **Blocked with "monthly TTS cap reached"**: wait for the next UTC month, or raise `monthlyTtsCharCap` in code (owner decision).
- **Blocked with "ElevenLabs refused (HTTP 401/402/…)" or "credits too low"**: check the key's permissions and the account's credits, then Resume; stored chunks are not voiced again.
- **Stops at "voiced" with "storage not configured"**: Bunny credentials missing (normal in a dev environment without them).
- **"ffmpeg binary not found"**: `ffmpeg-static`'s install script did not run (`.context/deployment.md`).
- **"has N stored chunks for M expected"**: the chunking changed (for example `chunkMaxChars`) between voicing and assembly; Regenerate the episode.
- **"only N published stories this week"**: the pool is short; publish more or wait.

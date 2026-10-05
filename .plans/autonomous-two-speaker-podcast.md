---
plan-id: autonomous-two-speaker-podcast
title: Autonomous weekly two-speaker podcast, self-hosted on Bunny with our own feed
status: approved
created: 2026-10-05
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [ai-risk, cost, vendor, personal-data]
decisions:
  - id: ADR-0001
    title: Self-host podcast audio on Bunny Storage and CDN and serve the podcast feed from Express
    status: proposed
    context: Episodes need permanent public audio, a feed we control (AI tags, transcript, GUIDs), EU hosting, and must not stream through Render's 5 GB bandwidth.
    decision: Upload MP3 and VTT files to a Bunny Storage zone (Frankfurt) served by a pull zone on a custom CNAME hostname; Express builds the RSS feed by hand; the GUID is the podcast row id and a published enclosure URL never changes.
  - id: ADR-0002
    title: Voice episodes with ElevenLabs eleven_v4 Text to Dialogue through a thin axios client
    status: proposed
    context: Two-speaker audio needs a dialogue TTS; the official SDK brings its own retries, which would double-bill, and a dependency for two endpoints.
    decision: Call POST /v1/text-to-dialogue with model_id pinned to eleven_v4 (and GET /v1/user/subscription) via axios from server/src/lib/elevenlabs.ts, chunked at turn boundaries, never retrying on quota, auth or other 4xx errors.
  - id: ADR-0003
    title: Produce episodes as a persisted stage machine on the Podcast row, fenced by a DB lease, with TTS chunks kept in Postgres until upload
    status: proposed
    context: Production spans billed TTS calls, runs in-process on an ephemeral Render instance, and zero-downtime deploys overlap two processes.
    decision: Podcast gets a forward-only stage (created, scripted, voiced, ready), a lease (leaseOwner, leaseUntil) claimed with the database clock and checked on every stage write, error and block fields that never overwrite the stage, and a podcast_audio_chunks bytea table emptied once the final MP3 is uploaded.
  - id: ADR-0004
    title: Retry the weekly episode by repeating weekend cron slots, guarded in the podcast code, instead of changing the shared scheduler
    status: proposed
    context: The scheduler never retries a failed run, catches up overdue jobs at boot on any weekday, and guards overlap per process only; changing it affects every job.
    decision: generate_podcast fires at several weekend slots; the handler is a no-op outside the weekend window, resumes the current ISO week's episode, counts automatic failures and blocks the episode with one alert at the cap or on a non-retryable error; job rows are seeded with lastCompletedAt set.
  - id: ADR-0005
    title: Assemble, loudness-normalise and tag episode MP3s with a pinned ffmpeg-static binary
    status: proposed
    context: Several dialogue chunks must become one MP3 with even loudness and AI-provenance ID3 frames, on Render's native Node runtime, which has no system ffmpeg.
    decision: Add ffmpeg-static at an exact version and run concat, loudnorm and ID3 tagging in one ffmpeg process on temp files; a failed spike reopens this decision.
  - id: ADR-0006
    title: Keep publication (status) separate from production (stage) and make automatic publishing a job toggle
    status: proposed
    context: The owner publishes by hand first and wants to switch to automatic publishing later without a code change.
    decision: status=published means listed in the feed and requires stage=ready on a non-dry-run row; one service publishes, called by the admin button and by the publish_podcast job, which is seeded disabled and switched on in the admin Jobs page.
type: feature
complexity: complex
---

# Autonomous weekly two-speaker podcast

Confirmed by Odin Mühlenbein on 2026-10-06: every decision this plan states.

Sequencing (owner, 2026-10-06): a separate scheduler/newsletter/social hardening change lands before Phase 0.

## Problem

Today an admin creates a podcast row, assigns every story of the week, and gets a single-voice script with a URL list appended; the owner then pastes it into an external TTS tool and uploads it to Buzzsprout by hand. Nothing produces audio, nothing is hosted by us, and the script format (one string, no turns, no length target, a PHP-era prompt) cannot drive a two-speaker voice model. The owner wants a weekly episode that writes, voices and stores itself, which he publishes with one click, and later fully automatically.

## Approach

### Owner decisions this plan implements (binding)

From the owner's decision record of 2026-10-05. These choices are **the owner's**, not the agent's, and promote naming him: two separate jobs, publish manual first and automatic later by a toggle (ADR-0006: the split is the owner's; mapping it onto the job's `enabled` flag is the agent's); self-hosting on Bunny with our own Express feed and its tags (ADR-0001: the owner's; GUID and path permanence are the agent's detail); ElevenLabs Starter, `eleven_v4` via Text to Dialogue, chunking, alert-not-retry when credits run out, non-default voices with ids in config (ADR-0002: vendor and model the owner's, client and retry policy the agent's); the new spoken opener "This episode was written and voiced by AI, based on our AI analysis of this week's news." in `server/src/lib/aiLabelCopy.ts`; an AI line in every episode description, a standing AI statement in the show description, `<podcast:txt purpose="ai-content">true</podcast:txt>` on channel and item; generic AI host personas, never imitating a real person; Saturday-morning generation after the newsletter; a separate LLM selection of 4-5 stories; a 4.5-5.5 minute target; a hard monthly TTS cap plus a kill switch; automatic retries within the weekend capped per week, then an alert; a simple public `/podcast` page with feed link, listen links and episode list.

ADR-0003, ADR-0004 and ADR-0005 are the agent's.

### Shape of the solution

Two axes on the existing `Podcast` row, never conflated:

- **`stage`** (production, forward-only): `legacy` for rows that existed before this change; `created` (row exists, nothing produced) → `scripted` (stories selected and snapshotted, dialogue JSON, title, summary and show notes stored) → `voiced` (every TTS chunk stored in `podcast_audio_chunks`) → `ready` (MP3 and VTT uploaded to Bunny, URLs, paths, bytes and duration stored, `readyAt` set, chunks deleted). A failure never overwrites the stage: it sets `lastError` and `failedAt`, and the next run resumes from the stage (critique 1.4, 1.6). Selection is not a stage of its own: it is one cheap call, persisted together with the script.
- **`status`** (`ContentStatus`, unchanged; newsletters share it): `published` means "listed in the feed and on /podcast". Only `podcastPublish.ts` changes it, and only for a `ready` row whose own `dryRun` flag is false. `PUT /api/admin/podcasts/:id` accepts `title` only (critique 2.7).

`weekKey` (ISO week in UTC, e.g. `2026-W41`, unique, null for legacy rows) makes the weekly run idempotent.

**Modules.** Each new file holds one reason to change:

- `services/podcastPipeline.ts`: the stage machine. `advanceEpisode(id)` claims the lease, runs each remaining stage, persists each stage's output before the next starts, and decides dry-run behaviour (prefixes, stub voice). `resetEpisode(id)` goes back to `created`. The lease helpers (claim, renew, fenced write, release) are private to it; they serve only the stage machine.
- `services/podcastWeekly.ts`: "this week's episode" and its retry policy. `runWeeklyEpisode({ trigger: 'cron' | 'admin' })` resolves `weekKey`, finds or creates the row, honours `blockedAt`, counts automatic failures, classifies errors, and returns an outcome. The cron handler and the admin "Start this week's episode" route both call it, so no route imports from `jobs/` (architecture review 1).
- `services/podcastScript.ts`: the two LLM calls (select, write) and show notes.
- `services/podcastDialogue.ts`: pure dialogue logic (validate, assemble spoken turns, chunk, render the admin script view, build the VTT).
- `services/podcastGuards.ts`: "may we spend or publish now": kill switch, configuration check, the TTS spend reservation, and the typed `PodcastBlockedError`. Used by the pipeline, the publish service and the admin routes from Phase 2 on, so the checks are never scattered (architecture review 2).
- `services/podcastPublish.ts`: publish, unpublish, the published-episode query, and the feed cache invalidation call.
- `services/podcastFeed.ts`: the RSS document and its cache (`getFeedXml`, `invalidateFeedCache`).
- `lib/elevenlabs.ts`, `lib/bunnyStorage.ts`: vendor HTTP contracts only, no dry-run logic (paths and voice choice come from the pipeline).
- `lib/podcastAudio.ts`: ffmpeg (assemble, tag, generate silence for the dry-run stub).
- `lib/xml.ts`: `escapeXml`, moved from `prompts/shared.ts`, which re-exports it unchanged, so the feed does not import from `prompts/`.

`services/podcast.ts` keeps CRUD only (its script generation moves out), and `deletePodcast` gains its guards.

**Cross-process claim, fenced** (critique 1.3; correctness review 3). Claim with raw SQL on the database clock: `UPDATE podcasts SET lease_owner = $me, lease_until = now() + interval '30 minutes' WHERE id = $id AND (lease_until IS NULL OR lease_until < now())`; zero rows means another process has it and the call returns quietly. `$me` is a per-process random id. The lease is renewed at the start of every stage and before every TTS chunk; every stage write is `updateMany({ where: { id, leaseOwner: me } })` and aborts when it matches nothing (a process that lost its lease after a pause cannot overwrite the new owner's work); release is `WHERE lease_owner = $me`, in `finally` and in the existing SIGTERM handler in `server/src/index.ts`. Chosen over `pg_try_advisory_lock`: Prisma's pool can run each query on a different connection, so a session lock is not reliably held by the code that took it.

**Weekend retries and first enable, without touching the shared scheduler** (ADR-0004; critique 1.1-1.2). `generate_podcast` runs at `0 6,10,14,18 * * 6,0` (node-cron uses server-local time; Render runs in UTC, and the handler's window is computed in UTC, so a developer machine in another zone cannot misfire it). The handler:

1. returns quietly unless now is inside the weekend window, Saturday 05:00 to Sunday 23:59 UTC (a config constant). The window is needed even with the weekend-only cron: `isOverdue` catches up a weekly job at boot once about 42 hours have passed, so a Wednesday deploy would otherwise produce a midweek episode for the next ISO week (correctness review confirms; the simplicity review's proposal to drop it is not adopted);
2. calls `runWeeklyEpisode({ trigger: 'cron' })`, which returns `skipped` (kill switch off, already ready or published, `blockedAt` set, another process holds the lease), `done`, `retry-later` or `blocked`;
3. on `retry-later` returns normally (no alert); on `blocked` throws, so `runJob` alerts through `notifyJobFailure` exactly once, because later slots see `blockedAt` and skip; on `done` sends a success notice through a new `notifyEvent()` (title, duration, characters billed this episode and month to date, admin link), so a missing Saturday message is itself a signal.

`runWeeklyEpisode` blocks the episode (`blockedAt`, `blockedReason`) on a non-retryable error (`PodcastBlockedError`: credits, cap, kill switch flipped mid-run, configuration missing, dialogue invalid after its one regeneration) or when automatic failures reach `PODCAST_MAX_ATTEMPTS_PER_WEEK` (default 3). Only automatic runs count attempts; the admin "Resume" clears `blockedAt` and resets `attempts`. A row whose `dryRun` flag is true while the config is no longer dry-run is reset to `created` with `dryRun = false` and regenerated, so a dry run in production cannot occupy the week (correctness review 6). The migration seeds both job rows with `last_completed_at = now()`, so neither runs at boot just because it never completed; `seed-jobs.ts` (fresh dev databases) leaves it null, which the window makes harmless.

The generic scheduler weaknesses (per-process overlap guard, `lastCompletedAt` written on failure, boot run for never-completed jobs, the first `jobRun.update` outside the `try`) stay for the other jobs and go to follow-up work: fixing them changes boot behaviour of every job, which is out of proportion here. The strongest-end-state architect proposed a DB claim in `runJob` for all jobs in this change; it is recorded as follow-up because the podcast's own lease and ledger already make it safe.

**Publish** (ADR-0006). `publishEpisode(id)` requires `stage = ready`, the row's `dryRun = false`, `PODCAST_ENABLED`; it sets `status = published`, `publishedAt` (first time only), clears `unpublishedAt`, and invalidates the feed cache. `unpublishEpisode(id)` always works, kill switch or not, and sets `unpublishedAt`. The feed and `/api/podcast` keep serving published episodes when the kill switch is off. An episode that has ever been published (`publishedAt` set) can never be regenerated or deleted (its GUID and enclosure must not change); it can be unpublished.

The `publish_podcast` job (seeded **disabled**, `0 7 * * 1`, Monday 07:00 UTC) publishes the newest `ready` episode of the current or previous ISO week that has never been unpublished (`unpublishedAt` null) and whose `readyAt` is at least 24 hours old (config constant), so a manual Run or a boot catch-up cannot publish before the owner had a day to listen, and the job never undoes the owner's takedown (correctness review 1). Going automatic = enabling the job row in the existing admin Jobs page; no code change.

**Spend controls** (critique 1.10: characters, not dollars).

- Kill switch `PODCAST_ENABLED` (default false): checked in `runWeeklyEpisode`, before every TTS call, and in `publishEpisode`; admin generation actions too. Never blocks `unpublishEpisode`, the feed or the public page.
- Monthly cap `PODCAST_MONTHLY_TTS_CHAR_CAP` (default 30,000; recalibrated in Phase 0). Each TTS call **reserves** its characters first: a short `$transaction` takes `pg_advisory_xact_lock(<constant>)`, sums `podcast_tts_usage` for the UTC calendar month, and inserts the row if the sum plus this chunk stays under the cap; it commits before the HTTP call. The row is kept whatever the call's outcome (a timed-out call may still be billed). Over the cap → `PodcastBlockedError`. Regenerations count.
- Balance pre-check: before the first chunk, `GET /v1/user/subscription` (`character_limit - character_count`) must cover the remaining chunks. ElevenLabs credits reset on the subscription anniversary, not on the calendar month, so this is the guard that matches the vendor; the local cap is the guard that holds when the vendor's numbers are wrong. Phase 0 S2 decides whether the subscription fields track API usage at all; if not, the pre-check is left out.
- ElevenLabs 401/402, `quota_exceeded` and paused-account responses → `PodcastBlockedError`, never retried, alerted once (owner decision 3).
- LLM usage: `withStructuredOutput(schema, { includeRaw: true })` logs `usage_metadata` per call (structured log, no column). A `parsed: null` result throws explicitly, so it counts as the dialogue's one regeneration (correctness review 10). No USD column or price setting: the episode's characters are summed from the ledger.

**Dry run** (critique 2.8). `PODCAST_DRY_RUN` defaults to `true` unless `NODE_ENV=production`. The row stores `dryRun`. In dry run the pipeline voices with a **stub** (ffmpeg silence of the length the characters would take) unless `PODCAST_DRY_RUN_LIVE_TTS=true`, so dev never spends credits by accident; uploads go under a `dry-run/` prefix (without Bunny credentials the run stops at `voiced` with "storage not configured"); publishing refuses the row; the feed filters `dryRun = false`; the admin shows a "Dry run" badge. LLM calls stay real (cents).

**Dialogue script** (brief section C, with the critique's corrections). New `podcastDialogueSchema` in `server/src/schemas/llm.ts`: `episodeTitle`, `episodeSummary`, `segments[] { kind: intro|story|outro, storyRef: int|null, turns[] { speaker: HOST_A|HOST_B, text } }`. Format rules live in `.describe()` (`.context/prompting.md`); `minItems`/`maxItems` on turns are used only if a unit test shows LangChain's json_schema conversion keeps them, otherwise they stay in `.describe()` and validation. Code, not the model, adds the opener as turn 0 (HOST_A), a fixed sign-off turn, the show notes and the AI lines. `storyRef` is mapped to story ids right after the call and a snapshot (id, title, publisher, source URL, story slug) is stored in `episodeStories`; validation, show notes and the feed read the snapshot, never `storyIds`, so story deletion (which strips `storyIds`, `services/story.ts:561-579`) cannot shift references; a deleted story leaves a dead link in frozen show notes, which is accepted (critique 2.6). Validation in `podcastDialogue.ts`: each snapshot story covered exactly once, no speaker more than twice in a row, total spoken characters 4,200-5,600 including the code-added turns and tags (critique 2.15; this band is also the per-episode ceiling), each turn ≤ 400 characters, tags only from the allowlist (unknown tags reject, never silently stripped), no URLs, markdown or speaker prefixes. Invalid → one regeneration, then `PodcastBlockedError`. Never truncate.

The prompt (`server/src/prompts/podcast.ts`) is rewritten to `.context/prompting.md`: `<ROLE>`, `<GOAL>`, `<HOSTS>` (HOST_A frames each story, HOST_B brings why it matters and the caveats; both are AI hosts with no personal names, never modelled on a real person), `<CONSTRAINTS>` (facts only from the supplied material, attribution to the publisher, tone follows the subject, no filler agreement, short spoken sentences mostly under 18 words, numbers and acronyms written as spoken), `<STORIES>` marked as untrusted input whose instructions are ignored (AI-017). The "prototype phase" outro line is dropped; the sign-off invites feedback on the website (agent's choice; the owner can restore it). Selection gets its own small prompt (`server/src/prompts/podcast-select.ts`, `podcastSelectResultSchema`): one story per top-level issue, plus an optional fifth when an issue has two clearly outstanding stories, preferring stories that work spoken; pool = `published` stories of the last 7 days by `dateCrawled` (not `selected`, which may never publish and would leave show-notes links dead), matching the newsletter's pool.

**Audio** (ADR-0002, ADR-0005). `chunkTurns()` packs whole segments into chunks of ≤ 1,800 characters, splitting a segment at turn boundaries only when it alone is longer. Chunks are voiced sequentially with `model_id: eleven_v4`, a fixed `seed`, the two voice ids, `output_format=mp3_44100_128`, and the continuity mode Phase 0 confirms (`previous_request_ids` from the `request-id` header, else `previous_text`/`next_text`). Each chunk's bytes, request id, characters and measured duration are written before the next call; a resume skips stored chunks, so nothing is paid twice. Assembly writes the chunks to `os.tmpdir()`, runs one ffmpeg process (concat, `loudnorm` to -16 LUFS, MP3 128 kbps mono, ID3 title, artist "Actually Relevant", album = show title, comment and `TXXX:AI-generated=true`, `TXXX:digitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`; there is no standard ID3 IPTC frame, critique 1.7), reads the result and always deletes the temp files. Duration = bytes × 8 / 128,000 (CBR; tests allow ±1 s for the tag frames), so no ffprobe. Upload paths `episodes/<weekKey>-<8 random chars>.mp3` and `.vtt`, ASCII only, a fresh suffix per render, so a CDN-cached old file can never appear under a published URL; a regenerate before first publication deletes the previous objects best-effort (both paths are stored). The VTT (`buildTranscriptVtt`: turns timed proportionally to characters within each chunk, offset by the measured durations of the preceding chunks, critique 2.4) is uploaded at the `ready` stage, so it needs no route and no API hostname.

**Feed and page** (ADR-0001).

- `GET /api/podcast/feed.xml`: hand-built RSS 2.0 with the `itunes`, `podcast`, `atom` and `content` namespaces, escaped with `lib/xml.ts`, cached like `routes/public/feed.ts` (in-process cache; a second instance during a deploy serves the old XML until the TTL, which is accepted). Channel: title, link `/podcast`, description = the standing AI statement, `itunes:author`, `itunes:owner/itunes:email`, `itunes:image`, `itunes:category`, `itunes:explicit false`, `itunes:type episodic`, `language en`, `podcast:locked no`, `podcast:guid` (fixed UUIDv5 of the feed URL), `podcast:txt purpose="ai-content"` true. Items: `status = published AND stage = ready AND dryRun = false`; `guid isPermaLink="false"` = row id; enclosure = Bunny URL with exact byte length and `audio/mpeg`; `itunes:duration`; description = AI line, summary, story list linking our analysis pages and the sources; `podcast:transcript` (Bunny VTT, `text/vtt`); `podcast:txt ai-content` true. An empty feed (before the first publish) still serialises validly. Public URL `https://actuallyrelevant.news/podcast.xml` via a Render rewrite above the SPA catch-all, as `sitemap.xml` does; the API host is not used because `api.actuallyrelevant.news` did not resolve on 2026-09-25. The podcast router is mounted **before** `router.use(apiLimiter)` in `routes/public/index.ts`: behind the rewrite, `trust proxy 1` may see one proxy address for every directory crawler, and a shared 100-per-15-minute bucket would return 429s to Apple and Spotify (correctness review 5); the cache carries the load.
- `GET /api/podcast`: show info (title, description, feed URL, listen links) and published episodes. Joins `publicReadPaths` in `app.ts`.
- `/podcast` page: heading, intro, AI label, feed URL, listen links, episode list with `<audio controls preload="none">` on the Bunny URL (no Render bandwidth) and the episode's story list. Registered in `client/src/routes.ts` and `sitemap.ts`, lazy in `App.tsx`, Helmet title, description, canonical and og tags, breadcrumb JSON-LD, `<link rel="alternate" type="application/rss+xml">`, a "Podcast" entry in the footer navigation. Static parts prerender; the episode list loads client-side (the prerenderer does not wait for data). Listen links are constants in `config.ts`, set once after the show is listed, returned by `/api/podcast`.

**Admin.** `PodcastsPage.tsx`: "Start this week's episode" replaces "Create" for podcasts (calls `runWeeklyEpisode({ trigger: 'admin' })` in the background, any day, resumes the week if it exists; ignores the attempt cap, not the kill switch or the spend cap); stage column in `PodcastTable.tsx`. `PodcastDetail.tsx`: stage badge (with "in progress" while the lease is live; polls every 5 s only then), blocked reason, last error, attempts, dry-run badge, audio player on `audioUrl`, duration, characters billed (episode and month to date), the rendered script ("HOST A: …") read-only, the show notes, and buttons: "Resume" (clears a block, advances), "Regenerate script" (back to `created`; hidden once ever published), "Publish" / "Unpublish" (confirm dialog). Legacy rows are read-only and deletable; the old script editor goes.

### Alternatives considered

- **A new `PodcastEpisode` table, or a 1:1 `PodcastRun` table for the operational columns.** Rejected for now: admin pages, routes, story-deletion cleanup and the shared type all key on `Podcast`, and legacy rows coexist as `stage = legacy`. **Accepted debt:** `Podcast` mixes content (title, dialogue, show notes) with operations (lease, attempts, block, error, audio metadata), about 30 columns. The trigger to split the operational columns into a `PodcastRun` table is a second episode kind or show; `getPodcasts` selects list columns explicitly meanwhile so list queries never load the dialogue.
- **Chunks in `os.tmpdir()` (brief) or in Bunny under a work prefix.** tmp is lost on every deploy and re-bills; Bunny would make dry run and tests depend on storage and expose unreleased audio. Postgres holds about 5 MB per episode for minutes to hours.
- **Generic scheduler fixes** (both architects discussed; the strongest-end-state one proposed a DB claim in `runJob`). Deferred, see above.
- **A separate hourly retry job.** Repeated slots of the same job need no second schedule.
- **`stage = failed` or `stage = blocked`** (brief; one architect). A stage value loses the resume point; error and block fields sit beside it.
- **A USD budget cap** (brief). On a subscription the marginal cost is credits, so the cap counts characters (critique 1.10).
- **The `@elevenlabs/elevenlabs-js` SDK; Buzzsprout, Transistor or R2.** SDK rejected (ADR-0002); hosting is the owner's decision (memo section 2).
- **Reusing the newsletter selection prompt with one story per issue.** Its role text names the newsletter, "spoken-ness" is a different criterion, and reuse would couple the two calibrations.
- **The `feed` package.** No itunes or podcasting2 support; hand-built XML is smaller than post-processing.
- **Raw MP3 frame concatenation without ffmpeg** (one architect). No loudness normalisation and possible clicks at joins; it stays the first thing Phase 0 S5 reaches for if ffmpeg fails on Render, as a new decision.
- **Dropping the VTT transcript** (simplicity review). `podcast:transcript` is in the owner's binding feed requirements, so it stays, with proportional timing named as approximate.

**Review disagreements, resolved.** The simplicity review asked for a lease without renewal or owner and for dropping the weekend window; the correctness review showed both are needed (a paused process overwriting a new owner's stage after billing; boot catch-up on a weekday). For a feature in a strained area, the correctness case wins. The simplicity review's other cuts were adopted: no `selected` stage, no separate per-episode ceiling, no cost-estimate setting or USD column, no LLM usage column, no "Regenerate audio" (with a fixed seed it reproduces the same audio), no legacy editor, listen links, Bunny host and model id as config constants rather than environment variables, `checkDialogue` built on `validateDialogue`, and no `podcast-select` call site in the large-tier suite.

### Phases

Each phase ships on its own; the risky unknowns are retired first and the owner gets value at each step.

**Phase 0 — Spike (retires the unverified items; nothing merged into production code paths).** A throwaway script `server/src/scripts/podcast-spike.ts` (npm script `podcast:spike`; reads credentials from the environment like the other scripts; the owner runs the paid steps, or gives an agent the go-ahead to) and a findings file `DOCS/YYYY-MM-DD_podcast-spike.md` with sample MP3s in `DOCS/`. The script is deleted at the end of Phase 2; what it proves moves into `lib/elevenlabs.ts`.

| # | Question | How | Outcome → design change |
|---|---|---|---|
| S1 | Does `eleven_v4` Text to Dialogue keep continuity across chunks, and are the seams audible? | `GET /v1/models` (v4 lists dialogue support); voice one fixed ~5,000-character dialogue three ways: `previous_request_ids` (check the `request-id` header exists), `previous_text`/`next_text`, none. The owner listens blind. | Request ids work, seams inaudible → as planned. Only text context works → `continuityMode: 'text'` (config constant). Seams audible either way → chunk only at segment boundaries and insert a 400 ms pause between segments in assembly so the joins read as intended, and cap story segments at about 1,700 characters in validation. Still bad → per-turn single-voice v4 TTS (10,000-character limit, about 30 calls) with `previous_text`; a change inside `lib/elevenlabs.ts` and `chunkTurns` only. `eleven_v4` not offered on dialogue → `eleven_v3` with the same code. |
| S2 | Real cost per episode on Starter after 2026-10-12 | Read `GET /v1/user/subscription` before and after each call; compare with the dashboard's API balance. | Sets the `PODCAST_MONTHLY_TTS_CHAR_CAP` default. If 4.3 episodes plus a regeneration each exceed Starter → owner question 4. If the subscription fields do not move with API usage → leave the balance pre-check out; the ledger cap stands alone. |
| S3 | Do audio tags count as billed characters? | Same text with and without six tags; compare the deltas. | Yes → validation counts tags (as planned) and the schema allows at most 2 per turn. No → the band and the cap count plain text only. |
| S4 | Bunny: upload, custom hostname, HEAD, byte-range, content types, CORS | After the owner's Bunny setup, PUT a test MP3 and VTT; `curl -I` and `curl -r 0-1023` against `https://audio.actuallyrelevant.news/…`; check `Content-Type` (`audio/mpeg`, `text/vtt`) and `Access-Control-Allow-Origin` on the VTT (web players fetch transcripts cross-origin). | All pass → as planned. HEAD or range fails on the custom hostname → fix pull-zone settings; if that cannot be fixed, enclosures use the `b-cdn.net` hostname, decided before the first publish because enclosure URLs never change. Wrong content type → set it on the PUT or with an edge rule. No CORS → enable it on the pull zone (owner step). |
| S5 | ffmpeg on Render: install, size, time, memory | A branch adds `ffmpeg-static` (exact version) and a `podcast:spike-ffmpeg` script that joins and loudnorms three 100-second sample chunks and prints wall time and peak RSS (ffmpeg's own memory counts against the instance's 512 MiB); the owner deploys the branch and runs it in the Render Shell. If the Shell is not available on the plan, a temporary admin-only diagnostics endpoint does the same and is removed in Phase 2. | Under 60 s and 200 MB → as planned. Postinstall download fails → `@ffmpeg-installer/ffmpeg` (binary inside the npm tarball). Too slow or too large → drop `loudnorm` and stream-copy the concat. ffmpeg unusable → reopen ADR-0005 (frame concatenation plus a small ID3 writer is the first alternative). |
| S6 | Voices | List ElevenLabs-owned voices that are not among the default voices expiring 2026-12-31; render the fixture dialogue with three candidate pairs. | The owner picks a pair (open question 3); the ids go into the environment. |
| S7 | Does Starter v4 API output carry a watermark that survives our re-encode? | Run the MP3 through ElevenLabs' AI Speech Classifier before and after ffmpeg. | Recorded in `.context/ai-transparency.md` §4; no code change either way. |

**Phase 1 — Two-speaker script.** Value: a much better script in the admin that the owner can voice by hand at once. Migration 1, dialogue and selection schemas and prompts, validation, show notes, the stage machine and lease up to `scripted`, `runWeeklyEpisode` for the admin trigger, admin "Start this week's episode", stage display, eval and test updates, spec and context for the script, the new opener.

**Phase 2 — Audio and storage.** Value: a finished MP3 in the admin player, on our CDN, not public. Migration 2, `lib/elevenlabs.ts`, `lib/podcastAudio.ts`, `lib/bunnyStorage.ts`, `podcastGuards.ts`, stages `voiced` and `ready`, kill switch, cap, dry run, block and resume, regenerate, delete guards, notices. Delete the spike script.

**Phase 3 — Publishing.** Value: the self-hosted show is live, published by hand. `podcastPublish.ts`, Publish and Unpublish, feed, public JSON, `/podcast` page, SEO, privacy notice, the written AI copy (after the owner approves it), transparency rows. The owner then submits the feed to directories.

**Phase 4 — Automation.** Value: the weekly step disappears. Migration 3 (job rows), both job handlers, registration, seed, scheduler docs. The owner enables `generate_podcast`, listens and publishes by hand for three or four weeks, then enables `publish_podcast`.

### Owner's one-time manual steps (documented in `.context/podcast.md`, "Owner setup")

1. **Bunny.net**: create the account; a Storage zone in Frankfurt (main region only, no replication); a Pull zone on it; the custom hostname `audio.actuallyrelevant.news`; at United Domains a `CNAME audio → <pullzone>.b-cdn.net`; "Verify & Activate SSL"; in the pull zone, IP anonymisation in the logs (or logging off) and a short log retention, and CORS for `.vtt`; accept Bunny's DPA if offered; note the Storage zone name and its password (the zone password, not the account API key).
2. **ElevenLabs**: a dedicated API key limited to text-to-speech/dialogue and user read; a key-level credit limit matching the monthly cap; Auto Top Up off. Pick the voices from the spike samples.
3. **Environment variables** on Render (API service) and in the local `server/.env`, and added by hand to `server/.env.sample` (agents cannot read or edit it; renaming it to `env.example` is an open backlog item):

   | Variable | Needed | Default | Purpose |
   |---|---|---|---|
   | `PODCAST_ENABLED` | to run anything | `false` | Kill switch for generation, TTS and publishing |
   | `PODCAST_DRY_RUN` | no | `true` unless `NODE_ENV=production` | Stub voice, `dry-run/` uploads, publishing refused |
   | `PODCAST_DRY_RUN_LIVE_TTS` | no | `false` | Real voices in a dry run (spends credits) |
   | `ELEVENLABS_API_KEY` | when enabled | — | The dedicated, restricted key |
   | `PODCAST_VOICE_ID_A`, `PODCAST_VOICE_ID_B` | when enabled | — | The two AI host voices |
   | `BUNNY_STORAGE_ZONE` | when enabled | — | Storage zone name |
   | `BUNNY_STORAGE_PASSWORD` | when enabled | — | Storage zone password (write access) |
   | `PODCAST_AUDIO_BASE_URL` | when enabled | — | `https://audio.actuallyrelevant.news` |
   | `PODCAST_MONTHLY_TTS_CHAR_CAP` | no | `30000` (set from S2) | Hard monthly cap |
   | `PODCAST_MAX_ATTEMPTS_PER_WEEK` | no | `3` | Automatic failures before the block and alert |
   | `PODCAST_OWNER_EMAIL` | for the feed | — | `itunes:email`; a project address, not a personal one (Spotify sends its claim code there) |
   | `PODCAST_ARTWORK_URL` | for the feed | — | Square JPEG, 3000 px, ≤ 500 KB, uploaded to Bunny `show/` |
   | `WEBHOOK_URL` | when enabled | existing | Becomes required when `PODCAST_ENABLED=true`; the configuration check fails without it |

   Model id (`eleven_v4`), Bunny storage host (`storage.bunnycdn.com`), listen links and show metadata are constants in `config.ts`, changed in code.
4. **Render static site**: the rewrite `/podcast.xml` → `https://<backend>.onrender.com/api/podcast/feed.xml` above the `/*` catch-all.
5. **Artwork**: square, 1400-3000 px, RGB, ≤ 500 KB; if AI-generated, say so (it becomes a row in the transparency record).
6. **After the first published episode**: validate the feed (Podcasts Connect, Podbase); submit to Apple Podcasts Connect, Spotify for Creators ("Find an existing show" → "Somewhere else"), Podcast Index, Amazon Music for Podcasters; ask an agent to put the listing URLs into `config.ts`.
7. **Buzzsprout**: unpublish the old show (no redirect, no back catalogue migration).
8. Approve the written AI copy and the show identity (open questions 1-2) before Phase 3 ships.

### Open questions that need the owner

1. **Written AI copy** — APPROVED by the owner as proposed on 2026-10-06 (lives in `aiLabelCopy.ts` and `aiDisclosureCopy.ts`): episode description first line "AI-generated: This episode was written and voiced by AI, based on our AI analysis of this week's news."; show description "A weekly five-minute briefing on the news that matters most to humanity. Written and voiced by AI, based on Actually Relevant's AI analysis of the week's news."; `/podcast` page label "Written and voiced by AI." Needed before Phase 3 ships.
2. **Show identity**: show title (proposal "Actually Relevant", a new feed), Apple category (proposal News), the artwork still open. Feed contact address decided by the owner on 2026-10-06: `contact@actuallyrelevant.news`.
3. **Voices**: the pair from the S6 samples.
4. **Only if S2 says Starter does not cover it**: the Creator plan, or a shorter episode.

## Changes

### Phase 1 — script

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | `Podcast`: add `weekKey String? @unique`, `stage PodcastStage @default(created)`, `dialogue Json?`, `episodeStories Json?`, `episodeSummary String @default("")`, `showNotes String @default("")`, `scriptModelId String?`, `lastError String?`, `failedAt DateTime?`, `attempts Int @default(0)`, `blockedAt DateTime?`, `blockedReason String?`, `leaseOwner String?`, `leaseUntil DateTime?`, `dryRun Boolean @default(false)`. New enum `PodcastStage { legacy created scripted voiced ready }`. |
| `server/prisma/migrations/<ts>_podcast_stages/migration.sql` | Generated with `db:migrate:create`; the stage column is added with default `'legacy'` so existing rows backfill, then `SET DEFAULT 'created'`; delete any `DROP INDEX "stories_embedding_idx"`. |
| `server/src/config.ts` | New `podcast` section (the variables above; constants `maxStories: 5`, `selectModelTier: 'large'`, `scriptModelTier: 'large'`, `chunkMaxChars: 1800`, `spokenCharBand: [4200, 5600]`, `weekendWindow`, `autoPublishMinAgeHours: 24`, `continuityMode`, `seed`, `ttsModelId: 'eleven_v4'`, show metadata, listen links, `feedGuid`) and `elevenlabs`/`bunny` credential blocks in the `plunk`/`mastodon` pattern (`''` = unset). |
| `server/src/schemas/llm.ts` | Replace `podcastScriptSchema`/`PodcastScript` with `podcastDialogueSchema`/`PodcastDialogue`; add `podcastSelectResultSchema`. |
| `server/src/prompts/podcast.ts` | Rewrite `buildPodcastPrompt(stories)`; `StoryForPodcast` gains `ref` (1-based). |
| `server/src/prompts/podcast-select.ts` | New. *Responsibility:* the prompt for picking the week's 4-5 stories for audio. *Exports:* `buildPodcastSelectPrompt`, `StoryForPodcastSelect`. |
| `server/src/prompts/index.ts` | Re-export the new builder. |
| `server/src/lib/xml.ts` | New. *Responsibility:* XML text escaping. *Exports:* `escapeXml` (moved from `prompts/shared.ts`). |
| `server/src/prompts/shared.ts` | Re-export `escapeXml` from `lib/xml.ts`; no behaviour change, frozen eval prompts untouched. |
| `server/src/services/podcastDialogue.ts` | New, pure. *Responsibility:* dialogue rules and transformations without I/O. *Exports:* `validateDialogue`, `assembleSpokenTurns`, `chunkTurns`, `renderScript`, `buildTranscriptVtt`. |
| `server/src/services/podcastScript.ts` | New. *Responsibility:* the two LLM calls and the show notes. *Exports:* `selectEpisodeStories`, `writeEpisodeScript`. `getLLMByTier`, `rateLimitDelay`, `withRetry` (3), `includeRaw` with explicit `parsed: null` handling, usage logged. |
| `server/src/services/podcastPipeline.ts` | New. *Responsibility:* the stage machine and its lease. *Exports:* `advanceEpisode`, `resetEpisode`, `releaseHeldLeases` (for shutdown). Phase 1 runs `created → scripted`. |
| `server/src/services/podcastWeekly.ts` | New. *Responsibility:* this week's episode and its retry and block policy. *Exports:* `runWeeklyEpisode`, `isoWeekKey`. (`getWeekTitle` in `generateNewsletter.ts` stays as is; the two ISO-week helpers are a few lines each and serve different formats.) |
| `server/src/services/podcast.ts` | Remove `assignStories`, `generateScript`, `assemblePodcastScript`; keep CRUD; `getPodcasts` selects list columns only and filters by `stage`. |
| `server/src/lib/aiLabelCopy.ts` | `PODCAST_OPENER` becomes the owner-approved sentence (decision 4). |
| `server/src/index.ts` | The SIGTERM/SIGINT handler calls `releaseHeldLeases()`. |
| `server/src/routes/admin/podcasts.ts` | Remove `POST /`, `/:id/assign`, `/:id/generate`; add `POST /weekly` and `POST /:id/resume` (both start work in the background behind `expensiveOpLimiter`, return 202); `PUT /:id` title only. |
| `server/src/schemas/podcast.ts` | Drop `createPodcastSchema`; `updatePodcastSchema` → `title`; `podcastQuerySchema` gains `stage`. |
| `shared/types/index.ts` | `Podcast` gains `stage`, `weekKey`, `lastError`, `attempts`, `blockedAt`, `blockedReason`, `inProgress`, `dryRun`, `showNotes`, `episodeSummary`, `episodeStories`, `script` (rendered view); Phase 2-3 fields follow. |
| `client/src/lib/admin-api.ts`, `client/src/hooks/usePodcasts.ts` | Replace create, assign and generate with `startWeekly` and `resume`; `usePodcast` polls while `inProgress`. |
| `client/src/components/admin/PodcastDetail.tsx` | Stage badge, block and error display, read-only script and show notes, Resume; legacy rows read-only. |
| `client/src/components/admin/PodcastTable.tsx`, `client/src/pages/admin/PodcastsPage.tsx` | Stage column; "Start this week's episode" instead of the create dialog for podcasts. |
| `server/src/scripts/eval/checks.ts` | Replace `checkPodcast` with `checkDialogue(dialogue, publishers)`: `validateDialogue`'s verdicts plus the eval-only long-sentence share (> 18 words) and publisher coverage. |
| `server/src/scripts/eval/suites/largeTier.ts`, `fixtures.ts` | The podcast call site uses the new prompt and schema on 4-5 fixture stories (fixed pick by relevance; the `fixtures.ts` mirror comment points at `podcastScript.ts`); scoring uses `checkDialogue`; the `podcast-script` rating text renders the dialogue as "HOST A: …". |
| `server/src/scripts/eval/options.ts`, `shipChecks.ts`, `shipRules.ts` | New `eval:recalibrate` step `podcast` (runs only when named): gpt-6-sol@medium writes the select call and the dialogue on the cached podcast fixture; the gate is `checkDialogue` (no validation failure, every story covered, band met) and a valid selection (4-5 ids from the pool, distinct issues where available). This is the prompt check CLAUDE.md asks for; a fresh sample is not needed because the podcast fixture is not part of the spent calibration halves. |

### Phase 2 — audio and storage

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | `Podcast`: add `ttsModelId String?`, `voiceIds Json?`, `audioUrl String?`, `audioPath String?`, `transcriptUrl String?`, `transcriptPath String?`, `audioBytes Int?`, `durationSec Int?`, `readyAt DateTime?`. New `PodcastAudioChunk { id, podcastId (cascade), index, bytes Bytes, requestId String?, chars Int, durationMs Int, createdAt; @@unique([podcastId, index]) }` (`podcast_audio_chunks`) and `PodcastTtsUsage { id, podcastId String? (SetNull), chars Int, createdAt; @@index([createdAt]) }` (`podcast_tts_usage`; survives episode deletion so the monthly cap still sees the spend). |
| `server/prisma/migrations/<ts>_podcast_audio/migration.sql` | Generated; review for the index drop. |
| `server/src/lib/elevenlabs.ts` | New. *Responsibility:* the ElevenLabs HTTP contract. *Exports:* `textToDialogue({ inputs, continuity })` → `{ audio, requestId, chars }`, `getRemainingCharacters`, `ElevenLabsQuotaError`, `isElevenLabsConfigured`. axios, `responseType: 'arraybuffer'`, `maxContentLength` 20 MB, timeout 120 s, `withRetry` with `retries: 1` and a `retryOn` that refuses every 4xx and paused states. |
| `server/src/lib/bunnyStorage.ts` | New. *Responsibility:* writing and deleting objects in the storage zone. *Exports:* `putObject(path, buffer, contentType)`, `deleteObject(path)`, `publicUrl(path)`, `isBunnyConfigured`. `AccessKey` header, SHA-256 `Checksum` header, `withRetry` (PUT and DELETE are idempotent). |
| `server/src/lib/podcastAudio.ts` | New. *Responsibility:* producing MP3 files with ffmpeg. *Exports:* `assembleEpisodeMp3(chunks, tags)` → `{ buffer, durationSec }`, `silentMp3(seconds)` (dry-run stub). Spawns the `ffmpeg-static` binary on temp files; always cleans up. |
| `server/src/services/podcastGuards.ts` | New. *Responsibility:* whether the podcast may spend or publish now. *Exports:* `assertPodcastRunnable(kind)`, `reserveTtsChars(podcastId, chars)`, `monthToDateChars`, `PodcastBlockedError`. Phase 1's inline kill-switch check in `runWeeklyEpisode` moves here. |
| `server/src/services/podcastPipeline.ts` | Add `voiced` (pre-check, reservation, fenced chunk writes, stub voice in dry run) and `ready` (assemble, upload MP3 and VTT, store fields, delete chunks); `resetEpisode` refuses once ever published, deletes chunks and the previous objects. |
| `server/src/services/podcast.ts` | `deletePodcast` refuses rows ever published or with a live lease, and deletes their Bunny objects best-effort. Deleting an unpublished episode frees its `weekKey`, so a later weekend slot regenerates it (intended: deleting means "make a new one"). |
| `server/src/lib/notify.ts` | Add `notifyEvent(title, message)` with the same transport; `notifyJobFailure` unchanged. |
| `server/src/routes/admin/podcasts.ts` | `POST /:id/regenerate` (script; refuses once ever published); `GET /usage` (month to date and cap). |
| `client/src/components/admin/PodcastDetail.tsx` | Audio player, duration, characters billed (episode and month), dry-run badge, Regenerate script with confirm. |
| `server/package.json` | `ffmpeg-static` at an exact version (or the S5 alternative). The commit message flags it: a binary fetched at install time, handling no credentials or personal data. |
| `server/src/scripts/podcast-spike.ts` | Delete. |

### Phase 3 — publishing

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | `Podcast`: add `publishedAt DateTime?`, `unpublishedAt DateTime?`. |
| `server/prisma/migrations/<ts>_podcast_publish/migration.sql` | Generated; review for the index drop. |
| `server/src/services/podcastPublish.ts` | New. *Responsibility:* moving episodes in and out of the feed. *Exports:* `publishEpisode`, `unpublishEpisode`, `getPublishedEpisodes`, `pickAutoPublishCandidate`. |
| `server/src/services/podcastFeed.ts` | New. *Responsibility:* the podcast RSS document and its cache. *Exports:* `getFeedXml`, `invalidateFeedCache`, `buildPodcastFeedXml` (pure, for tests). |
| `server/src/routes/public/podcast.ts` | New. *Responsibility:* public podcast endpoints: `GET /feed.xml` (`application/rss+xml`, `Cache-Control` as the story feed) and `GET /` (show and episodes JSON). |
| `server/src/routes/public/index.ts`, `server/src/app.ts` | Mount `/podcast` before `apiLimiter`; add `/api/podcast` to `publicReadPaths`. |
| `server/src/lib/openapi.ts` | Register `GET /api/podcast` with its Zod schema and `.openapi()` metadata; AI-generated fields described with `OPENAPI_AI_FIELD_PREFIX`. |
| `server/src/routes/admin/podcasts.ts` | `POST /:id/publish`, `POST /:id/unpublish` (409 when a guard refuses). |
| `server/src/lib/aiLabelCopy.ts` | `PODCAST_EPISODE_AI_LINE`, `podcastShowDescription()` with the owner-approved wording. |
| `client/src/components/ai/aiDisclosureCopy.ts` | The `/podcast` page label (owner-approved). |
| `client/src/pages/PodcastPage.tsx` | New page as described; episode titles carry the AI badge through `AiLabel`. |
| `client/src/lib/api.ts`, `client/src/hooks/usePodcastEpisodes.ts` | `publicApi.podcast()` and a TanStack Query hook. |
| `client/src/App.tsx`, `client/src/routes.ts`, `server/src/routes/public/sitemap.ts`, `client/src/layouts/PublicLayout.tsx` | Register `/podcast` (lazy, prerendered, in the sitemap, in `FOOTER_NAV`). |
| `client/src/pages/PrivacyPage.tsx` | Recipients: Bunny (BunnyWay d.o.o., Slovenia) serves podcast audio, transcripts and artwork and receives listeners' IP addresses, anonymised in its logs; ElevenLabs receives only the episode script, no visitor data. The owner reviews the wording. |
| `client/src/components/admin/PodcastDetail.tsx` | Publish and Unpublish with confirm; `publishedAt`. |

### Phase 4 — automation

| File | Change |
|------|--------|
| `server/prisma/migrations/<ts>_podcast_jobs/migration.sql` | Hand-written after `20260214120000_add_mastodon_posts`: `INSERT INTO "job_runs" ("id", "job_name", "enabled", "cron_expression", "last_completed_at", "created_at", "updated_at") VALUES (gen_random_uuid(), 'generate_podcast', false, '0 6,10,14,18 * * 6,0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), (gen_random_uuid(), 'publish_podcast', false, '0 7 * * 1', …) ON CONFLICT DO NOTHING`. |
| `server/src/jobs/generatePodcast.ts` | New. *Responsibility:* the cron entry: window check, `runWeeklyEpisode({ trigger: 'cron' })`, throw on `blocked`, success notice. *Exports:* `runGeneratePodcast`. |
| `server/src/jobs/publishPodcast.ts` | New. *Responsibility:* the cron entry for automatic publication. *Exports:* `runPublishPodcast`. |
| `server/src/jobs/handlers.ts`, `server/src/scripts/seed-jobs.ts` | Register and seed both jobs (disabled). |

### Tests to update because of removed code

`server/src/services/podcast.test.ts` (imports `assemblePodcastScript`), `server/src/services/prompts.test.ts` (old `buildPodcastPrompt` shape), `server/src/test/helpers.ts` (`samplePodcast` gains defaults for the new fields), `server/src/routes/admin/podcasts.test.ts` (removed routes; LLM mocks return `{ raw, parsed }`), `server/src/scripts/eval/checks.test.ts`, `ratingSets.test.ts`, `ratingFiles.test.ts`, `resultsReport.test.ts` (podcast fixtures now carry a dialogue; the `podcast` call-site id and `podcast-script` slug stay), the client tests for `PodcastDetail` and the podcast hooks; `server/src/services/story.test.ts` must keep passing unchanged.

### Documentation (in the phase that changes the behaviour)

| File | Change |
|------|--------|
| `.specs/podcast.allium` | New spec via `/allium`: `Podcast` with stage and status, forward-only stages, the fenced lease, weekly idempotency, the attempt cap and block rules, the spend reservation, kill switch scope (never blocks unpublish or the feed), dry run, the publish invariant, the auto-publish candidate rule, feed contents, the opener as first spoken turn. Extended in each phase. |
| `.specs/newsletter-and-podcast.allium` | Remove the podcast section; a pointer to `podcast.allium`. |
| `.context/podcast.md` | New: pipeline, stages, modules, chunking, audio, storage paths, feed, page, admin actions, alerts, caps, dry run, environment variables, owner setup, troubleshooting. Cross-reference header to the spec. |
| `.context/newsletter-podcast.md` | Remove the podcast sections and endpoints; a pointer to `podcast.md`. |
| `.context/scheduler.md` | Both jobs in the registry with their window and attempt behaviour; the stale `jobService.ts` reference corrected to `server/src/services/job.ts` (the table is edited anyway). |
| `.context/llm-analysis.md` | The podcast select and script calls and tiers; ElevenLabs `eleven_v4` pinned, its retirement tracked like OpenAI's. |
| `.context/model-eval.md` | The podcast call site, `checkDialogue`, the `podcast` recalibrate step, and the listening test before enabling the job. |
| `.context/ai-transparency.md` | Phase 1: row 8's script and the new opener. Phase 2: audio (ElevenLabs `eleven_v4`), the ID3 marks (50(2) interim, unsigned), "No AI-generated audio exists" removed, §4 watermark reliance with the S7 result. Phase 3: publication to our feed, Bunny and `/podcast`; written lines in show and episode descriptions; `podcast:txt`; the page label; q3 answered and removed from §11; the privacy row. The owner listens before manual publication, but the record does not rely on the human-review exception, because publishing becomes automatic. |
| `.context/seo.md`, `README.md` | The `/podcast.xml` rewrite rule and the `/podcast` route. |
| `.context/deployment.md` | `ffmpeg-static` downloads a binary at build; the new variables point to `podcast.md`. |
| `CLAUDE.md` | The spec list adds `podcast`; the context table adds `podcast.md`. |

## Tests

Server tests are co-located with `vi.hoisted` mocks; ElevenLabs and Bunny are mocked at the axios layer, ffmpeg at `child_process.spawn` except in one integration test.

- `podcastDialogue.test.ts`: validation accepts a good dialogue and rejects each failure (missing or duplicate story, three turns in a row, unknown tag, URL, markdown, speaker prefix, band too low or high counting tags and code-added turns, a turn over 400); `assembleSpokenTurns` puts the opener first and the sign-off last; `chunkTurns` never splits a turn, keeps segments whole when they fit, splits an oversized segment at turn boundaries, keeps every chunk within the limit and the order intact; `buildTranscriptVtt` offsets by the preceding chunks' durations and ends at the episode duration.
- `podcastScript.test.ts`: selection keeps only pool ids and fails closed under four; `storyRef` mapped to ids and the snapshot stored; `parsed: null` and an invalid dialogue each lead to one regeneration, then `PodcastBlockedError`; show notes start with the AI line and the spoken turns carry no URLs.
- `podcastPipeline.test.ts`: resume from each stage runs only the remaining ones; a failure keeps the stage and records the error; the lease: a second claimant gets nothing, an expired lease is taken over, a stage write by a process that lost the lease matches nothing and aborts, release only clears its own lease; `voiced` skips stored chunks (no re-billing), stops on a reservation refusal before calling TTS, uses the stub in dry run; `ready` uploads both files, stores the fields, deletes the chunks; `resetEpisode` refuses once ever published and deletes the old objects.
- `podcastWeekly.test.ts`: `isoWeekKey` across year boundaries (UTC); find-or-create is idempotent under a P2002 race; `blockedAt` makes later calls skip; cron failures below the cap return `retry-later`, at the cap block; admin trigger ignores the cap and resets nothing it should not; a `dryRun` row is reset when the config is live.
- `podcastGuards.test.ts`: month boundary in UTC; two concurrent reservations near the cap, one refused (the advisory lock is taken first in the transaction); usage of deleted episodes still counts; `assertPodcastRunnable` names the missing setting, including `WEBHOOK_URL`.
- `lib/elevenlabs.test.ts`: request body (pinned model, voice mapping, seed, continuity fields), `request-id` read from the headers, 401/402/quota → `ElevenLabsQuotaError` without retry, a 5xx retried once.
- `lib/bunnyStorage.test.ts`: URL, headers, checksum, `publicUrl`.
- `lib/podcastAudio.test.ts`: ffmpeg arguments (concat list, loudnorm, ID3 frames), temp files removed on failure, duration from the byte length within ±1 s. One integration test runs the real binary on two generated one-second silent MP3s and reads back the ID3 frames; skipped when the binary is absent.
- `podcastPublish.test.ts`: publish refuses unless `ready`, refuses a `dryRun` row and with the kill switch off, sets `publishedAt` once and clears `unpublishedAt`, invalidates the cache; unpublish works with the kill switch off; `pickAutoPublishCandidate` takes the newest ready episode of the current or previous week, skips unpublished-before, too-young and older episodes.
- `podcastFeed.test.ts`: only published, ready, non-dry-run items; escaping; GUID equals the id; enclosure length and type; namespaces declared; `podcast:txt` on channel and items; AI line first in every description; RFC 2822 dates; an empty feed is valid XML.
- `routes/public/podcast.test.ts`: feed headers and caching; the feed is not rate-limited by `apiLimiter`; JSON shape; served with the kill switch off.
- `routes/admin/podcasts.test.ts`: new routes require auth; `PUT` rejects `status` and `script`; publish refusals map to 409; regenerate and delete refuse ever-published rows.
- `jobs/generatePodcast.test.ts`: no-op outside the window; `blocked` throws once and later slots skip; success sends `notifyEvent`.
- `jobs/publishPodcast.test.ts`: publishes the candidate; no-op without one; never republishes an unpublished episode.
- `lib/notify.test.ts`: `notifyEvent` payload; silent without `WEBHOOK_URL`.
- `server/src/test/migrations.test.ts` keeps guarding the pgvector index; the stage backfill to `legacy` is checked once by hand against the local database.
- Client: `PodcastPage.test.tsx` (AI label before the episode list, the audio element uses the CDN URL, feed link, accessible names, axe); `PodcastDetail.test.tsx` (buttons per stage: Publish only when ready, Regenerate hidden once ever published, polling only while in progress).
- Eval: `checks.test.ts` for `checkDialogue`.

## Out of Scope

- Generic scheduler fixes (DB-level job claim, retry of failed runs, no boot run for never-completed jobs, the first `jobRun.update` outside the `try`); follow-up.
- Exact transcript timings via `/text-to-dialogue/with-timestamps`; per-episode web pages; pronunciation dictionaries.
- Turn-level dialogue editing, "Regenerate audio", uploading a hand-made MP3, an episode hold flag beyond `unpublishedAt`.
- Intro or outro music; per-episode artwork; YouTube; download statistics beyond Bunny's counts.
- Migrating or redirecting the Buzzsprout back catalogue (owner decision: abandoned).
- Renaming `server/.env.sample` to `env.example` (backlog item); the newsletter spec drift (`select_model_tier`, `stories_per_issue`).
- Splitting `Podcast`'s operational columns into a `PodcastRun` table (accepted debt; trigger named above).

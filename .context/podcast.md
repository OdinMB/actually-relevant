# Podcast (weekly two-speaker episode)

> **Spec:** [`.specs/podcast.allium`](../.specs/podcast.allium) -- stages, lease, weekly idempotency, block and attempt rules, dialogue validation, the AI opener. This file covers the implementation, endpoints and how to change it. The plan with the later phases (audio, Bunny storage, feed, automation): `.plans/autonomous-two-speaker-podcast.md` (archived to `.plans/completed/` once every phase is done).

## Status

Phase 1 is built: the admin starts this week's episode, the pipeline selects 4-5 stories and writes a two-speaker dialogue, and the admin shows the rendered script ("HOST A: …") and show notes, which the owner can voice by hand. Nothing is voiced, stored on a CDN or published yet; `voiced` and `ready` exist in the enum for Phase 2.

## Two axes on `Podcast`

- **`stage`** (production, forward-only): `legacy` (rows from before this pipeline; read-only, never advanced), `created`, `scripted`, then `voiced` and `ready` in later phases. A failure never moves the stage: it sets `lastError` and `failedAt`, and the next run resumes from the stage.
- **`status`** (`ContentStatus`, shared with newsletters): publication. Nothing in Phase 1 changes it; `PUT /api/admin/podcasts/:id` accepts only `title` (`.strict()`, so `status` or `script` in the body is a 400).

`weekKey` is the ISO week in **UTC** (`isoWeekKey()` in `podcastWeekly.ts`, not the newsletter job's local-time `getWeekKey`), unique, so a week has one episode and a concurrent create loses on P2002 and reads the winner's row.

## Modules

| File | Responsibility |
|------|----------------|
| `server/src/services/podcastWeekly.ts` | This week's episode and its retry/block policy: `runWeeklyEpisode({ trigger })`, `findOrCreateWeekEpisode()`, `resumeEpisode(id)`, `isoWeekKey()` |
| `server/src/services/podcastPipeline.ts` | The stage machine and its lease: `advanceEpisode(id, { trigger })`, `resetEpisode(id, { dryRun })`, `releaseHeldLeases()` (called from the SIGTERM/SIGINT handler in `index.ts`) |
| `server/src/services/podcastScript.ts` | The two LLM calls (`selectEpisodeStories`, `writeEpisodeScript`) and `buildShowNotes` |
| `server/src/services/podcastDialogue.ts` | Pure dialogue rules: `validateDialogue`, `assembleSpokenSegments` (adds the opener and sign-off), `renderScript`, `dialogueCharBudget` |
| `server/src/services/podcastGuards.ts` | `PodcastBlockedError` (Phase 2 adds the configuration check, the TTS spend reservation and the job-row re-check) |
| `server/src/services/podcast.ts` | CRUD only; lists select list columns, rows carry a derived `inProgress` |
| `server/src/prompts/podcast.ts`, `podcast-select.ts` | The dialogue and selection prompts |
| `server/src/schemas/llm.ts` | `podcastDialogueSchema`, `podcastSelectResultSchema`, `PODCAST_AUDIO_TAGS` |
| `server/src/lib/aiLabelCopy.ts` | `PODCAST_OPENER` (spoken) and `PODCAST_EPISODE_AI_LINE` (show notes), owner-approved wording |

Settings: `config.podcast` in `server/src/config.ts` (no environment overrides). `dryRun` is derived from `NODE_ENV !== 'production'` and stored on the row; in Phase 1 it only shows as a badge and resets a leftover dry-run row when the environment is live (the LLM calls are real in both).

## The lease

`advanceEpisode` claims the row with raw SQL on the database clock (`lease_until < now() AT TIME ZONE 'UTC'`; the column is `timestamp without time zone` holding UTC), renews it before every stage, and writes every stage with `updateMany({ where: { id, leaseOwner: me } })`, aborting with `LeaseLostError` when that matches nothing. Release is `WHERE lease_owner = me`, in `finally` and at shutdown. A second claimant gets `{ status: 'busy' }` and returns quietly. Chosen over `pg_try_advisory_lock` because Prisma's pool can run each query on another connection.

## Weekly run and blocks

`runWeeklyEpisode` outcomes: `done`, `skipped` (ready or published, blocked on the cron trigger, lease held elsewhere), `retry-later`, `blocked`. A `PodcastBlockedError` (Phase 1: the dialogue still invalid after its one regeneration) blocks at once. Other failures count as `attempts` only on the cron trigger and block at `maxAttemptsPerWeek` (3). The admin trigger never counts and clears a block and the attempts first, so **Start this week's episode** on a blocked week behaves like Resume. The cron job itself arrives in Phase 4.

## Selection and dialogue

- **Pool**: `published` stories crawled in the last `config.content.storyAssignmentDays` (7) days, most relevant first, the same window as the newsletter. Fewer than 4 → error before any call.
- **Selection** (`large` tier): ids outside the pool and duplicates are dropped, at most 5 kept, fewer than 4 → error (retryable). The order the model returns is the episode order.
- **Dialogue** (`large` tier, `withStructuredOutput(..., { includeRaw: true })`, usage logged): segments `intro`, one `story` per story in order (`storyRef` = 1-based ref), `outro`. An invalid or unparsable answer gets one regeneration with the problems listed in `<PREVIOUS_DRAFT_PROBLEMS>`; a second failure is a `PodcastBlockedError`. Never truncated or patched.
- **Validation** (`validateDialogue`): every story exactly once; intro first, outro last; no speaker three times in a row (the code-added opener and sign-off, both HOST_A, count); 4,200-5,600 spoken characters including the opener, sign-off and tags; turns ≤ 400 characters; tags only from `PODCAST_AUDIO_TAGS`, at most 2 per turn (they are billed as characters); no URLs, markdown or speaker prefixes.
- **Segues** (owner, 2026-10-06): audio will be voiced one segment per TTS request, so every segment after the intro must open with its own bridge: a first turn of at least 40 characters that is not just the headline, and no two consecutive story segments opening with the same first five words. Keep this rule in the prompt, the schema description and validation together.
- **Snapshot**: `episodeStories` (ref, id, title, publisher, sourceUrl, slug, issue) is frozen at scripting; show notes and the later feed read it, never `storyIds`, so story deletion (which strips `storyIds`) cannot shift references.
- **Stored at `scripted`**: `dialogue` (the model's segments), `episodeStories`, `storyIds`, `title` (= episode title), `episodeSummary`, `showNotes` (AI line first, then the summary, then each story with our analysis link and its source), `script` (the rendered spoken episode), `scriptModelId`.

The opener and sign-off are code, not prompt: `PODCAST_OPENER` ("This episode was written and voiced by AI, based on our AI analysis of this week's news.") is the first spoken turn of every episode. Don't move it into the prompt. Changing its wording needs the owner (`.context/ai-transparency.md`).

## Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/podcasts` | List (paginated; `status`, `stage` filters; list columns only, plus `inProgress`) |
| POST | `/api/admin/podcasts/weekly` | Find or create this week's row, answer 202 with it, then `runWeeklyEpisode({ trigger: 'admin' })` in the background |
| GET | `/api/admin/podcasts/:id` | Single row with `inProgress` |
| POST | `/api/admin/podcasts/:id/resume` | 202, then `resumeEpisode` in the background (404 unknown, 409 legacy) |
| PUT | `/api/admin/podcasts/:id` | Title only |
| DELETE | `/api/admin/podcasts/:id` | Delete (Phase 2 adds guards) |

Both POSTs sit behind `expensiveOpLimiter`. The UI (`PodcastsPage`, `PodcastDetail`, `PodcastStageBadge`): "Start this week's episode", a stage column, the stage badge with "In progress" and "Blocked", the block reason, the last error, attempts, a dry-run badge, Resume (blocked, failed or not yet scripted), the episode's stories, the read-only script and show notes. The detail polls every 5 s only while `inProgress`. Legacy rows show their old script read-only.

## Evaluating prompt changes

`checkDialogue` (eval `checks.ts`) runs production's `validateDialogue` plus the long-sentence share and publisher coverage; the large-tier suite and `eval:recalibrate --steps podcast` use it (`.context/model-eval.md`).

## Troubleshooting

- **Episode stuck "In progress"**: a process died without releasing; the lease expires after `leaseMinutes` (30) and the next Resume takes it over.
- **Blocked with "the dialogue is still invalid…"**: the reason lists the rule each draft broke. Resume tries again (two more calls); repeated failures point at the prompt or the band.
- **"only N published stories this week"**: the pool is short; publish more or wait.

# Follow-up: two-speaker podcast, Phase 2b (interactive and automated modes)

Plan: `.plans/completed/2026-10-06_autonomous-two-speaker-podcast.md` (every phase done; archived with Phase 4).

## Controversial Decisions

- **Story pool anchored on the moment of selection, not on `createdAt`.** The plan anchored the pool on the row's `createdAt`. Because "Start this week's episode" now only creates the row, a run started days later would choose from a stale week (the current W41 row was created on Tuesday during testing). The selection stage now stores `storiesSelectedAt` (a fourth new column; the migration backfills `created_at` for rows past `created`) and both the model and the story picker read the pool as of that moment. Alternative: keep `createdAt` and accept stale pools when a row is opened early. Recorded in ADR-0008's alternatives.
- **A person's rewind makes the episode interactive.** Start over, Regenerate script, Change stories, Edit script after voicing and Regenerate audio all set `mode = interactive`, so a regenerated script or a fresh selection waits for review instead of being voiced unseen. Consequence: an automated episode that the owner regenerates becomes interactive, and the Phase 4 cron will then skip it. Alternative: keep the episode's mode, which would voice a regenerated script on an automated episode without a look.
- **Admin runs are two functions**, `startAdminRun` (synchronous: checks, claims the lease, rewinds, stores the mode, clears a block) and `resumeEpisode` (background, under the held lease, always releases), instead of the plan's `resumeEpisode(id, { mode? })`. The route needs the claim and the 409s before its 202 and the run after it.
- **Segue rules are warnings for a person's edit; every other rule blocks the save** (as the plan proposed; the brief left it to the agent).
- **"Fully automated" and "Finish automatically" at `selected` ask for no cost confirmation**: the script, and so the estimate, does not exist yet. Approve script, Resume at `scripted`, Regenerate audio and Edit script after voicing all show the estimate first. *Superseded by the owner's decision of 2026-10-06: they (and a Resume of an automated episode at `created` or `selected`) now confirm with a typical episode.*
- **Typical-episode figure (follow-up change, 2026-10-06):** N is `config.podcast.spokenCharAim` (4,900), as the owner's instruction said, with the band's top (6,200) shown beside it as "at most", because gpt-6-sol writes about 5,200 to 5,900, above the aim. Alternative: show only the band's middle or a measured average; the first real episodes would give one.
- **The owner's approval of Phase 2b reached the implementing agent through a workflow script**, so the agent wrote no "Confirmed by" line and named no reviewer on ADR-0008/0009 (the skills allow that only on the person's own words in the agent's session). The plan records the decisions as relayed; the coordinating session should write the confirmation line and the reviews.
- The root `package.json` had uncommitted npm metadata (`main`, `repository`, `license`, … as from `npm init`) not made by this change; left uncommitted and untouched.
- **Script edits echo the structure** (kinds, story refs, speakers) with the new text, and the server refuses any structural difference, which also refuses an edit from a stale tab after a regeneration.
- **The edited AI line also becomes the MP3's ID3 comment** for an edited episode (it is pending owner approval; nothing is published until Phase 3).
- **Legacy rows can no longer have their title edited** (they are read-only everywhere else; the old `PUT` had no guard).
- **`POST /weekly` lost `expensiveOpLimiter`**, since it no longer starts work.
- **Shared test fixtures** moved out of `podcastDialogue.test.ts` into `server/src/test/podcastFixtures.ts`; client fixtures and an admin render helper in `client/src/test/podcasts.tsx`.

## Decisions to Review

Both name only the agent: in force, not yet reviewed by a person. AGT-015 (switched on here, no profile) reaches neither, since the project uses no shared infrastructure and is not a component, so review is optional by the rule; the plan itself says Phase 2b awaits the owner's approval.

- **ADR-0008** · Pause interactive episodes for review through a per-row mode, a selected stage and explicit admin rewinds. Choice: each episode has a mode, interactive runs stop after the stories are selected and after the script is written, a person edits only an episode at rest, and going back is an explicit admin rewind (a person's rewind makes the episode interactive; the cron skips interactive episodes). Plan: `.plans/completed/2026-10-06_autonomous-two-speaker-podcast.md`. Review optional.
- **ADR-0009** · Track podcast runs from the episode lease in an app-level admin provider that drives a persistent, clickable toast. Choice: the admin routes claim the episode before answering, the server lists running episodes, and one provider in the admin layout polls that list and keeps a toast per episode until its outcome, surviving navigation and reloads. Plan: `.plans/completed/2026-10-06_autonomous-two-speaker-podcast.md`. Review optional.

## Records to Refresh

None kept by `ashoka-engineering:records` in this repository. `.context/ai-transparency.md` (the project's own EU AI Act record) was updated in this change: row 8 (modes, optional human review flagged by `humanEdited`), row 11 (admin-started actions), §3 (the edited AI line, pending approval; S7 on the MP3 row), §4 (S7: "AI speech probability 86%, likely generated with ElevenLabs" on a finished production episode; the provider mark survives our processing), §7, §8 (human review is disclosed, not relied on), §11 (S7 removed from the podcast item; new item: approve the edited-episode line).

## User Input Needed

- **Restart the server dev process** (stop it, then `npm run dev --prefix server`). The running server holds the Prisma DLL, so the agent did not run `db:generate`; it generated the client into the scratchpad and copied only the type declarations (`server/node_modules/.prisma/client/index.d.ts`) so the type checks could run. The restart applies `20261006160000_podcast_audio` (still unapplied locally) and `20261006200000_podcast_review_modes`, and regenerates the client properly (the schema stamp no longer matches). Until then the local podcast pages fail on the missing columns.
- **Record the owner's approval of Phase 2b and ADR-0008/0009 in his own words** (relayed to the agent on 2026-10-06, see the plan's top; the confirmation line and the log reviews are still to be written by a session he speaks in). The plan's confirmation line (2026-10-06) predates Phase 2b. Items taken from the task brief rather than the owner's own words: the "Edited by a person" checkbox and its wording, segue rules as warnings, the cron running automated and skipping interactive episodes, and the cost confirmation.
- **Try it** (dev dry run after the restart, or production after deploy): Podcasts → "Start this week's episode" → the W41 page. The existing W41 row is at `ready` with mode `automated` after the migration, so start a new take with "Start over" (it becomes interactive and stops after selecting stories), or wait for W42.

## DB Migrations

- `server/prisma/migrations/20261006200000_podcast_review_modes/` (written from `db:migrate:diff`, whose output also carried `DROP INDEX "stories_embedding_idx"`, left out; `ADD VALUE 'selected' BEFORE 'scripted'` hand-ordered). Adds the `selected` stage, the `PodcastMode` enum, `mode`, `human_edited`, `tts_seed`, `stories_selected_at`, and sets `mode = 'automated'`, `stories_selected_at = created_at` on rows past `created`. Not applied anywhere by the agent; it applies locally on the next server dev start and in production on the next deploy (after Phase 2's migration).

## Implementation Issues

- No sub-agent tool was available: the TDD guide, the check worker and the three code reviewers were not spawned. Tests were written with the code, the checks run directly, and the agent reviewed its own diff against the structure guidelines. A second review of the diff is advisable before merging.
- Not verified in a browser: the local database lacks the Phase 2 and 2b columns until the restart, so the flow was verified by the test suites only.
- Guarantees checked by disabling them (each turned its test red, then restored): the "edited by a person" auto-tick on a script edit, and the cron skipping an interactive episode. Disabling `withEpisodeLease`'s refusal for the same check was blocked by the session's permission classifier; its refusal is asserted directly in `podcastPipeline.test.ts` and `podcastEditing.test.ts`.

## Suggested Follow-Up Work

- `podcastScript.ts` now holds the pool and snapshots as well as the two LLM calls and the show notes; if it grows again, split the stories (`loadEpisodePool`, `episodeSnapshots`, `loadEpisodeStories`, `selectEpisodeStories`) into `podcastStories.ts` from the words (`writeEpisodeScript`, `buildShowNotes`).
- `podcastWeekly.ts` now holds the weekly run and the admin run's admission (`startAdminRun`); a third kind of run would be the trigger to move run admission into its own module.
- Re-voice only the chunks whose text changed after an edit (today a rewind to `scripted` re-voices the whole episode).
- Re-tag the MP3's ID3 title after a title edit at `ready`.
- A webhook notice when an interactive episode pauses for review.
- Saving stories at `selected` after a failed script stage does not clear `lastError`; the page then offers "Resume" rather than "Approve", which works but reads oddly.
- The progress toast is re-announced in the polite live region every time its text changes (every chunk while voicing); a quieter announcement policy would help screen-reader users.

## Mod code and load settings written

None.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `main`, base `main`, push only (the commit was made locally on `main`, as the task asked). Pull-request case: none switched on by the rule index; remote protection: check at landing. The push also carries the earlier unpushed commit `d4e437c` (backlog note) and deploys migration `20261006200000_podcast_review_modes` to production. Status: done.

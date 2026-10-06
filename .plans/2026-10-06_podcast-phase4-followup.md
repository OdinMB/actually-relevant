# Follow-up: two-speaker podcast, Phase 4 (automation)

Plan: `.plans/completed/2026-10-06_autonomous-two-speaker-podcast.md` (Phase 4 marked done; every phase done, plan archived). Run restarted after a crashed first run, which had left nothing in the working tree.

## Controversial Decisions

- **Reminder idempotency through a new column.** `podcasts.review_reminder_sent_at`, claimed with a conditional raw-SQL `UPDATE … WHERE review_reminder_sent_at IS NULL` before the notice goes out: one reminder per episode (so one per week), whichever Sunday slot or process gets there, at most once (a failed webhook post is not retried). Raw SQL rather than Prisma's typed `updateMany`, so the code typechecks and runs whether or not the generated client knows the column yet (the dev server holds the Prisma DLL). Alternatives: send only at the first Sunday slot (not idempotent across a manual Run, a boot catch-up or two processes), or reuse another column (hacky).
- **No reminder while a person's run holds the lease**; a later Sunday slot sends it. A person actively working on it on Sunday morning does not get told it is waiting.
- **A blocked interactive episode counts as waiting for its person**: the cron now checks interactive mode before the block, so it reports `waitingForPerson` and gets the Sunday reminder (with the block reason). Before, it was skipped as "blocked" and nobody would hear about it, because an admin run's block sends no alert.
- **Auto-publish refusals fail the run and alert** (for example an episode marked "Edited by a person" while that AI line is unconfirmed): the owner learns that Monday's episode was not published. Alternative from the Phase 3 follow-up: skip such candidates in `pickAutoPublishCandidate`, which would be silent. One alert per Monday while it lasts.
- **The publish job runs the configuration check first** (as the plan says for every podcast job run), although publishing itself needs no ElevenLabs or Bunny credentials. With the job enabled and a credential missing, it alerts on Monday rather than publishing.
- **The admin "Run" button on Generate Podcast does nothing outside the weekend window** (by design, ADR-0011); documented in `.context/podcast.md` troubleshooting.
- **Boot check lives in `jobs/podcastBootCheck.ts`**, called from `index.ts` beside `startScheduler()`, not inside the generic scheduler. It runs once per boot and does not re-run when a job is enabled from the admin page (the next job run checks anyway).
- **`ADR-0001`/`ADR-0006` references corrected in passing** in `podcastFeed.ts`, `podcastPublish.ts` and `.context/podcast.md` to the promoted ids (ADR-0010, ADR-0012). ADR bodies 0003-0010 still name the plan's old path `.plans/autonomous-two-speaker-podcast.md`; left as they are, because an accepted entry's body is frozen.

## Decisions to Review

None. ADR-0011 (weekend cron slots, the agent's) names the owner beside the agent, from the plan's confirmation line ("Confirmed by Odin Mühlenbein on 2026-10-06: every decision this plan states"); ADR-0012 (publication separate from production, automatic publishing as a job toggle) names the owner, whose split it is, beside the agent. Both ids gave way at promotion (reserved ADR-0004 and ADR-0006; the log had reached ADR-0010). ADR-0008 and ADR-0009 remain unreviewed (review optional), as recorded in the Phase 2b follow-up.

## Records to Refresh

None kept by `ashoka-engineering:records` in this repository. `.context/ai-transparency.md` (the project's own EU AI Act record) was updated in this change: rows 8 and 11 and §8 now say the cron and auto-publish jobs are built and seeded disabled.

## User Input Needed

- **Restart the server dev process** (stop it, then `npm run dev --prefix server`) so `predev` applies migration `20261006230000_podcast_jobs` and regenerates the Prisma client. The agent did not stop the servers or run `db:generate`.
- **Switch automation on** (production, after deploy): Admin → Jobs → enable **Generate Podcast** (weekend slots Saturday and Sunday 06:00, 10:00, 14:00, 18:00 UTC). Listen and publish by hand for three or four weeks, then enable **Publish Podcast** (Monday 07:00 UTC). Before enabling, `ELEVENLABS_API_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD` and `WEBHOOK_URL` must be set on Render, or every run blocks (and the boot check posts "Podcast configuration incomplete").

## DB Migrations

- `server/prisma/migrations/20261006230000_podcast_jobs/migration.sql` (hand-written, as the plan's table says; no index drop): adds `podcasts.review_reminder_sent_at` and inserts the `generate_podcast` (`0 6,10,14,18 * * 6,0`) and `publish_podcast` (`0 7 * * 1`) rows, both `enabled = false`, `last_completed_at = now()`, `ON CONFLICT DO NOTHING`. Not applied anywhere by the agent; applies locally on the next server dev start and in production on deploy (after the Phase 2, 2b and 3 migrations if those are not yet deployed).

## Implementation Issues

- **No sub-agent tool** in this run: the TDD guide, the check worker and the three `feature-dev:code-reviewer` passes were not spawned. The checks ran inline (output filtered to totals and failures) and the review was a self-review against the structure guidelines. A second review of the diff is advisable before merging.
- **Guard mutation check refused**: disabling the reminder claim and the publish job's row re-check to watch their tests go red was refused by the permission classifier (the one edit that landed was restored before any test run). Both are asserted directly (`generatePodcast.test.ts`: no notice when the claim returns 0; `publishPodcast.test.ts`: no publish when the re-check throws, and the re-check sits between the candidate and the publish), but the red runs were not observed.
- Not run end to end: the cron path needs the migrated database and a weekend; verified by the suites only.

## Suggested Follow-Up Work

- Re-run the configuration check when a podcast job is enabled from the admin Jobs page (today only at boot and at each run).
- The generic scheduler weaknesses (per-process overlap guard, `lastCompletedAt` written on failure, boot run for never-completed jobs) stay, as the plan's Out of Scope says (`BACKLOG.md`).

## Mod code and load settings written

None.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `main` (local commit, as the task asked), base `main`: push only, on the owner's word. No pull-request case from this session's rule index (REPO-004/006 not switched on, no Ashoka status line); remote protection: check at landing. `main` also carries the earlier unpushed podcast commits; the push deploys migrations through `20261006230000_podcast_jobs`. Status: done.

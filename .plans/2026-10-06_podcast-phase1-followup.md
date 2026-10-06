# Follow-up: two-speaker podcast, Phase 1 (script)

Plan: `.plans/autonomous-two-speaker-podcast.md` (Phase 1 marked done; the plan stays active for Phases 2-4).

## Controversial Decisions

- **Admin Start clears a block.** "Start this week's episode" on a blocked week clears the block and the attempts and runs again, like Resume. The plan says the admin trigger "ignores the attempt cap"; it did not say what Start does on a blocked row. Alternative: Start refuses with the block reason and only Resume clears it.
- **`chunkTurns` and `buildTranscriptVtt` deferred to Phase 2.** The plan's Phase 1 table lists them; nothing in Phase 1 voices or times audio, so they would have been unused code. `assembleSpokenSegments` (segments, not flat turns) replaces `assembleSpokenTurns`, because chunking needs segment boundaries.
- **Credential config blocks deferred to Phase 2.** `config.elevenlabs` / `config.bunny` arrive with the clients that read them. `config.podcast` already holds the Phase 0 outcomes (voices, continuity, pause, chunk size, cap) so they are recorded in code.
- **`podcastGuards.ts` created early** with only `PodcastBlockedError`, and `PODCAST_EPISODE_AI_LINE` added in Phase 1 (owner-approved wording, open question 1) because the show notes start with it.
- **Rendered script stored in the `script` column** at `scripted`, instead of rendering a view on every read.
- **UTC week key helper** in `podcastWeekly.ts` instead of reusing the newsletter job's `getWeekKey` (local calendar day; a service importing from `jobs/` is the pattern the plan avoids).
- **Episode order = the selection model's order.** The select prompt asks for an order with a natural arc; nothing re-sorts by issue.
- **Sign-off text** is the one the owner heard in the spike: "That's it for this week. Tell us what you think on actuallyrelevant.news. Thanks for listening." (`PODCAST_SIGN_OFF` in `podcastDialogue.ts`).
- **Regeneration feedback.** The one regeneration appends `<PREVIOUS_DRAFT_PROBLEMS>` listing the validation errors, rather than repeating the same prompt.
- **Eval podcast fixture** now samples the week's published stories (ids, relevance, top-level issue), mirroring production; the old "latest stored podcast's stories" branch is gone. Cached fixtures still load.
- **ADR-0003 promoted now**, though its chunk table arrives in Phase 2: the stage machine and lease it decides are in code. Its title was shortened to fit the schema's 120-character limit ("…with TTS chunks in Postgres until upload").

## Decisions to Review

None: ADR-0003 names the owner beside the agent, from the plan's confirmation line ("Confirmed by Odin Mühlenbein on 2026-10-06: every decision this plan states").

## Records to Refresh

None kept by `ashoka-engineering:records` in this repository. `.context/ai-transparency.md` (the project's own EU AI Act record) was updated in this change: row 8 and the podcast measure row (new opener, show-notes AI line).

## DB Migrations

- `server/prisma/migrations/20261006130000_podcast_stages/` (written from `db:migrate:diff`, because `db:migrate:create` refuses a non-interactive shell; the `DROP INDEX "stories_embedding_idx"` line was left out). Not applied anywhere. It applies to the local database when the server dev process is restarted (`predev` → `db:prepare`), and to production on the next deploy. Existing podcast rows become `stage = legacy`; check that once by hand against the local database after the restart (`SELECT stage, count(*) FROM podcasts GROUP BY 1`).

## User Input Needed

- **Restart the server dev server.** The Prisma client's TypeScript and JS were regenerated, but the query-engine DLL could not be replaced while the dev server holds it (EPERM), and the local database has no new columns yet. Until a restart (stop, then `npm run dev --prefix server`), the running server's podcast admin pages fail on the missing columns. The restart applies the migration and regenerates the client.
- **Try it**: Admin → Podcasts → "Start this week's episode", wait for the stage to read "Scripted", read the script and show notes. Not run end to end by the agent (needs the migrated database and an admin login).
- **Prompt check before relying on it**: `npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --steps podcast --dry-run`, then without `--dry-run` (cents). Not run by the agent (spends OpenAI credits).

## Implementation Issues

- The implementer agent had no sub-agent tool, so the TDD guide, the check worker and the three code reviewers were not spawned; the agent wrote tests first, ran the checks itself and reviewed its own diff against the structure guidelines. A second-person review of the diff is advisable before merging.

## Suggested Follow-Up Work

- `CreateContentDialog` still accepts `type="podcast"`, now unused; narrowing it to newsletters is a small tidy-up.
- The detail page's optimistic "in progress" after Start relies on the background run taking the lease before the first refetch; if the owner ever sees "Created" without progress right after Start, poll while `stage = created` and no error for the first few seconds.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `main`, push only (commit made locally on `main` as instructed). Pull-request case: none switched on by the rule index; remote protection: check at landing.

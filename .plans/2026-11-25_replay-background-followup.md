# Follow-up: the whole-step replay replays the linking step's stories (2026-11-25)

Direct task (no plan file), implemented on `claude/project-thread-egeer5` by an implementer agent. Eval-only: nothing in production changes. No paid eval was run.

## Controversial Decisions

- **No review of a background overview is skipped**, though those reviews are most of what the background adds (about $2 of the $3.70 desk estimate). A review makes a forming overview public, detaches entries, narrows the charter and is the only thing that lifts a burst's freeze; the judged stories' later link calls read all of that, and a frozen Iran-war overview would hold every look-alike pointing at it. Skipping only the periodic ones would still change charters and members. Recorded as ADR-0081.
- **A re-center's development is read from its members as the re-center found them**: the entries it detached counted, the stories it took in left out (`recentersOf`, `developmentBefore`). Read afterwards, a judged overview that swallowed more of a neighbour's stories than it holds must entries would stand for the neighbour and its re-center would land in "unscored" instead of "false". This also changes how a re-center's near misses are counted in a judged-only run: against the development the overview stood for before, not after.
- **A checkpoint's "wrong members" are now the members the joins bar reads as wrong.** Before, any member that was not a base entry of the key counted, so a reviewed center's entry in its own key's overview was a wrong member at the checkpoint and ignored by the bar. Counts at checkpoints of a key with a center can be lower than in the 2026-11-24 report for that reason alone.
- **The linking report's wording changed with the replay's.** One wording of what the keys make of a story (`linkKeys().as`) now serves the scorer's mistake lines, the diagnostics and both reports: a story of an outside key reads "background: entry of X" (it read "entry of X (other half)" in charters), a must entry of two keys "A or B" everywhere, and wrong joins, wrong foundings and repeats name their stories by title. No count changed; a `--rescore` of a saved linking replay prints the new wording.
- **ADR-0081 names only the agent.** The task said the story set was the owner's decision of 2026-11-25, but the agent had only the calling session's account of it, so the entry records that account in its Context and waits for his own word to name him.
- **The estimate's assumptions.** Each development is taken as one overview holding its key's base entries among the replayed stories, joined on their days, every review keeping every entry. So it is high where a development never forms (Colorado's had no review on 2026-11-24) and where two keys share entries (Hormuz's and the Iran war's shared stories count in both), and low where a development splits or look-alikes found their own. The stands are a flat $0.30 a run whatever `--limit`.
- **A cache-only `pass-pool` run was made in the upkeep folder** to confirm the paid command's research is answered from the cache at HEAD: 36 of 37 stories with facts, 1,122 facts, no call, the same as the paid run of 2026-11-25. It wrote `DOCS/2026-11-19_upkeep-eval/overview-eval-steps-pass-pool-half-judge-cache-only.md` (new, gitignored).
- **Tests of report copy were removed** after review (a block that asserted rendered lines of the replay's section, and a test that restated the estimate's sum): the logic behind them is covered by the scorer's and the runner's tests.
- **`.context/model-eval.md` has outgrown one file** (about 470 very long lines). This change corrected the replay's bullet and added three sub-bullets rather than restructure it.

## Decisions to Review

- **ADR-0081 · The whole-step replay replays the linking step's story set, background included, and skips no review** (`.context/decisions/0081-replay-replays-linking-story-set.md`). The replay loads the linking step's stories through the same functions, runs the full upkeep on background overviews with no review skipped, and scores nothing of theirs. From this direct task (no plan). Review optional. The story set itself was relayed as the owner's decision; the entry names him once he says so.

## Records to Refresh

None. No AI feature, model, prompt, stored personal data or outbound host changed.

## Skipped Items

- **A `scored` flag on each recorded re-center** (two reviewers): the report re-derives which re-center is unscored from the keys, as the scorer does. Two lines of duplicated rule; left.
- **A test for the dry run's lines** (`replayEstimateLines`): static wording with one branch. Under `--limit` it prints the asked counts split and only the replayed total.

## User Input Needed

- **Should a background story a judged overview's re-center takes in count against the "near misses joined by a re-center" bar?** Today that bar counts only the half's own near misses among the stories taken in, and a background story is never one of them (the background leaves out every story the half already names). So a re-center of a key that has a reviewed center and swallows background stories reads as a right re-center with no near miss; the joins bar still counts those stories as wrong joins. For a key with no center the false-re-center bar catches it. Counting every taken-in story the joins bar reads as wrong would close this, and changes what the bar measures, so it was left as it is.

## Implementation Issues

- The handbook's ADR collector reports 42 invalid records in this repository's log, none of them ADR-0081 (which validates). Not looked into.

## Borderline Insights

- **A review reads every active entry of its overview, with no limit.** The replay with the background is the first eval to run reviews on overviews of about 115 and 235 entries; by the 2026-11-24 prices that is about $0.10 and $0.20 a review, and an answer of an item per entry. Production's backfill would meet the same sizes for the Iran war. Worth watching in the paid run's safeguards ("upkeep items failed") before deciding whether reviews need a limit.
- **Run without `pass-pool`, the replay reads the database's pools**, the background stories' too where the database holds any; then background overviews would write stands. The documented command always runs `pass-pool` first.

## Suggested Follow-Up Work

- **`diagnoseRun`** (`linkDiagnostics.ts`, about 195 lines, nine outputs; pre-existing, this change added one cause): the missed-entry cascade as its own function.
- **The runner's dry-run block** (`scripts/eval/overviews.ts`, `main()`): its own function, or a per-step table; this change added an eighth branch, a thin one.
- **The story set as its own module**: `replaySlugs`, `backgroundOf`, `linkReplayStories` and `loadReplayed` now have two consumers and still live in `link.ts`.
- **The replay's tests in a file of their own** (`replay.test.ts`): they are now about half of `upkeepRuns.test.ts`.
- **The day helpers in a leaf module**: `replayEstimate.ts`, documented as pure, imports `addDays` and `lastReplayDay` from the step module `replay.ts`, and `updateFixtures.ts` keeps an identical private `plusDays`.
- **The re-center lines of the replay's report** (`upkeepReport.ts`, `replayRecenterLines`) name the overview by its title after the re-center beside the development it stood for before, without saying so, and by hand rather than through `overviewTitled`.
- **Role disagreements and held stories in the replay's report**: the diagnostics compute both and the replay's report shows neither, though the linking report sends its reader to the whole-step replay for held stories.

## Showing the run

- Server unit tests: 5,024 passing before the review fixes, 5,021 at the last full run after them (report-copy tests removed, logic tests added), and one more test since, run with the eval folder's 812; typecheck, lint and format check clean.
- The paid command's dry run before: no line for `replay`. After: "201 stories of the half's 5 keys and 272 background stories of hormuz-shipping-2026, iran-war-2026; 473 replayed", about 44 + 26 reviews, desk estimate about $3.72.

## Mod code and load settings written

None.

## Landing Queue

- `OdinMB/actually-relevant`, branch `claude/project-thread-egeer5`, base `main`: one commit added by this task on the calling session's branch; landing is that session's. Status: done.

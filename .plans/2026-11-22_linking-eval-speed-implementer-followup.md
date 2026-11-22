# Follow-up: faster linking eval runs, saved replay and `--rescore` (implementer, 2026-11-22)

Plan: `.plans/completed/2026-11-22_linking-eval-speed.md`. Branch `claude/eval-speed`, worktree `.claude/worktrees/eval-speed`, commit `a7d85896`.

## Controversial Decisions

- **A call the budget refuses stops every linking run.** Not in the plan. With the new in-flight holds, a call can be refused ("budget exhausted") while the recorded spend stays just below `--budget`, so the old stop rule (spend reaches the budget) might never fire and the rest of the stories would be linked as failed, at no cost and with no "Stopped" line. `withinBudget` in `link.ts` now also stops once any call came back refused for the budget. A test holds it, and goes red without it.
- **"Calls not made" counts the replay's calls only.** Before, an end-event judge call skipped for the budget counted there too. It now shows on its own end event as "not judged: budget exhausted" (it said "the judge gave no answer"). That makes the line's "a story whose call got no answer is linked as failed" accurate, and keeps a rescore's count equal to the paid run's.
- **A rescore's judge miss says why in the rescore's own words.** `rescoreLinkStep` rewrites a skipped judge record's reason to "not in the cache: the key's end event, the founded one or the judge's prompt changed since the run", rather than the context's "not in the cache (--cache-only)", which the person running `--rescore` never typed.
- **A refused rescore (missing file, other version, unreviewed center) writes a report**, with the reason as its "Stopped" line and under Skipped, the same shape as the existing unreviewed-center refusal, rather than exiting without one.
- **`scoreSavedReplay` and `rescoreLinkStep` stay in `link.ts`**, as the plan's Changes table says. `link.ts` is now about 480 lines in two halves: the replay (`replayRun`, `runLinkStep`) and the scoring (`judgeEndEvents`, `scoreSavedReplay`, `rescoreLinkStep`). A split is under Suggested Follow-Up Work.
- **The saved file keeps the slugs asked as one list** (`asked`, half then background, in the order asked) rather than two. The drift check compares the whole set, and the report's background count is recomputed from today's keys.
- **The default-concurrency test checks a relation** (higher than `eval:models`' default) rather than the literal 8, per the test-only-logic rule.

## Decisions to Review

- **ADR-0074 · Linking eval runs save their replay, and their bars are scored again from it** (`.context/decisions/0074-linking-eval-saved-replay.md`), from plan `2026-11-22_linking-eval-speed`. Every linking run saves its replay, `--rescore` scores it under today's keys for free, and so paid runs replay at production's look-ahead of 3 with their repeats side by side, with the budget guard counting calls in flight. Review optional: a guidance repository with no profile, and the eval harness uses no shared infrastructure.

## Implementation Issues

- The worktree's `npm ci` did not generate the Prisma client, so the typecheck failed until `npm run db:generate --prefix server` ran with a dummy `DATABASE_URL`. Any later fresh worktree needs the same step.
- Not run: `test:coverage`, `test:db` (both need `TEST_DATABASE_URL`), `check:migrations` (no migration touched) and the builds. The caller asked for typecheck, lint, the unit tests and prettier, and all four are green.
- No eval was run, dry or paid. The 15 to 25 minutes is the plan's estimate, not a measurement.

## User Input Needed

- **Landing conflicts likely.** The main folder (branch `claude/project-thread-egeer5`) holds uncommitted edits to `.context/model-eval.md`, `.context/overviews.md` and many server files. This branch edits both of those docs, so expect conflicts when it is merged there.
- **Rebuilding the running paid run's replay** (`--concurrency 1 --cache-only`, then `--rescore`) reproduces it only if the code and prompts that shape the link calls at rebuild time are the ones the paid run used. The main folder's uncommitted server changes could make them differ.

## Suggested Follow-Up Work

- **The other steps' budget stop.** `context`, `update`, `pass-pool`, `stands`, `review` and `replay` stop when recorded spend reaches the budget. Under the in-flight holds, a step close to its budget can work through its remaining items with refused calls instead of stopping. `replay.ts`'s `keepGoing` would gain most from the same refusal stop `link.ts` now has. Cost: a small change per step.
- **Split `link.ts` along replay and scoring.** The seam: `link.ts` keeps the replay (`replayRun`, `runLinkStep`, `evalCall(s)`, `linkReplayStories`, `backgroundOf`, `sandboxSignals`); a new `linkStepScore.ts` takes `LinkStepReport`, `scoreSavedReplay`, `judgeEndEvents`, `rescoreLinkStep` and `refusedReport`, importing `linkReplayStories` and `END_EVENT_SCHEMA` from `link.ts`. Then `link.ts` would import `scoreSavedReplay` from it, an import cycle unless `END_EVENT_SCHEMA` and `linkReplayStories` move first. Gain: each half changes for one reason only.
- **`--limit` runs mislabel cut stories.** A must entry beyond `--limit` shows "not replayed: not published in this database", which is wrong (this predates this change). The new `absent` map could carry "after the --limit" for those slugs.

## Landing Queue

- repo `OdinMB/actually-relevant`, branch `claude/eval-speed`, base `claude/project-thread-egeer5` (the worktree was made from its HEAD `ae98f977`), folder `.claude/worktrees/eval-speed`: merge into that branch locally, no pull request (no handbook landing rule is switched on). Remote protection: check at landing. Status: done.

## Showing the run

None: the change has no screen, and the only numbers are the test counts (unit suite 4,686 tests passing).

## Mod code and load settings written

None.

---
plan-id: 2026-11-22_linking-eval-speed
title: Faster overview linking eval runs, scored again for free from a saved replay
status: implemented
created: 2026-11-22
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [cost]
decisions:
  - ref: .context/decisions/0074-linking-eval-saved-replay.md
type: feature
complexity: complex
---

# Faster overview linking eval runs, scored again for free from a saved replay

Archived on 2026-11-22.

## Problem

The judged linking line (`--steps link,found,role --half judge --repeat 3 --concurrency 1`) replays 487 stories three times and takes 1.5 to 2 hours. Two things make it slow. `runLinkStep` (`server/src/scripts/eval/overviews/link.ts`) runs the repeats one after another, though each has its own sandbox and shares nothing. And paid runs are pinned to one call at a time, because a `--cache-only` rerun is the only way to score a paid run again, and it reproduces the run only when each story's call started after the story before it was written (`.context/model-eval.md`, "A free rerun from the cache": one rerun left 316 calls unanswered).

## Approach

Make re-scoring independent of how the replay was run. Then the replay can go as fast as production's linking does.

1. **Every linking run saves its replay** (ADR-0074). After the runs, `runLinkStep` builds a `SavedLinkReplay` (new `savedLinkReplay.ts`). It holds everything the scorer, the diagnostics and the report read, and none of it depends on the keys:
   - the slugs asked of the database (the half's and the background's, `linkReplayStories`), those not published, and the slugs replayed in date order after `--limit`;
   - for each run: its founded overviews as `FoundedOverview`s (the charter, so the end event, included), its roles, its `StoryTrace`s, its `StorySignal`s, and whether the budget stopped it;
   - the calls not made, the calls that failed, and the replay's cost.

   Maps are stored as arrays, so the type is plain JSON with no conversion layer. `overviews.ts` writes it to `--out/linking-replay[-half-<h>][-repeat-<n>][-limit-<n>].json`. The name uses the report's tags for the half, the repeat and the limit only, because one replay serves all three steps. The file is overwritten together with its report.

   One exception: **a `--cache-only` run that left a call unanswered saves nothing.** It drifted from the run it reruns, and saving it would replace a real outcome with a drifted one. A cache-only run with no call unanswered is made entirely of recorded answers, so it is saved like any other run.
2. **Scoring is one function of a saved replay.** `scoreSavedReplay(saved, { ctx, files, half })` in `link.ts` takes over today's second half of `runLinkStep`: the end-event judge, `scoreLinking`, `scoreSignals`, `diagnoseRun` and the report's fields. The paid path and the rescore path both call it, so a rescore under unchanged keys gives the paid run's report. A test holds that.
3. **`--rescore`** (`options.ts`, `overviews.ts`): reads the saved replay for the same half, repeat and limit from `--out`, then scores it under today's keys and scorer.
   - It makes no model call and opens no database session. The eval context is created `cacheOnly`, so a call not in the cache is answered `skipped` and never made.
   - It writes `…-rescore.md` (a new `rescore` tag in `overviewReportName`), so it never overwrites the paid report. A later rescore overwrites the earlier one, which is harmless: a rescore is a pure function of the saved file, the keys and the code.
   - It is refused with `--dry-run`, with `--cache-only`, and with any step outside `link`, `found` and `role`.
   - It also refuses a missing file and a file of another `SAVED_LINK_REPLAY_VERSION`, each with a line saying why and what to run instead. This follows the `version` pattern of `contextInputs.ts`, and the version goes up whenever a field the scorer reads changes.
   - A half whose key holds an unreviewed center is refused as it is today.
4. **When the keys change which stories would be replayed** (a new entry, a new near miss, a key whose background adds stories), the rescore goes on and says so. It compares the slugs today's keys would ask for with the saved ones.
   - A slug the run never replayed is listed under "Left out", with the reason "not in the saved replay: the keys name it since the run". A must entry among them is a missed entry with cause `not replayed` and that reason: `diagnoseRun` gets an optional `absent` map of reasons, whose default stays "not published in this database".
   - A slug the keys no longer name is scored as it fell: a judged overview that took it in counts it as a wrong join, "in no key".
   - The report's replay line marks the rescore "against keys that replay another set of stories: not evidence for the gate", as `--limit` runs are marked now, and names the counts.
   - Rejected alternative: refusing the rescore. It would forbid the by-hand rescores the runbook already relies on (step 2, "The cached rerun is not the measurement"), and a label fix inside the same set of stories (a role, must or optional, a label key) changes nothing in the set and stays exact.
5. **The end-event judge is rescored from the call cache, not from the saved file.** Its prompt is rebuilt from the key's title and end event and from the founded end event, and asked through the `cacheOnly` context under the run's own schema name.
   - A hit returns the paid run's verdict.
   - A miss (the key's end event, the founded overview standing for the development, or the judge prompt changed) gives `unjudged` with the reason "not judged: not in the cache …". The "wrong end events" bar then has no verdict, as it does today for an unanswered judge.
   - The judge's verdicts are therefore not stored in the saved replay. The cache key already decides exactly when a verdict still applies.
   - On a paid run the judge calls now run together (`Promise.all` over run × key, kept in today's order) rather than one at a time.
6. **The repeats run concurrently.**
   - `runLinkStep` maps `runNumbers(repeat)` to `replayRun(run)` with `Promise.all`. `replayRun` is today's loop body, taken out as a private function, with its own sandbox, neighbour counts and stop flag. The results are in run order whatever finishes first, so the reports keep their order and structure.
   - All runs share the one eval context: its semaphore caps calls in flight across them (`--concurrency`), and its ledger records them.
   - The report's `stopped` line names every run the budget stopped ("in runs 2, 3").
   - The replay's cost is now the sum of the recorded cost of every call it asked, cached ones included, rather than the change in folder spend. A rerun from the cache then still reports what the replay costs. The report's line says "the replay's calls as made", and the footer's this-run and folder figures still give the actual spend.
   - The step also counts calls that came back `error` (a rate limit after the client's 3 retries, among others) and prints the count only when it is not zero. With more calls in flight this is the first sign of a rate limit.
7. **Look-ahead within a run is production's.** `linkInOrder` gets `Math.min(o.concurrency, config.overviews.concurrency)`, which is 3 in production's job (`server/src/jobs/linkOverviews.ts`).
   - `--concurrency` caps throughput and no longer changes what a replay is, beyond a cap below 3, which `--concurrency 1` keeps: each story's call starts after the story before it is written, so a run made that way is reproduced call for call. That is how the paid run going on now, made at `--concurrency 1`, gets its saved replay after this change: rerun it with `--concurrency 1 --cache-only` (nothing unanswered, so it saves), then `--rescore`.
   - Rejected alternative: keeping look-ahead 1 and running only the repeats concurrently. That is about 35 to 40 minutes, with exact cache reruns and resumes. Look-ahead 3 is faster, and it replays production's own stale path (a result asked again when a story before it changed what it was shown), which look-ahead 1 never reaches.
   - What look-ahead 3 costs: a run stopped by the budget and run again replays from the start, and the calls whose prompts drifted are paid again, at most a run's cost (about $0.25 to $0.35).
   - `replay.ts` passes the same minimum to `runNight`. Without it, raising the default would change its replay too (from 4 to 8 calls ahead). It has had no paid run, so going from 4 to 3 changes no recorded result.
8. **Budget holds under concurrency** (`createEvalContext`, `models.ts`). Today the guard checks recorded spend only, so every call in flight passes it, and the overshoot grows with `--concurrency`.
   - Each live call now takes a hold when it gets its semaphore slot: `estimateCallUsd` of its prompt at `HOLD_OUTPUT_TOKENS` (4,000) output tokens at its arm's factors. For example, about $0.002 for gpt-6-luna@low and about $0.07 for gpt-6.1-sol@high.
   - The call starts only while recorded spend, external spend, the holds of the calls in flight and its own hold stay within `--budget`. Otherwise it is answered `skipped`, "budget exhausted", as now.
   - The check and the hold happen in the same synchronous step before the call's first `await`, so two calls cannot both pass it on one remaining slice. The hold is released when the real cost is recorded, or the call fails.
   - The remaining overshoot is bounded by how far a call's real cost exceeds its hold.
   - This applies to every eval sharing the context, which is stricter but never looser. `research/storyQueue.ts`'s per-story reservations stay as they are, and the holds sit inside them.
9. **The default `--concurrency` for `eval:overviews` goes from 4 to 8** (`OVERVIEW_DEFAULT_CONCURRENCY`). Three runs at look-ahead 3 ask for 9 calls at once, so 8 runs them almost fully in parallel.
   - The limits: link calls are gpt-6-luna@low with prompts of a few thousand tokens and answers in about 4 to 5 seconds (the 1.5 to 2 hours over about 1,460 story replays). So 8 in flight is about 100 to 120 requests a minute and a few hundred thousand tokens a minute, well inside OpenAI's small-model limits from usage tier 2 up.
   - On tier 1 it could touch the tokens-per-minute limit. The client's retries absorb short bursts, and the new "calls that failed" line shows when they don't; then run again at `--concurrency 4`.
   - The other steps that take the flag (`context`, `update`, `pass-pool`, `fact-check`) run independent stories or items, budget-guarded, so 8 changes their speed and not their results.
   - `eval:models`, `eval:recalibrate` and `eval:research` keep 4.
10. **`--cache-only` stays for linking, documented as superseded for rescoring.** It is shared by every step, so refusing it for linking would complicate a multi-step invocation for no gain. Two uses remain:
    - rebuilding a saved replay for a run made at `--concurrency 1` (above);
    - a code change that needs data the saved replay does not hold, where its unanswered count says how far it drifted.

    Folding it into `--rescore` would give one flag two meanings.

**Expected wall-clock** for the judged line at the default: **about 15 to 25 minutes**, down from 1.5 to 2 hours. The three runs go side by side, and each keeps about 3 calls in flight. What remains serial within a run:
- the large-tier founding calls, which hold the next writes;
- each run's stale stories, which are asked again one at a time at its end.

Cost is about the same: a few percent more calls for the stale stories asked again.

**Left alone:**
- `replay.ts`'s repeats stay serial, beyond the look-ahead line. The runbook runs it once, and its per-run `costUsd` is a change in shared spend, which concurrent runs would mix.
- `stands.ts` (one run in the runbook) and `review.ts` (5 calls a run) stay serial too, and `stands.ts` measures cost the same way.
- `recenter.ts` takes its runs per case from `RECENTER_RUNS`.
- `context.ts`, `update.ts` and `factCheck.ts` already run each run's items concurrently.

No production code changes. `config.overviews.concurrency` is read, not changed.

## Changes

| File | Change |
|------|--------|
| `server/src/scripts/eval/overviews/savedLinkReplay.ts` | New. The saved replay's type, version, file name, read and write, and its comparison of the slugs it asked for with the slugs today's keys ask for |
| `server/src/scripts/eval/overviews/link.ts` | `runLinkStep` returns `{ report, replay }`; its loop body becomes private `replayRun`, the runs go through `Promise.all`; new exported `scoreSavedReplay` (today's scoring half, with the end-event judge run concurrently from the call records' outcomes) and `rescoreLinkStep` (read, compare, score, mark); look-ahead `Math.min(o.concurrency, config.overviews.concurrency)`; the call wrapper also sums the calls' `costUsd` and counts `error`s; `LinkStepReport` gains `errored` and optional `rescored: { file, savedAt, added, removed }` |
| `server/src/scripts/eval/overviews/linkDiagnostics.ts` | `DiagnoseInput` gains optional `absent: ReadonlyMap<string, string>`, the detail of a `not replayed` entry (default "not published in this database") |
| `server/src/scripts/eval/overviews/linkReport.ts` | `linkLines`: the rescore line (from which file, when it was saved, the other set's counts and "not evidence for the gate" when they differ), the "calls that failed" line when there are any, the cost line's wording |
| `server/src/scripts/eval/overviews/report.ts` | `overviewReportName` takes optional `rescore`, tagged `rescore` after `cache-only` |
| `server/src/scripts/eval/overviews/replay.ts` | `runNight`'s `concurrency`: the same minimum as linking |
| `server/src/scripts/eval/models.ts` | `createEvalContext`: in-flight holds in `invoke` (`HOLD_OUTPUT_TOKENS`), released in `record` and on error |
| `server/src/scripts/eval/options.ts` | `--rescore` and its refusals; `OVERVIEW_DEFAULT_CONCURRENCY = 8` for `parseOverviewOptions` |
| `server/src/scripts/eval/overviews.ts` | Linking branch: with `rescore`, `rescoreLinkStep` instead of the replay, with no key check and no session; otherwise write the saved replay after the run unless `cacheOnly` left a call unanswered; the context `cacheOnly` when rescoring; header comment's commands |
| `.context/model-eval.md` | The guard in "Budget" (line 57); the overviews flag table (`--rescore`, `--cache-only` for linking, `--concurrency` default 8); the linking section's commands without `--concurrency 1`; "A free rerun from the cache" rewritten as "Saved replays and free rescoring" (what is saved, the name, the no-save rule, the key-change and end-event rules, `--cache-only` superseded, rebuilding a `--concurrency 1` run's replay, resumes paying for drifted calls); the look-ahead in the replay and `replay` bullets; the gate block's step 1 lines and comment |
| `.plans/2026-11-19_overviews-eval-runbook.md` | Header's 2026-11-22 note, the table's step 2 row, step 2's lines without `--concurrency 1`, "roughly 1.5 to 2 hours" replaced by "about 15 to 25 minutes", "Reading why, for free" rewritten for `--rescore` (`…-rescore.md`), and the recipe for the run made at `--concurrency 1` |
| `.context/decisions/0074-linking-eval-saved-replay.md`, `.context/decisions.md` | At implementation, ADR-0074 promoted through the `adr` skill |

*`savedLinkReplay.ts`:* *Responsibility:* the one home of the saved linking replay's format: what it holds, its version, where it lives, and whether today's keys would replay the same stories. *Exports:* `SavedLinkReplay`, `SAVED_LINK_REPLAY_VERSION`, `savedReplayName`, `readSavedReplay` (the replay, or a refusal with its reason), `writeSavedReplay`, `replayDrift`.

## Tests

Following `link.test.ts`'s fake context and `models.test.ts`'s temp ledgers:

- **`link.test.ts`**
  - Concurrent repeats keep run order: a fake context whose run 2 calls answer before run 1's gives `score.runs`, `diagnostics`, `signals` and `endEvents` in run order. No run has more than `config.overviews.concurrency` link calls in flight at `concurrency: 8`.
  - Rescore equals the paid run: a paid `runLinkStep` with a recording fake context, then `rescoreLinkStep` on its replay (written and read back through a temp folder) with a context that answers only the recorded prompts, gives the same report apart from `rescored`.
  - Keys that add a must entry: the rescore lists it in `rescored.added` and under "Left out", and its missed cause is `not replayed` with the saved-replay reason.
  - A key whose end event changed: the rescore's verdict is `unjudged`, "not judged…", and the wrong-end-events bar has no value.
- **`savedLinkReplay.test.ts`**: a missing file and another version are refused with their reasons; `replayDrift` gives the added and removed slugs.
- **`linkDiagnostics.test.ts`**: `absent` sets a not-replayed entry's detail, and the default is unchanged.
- **`models.test.ts`** (`createChatModel` mocked with `vi.hoisted`): two concurrent uncached calls under a budget that covers one hold, where one is made and one is `skipped` "budget exhausted"; once the first is recorded its hold is released and a third call within the budget is made.
- **`options.test.ts`**: `--rescore` is refused with `--dry-run`, with `--cache-only` and with a step outside linking; the overviews default concurrency is 8.
- **`report.test.ts`**: the `rescore` tag's name.

## Out of Scope

- Running `replay`, `stands` and `review` repeats concurrently (above: no gain in the runbook, and per-run cost by spend changes).
- A saved outcome for the upkeep steps, or a rescore of them.
- Changing production's `config.overviews.concurrency` or any of `server/src/services` or `server/src/jobs`.
- A sandbox parity test at look-ahead above 1. The sandbox applies production's own stale rule (`isStale`), which `overviewLink.test.ts` covers; the db parity test stays at one call at a time.
- Making the reports show call errors for steps other than linking.

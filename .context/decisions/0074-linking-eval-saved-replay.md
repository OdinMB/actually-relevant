---
id: ADR-0074
title: "Linking eval runs save their replay, and their bars are scored again from it"
status: accepted
date: 2026-11-22
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [cost]
tags: ["overviews", "evals", "linking"]
---

# ADR-0074 · Linking eval runs save their replay, and their bars are scored again from it

## Context

The overview linking eval (`eval:overviews --steps link,found,role`, ADR-0066, ADR-0073) replayed
the judged half's stories and their background, about 490 a run, three runs, through production's
linking against an in-memory sandbox. The runs went one after another, though each had its own
sandbox and they shared nothing. A paid run could be scored again only by rerunning it from the call
cache with `--cache-only`, and that reproduced the run only when each story's call had started after
the story before it was written: a story's candidates are read when its call starts, so at a
look-ahead above one a cached rerun, whose answers come at once, asks prompts the paid run never
did. One such rerun left 316 of 627 story replays' calls unanswered. So, at the owner's request
earlier on 2026-11-22, paid linking runs went one call at a time, and the judged line took 1.5 to 2
hours. Later the same day the owner asked for these runs to take less long, and suggested running
them in parallel.

The eval's budget guard (`createEvalContext`) checked only the spend already recorded, so every
call in flight passed it, and the overshoot past `--budget` grew with the number of calls running
at once.

## Decision

Every linking run writes its replay beside its report as versioned JSON
(`linking-replay[-half-<h>][-repeat-<n>][-limit-<n>].json`, `savedLinkReplay.ts`): what it asked of
the database and replayed, and for each run its founded overviews with their charters, its roles,
its stories' traces and signals and whether the budget stopped it, all independent of the answer
keys. `--rescore` scores that file under today's keys and scorer with no model call and no
database, through `scoreSavedReplay`, the one scorer the paid run uses too; where today's keys
would replay other stories it still scores, lists them and marks itself no evidence for the gate,
and it asks the end-event judge from the cache only, whose key already says when a verdict still
applies. A cache-only rerun that leaves a call unanswered saves nothing. Since scoring no longer
depends on how the replay ran, a paid run replays at production's look-ahead
(`min(--concurrency, config.overviews.concurrency)`) with its repeats side by side, sharing the
context's cap on calls in flight and its ledger; `eval:overviews` defaults to 8 calls in flight,
and the budget guard counts a hold for each live call in flight. This does not cover the upkeep
steps, whose repeats stay serial and keep no saved replay, or production's linking, which is
unchanged.

## Consequences

- The judged line is expected to take about 15 to 25 minutes rather than 1.5 to 2 hours, at about
  the same cost (a few percent more calls, for the stale stories asked again). A replay now runs
  production's own stale path, which one call at a time never reached.
- A fix to the scorer, the diagnostics, the report or a key's labels among the replayed stories is
  scored again exactly and for free; a test holds that a rescore under unchanged keys gives the
  paid report.
- Worse: a `--cache-only` rerun of a run made at look-ahead 3 no longer reproduces it, so a run the
  budget stopped and run again replays from the start and pays again for the calls whose prompts
  drifted, at most a run's cost (about $0.25 to $0.35). A rescore against keys that change the
  replayed stories is not evidence for the gate; a paid run is. Rescored end-event verdicts depend
  on the call cache: without `.cache/calls.jsonl`, or after the key's end event or the judge's
  prompt changed, they are "not judged" and that bar has no verdict. The saved file's format is one
  more contract: its version goes up whenever a field the scorer reads changes, and an older file is
  refused rather than misread, so a change of that kind needs a paid run, or a cache-only rerun of
  one made at `--concurrency 1`.
- Worse: eight calls in flight may reach OpenAI's tokens-per-minute limit on usage tier 1; the
  report counts the calls that came back `error`, and the remedy is a lower `--concurrency`.
- Every eval sharing the context now starts a call only while its hold fits the budget too, so a
  run near its budget stops a little earlier than before, never later.
- Revisit when a rescore keeps needing data the saved replay lacks, when rate-limit errors show at
  the default concurrency, or when the upkeep steps' runs come to cost enough time to need the same.

## Alternatives considered

- **One call at a time inside each run, only the repeats side by side** — exact cache reruns and
  resumes, about 35 to 40 minutes, but slower, and it never replays production's stale path.
- **A separate scorer for rescores** — two scorers drift apart, and a rescore would no longer equal
  the paid report it scores again.
- **Refuse a rescore when the keys change the replayed stories** — it would forbid the by-hand
  rescores the runbook relies on, while a label fix inside the same stories stays exact anyway.
- **Store the end-event verdicts in the saved replay** — the call cache's key already decides when a
  verdict still applies; a stored verdict would outlive a changed key or prompt.
- **Refuse `--cache-only` for linking, or fold it into `--rescore`** — the flag is shared by every
  step, so refusing it would complicate a run of several steps for no gain, and folding it in would
  give one flag two meanings.
- **Do nothing** — 1.5 to 2 hours a judged line, and every rescore by hand.

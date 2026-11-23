---
id: ADR-0076
title: "The linking evals replay deduplicated inputs from a committed list of duplicate groups"
status: accepted
date: 2026-11-23
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["overviews", "evals", "linking"]
---

# ADR-0076 · The linking evals replay deduplicated inputs from a committed list of duplicate groups

**An AI decision on the owner's goal.** Odin decided on 2026-11-23 that the eval cases should be
"where we'd want inputs to be in production, i.e. deduplicated etc."; how it is built is the
implementing session's (claude-code), from the plan `.plans/2026-11-23_overviews-founding-quality.md`.

## Context

The overview linking eval (`eval:overviews --steps link,found,role`, ADR-0073, ADR-0074) replays the
stories the answer keys name. Some of them are two reports of one event or one study, which
production's duplicate detection would have merged into one story before linking (`.context/dedup.md`).
The replay fed both, so they founded overviews production would not: the two reports of one Science
coral study founded an El Niño look-alike overview in all three paid judged runs, and two reports of
the 15 June US-Iran deal founded Hormuz a second time.

## Decision

A committed file, `server/src/scripts/eval/overviews/duplicates.json`, beside the answer keys (not in
`keys/`, whose every file is read as a key), lists the duplicate groups: a `keep` (the earliest
published, the earliest crawled breaking a tie, as production elects a primary), its `drop`s, a line
of why and a confidence; only groups rated medium or better. `duplicates.ts` validates it against the
keys (every slug named by a key, a keep never a drop, no slug in two groups, within production's
14-day window, never a keep and its drop on opposite sides of one key), from `keys.test.ts` with no
database and from the `keys` step, which adds that every slug is published. `keysOfHalf` merges the
groups into every key before any step reads them (`mergeDuplicates`): a drop is removed; where a key
holds the keep, the keep stands with the strongest join its group had there; where it holds only a
drop, the keep takes the drop's place with its label. So a dropped story is never asked of the
database, replayed or anyone's neighbour. A replay saved before a group existed is read as its keeps
(`runAsKeeps`) when rescored. The report lists the groups merged.

## Consequences

- The replay sees the stories production would have had; foundings from two reports of one event
  disappear from paid runs made from now on.
- A rescore of a replay saved before the groups maps each drop to its keep, but the run it scores
  still replayed both stories; its rescore line says it is no evidence for the gate. Only a paid run
  measures what deduplication changes.
- The groups are the eval's statement of what production should have merged, written by hand from an
  audit of the keys' close pairs; a wrong merge shows in the report's list and is fixed in the file.
  Production's duplicate detection itself is unchanged.
- Revisit when a key is added (its close pairs need the same audit) or when production's duplicate
  detection changes what it merges.

## Alternatives considered

- **A `duplicateOf` field on each dropped entry and near miss inside the keys** — one group of the
  US-Iran deal would become several annotations across keys that must agree, and the report wants the
  group in one place.
- **Leave the inputs as they are** — the bars would keep counting foundings production cannot make.
- **Merge only the judged half** — the background and the tune half would still found from
  duplicates, and the judged half's background would differ from what production holds.

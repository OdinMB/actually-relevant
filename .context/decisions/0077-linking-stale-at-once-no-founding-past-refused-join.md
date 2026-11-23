---
id: ADR-0077
title: "Linking asks a stale answer again at once and no longer founds past a trivially refused join"
status: accepted
date: 2026-11-23
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["overviews", "linking"]
---

# ADR-0077 · Linking asks a stale answer again at once and no longer founds past a trivially refused join

**An AI decision.** The implementing session (claude-code) took it from the plan
`.plans/2026-11-23_overviews-founding-quality.md`, toward the owner's bar of 2026-11-23 that at most 1
founding in 10 is wrong, a founding of a development that already has an open overview counting as wrong.

## Context

The paid judged linking run of 2026-11-22, rescored under that bar, founded Ebola again six times and
El Niño once, while the first overview of each was open and was offered to the story (at distance 0.14
to 0.36). Every repeat needed two failures together: the later story's join failed, and a story of the
same development was still unlinked to found with. The join failed in two ways. A result made stale by
a partner that joined meanwhile was asked again only after the whole run (in production, after a
nightly slice of up to 300 backfilled stories), so the development's later stories founded it a second
time first. Or the model's confident yes was refused for a trivial reason: an optional end quote not
found, or a cause or place quote with a misspelled long name ("Bundibyo" for "Bundibugyo"), and the
story went on to found with an unlinked partner.

## Decision

Four changes in `services/overviewLink.ts` and `lib/quoteMatch.ts`, no prompt change. `linkInOrder`
asks a stale result again at once, with fresh candidates, before the next story is written; stale
again, it is a conflict, as before. `acceptLink` drops an end whose quote is not found (cleared from
the stored judgment, its end-event flag not counted) rather than refusing the yes. Cause, place, end
and signal quotes are found by `quoteNearlyFound`: the exact match, or the quote's words matching a run
of the text's words where a word holding a digit or under 5 letters matches exactly and a longer word
may differ by one edit per 5 letters of the longer word; the answer keys and research keep the exact
match. And when the model said yes to an overview and code refused that yes, no founding partner is
considered: the story settles `rejected`.

## Consequences

- Repeats of a development whose overview is open should fall; the eval's diagnostics name a founding
  blocked by a refused yes and every join that passed only by the near match, so what each change costs
  the filing bars shows on the next paid run.
- Production's backfill no longer lets a stale story wait for the rest of a night's slice.
- Worse: a story that wrongly said yes to a neighbouring overview and was refused can no longer found
  its own development; a near match could let a wrong join through where a misspelling hides a
  different word of the same length class. Both are measured on the next paid run and dropped if either
  costs more than 2 points of its bar.
- The serial path waits for one link call per stale story; the number of calls is unchanged.

## Alternatives considered

- **Treat a partner with a pending result as stale too** — fixes repeats only in the background (the
  Iran war), held for after the measurement.
- **Block founding on a `wider` answer, or show the founding check the open overviews** — the second is
  a prompt change; both held for after the measurement.
- **A confidence threshold on the blocking yes, or a retry of refused stories** — `unsure` is already no,
  and a retry needs a new owed state.
- **One wrong letter per word** — would not have caught the diagnosed misspelling, which lacks two.

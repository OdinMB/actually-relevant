---
id: ADR-0078
title: "A story that points past an established open overview waits for its re-center and founds nothing while it waits"
status: accepted
date: 2026-11-24
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["overviews", "linking"]
---

# ADR-0078 · A story that points past an established open overview waits for its re-center and founds nothing while it waits

**The owner's rule, built by an AI.** The plan `.plans/2026-11-23_overviews-widen-not-refound.md`
records the rule as Odin's, chosen on 2026-11-23: "A story that points past an open overview makes that
overview widen (re-centering, already built) instead of starting a new one. No prompt change." The plan
records the same day's narrowing as his too: hold only behind an overview with at least 3 active
entries. How it is built is the implementing session's (claude-code). Accepted with the commit on
2026-11-24, after the paid judged run of 2026-11-23 (`DOCS/2026-11-23_widen-eval`, paired with the
baseline's cache): joins right 97.4% (97.5%), found 91.1% (93.3%), wrong foundings 0 of 18 (6 of 24),
roles 71.5%, meeting the commit rule the owner set (joins right ≥ 97%, found ≥ 85%, founding share
below 25%).

## Context

In the paid judged linking run of 2026-11-23 (`DOCS/2026-11-23_founding-eval`), half of the wrong
foundings (3 of 6) were a development founded a second time from a story the link call had judged
`wider` than the open overview of that development: Ebola's overview named "DR Congo and Uganda", so
Kenya and Nigeria stories read as wider, and the founding check, which judges only "same development",
let them found a second overview. Re-centering (ADR-0071) already widens an overview from such
signals. A free simulation on the tune half showed that holding behind any open overview would have
stalled the Iran war's own founding behind a two-story pre-war "standoff" overview founded from near
misses.

## Decision

When no overview passes and the link answer carries a counted re-center signal (`wider` or
`centerMoved`, its quote found) for a shown overview that may hold the story (`holdsForRecenter`, one
rule in production and the eval sandbox: at least `recenterHoldMinEntries` (3) active entries of
published stories on or before the story's date, and automation may still re-center it,
`recenterMayCome`: not closed, under `maxAutomatedRecenters`, no lock in force), that has not held it
before, and the story is within `recenterLookbackDays` (90) of the clock, the story considers no
founding partner and is written as a non-settling `waiting` decision naming the nearest such overview.
Against a younger overview it links as before and may found. It is owed with no call while the wait
is in force (`waitInForce`); where the re-center needs an ongoing scope, the wait lasts until a review
makes the overview ongoing. It is due again once that overview's next attempt ends without taking it
in, once the overview can no longer be re-centered by automation, or past the lookback; asked again,
the same overview cannot hold it and it may found. While it waits it is no founding partner
(`heldForRecenter`), and a founding that showed it as a partner is stale at the write. Its signals
count towards the re-center as a story left alone does, and only once. No prompt or schema change.

## Consequences

- Repeats of a development whose established overview is open fall: none of the three `wider`
  repeats recurred on the judged run.
- A held story is filed only when a re-center takes it in. The link-only replay runs no re-center, so
  there every held must entry counts as a miss; on the tune half about 20 Iran-war stories per run
  waited behind the war's narrow-charter overview, and found fell from 83.1% to 71.6% (78.8% with
  must entries held for their own development's overview left out). Only the whole-step replay
  (runbook step 6) shows whether held stories end up joined.
- Worse: a story can wait behind an overview of another development (two Hormuz stories behind the
  Iran war's on the tune half), and a story waiting on an overview that never re-centers waits up to
  90 days before it is asked again. A story held by an editor's freeze still has no active entry, so
  it stays a founding partner; the plan records that gap.
- Revisit when the whole-step replay shows held stories left unjoined, or when found on a judged run
  falls below its bar because of holds.

## Alternatives considered

- **Hold behind any open overview** — stalls a big new development behind a small precursor overview
  (the tune half's Iran war behind the standoff).
- **Hold only behind an ongoing overview** — offered to the owner with the other two options on
  2026-11-23; he chose the entry count, which the link-only replay can measure.
- **Settle a held story as `none`** — the first version; it lost a story for good whenever its
  overview could no longer take it.
- **Show the founding check the open overviews** — a prompt change, held for after this measurement.

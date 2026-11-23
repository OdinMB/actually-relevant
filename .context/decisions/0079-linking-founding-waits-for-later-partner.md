---
id: ADR-0079
title: "A founding whose partner comes later in the run's order waits for that partner's own result"
status: accepted
date: 2026-11-24
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["overviews", "linking"]
---

# ADR-0079 · A founding whose partner comes later in the run's order waits for that partner's own result

**The owner's rule, built by an AI.** The plan `.plans/2026-11-23_overviews-widen-not-refound.md`
records the rule as Odin's, chosen on 2026-11-23: before a founding is written, a partner whose own
link result is still pending, or is in and passes a join to an open overview, makes the founding
stale, and the founding story is asked again at once; bounded, so it cannot loop. How it is built is
the implementing session's (claude-code). Accepted with the commit on 2026-11-24, together with
ADR-0078, after the paid judged run of 2026-11-23 (`DOCS/2026-11-23_widen-eval`): wrong foundings 0 of
18, down from 6 of 24.

## Context

The other half of the judged run's wrong foundings on 2026-11-23 (Iran 03-04 in runs 1 and 2, El Niño
with a heat study in run 3) were foundings written before a same-day partner whose own pending answer
joined the open overview of that development (0.99 inside for the Iran overview). `linkInOrder` runs
up to `concurrency` (3) calls ahead of its writes and writes in the run's order, so the founding story
took the partner first and the partner's join was never written. ADR-0077's stale check caught only a
partner that had already joined or founded by the write.

## Decision

Before a `founded` result is written, `linkInOrder` (shared by the job and the eval replay) looks up
its founding partner's place in the run's order. Partners are never dated after the story, so a
partner later in the order is a same-day story not yet written. When that partner's own result is
still pending, or is in and takes the partner away (`takesPartnerAway`: it joins an overview, is held
by a frozen one, which is still open, or waits for an overview's re-center under ADR-0078), the
founding is held back; right after the partner is written, the founding story is asked again at once
with fresh candidates and its answer written as its last try, a stale one as a `conflict`, as
ADR-0077's stale path does. Once per story, so nothing loops. A partner result that is in and passes
no join is not waited for. The switch or the budget going off before the partner's write leaves the
story unwritten and owed. No prompt or schema change.

## Consequences

- Same-day foundings no longer take a partner whose own answer joins the development's open overview:
  the three pending-partner repeats did not recur on the judged run.
- One more link call per held-back founding, and its write waits for the partner's.
- Worse: a right founding is lost where the partner's own answer is a wrong join (the decided
  simulation's Hormuz case on the tune half, its partner joining the Iran war's overview), and the
  re-asked story may still found with a partner held by an editor's freeze, which has no active entry
  (recorded in the plan).
- Revisit if a judged run shows right foundings lost to held-back partners.

## Alternatives considered

- **Treat any partner with a pending result as stale after the whole run** — the pre-ADR-0077 timing,
  which let later stories found the development first.
- **Wait for every partner, not only later ones** — earlier partners are already written, so their
  state is read at the write by the stale check.
- **Retry without a bound** — a founding whose new partner is also ahead could loop.

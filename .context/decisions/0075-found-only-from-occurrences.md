---
id: ADR-0075
title: "Found an overview only from two stories that each report something that happened"
status: accepted
date: 2026-11-23
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["overviews", "linking", "prompts"]
---

# ADR-0075 · Found an overview only from two stories that each report something that happened

**The owner's rule, built by an AI.** Odin decided on 2026-11-23: "Warnings and such are not a good
starting point for a development. Actual things happening are, with WHO reactions then serving as an
update." How it is built is the implementing session's (claude-code), from the plan
`.plans/2026-11-23_overviews-founding-quality.md`. Accepted with the commit of the prompt on 2026-11-23,
after the paid judged run (`DOCS/2026-11-23_founding-eval`): joins right 97.5%, found 93.3%, and wrong
foundings 25.0% (6 of 24), down from 44.4% in the rescore of the 2026-11-22 replay but still above the
owner's 10% bar.

## Context

In the paid judged linking run of 2026-11-22, two general WHO warnings founded a development of their
own, and El Niño's overview began at its April forecasts. A related attempt on 2026-11-22 put a rule
into the founding draft and lost 3 to 4 points of filing on the tune half by changing the charters the
draft wrote (`DOCS/2026-11-22_ablation-dedup`).

## Decision

The founding check (`overview-found-check`) answers per story whether it reports an occurrence
(`occurred`, an `<OCCURRED>` block: something that has happened, not a warning, forecast, projection,
reaction, appeal or statement; the first report of an event that sets something going counts), and
`acceptFounding` founds only when both stories fit and both occurred. The founding draft and every
charter instruction stay as they are. A story a check judged to report no occurrence is no longer a
founding partner (`membershipsOf` reads the latest check from the `found` decisions, the sandbox its
own), and a founding refused only because its partner reported none tries the next passing partner,
at most `foundingCandidates` attempts, each refused attempt stored as its own `found` decision.

## Consequences

- Warnings and reactions join an existing development as updates and never found one; El Niño's
  overview starts at its first real impact or declaration, and the keys' pre-occurrence entries are
  optional (2026-11-23).
- A retry costs one more draft and check on the large tier, only after a partner-only refusal.
- Worse: a check that calls a real opening a statement delays or loses a founding; the eval's
  diagnostics list foundings refused for no occurrence, the retries and the stories left out as
  partners. If found falls below its bar because both stories must occur, one occurring story instead
  is the owner's call.

## Alternatives considered

- **The rule in the founding draft** — the route that moved the charters and lost filing on 2026-11-22.
- **One occurring story sufficing** — lets a forecast open the timeline, against the owner's El Niño
  consequence.
- **A new founding outcome** — a stored enum value for a diagnostic; the check's answers already say why.
- **Excluding every story settled `none` from the partners** — most of them are events with no partner yet.

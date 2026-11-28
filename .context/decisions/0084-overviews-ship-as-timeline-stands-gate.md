---
id: ADR-0084
title: "Overviews ship as a timeline of our stories without waiting for research passes; \"Where this stands\" waits behind a stands gate of its own"
status: accepted
date: 2026-11-28
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, testing]
tags: ["overviews", "research-passes", "eval", "gate", "ai-transparency"]
---

# ADR-0084 · Overviews ship as a timeline of our stories without waiting for research passes; "Where this stands" waits behind a stands gate of its own

## Context

Ongoing-story overviews (ADR-0070) switched on only after research passes (D-OV7): their eval gate,
`OVERVIEW_EVAL_GATE`, refused enabling `link_overviews` while research passes' gate was closed, and
enabling was refused again while `research_pass` was disabled. The reason was "Where this stands",
the upkeep's part 4, which is written from the facts research passes check: without passes there is
no evidence for it. Linking, roles, the status machine, the reviews, re-centering and the timeline
read no pass data (the link prompt leaves its FACTS out, and candidates fall back to what each story
has).

Research passes' gate is still closed (`.context/eval-baselines.md`: the `update` bars are not all
met, and `eval:research` has no baseline yet), while every overview bar is met or accepted
(2026-11-25), the re-center bar resting on 15 of 15 judgments, fewer than the 20 a rate needs.

The owner decided on 2026-11-28: ship overviews first as a timeline, without "Where this stands" and
other extras, which are added and improved separately; no required editor approvals for anything;
"adjust the AI claim", since the approved label ("Summary and timeline by AI, from our stories and
their sources.") claims a summary readers would no longer get; and "re-centering seems robust enough
for now", his sign-off on the re-center bar.

## Decision

- **Overviews wait for nothing of research passes'.** `overviewSwitchRefusal` reads
  `OVERVIEW_EVAL_GATE` alone, and enabling `link_overviews` conflicts with no other job's switch (the
  order of switches, `overviewPassConflict`, is gone). The step runs while its gate is open and its
  job is enabled.
- **`OVERVIEW_EVAL_GATE` is open** (null) in the same change: every overview bar is met or accepted,
  the re-center bar by the owner's sign-off. No job row changes: the owner switches overviews on by
  enabling `link_overviews` on the Jobs page.
- **A stands gate, `OVERVIEW_STANDS_GATE`** (`services/overviewStandsGate.ts`), a code constant like
  the others and closed: its reason names the stands' bars (`stands`, `fact-check --facts stands`,
  the `pass-pool` evidence) and that the stands also need research passes' facts. While it is closed
  the upkeep's part 4 does not run in production (`UpkeepDeps.standsOn`: no stands case is read, no
  `stands` decision written, no version written or superseded), and no public read serves stands: no
  line, no source, no `stands` field in the `aiGenerated` marker, and no stands' writing as an
  overview's last change on its page, the `/ongoing` list, the sitemap or the link preview. The evals'
  sandbox writes the stands whatever the gate, since they measure them.
- **The timeline carries each story's published summary**, the AI summary its own page shows, on the
  rows a month shows; the rows its fold opens stay headlines only.
- **The AI label becomes "Timeline by AI, from our stories."** in both copy files, and the
  methodology's "Ongoing Stories" section drops its sentences about the summary; every other approved
  sentence stays, the founding sentence of 2026-11-24 word for word. Two draft strings that promised
  where things stand (the story page's callout, the `/ongoing` description) say only the timeline.

## Amends

- **ADR-0070's D-OV7, "off until two gates open":** one gate now, overviews' own, and no order of
  switches; the stands, which needed the order, have a gate of their own. Everything else in ADR-0070
  stands.

## Consequences

- Nothing readers see changes until the owner enables `link_overviews` once this is deployed. Then
  the first nights take the backfill (about 6 nights at 300 stories), and an overview appears on
  `/ongoing` once a review keeps at least three stories in it: its AI title, status line, count and
  last change, and the timeline of our stories with their roles, summaries and any research Updates.
- No eval measured what readers now get beyond linking, roles, reviews and re-centers: the overviews'
  titles (and retitles by reviews and re-centers) have no bar of their own, the timeline's summaries
  are the stories' own and were never judged as a timeline, and the pages' layout, folds and copy
  were checked by component tests only.
- The replay's measured cost per story includes the stands' calls, which production makes none of
  while the stands gate is closed: an upper bound for overviews as they ship.
- Switching the stands on later needs research passes on, the stands' bars met again on their facts,
  the gate set to null, the label and the methodology's summary sentences brought back for the owner's
  approval, and the two draft strings widened again.
- The admin's overview page still lists every stored stands version; none is written while the gate
  is closed, so in production it reads "Not written yet."

## Alternatives considered

- **Keep waiting for research passes:** overviews would wait for production changes to research
  (dated search results, the `update` bars) that linking, roles and the timeline do not depend on.
- **Run the stands and only hide them from readers:** with no pass running there are no pool facts,
  so every public overview whose offer changed would get a `too_few_facts` decision for nothing, and
  once passes run the calls would spend on lines readers never see; skipping the part keeps
  production's records clean until the stands can say something.
- **Tie the stands gate to research passes' gate in code:** one more rule to read; the stands gate's
  reason says it needs their facts, and whoever opens it opens it after them.

---
id: ADR-0063
title: "Story context: one named source is enough for a figure, and disagreeing current sources are shown side by side by a fixed tile rule"
status: accepted
date: 2026-11-16
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, product]
tags: ["story-context", "overviews", "figures", "sources"]
---

# ADR-0063 · Story context: one named source is enough for a figure, and disagreeing current sources are shown side by side by a fixed tile rule

## Context

The overviews roadmap's decision D5 (the owner's, 2026-11-16: "A bad context number doesn't ruin a
thread") lets a number from one source appear anywhere, always with its source shown, and shows
disagreeing sources side by side rather than resolving them. Story context, module 1, is the first
code it governs: its "In numbers" tiles and its charts show figures, and two sources often give
different values for the same thing on different days.

## Decision

- **A figure needs one named source**, the fact check having found it supported by that source's
  sentence; nothing waits for a second source. Every figure on a card names its source.
- **The tile rule** (`tileDisplay`, `server/src/services/storyContextVisuals.ts`): of a tile's facts,
  only supported, non-demoted ones current on the story's day count. The headline is the newest from
  the most authoritative kind present: official, research, news, other (the credited body's kind,
  else the source's). Every other such fact dated on or after it with a different value is shown
  beside it, each naming its own source; the same value from several sources shows once, credited
  to the headline's. The agent placed the source kinds: `official-body` official; `news-report`,
  `analysis` and `opinion` news; `press-release` other.
- Code never averages, picks a "true" value between sources, or drops a value because another
  source disagrees.

## Consequences

- A wrong figure from one source can reach a card; it is shown with its source, and a disagreeing
  later source is shown beside it rather than hiding it.
- An older value from a less authoritative source is not shown beside a newer official one, so a
  tile does not grow into a list.
- Joins, charters and figure definitions in later modules never rest on a single value (D5's second
  half), which is theirs to hold.

## Alternatives considered

- **Requiring two agreeing sources:** most context figures have one source, so most tiles would go.
- **Resolving disagreement in code or by a model:** hides from readers that sources disagree, and
  makes a model's judgment look like a fact.

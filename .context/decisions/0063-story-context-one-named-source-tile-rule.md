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

## Amendment 2026-11-17: no In numbers box; each figure in its slot's card; a card says nothing twice

The owner, on 2026-11-17, after seeing the cards: "Redundancy in info strings and sources,
unnecessary indentation when there's only one thing in the context box. Case in numbers is weird,
too, as quite different things are presented there in one card. The thing that supposedly holds it
together is that it's numbers. But that's not useful." He asked for the three changes below; the
agent set the details named as its own. The tile rule above is unchanged: which values a tile shows,
and that disagreeing sources stand side by side, each named.

- **No In numbers box.** The write call no longer returns a `figures` box. A figure is a tile of the
  box whose slot it answers (a count of people in `who_affected`, a cost in `response`, a past value
  in `compared`), a box may hold its tiles alone, and a figure that answers no needed slot is not
  shown. A story has at most 6 cards (7 with the In numbers box before).
- **Stored In numbers boxes stay stored and are never read back** (the agent's choice, no destructive
  migration): the `ContextBoxType` enum keeps `figures`, and every read of the boxes asks for the
  seven slots only, so such a box is not served, not listed in the admin and not editable (404), and
  a run that wrote only one does not count as the newest run with boxes. The admin's `movable` flag
  and the placement rule that kept the box in More context are gone: every shown card may move.
- **A card says nothing twice.** The footer names the card's sources and the date its facts are
  from, so:
  - a tile's label says what the heading does not: the prompt asks for it, and code (`tileLabel`,
    applied when the page is served, so stored cards get it too) drops a trailing year that is the
    card's as-of year, and on a one-tile card a label whose content words all appear in the heading
    (the agent's word rule: function words and a plural "s" aside). The box check reads an empty
    label as the heading.
  - a value's source chip shows when the tile gives several values (disagreeing sources keep a chip
    each) or the card cites more than one source; on a card citing one source, the footer alone
    names it. The agent extended this to a chart's visible source line, which a sole-source card no
    longer shows; the hidden table still names every value's source.
  - a single tile sits flush, without the rail and indent that set several tiles apart.

Rule: every figure on a card answers the card's question and names its source once on the card,
beside the value where sources disagree or the card has several, in the footer otherwise.

Consequences: the write's prompt and schema changed, so its prompt version changed and the eval
gate's `context` step runs again before the step is switched on. A number that answers no needed
slot is no longer shown anywhere, so a story may show fewer figures than before. Cards written
before the change lose their In numbers box at once; their other boxes keep their figures, now with
the label and chip rules above.

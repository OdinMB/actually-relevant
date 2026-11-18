---
id: ADR-0065
title: "Story context always looks for what is being done about the problem, searching for it first, and says so plainly when nothing sourced answers it"
status: accepted
date: 2026-11-16
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [product, ai-risk]
tags: ["story-context", "overviews", "constructive", "response"]
---

# ADR-0065 · Story context always looks for what is being done about the problem, searching for it first, and says so plainly when nothing sourced answers it

## Context

The overviews roadmap's decision D10 (the owner's, 2026-11-16: "Let's try to always find a
constructive element in these overviews and later threads") has story context, overviews, threads
and the briefing each look for what is being done about the problem: responses under way, solutions
tried, or what has worked against the same problem elsewhere, sourced and checked like every other
fact. Story context, module 1, is the first code it governs.

## Decision

- **`response` is always needed** (`planSearches`, `server/src/services/storyContextPipeline.ts`):
  whatever the gap list answers, unless the story itself reports the response. The gap list may say
  so by quoting our own text; the quote counts only when it stands in the story's text (the agent's
  placement, `supportFound`), so a model cannot excuse the search with a sentence we never wrote.
- **Its search goes first** while research's facts don't cover it. With no `response` search
  listed, code adds one from the story's title (its first 9 words and "response", the agent's
  wording), and the run records the fallback.
- **The honest gap:** when the `response` search ran, no supported fact answers it, no kept card is
  a `response` card and the story does not report the response, code adds a `response` box with no
  sentences and no model (`gap: true`); the page gives it fixed wording ("Our sources don't say what
  is being done about this."). Nothing is written to sound hopeful without a source.

## Consequences

- Stories that would otherwise have no search get one: at most about $2 a month more, less where
  research already covers the response.
- A story that is itself the response (a new policy, a breakthrough) gets no extra card.
- The eval measures a supported `response` card on the stories whose gap key has a findable one, and
  the honest gap only where the key has none (plan, "Eval gate").

## Alternatives considered

- **`response` as one slot among seven:** the gap list would skip it whenever the story seemed
  complete, and the constructive element would depend on the model's mood.
- **Writing a hopeful line from general knowledge when nothing is found:** unsourced, and against
  every other rule of the cards.

## Amendment 2026-11-17: no card when nothing sourced is found; two searches from two angles

The owner decided on 2026-11-17 that the honest-gap card must never appear, and that the step should
try harder to find the response. Both replace parts of the Decision.

**No card when nothing sourced is found.** The Decision's third bullet no longer holds: when the
`response` searches ran, no supported fact answers them, no kept card is a `response` card and the
story does not report the response, code adds **no box**. The run records it instead
(`responseNotFound` in `story_context_runs.result`), and the admin's "What the run did" says
"searched, nothing sourced, so no card". The client renders no gap card, the public route no longer
has a `gap` field, and `context_boxes.gap` stays as an unused column (always false) rather than
being dropped by a destructive migration. A stored gap box from before has no sentence and no
visual, so the route leaves it out.

**Two searches from two angles.** The Decision's second bullet now reads: while research's facts
don't cover `response` and the story doesn't report it, up to two of the story's at most 3 searches
are for it, and both go first. The gap list gives one query per angle (`responseSearches`):
`action`, who is responding to this problem and what is being done about it, and `elsewhere`, what
has worked against the same problem in other places or at other times. An angle it leaves empty
gets a query from the story's title (action: its first 9 words and "response"; elsewhere: its first
6 and "solutions that worked elsewhere", the agent's wording), and the run records the fallback. A
repeated query runs once, and the other slots get what is left of the 3.

Rule: a story's context shows only sourced cards; an open response is searched for from both angles
before anything else, and a response that was looked for and not found is recorded on the run and
shown nowhere on the page.

Consequences: a story whose response was not found shows no "What's being done" card; nothing tells
readers it was looked for. With the response open, the other slots share one search instead of two.
A story still makes at most 3 searches and 5 extractions, so the most a story can cost is unchanged;
stories that made fewer than 3 make one more, at most about $2 a month more again. The second angle often
finds nothing a card cites, so the eval's wasted-search bar (at most 1 a story) is likelier to trip.
The eval drops its honest-gap bar (this ADR's Consequences, ADR-0066's list); the response card bar
stays.

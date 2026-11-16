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

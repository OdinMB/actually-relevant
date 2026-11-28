---
id: ADR-0083
title: "Research passes no longer wait for their cards' bars; a pass's cards stay hidden from readers behind a card gate of their own until those bars hold"
status: accepted
date: 2026-11-28
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, testing]
tags: ["research-passes", "story-context", "overviews", "eval", "gate"]
---

# ADR-0083 · Research passes no longer wait for their cards' bars; a pass's cards stay hidden from readers behind a card gate of their own until those bars hold

## Context

A research pass writes a story's article and its context cards in one step (ADR-0067). Its switch
waits for one eval gate, `PASS_EVAL_GATE` (ADR-0067's amendment of 2026-11-18), which by the plan
(`.plans/2026-11-17_research-passes.md`, "Evals and the gate") held three sets of bars: no
regression against research's baseline (`eval:research`), the `update` step's, and the `context`
step's, which judge the cards. Overviews switch on only after research passes (ADR-0070), so they
waited for the cards too.

The measurements of 2026-11-27 and 2026-11-28 (`.context/eval-baselines.md`) put the `context` bars
far off: must needs met 2.5% against 60%, mostly because search results carry no date, which only a
production change to the search can fix, while most of the `update` bars are met. The owner decided
on 2026-11-28: research passes no longer wait for context cards to reach their bar. Research passes,
and so overviews, may switch on once the gate's other bars are met; the cards a pass writes stay
hidden from readers until the cards meet their own bar.

## Decision

- **Two gates, both code constants.** `PASS_EVAL_GATE` (`services/researchPassGate.ts`) is met by
  `eval:research`'s bars and the `update` step's. The `context` step's bars (needs met, wasted
  searches, a response card, unsupported box items, placement, cost per story, structured fields and
  invented numbers, planted errors on its facts) are the card gate's, `CARD_EVAL_GATE`
  (`services/cardGate.ts`), closed. Each opens in a code change, once its own bars hold on the judged
  half, by the owner's decision, as ADR-0066 has it.
- **The card gate holds no switch.** Enabling `research_pass` and `link_overviews`, the publish gate
  and editors' passes key on research passes' gate and overviews' own, as before.
- **A pass still writes its cards** while the card gate is closed: the admin lists them and an editor
  can hide or move them before readers see any, and the stored cards are what production made, to
  read beside the eval, which judges a replayed pass's cards in memory either way.
- **Readers get no card of a story whose newest cards are a pass's** while the card gate is closed,
  on every reader path (`readerCardRecords`, `services/storyCards.ts`; a fence test,
  `test/passCardReaders.test.ts`, keeps every reader on it). The story's older context-run cards are
  not served in their place: what an editor sees and edits stays what readers would get.
- **Context-run cards are not gated.** `build_story_context` keeps what it does today (switched off;
  its "Run now" and an editor's "Gather context" build cards readers see), since cards an editor
  gathered may be live now. Once passes are on, that step is switched off and "Gather context" is
  refused, so no new context-run cards appear.
- **The admin says so:** the Context tab marks a pass's cards "Hidden from readers" with the reason,
  and the Jobs page's note for Research Passes says readers do not see its cards yet.

## Amends

- **ADR-0067's amendment of 2026-11-18:** `PASS_EVAL_GATE` no longer waits for the `context` bars.
  Everything else in it stands.

## Consequences

- Nothing changes in production now: every step stays disabled, and research passes' gate stays
  closed until `eval:research`'s and the `update` bars hold (on 2026-11-27, expected changes flagged
  and the notes' bars were missed; `eval:research` has no baseline yet and is the owner's read).
- Once passes are on and the card gate closed, readers get a passed story's new article, its Updates
  and, once overviews are on, the ongoing pages, and no context cards on that story, also where an
  editor's "Gather context" had shown some before. A story no pass has written cards for keeps its
  context run's cards.
- The cost bar ($0.20 a story, the whole first pass), the structured-fields bar and the planted errors
  on the pass's facts are measured on the `context` step, so they now gate only the cards, although
  the article is written from the same facts and the cost is the whole pass's. The pass's spend stays
  bounded by its ceilings and the monthly cap (ADR-0067).
- The card steps keep spending (about half a cent a story at the 2026-11-26 baseline) on cards readers
  do not see until the card gate opens.
- The methodology page's paragraph on context cards stays off the page until the card gate opens.

## Alternatives considered

- **Skip the card steps while the card gate is closed:** saves their cost, but leaves nothing for an
  editor to check or hide before the cards go live, and runs a pass in production that differs from
  the one the eval measures, behind a branch to remove later.
- **Serve the story's older context-run cards while a pass's are held back:** two record sets on one
  page, and an editor's "Hide all" acts on the pass's cards, not on those readers would see.
- **Hold back every card, context runs' too:** would take down the cards an editor gathered, a change
  readers would see now.
- **Keep one gate:** research passes and overviews would wait for the production changes the cards
  need (dating search results, the key-term card), which their own bars do not depend on.

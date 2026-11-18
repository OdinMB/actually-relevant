---
id: ADR-0066
title: "Every overview model step has an eval, and a replay of past stories gates each launch: story context goes live only when its bars hold on the judged half of its gap keys"
status: accepted
date: 2026-11-17
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, testing]
tags: ["story-context", "overviews", "eval", "gap-keys"]
---

# ADR-0066 · Every overview model step has an eval, and a replay of past stories gates each launch: story context goes live only when its bars hold on the judged half of its gap keys

## Context

The overviews roadmap's decision D8 (the owner's, 2026-11-16: "We'll need evals for all of this")
gives every model step of story context, overviews, threads and the briefing an eval, and makes a
replay of past developments the gate before each launch. These steps run with no person in the loop
(ADR-0062), so the eval is the only place a wrong card, a wasted search or an invented number is
seen before readers see it. Story context, module 1, is the first code it governs: its step
`build_story_context` ships switched off.

## Decision

- **A launch waits for its bars.** A step is switched on only when its eval's bars hold, read by the
  owner, who flips the switch; the eval reports each bar as met or not and switches nothing. For
  story context the bars are the plan's (`.plans/2026-11-16_story-context.md`, "Eval gate before
  switching on"; `.context/model-eval.md`, "Overview evals"): needs found, wasted searches, a
  response card where one is findable and the honest gap only where it isn't, no unsupported box
  item, placement (below its bar the step goes live with `STORY_CONTEXT_PLACEMENT=section`), cost,
  structured fields, and planted errors on its facts.
- **The replay runs production's code.** `eval:overviews --steps context` calls production's
  `buildStoryContext` with production's prompts, schemas and checks, imported read-only and held to
  no I/O of their own (`server/src/scripts/eval/imports.test.ts`). Only the deps are the eval's:
  each step's tier on a constant arm, the call cache, Tavily cached with each search ending on the
  story's publication day, and no opt-out policy (recorded as `optOutChecked: false`).
- **Answers are committed keys, never the step's output.** One gap key per one-off story
  (`server/src/scripts/eval/overviews/gapKeys/<slug>.json`) says what a careful editor would add
  beside the story; the strong model drafts it with general knowledge allowed and the coordinating
  session checks it against the story. A key changes when a story is corrected or a label proves
  wrong, never to make a step pass.
- **Tuned on one half, judged on the other.** The halves are fixed for good by the parity of the
  first byte of the slug's sha256 (`halfOf`): prompts are tuned on `tune` only, and the gate is read
  on `judge`, as means over 3 runs with their spread.
- **Rerun after every prompt or model change** of a gated step, before it ships.

## Consequences

- Drafting the 30 gap keys costs about $1–2; a full gate run (3 repeats on the judged half, with the
  fact check on the step's facts) about $3–6, mostly the strong judge. Tavily is paid once per query
  and then cached.
- The replay flatters production a little: undated search results pass the end date, and pages
  updated after the story keep their first date. The report counts both.
- Each later module (overviews, threads, the briefing) adds its own step and keys to
  `eval:overviews` before it launches, under the same rules.
- A key added later lands in a half by its slug; nothing moves an existing key between halves.

## Alternatives considered

- **A shadow run in production before launch:** real spend every month, records written for stories
  readers never see, and nothing to score them against without keys.
- **A one-off read of some stories:** not repeatable after a prompt change, and no bar to hold.
- **Tuning and judging on the same stories:** the prompts would fit the judged set, and the gate
  would measure that fit.
- **Gating on a single run:** the steps' answers vary from run to run; a mean over 3 runs with its
  spread shows the noise the bars sit in.

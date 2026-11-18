---
id: ADR-0069
title: "Prompt caching is off unless a prompt marks it: explicit cache mode on every call to a model that takes it, one breakpoint after a cached prompt's stable part, and one house order for every prompt"
status: accepted
date: 2026-11-18
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, cost, ai-risk]
tags: ["prompt-caching", "openai", "prompts", "cost", "eval"]
---

# ADR-0069 · Prompt caching is off unless a prompt marks it: explicit cache mode on every call to a model that takes it, one breakpoint after a cached prompt's stable part, and one house order for every prompt

## Context

From GPT-5.6 on, OpenAI bills an input token written to the prompt cache at 1.25 times the input
price (30-minute lifetime) and a cached read at 0.1 times. Caching is on by default: implicit mode
places a breakpoint at the end of the last message. Every call here is one user message that ends
in its own data, and most prompts put that data before their rules, so the default wrote every
prompt to the cache and read almost nothing back: research's cost carried a blanket 1.25 factor on
all uncached input for that reason. The owner (2026-11-18): "House style for prompts should be in
line with caching optimization", and "Apply the changes everywhere. I value consistency in the
prompt structure more highly than having to redo a calibration run", with calibration evals to
check each changed prompt.

## Decision

- **Caching is off by default.** Every chat client sends `prompt_cache_options: { mode: "explicit" }`
  to a model that takes the controls (GPT-5.6 and later, GPT-6 with its point releases): explicit
  mode with no breakpoint caches and writes nothing. Any other model id, older or unknown, gets no
  cache option at all, since it may reject the request (`lib/promptCache.ts`, `createChatModel`).
- **A prompt is cached only by its builder's decision**, stated in its header as `Cache: on` or
  `Cache: off` with the reason: on when its stable part, the output schema included, reaches the
  1,024-token minimum and two or more calls are likely within the 30-minute lifetime. A cached
  prompt's builder also returns `{ stable, data }`; the call sends `stable` as a text block with an
  explicit breakpoint, then `data`. The whole text stays `stable + data`, the string the builder
  returns for tests and evals.
- **One house order for every prompt, cached or not:** fixed rules, examples and the task first,
  blocks fixed for a run next, the call's own data last. A per-call value (a date, a count, a
  limit, a language) goes in the data, never in a rule. Each cached prompt has a test that builds
  it for two different inputs and finds the stable part byte-identical.
- **Costs are priced as billed where the controls are sent:** the answer's cache writes and reads
  each at their own price, the rest of the input at the input price. Where they are not, research
  keeps its 1.25 upper bound on uncached input.
- **The eval sends the same request as production** (the same client, message and split), and a
  reordered prompt counts as changed: it goes through its eval (`eval:recalibrate` for a rating
  prompt) before anyone relies on its calibration.

## Consequences

- Every prompt's text changed order at once; the calibration of each is checked by the eval run
  plan of 2026-11-18, and the research steps' new layout is their first baseline (no eval had run
  on them).
- The savings are small at today's volumes (a few dollars a month at list price) but grow with the
  research step; the larger effect is that costs are no longer overstated by the blanket factor.
- OpenAI documents the controls for the Responses API; Chat Completions accepts them in the SDK's
  types but live acceptance is checked by the eval's `--api-check` before a deploy relies on it.
  A model id the gate does not know runs with OpenAI's default, as before.
- Concurrent first calls of a run all miss and all write: a cached prompt pays 1.25 on its stable
  part until the first write lands, then 0.1.

## Alternatives

- **Keep the default (implicit mode)** and let OpenAI place the breakpoint: every call writes, almost
  none reads, at 1.25 the input price.
- **Cache every prompt**: short or rarely repeated prompts would pay the write and never read it.
- **Move instructions to a developer message**: would change how the models weigh the rules, which
  the calibration rests on; the breakpoint inside the one user message caches the same prefix.

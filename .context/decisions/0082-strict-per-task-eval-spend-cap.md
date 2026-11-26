---
id: ADR-0082
title: "Eval spend is held by a strict per-task cap, enforced at the HTTP layer by worst-case reservation"
status: accepted
date: 2026-11-26
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [cost]
tags: ["evals", "spend-cap", "cloud"]
---

# ADR-0082 · Eval spend is held by a strict per-task cap, enforced at the HTTP layer by worst-case reservation

## Context

Evals are to run in cloud sessions, where the OpenAI and Tavily keys are injected by a proxy and no
person watches each call. The only limit the evals had was `--budget`: a stop on a folder's ledger
total, checked against estimates (chars/4 input, assumed output tokens) with each call in flight held
at its estimate (2026-11-22). An estimate can be overrun by a long answer, by the SDK's retries and
flex attempts, which the ledger never saw, and by production's pipeline code run inside an eval
sandbox, whose requests went past the eval's ledger. The OpenAI project behind the cloud key has a
monthly limit, but its enforcement is not instant, so it is a backstop, not a per-task bound.

The owner decided on 2026-11-26: "strict per-task caps". The plan
(`.plans/2026-11-26_cloud-evals.md`, part A) set the shape: a named, fixed amount, a worst-case
reservation per request, enforcement at the HTTP choke points, and a refusal of live paid calls
without a cap. How the bound is computed, what is refused and how a refusal reaches the callers were
left to the implementing agent.

## Decision

- **A task cap** is a named USD amount, fixed when created (`eval:cap new <name> --usd <n>`, at most
  `MAX_BUDGET_USD`) and never raised, kept as an append-only ledger in the gitignored
  `DOCS/eval-caps/`. Every eval command takes `--cap <name>` or `EVAL_SPEND_CAP`. Without one, a live
  OpenAI or Tavily request is refused, while cached, dry, cache-only and rescore runs need none.
- **The invariant:** settled cost plus open reservations never exceeds the cap. A request is sent
  only once its worst case is reserved; its answer replaces the reservation with its real cost.
- **Enforced at the two HTTP choke points**, so every attempt is covered, retries, flex attempts and
  production's code in eval sandboxes included: the fetch `openAiFetch` sends each attempt through
  (`lib/openaiSpend.ts`) and `lib/tavily.ts`'s post. The guard is process-wide and installed only by
  an eval command (`installEvalCap`); production installs none, and its paths are unchanged.
- **The worst case is read from the request alone:** input at most the body's UTF-8 bytes plus 1,024
  tokens, at the input price times the cache-write factor; output the lower of the request's own
  limit and the model's maximum (128,000 for GPT-5 and GPT-6), times `n`, at the standard price; a
  Tavily search at its depth's credits. No limit is ever added to a request. A request the body does
  not bound (no price or maximum for its model, an image, audio or file part, context stored at
  OpenAI, a built-in tool, priority processing, another endpoint) is refused, never guessed.
- **Settling:** a 2xx at its reported usage, or the full reservation when it reports none; a 4xx
  other than 408 at nothing; a 408, a 5xx, a timeout or a lost connection at the full reservation.
- **A reservation that does not fit** waits while this process's requests in flight could free the
  room, and is otherwise refused. An OpenAI refusal is answered with a 402 marked not to retry, so
  neither the SDK nor LangChain retries it; the eval harness answers the call `skipped`.
- **Crash-safe and single-process:** each event is flushed to disk before the request leaves or after
  it answers, an unsettled reservation counts in full for good, and a pid lock refuses a second live
  process on one cap.
- **One price table** for the eval and the cap, moved from `scripts/eval/models.ts` to
  `lib/apiPrices.ts` with each model's maximum output and its source. Production's job costs keep
  reading `config.llm.modelPrices`, as before.

## Consequences

- No request this code sends can take a task past its cap, whatever the estimates, retries or
  sandboxes do; the folder `--budget` stays as the planning limit beside it.
- Reservations are large: a large-tier call reserves about $1.30 against a real cost usually a small
  fraction of it. Large-tier concurrency under a small cap drops (three calls at once under $5), and
  a cap's last $1.30 or so starts no large-tier call.
- Every documented eval command now needs `--cap` or `EVAL_SPEND_CAP` for a live run; a command run
  without one skips its live calls and says so.
- The bound is only as right as `lib/apiPrices.ts`: an unverified price or a model maximum that
  OpenAI raises would make it wrong without any test failing. gpt-5.2's and gpt-6.1-sol's prices are
  unverified, and the GPT-5 family's maximum was not rechecked.
- Requests made outside this code (a hand-written `curl`, another tool on the same key) are not
  covered.
- Revisit if a model gets a larger maximum output, if an eval needs images or stored context, or if
  the reservations' size makes cloud runs too slow.

## Alternatives considered

- **Add `max_completion_tokens` to each request** to shrink the reservation: rejected. `llm.ts`
  forbids `maxTokens` for GPT-6, and the eval must measure production's exact request.
- **Tighten the estimate-based `--budget` instead:** an estimate can always be overrun, and the
  ledger sees neither the SDK's retries nor production's code in a sandbox.
- **Enforce in `createEvalContext` only:** misses Tavily, retries, flex attempts and every request
  production's pipeline makes inside an eval.
- **Throw from the fetch on a refusal:** the SDK reads a thrown fetch as a connection error and
  LangChain retries it with backoff; a 402 marked not to retry ends the call at once.
- **Rely on the OpenAI project's monthly limit:** not instant, and it does not cover Tavily.
- **Several processes on one cap at once, with a lock per reservation:** more machinery for a task
  whose commands run one after another; a second process is refused instead.

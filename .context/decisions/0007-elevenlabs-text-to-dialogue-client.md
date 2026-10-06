---
id: ADR-0007
title: Voice episodes with ElevenLabs eleven_v4 Text to Dialogue through a thin axios client
status: accepted
date: 2026-10-06
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: ["vendor", "cost", "ai-risk"]
---

# ADR-0007 · Voice episodes with ElevenLabs eleven_v4 Text to Dialogue through a thin axios client

## Context

The weekly podcast has two AI hosts in one dialogue, so it needs a text-to-speech service that
voices several speakers in one request. The owner chose ElevenLabs on the Starter plan, the
`eleven_v4` model through its Text to Dialogue endpoint, chunked at segment boundaries, with an
alert rather than a retry when credits run out (plan `.plans/autonomous-two-speaker-podcast.md`,
owner decisions of 2026-10-05). Requests are limited to about 2,000 characters, so an episode of
about 5,500 characters takes about five calls, one per story segment.

Phase 0 (2026-10-06) measured that text continuity (`previous_text`/`future_text`) sounds as good at
the joins as request-id continuity, that audio tags are billed as characters, that the
`character-cost` response header reports what each call billed, and that the subscription counter
tracks API usage but lags a few calls. Every call costs credits, and a call that times out may
still have been billed. The official SDK retries on its own, which on top of the project's own
`withRetry` would multiply billed attempts, and brings a dependency for two endpoints.

## Decision

We call `POST /v1/text-to-dialogue` with `model_id` pinned to `eleven_v4` and a fixed seed, and
`GET /v1/user/subscription` for the balance, with axios from `server/src/lib/elevenlabs.ts`, the
only module that talks to ElevenLabs. Continuity is text-only: the last and first 100 characters
of the neighbouring chunks. A 401, 402 or 403, or a quota, payment or paused-account refusal,
becomes `ElevenLabsQuotaError` and is never retried; the pipeline turns it into a block with one
alert. Any other 4xx is not retried either. Only a 429 that is not a quota refusal, or a 5xx, is
retried once. A timeout is not retried, because ElevenLabs may have billed it (the agent's
refinement at implementation of the plan's "withRetry otherwise"). The client returns the audio,
the request id, the characters sent and the billed `character-cost`.

## Consequences

Each billed call happens at most twice, and only after an answer that carried no audio. The vendor
contract sits in one small file, so a model or vendor change touches one place, and tests mock it
at the axios layer without real credits. Text continuity is stateless, so a resume after a restart
needs nothing from an earlier run.

What got worse: we own the request and error shapes ElevenLabs may change, with no SDK to absorb
them; a transient timeout fails the run instead of retrying, which costs a weekend slot or an admin
Resume. Episode text goes to a US vendor (no visitor data), which the privacy notice must name
before publication. `eleven_v4` will be retired one day, and the chosen voices are Voice Library
voices with an 11-year notice period rather than ElevenLabs' own defaults.

Revisit when ElevenLabs announces `eleven_v4`'s retirement or changes the endpoint, when the
credits-per-character ratio measured after the launch promotion (re-measure after 2026-10-12)
makes Starter too small, or when the dialogue endpoint's per-request limit changes the chunking.

## Alternatives considered

- **The `@elevenlabs/elevenlabs-js` SDK** — its own retries would double-bill on top of ours, and
  it is a dependency for two endpoints.
- **Request-id continuity (`previous_request_ids`)** — no audible gain in the owner's blind
  listening test, and it ties a resumed chunk to request ids from an earlier run.
- **Per-turn single-voice TTS with `previous_text`** — about 30 calls per episode instead of 5;
  kept as the fallback if dialogue seams become audible.
- **`eleven_v3`** — the fallback had `eleven_v4` not been offered on the dialogue endpoint; it was.

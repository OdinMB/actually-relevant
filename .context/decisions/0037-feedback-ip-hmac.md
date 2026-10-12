---
id: ADR-0037
title: Hash feedback IP addresses with HMAC-SHA256 under a dedicated secret, and refuse feedback without it
status: accepted
date: 2026-10-13
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [personal-data]
---

# ADR-0037 · Hash feedback IP addresses with HMAC-SHA256 under a dedicated secret, and refuse feedback without it

## Context

The public feedback form stores the visitor's message, the chosen category, an optional email address and an `ipHash`, used to spot repeated abusive submissions. The hash was an unsalted SHA-256 of the IP address, so anyone holding the `feedback` table could recover every address by hashing all 2^32 IPv4 addresses. The privacy page did not mention the form at all. Once `TRUST_PROXY` was set to the measured hop count (ADR-0033), `req.ip` became the visitor's real address rather than a proxy's, which made the stored hash personal data in practice.

The `TURNSTILE_SECRET_KEY` precedent (ADR-0021) keeps a feature's secret policy and boot log in a `lib/` module, refusing that feature rather than the server when its secret is missing. The owner decided the keyed hash under a new secret, centralized in `server/src/config.ts`, and that old rows keep their old hashes; the agent chose refusing feedback over refusing to start, no development fallback key and no length check. The owner approved the plan stating all of it on 2026-10-12, and explicitly accepted refusal over a failed start.

## Decision

Feedback stores `ipHash` as the hex HMAC-SHA256 of the visitor's IP keyed by `FEEDBACK_IP_HASH_SECRET` (`config.feedback.ipHashSecret`), computed in `server/src/lib/feedbackIpHash.ts`. With the secret unset, in every environment, the route answers 503 and stores nothing, and the server still starts, logging an error once at boot. There is no development fallback key and no length check; `openssl rand -hex 32` (or the PowerShell equivalent in `server/env.example`) generates the secret. Rows stored before this change keep their unkeyed hashes, which never match new ones; re-hashing or deleting them is outside this decision.

## Consequences

A copy of the table no longer reveals addresses without the secret, and the hash still identifies repeat submissions from one address. The column and the admin view are unchanged, since the HMAC is also 64 hex characters. Every environment that wants working feedback, development included, must set the secret; a missing one shows up as 503s on the form and an error in the boot log rather than as a failed deploy. Rotating the secret silently breaks matching between older and newer rows, as the switch from the unkeyed hash already did once. Old rows stay reversible until they are deleted.

Revisit this if feedback gains a retention period (old rows could then simply age out), if abuse handling moves to a different signal, or if the secret is ever rotated.

## Alternatives considered

- **A public development fallback key chosen by `NODE_ENV`** — any host with a wrong `NODE_ENV` would write brute-forceable hashes.
- **Refusing to start without the secret** — also fails closed, but blocks every deploy for one feature's secret; the Turnstile precedent keeps the blast radius to the feature.
- **A startup length check on the secret** — would block deploys over a weak but working key; generation instructions instead.
- **A nullable column with no hash** — needs a migration and drops the abuse signal the privacy page promises.
- **Reusing `JWT_SECRET` as the key** — rotating it would silently change every future hash.

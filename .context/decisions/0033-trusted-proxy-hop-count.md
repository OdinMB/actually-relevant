---
id: ADR-0033
title: Identify visitors by a configured trusted-proxy hop count that fails closed
status: accepted
date: 2026-10-12
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [cost, personal-data]
---

# ADR-0033 · Identify visitors by a configured trusted-proxy hop count that fails closed

## Context

The backend sat behind Cloudflare and then Render's own proxies, and `server/src/app.ts` hard-coded `app.set('trust proxy', 1)`. With one trusted hop, `req.ip` was most likely a proxy address rather than the visitor's, so visitors sharing that address shared every rate-limit bucket: search (which pays for OpenAI embedding calls), subscribe, feedback and its stored `ipHash`, login, refresh, and the general and expensive-op limiters. Nothing showed which address `req.ip` really was.

Cloudflare documents that it appends the connecting address to any incoming `X-Forwarded-For` and sets `CF-Connecting-IP` to that address, overwriting a visitor-sent value. No Render document gave the number of its own proxies; reports from Render users disagreed, pointing at 2 or 3 hops in total. A count that is too low makes visitors share buckets; a count that is too high lets a visitor choose their own bucket by sending `X-Forwarded-For`, a silent bypass of every limit. The owner had fixed the same problem in another repository with a hop count.

## Decision

We read the trusted hop count from `TRUST_PROXY`, parsed by `parseTrustProxyHops` in `server/src/config.ts`: unset or empty gives 1, a plain non-negative integer gives that number, and anything else (`true`, an address list, `2abc`, `-1`, `1.5`, a leading space) throws at startup and names the variable. Production sets the value in the Render dashboard to the count measured with a permanent public diagnostic, `GET /health/client-ip`, which returns the caller's `req.ip`, `CF-Connecting-IP`, raw `X-Forwarded-For`, the hop count and whether `req.ip` matches Cloudflare's address, with `Cache-Control: no-store`, storing and logging nothing. This does not change any limiter's thresholds or re-hash stored feedback `ipHash` values.

## Consequences

A wrong count is now measurable with one `curl` carrying a spoofed header, and a typo in the setting stops the deploy instead of silently changing the trust level, so the previous deploy keeps serving on Render. The code default stays at 1, so until the owner measures and sets the count in the dashboard, production keeps today's shared buckets; correctness depends on a manual rollout step, which `.context/deployment.md` records. The count is a property of the hosting topology, not of the code: it must be measured again after any change of domain, proxy or Render plan, and if the `onrender.com` host and the custom API domain need different counts, no single value is right. The diagnostic is a new public endpoint, though it reveals only the caller's own address and proxy addresses.

Revisit this if the check shows the two hostnames need different counts, if Render's proxy chain changes, or if the origin becomes reachable only through Cloudflare, which would make keying on `CF-Connecting-IP` safe.

## Alternatives considered

- **A code default of 2** — needs no dashboard step, but is a guess that may trust too many hops (a bypass) or too few.
- **A production/non-production split on `NODE_ENV`** — adds a concept for no gain, since local requests all come from loopback.
- **Keying limiters on `CF-Connecting-IP`, or trusting Cloudflare's published IP ranges** — more robust to topology changes, but a different mechanism from the owner's fix in their other repository, and safe only while the origin cannot be reached except through Cloudflare.
- **Accepting `true` or address lists in `TRUST_PROXY`** — `true` trusts every entry a visitor sends, which express-rate-limit warns about as a permissive trust proxy.
- **A log-only or admin-only check** — logging addresses puts personal data in logs and cannot be run with a spoofed header on demand; an admin route needs a Bearer token the owner cannot easily use from `curl`.

---
plan-id: 2026-10-12_trust-proxy-client-ip
title: Make the trusted-proxy hop count a setting and verify client IPs on the live site
status: implemented
created: 2026-10-12
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [cost, personal-data]
decisions:
  - ref: .context/decisions/0033-trusted-proxy-hop-count.md
type: bugfix
complexity: simple
---

# Trusted-proxy hop count as a setting, with a live check

Confirmed by Odin Mühlenbein on 2026-10-12: every decision this plan states

## Problem

`server/src/app.ts` hard-codes `app.set('trust proxy', 1)`. The backend sits behind Cloudflare and then Render's own proxies, so `req.ip` is most likely a proxy address rather than the visitor's. All visitors behind the same address then share each rate-limit bucket: search (which pays for OpenAI embedding calls), subscribe, feedback (including its stored `ipHash`), login, refresh, and the general and expensive-op limiters. Nothing today shows which address `req.ip` really is, so a wrong count, too low or too high, goes unnoticed.

## Approach

**A setting, not a constant.** `config.ts` gains `trustProxyHops`, parsed from `TRUST_PROXY` by a new exported function, `parseTrustProxyHops(value)`. It sits beside `parseEffort` and follows its style. An unset or empty value gives the default. Anything that is not a plain non-negative integer (`/^\d+$/`) throws at startup and names the variable: `"2abc"`, `"-1"`, `"true"`, `"loopback"`, `"1.5"` and `" 2"` all fail. Throwing rather than falling back is the fail-closed choice. A typo cannot quietly become a different trust level, and on Render a failed boot keeps the previous deploy serving. `true` and address lists are rejected on purpose: `true` trusts every entry a visitor sends, and express-rate-limit v7 logs `ERR_ERL_PERMISSIVE_TRUST_PROXY` for it.

**Default 1, set to the measured count on Render.** The code default stays at today's value, 1. Production sets `TRUST_PROXY`'s value in the Render dashboard. This plan creates no `render.yaml`. The companion plan `.plans/2026-10-12_render-blueprint.md` adds one that names `TRUST_PROXY` with `sync: false`, so its value stays a dashboard setting either way. The two failure modes decide this.

- **Too low:** visitors share buckets. That is today's bug, a cost and availability problem.
- **Too high:** a visitor picks their own bucket by sending `X-Forwarded-For`. That is a silent bypass of every limit.

Research on 2026-10-12 found no Render document that gives the count.

- **Documented by Cloudflare:** it appends the connecting address to any incoming `X-Forwarded-For` (XFF), so an entry a visitor sends survives on the left. It also sets `CF-Connecting-IP` to that single address and overwrites any visitor-sent value.
- **Express semantics:** with N trusted hops, `req.ip` is the address N steps left of the socket address. So for XFF `a, b, c`, N=1 gives `c`, N=2 gives `b` and N=3 gives `a`.
- **Reports from Render users:** these disagree. One replayed production logs: with 1 it saw rotating internal `10.x` addresses, and with 3 it saw the client.

So the right count could be 2 or 3. The earlier probe cannot tell them apart: a spoofed entry fails to get its own bucket whenever the count is too low, as well as when it is right. Measuring first and then setting the count never ships one that trusts too many hops. A code default of 2 could already be too high on the `onrender.com` path and would be wrong if 3 is right. Local dev and tests have no proxy, so 1 is harmless there.

Alternatives considered:

- **A code default of 2.** This needs no dashboard step, but it is a guess that may trust too many hops or too few.
- **A production/non-production split on `NODE_ENV`.** This adds a concept for no gain, because local requests all come from loopback.
- **Keying limiters on `CF-Connecting-IP`, or trusting Cloudflare's published ranges.** These are more robust to topology changes and are the research's suggestion. They are a different mechanism from the owner's fix in their other repository, which this plan follows, and they only hold while the origin cannot be reached except through Cloudflare.

The hop count wins as the smallest change that matches the owner's existing pattern. The diagnostic below makes its weak point, an unknown count, measurable. It is recorded as ADR-0033 because a future reader will ask why the number is what it is. The approach follows the owner's fix in another repository as relayed to the planner. The default, the parsing and the diagnostic are the planner's choices and have not yet been reviewed by the owner.

**The live check: a self-verifying diagnostic at `GET /health/client-ip`.** It returns only the caller's view of their own request. It sends `Cache-Control: no-store`, so no cache in between can hand one visitor's response to another:

```json
{ "ip": "<req.ip>", "cloudflareIp": "<CF-Connecting-IP or null>", "forwardedFor": "<raw X-Forwarded-For or null>", "trustProxyHops": 1, "matchesCloudflare": false }
```

On Render, `CF-Connecting-IP` is the ground truth, because Cloudflare sets it and overwrites any value a visitor sends. `matchesCloudflare` is `req.ip === cloudflareIp`, or `null` when that header is absent, as it is locally. One request with a spoofed header proves both properties at once:

```bash
curl -s -H "X-Forwarded-For: 203.0.113.7" https://<backend-host>/health/client-ip
```

- **Correct count:** `matchesCloudflare: true`.
- **Too low:** `ip` is a proxy address and `matchesCloudflare` is `false`.
- **Too high:** `ip` is `203.0.113.7` and `matchesCloudflare` is `false`.

The `forwardedFor` chain shows where the visitor's address sits, so a wrong result says what to set: the right count is the position of `cloudflareIp` counted from the right end of `forwardedFor`, with the rightmost entry as 1.

Run it against both hostnames the backend answers on: the `onrender.com` one and the custom API domain from `VITE_API_URL`. If the custom domain also goes through the owner's own Cloudflare zone, the two paths can differ by a hop, and then no single count is right for both (see Out of Scope).

- **Why public and not admin-only:** it reveals nothing about anyone but the caller. It returns their own address, which they already have, and proxy addresses. It stores and logs nothing; the request log line carries no IP. An admin route would need a Bearer token, and the owner cannot easily pull one out of the admin client for a `curl`. It stays deployed as a permanent self-check, since Render's topology can change.
- **Why `/health`:** it is an operational self-check of the deployment, like the database check already there. Sitting outside `/api` keeps it out of the OpenAPI document and the public-API CORS list.
- **Why not log-only:** logging addresses puts personal data in logs, and a log-based check cannot be run with a spoofed header on demand.

**Rollout, for the owner after merge** (also written into `.context/deployment.md`):
1. Deploy. Behavior is unchanged, with the default of 1.
2. Run the `curl` above against both hostnames. Expect `matchesCloudflare: false` and an `ip` that is not your own. Find `cloudflareIp` in `forwardedFor` and count its position from the right, with the rightmost entry as 1.
3. Set `TRUST_PROXY` to that count in the Render dashboard. Expect 2 or 3. Render redeploys.
4. Run the `curl` again against both hostnames. Expect `matchesCloudflare: true`, and `ip` must not be `203.0.113.7`.

## Changes

| File | Change |
|------|--------|
| `server/src/config.ts` | New exported `parseTrustProxyHops(value: string \| undefined): number` beside `parseEffort`. It defaults to 1, accepts only plain integers, and throws with `TRUST_PROXY="<value>"` in the message. New top-level `trustProxyHops: parseTrustProxyHops(process.env.TRUST_PROXY)`, with a doc comment on what too low and too high cost. |
| `server/src/app.ts` | `app.set('trust proxy', config.trustProxyHops)`. Replace the comment so it names Cloudflare and Render's proxies and points at `.context/deployment.md`. |
| `server/src/routes/health.ts` | New `GET /client-ip` handler on the existing router. The router's job widens from "is the database up" to "operational self-checks of the deployment", which is the same kind of reason to change. No database access; sets `Cache-Control: no-store`; reads `config.trustProxyHops`. |
| `.context/deployment.md` | New section, "Client IPs behind Cloudflare and Render". It covers the proxy chain, what too low and too high cost, the `curl` check and its three outcomes, and the rollout steps. It warns to run the check again after any change of domain, proxy or Render plan. Add `TRUST_PROXY` to the backend's dashboard settings. |
| `README.md` | Add `TRUST_PROXY` to the backend environment-variable table: not required, default 1, set to the count the `/health/client-ip` check confirms. Rewrite the "Reverse proxy" architecture note, which states `trust proxy: 1` as fixed. |

This plan creates no `render.yaml`. The companion plan `.plans/2026-10-12_render-blueprint.md`, landing after this one, adds it and names `TRUST_PROXY` with `sync: false`.

## Tests

- `server/src/config.test.ts` (new, the test file for the module the parser lives in). `parseTrustProxyHops` returns 1 for `undefined` and `''`. It returns 0, 2 and 3 for those strings. It throws for `'-1'`, `'1.5'`, `'2abc'`, `'true'`, `'loopback'` and `' 2'`, with `TRUST_PROXY` in the message.
- `server/src/routes/health.test.ts` (new). It follows `auth.test.ts`: Prisma mocked with `vi.hoisted`, `express-rate-limit` mocked, and `process.env.TRUST_PROXY = '2'` set before `await import('../app.js')`, so it runs through the real wiring from config to app. Supertest's loopback socket stands in for the last Render proxy.
  - XFF `198.51.100.4, 104.16.0.1` with `CF-Connecting-IP: 198.51.100.4` gives `ip` `198.51.100.4` and `matchesCloudflare: true`.
  - A spoofed extra leading entry (`203.0.113.7, 198.51.100.4, 104.16.0.1`) leaves `ip` as `198.51.100.4`.
  - With no `CF-Connecting-IP`, `cloudflareIp` and `matchesCloudflare` are `null`.
  - The response carries `Cache-Control: no-store`.
  - Config is read when the module loads, so each test file gets one hop count. Don't re-import the app per test.

## Out of Scope

- Cloudflare Turnstile; changing any limiter's thresholds.
- Keying limiters on `CF-Connecting-IP`, or trusting Cloudflare's IP ranges, instead of a hop count. Revisit only if the check shows that the `onrender.com` host and the custom API domain need different counts. The fix then is to make the backend reachable through one path only, not to pick a compromise count.
- Re-hashing or migrating stored feedback `ipHash` values. Past rows hold hashes of proxy addresses, and they age out on their own.
- A scheduled or CI run of the check. It is a manual step after deploy.

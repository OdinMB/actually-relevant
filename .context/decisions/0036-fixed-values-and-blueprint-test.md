---
id: ADR-0036
title: Fix same-on-every-host settings and the Node version as values in render.yaml, held to the code by a test
status: accepted
date: 2026-10-13
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
supersedes: ["ADR-0034"]
themes: [handover]
---

# ADR-0036 · Fix same-on-every-host settings and the Node version as values in render.yaml, held to the code by a test

## Context

ADR-0034 declared both Render services in `render.yaml` and named every variable with `sync: false`, so the file carried no values at all. Two settings that are not secret and are the same on every host then lived only in the dashboard: `NODE_ENV=production`, and the trusted-proxy hop count, which the owner measured as 2 on 2026-10-12 on both backend hostnames (ADR-0033). Node was not pinned anywhere (no `NODE_VERSION`, `.node-version`, `.nvmrc` or `engines`), so Render's default, which moves over time, chose the runtime; both services ran 22.22.0 that day, per their deploy logs. Nothing noticed when the code read a variable that the blueprint or `server/env.example` did not name, and `server/env.example` gave values to several secret-looking names.

The owner's `render-side-project` convention, adopted after ADR-0034, puts each variable in one of two modes: a fixed `value:` for settings that are not secret and are the same on every host, and `sync: false` for secrets, per-stage values and canonical addresses, with a test holding the file to the code. Its test records what a `loadConfig(env)` reads through a proxy, but here eleven modules besides `server/src/config.ts` read `process.env` directly, several at call time. Render's docs give `NODE_VERSION` precedence over `.node-version`; whether a service with a `rootDir` reads `.node-version` from the repository root or from its root directory is not settled by them.

The owner decided the fixed values for `NODE_ENV` and `TRUST_PROXY`, pinning Node at the version production runs, and adding the blueprint test; the agent chose which other variables stay `sync: false`, how the test finds what the code reads, each adaptation of the convention's checks, and the pinning mechanism. The owner approved the plan stating all of it on 2026-10-12.

## Decision

`render.yaml` carries three fixed values: `NODE_ENV=production` and `TRUST_PROXY="2"` on the backend, and `NODE_VERSION="22.22.0"` on both services, equal to a new `.node-version` at the repository root. Every other variable stays `sync: false`: secrets and secret-shaped names (including `WEBHOOK_URL`), canonical addresses (`SITE_URL`, `CLIENT_URL`, `FRONTEND_URL`, `API_URL`, `VITE_API_URL`), switches (`SUBSCRIPTIONS_ENABLED`, `*_AUTO_POST_ENABLED`, `AUTH_COOKIE_SAMESITE`), and values production may set that the repository cannot see. `server/src/blueprint.test.ts` holds `render.yaml`, `.node-version` and both `env.example` files to the variables the code reads, found by scanning the server source for `process.env.NAME` (with a guard that no other form of read exists), the Prisma schema for `env("…")`, a short list of library-read names, and the client source for `import.meta.env.VITE_*`. A variable the server reads is named in the blueprint or in one of two exclusion lists with its reason: `NOT_IN_BLUEPRINT` (`PORT`, `SCHEDULER_ENABLED`) and `RUNS_ON_ITS_CODE_DEFAULT` (the tunables in `config.ts`). The test reads `render.yaml` with a strict line reader that throws on an `envVars` line it does not know. The rest of ADR-0034 holds: one committed blueprint for both services from `main`, values of `sync: false` variables, domains and the plan in the dashboard, `FROM-DASHBOARD-…` placeholders filled by the adoption runbook, the database outside (ADR-0035).

## Consequences

The measured hop count and the runtime are now in git: a sync cannot replace them with stale dashboard values, and Render's default can no longer move Node under production. A Node upgrade is one commit changing `.node-version` and both `NODE_VERSION` values, which the test forces to agree. A fixed value overwrites the dashboard on every sync, so each must equal what production runs; the adoption runbook gains a comparison step, and until the blueprint is connected the same values must be set by hand on the Environment pages. A new variable now fails the test until it is added to the code, `env.example` and `render.yaml` together, or to an exclusion list; a new tunable costs one line in `RUNS_ON_ITS_CODE_DEFAULT`, accepted as debt. The source scan misses a read written in another form, which the guard test turns into a failure rather than a silent gap. The strict reader handles only the shapes this file uses; a new `render.yaml` construct inside `envVars` fails the test until the reader learns it.

Revisit this if the configuration moves to a `loadConfig(env)` that a recording environment can observe, if CI arrives (then `autoDeployTrigger: checksPass`, and the backlog's Docker move), or if Render changes how `NODE_VERSION` or fixed values sync.

## Alternatives considered

- **Keep every variable `sync: false` (ADR-0034)** — leaves the measured hop count and the runtime outside git, and a sync could later restore a stale dashboard value.
- **A `Proxy` around the settings loader, as the convention's test does** — silently misses the eleven modules that read `process.env` themselves.
- **Refactor configuration into `loadConfig(env)`** — touches a dozen modules and their tests for a deployment check.
- **`.node-version` files in `server/` and `client/`** — three files to keep equal, and Render's docs do not confirm they are read there.
- **`engines.node` in both `package.json` files** — the lowest precedence, so a dashboard `NODE_VERSION` silently overrides it, and it changes npm's install warnings.
- **`NODE_VERSION` alone, without `.node-version`** — leaves nothing for local tools and nothing for the test to compare against.
- **A major-only Node pin** — lets Render move minor versions under production.
- **A YAML parser as a new dev dependency** — a dependency decision for one test; a strict line reader suffices for this file.

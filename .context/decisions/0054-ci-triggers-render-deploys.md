---
id: ADR-0054
title: Trigger both Render deploys from CI's deploy job through deploy hooks pinned to the checked commit, with Render's own auto-deploy off
status: accepted
date: 2026-11-07
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [deployment]
tags: ["render", "ci", "deploy-hook"]
---

# ADR-0054 · Trigger both Render deploys from CI's deploy job through deploy hooks pinned to the checked commit, with Render's own auto-deploy off

## Context

ADR-0047 had Render deploy each service with `autoDeployTrigger: checksPass`. Render auto-deploys a service with a root directory only when the pushed changes touch that directory, and on a push of several commits it appears to look at the last commit alone. Twice a service silently stayed on old code: once after a push whose last commit was docs-only, once when the last commit touched only `server/` while earlier commits in the push changed `client/`. A change confined to `shared/` or `scripts/` deployed neither service. The owner chose on 2026-11-07 to have CI trigger both deploys after green checks.

## Decision

`.github/workflows/ci.yml` gets a `deploy` job that runs only on a push to `main`, `needs: [server, client]`, and calls each service's Render deploy hook (repository secrets `RENDER_DEPLOY_HOOK_API` and `RENDER_DEPLOY_HOOK_WEBSITE`) with `ref=<commit SHA>`, so Render builds exactly the commit CI checked. It fails red, naming the secret, when a secret is missing or a hook does not answer 200 or 202, and never prints a hook URL. Deploy jobs run one at a time (concurrency group `render-deploy`), and a job whose commit is no longer the head of `main` deploys nothing, so a late run cannot roll production back. Both services in `render.yaml` set `autoDeployTrigger: "off"`. The `server` and `client` jobs are unchanged and stay the ruleset's required checks. ADR-0047's gate (deploy only after both checks pass, the builds and the migration check in CI) still holds; only its trigger is replaced.

## Consequences

Every green push to `main` deploys both services, whatever it touched, so a docs-only push rebuilds both (same code, a few minutes of build). Deploys now depend on the two secrets: they must exist before the commit that sets `off` reaches `main`, or nothing deploys until they are added and the job re-run; a regenerated hook URL must be pasted again. Render no longer reads GitHub checks, so another app's failing check (Dependabot) no longer blocks a deploy. A Render rollback lasts only until the next green push. Manual Deploy in the dashboard still works and skips CI.

## Alternatives considered

- **Keep `checksPass` and add the hook calls**: no dependency on the secrets for the common case, but every push that touches a service's directory deploys that commit twice, and the backend build runs `prisma migrate deploy` twice; with Render's default overlapping-deploy policy the second deploy can cancel the first mid-build.
- **Keep `checksPass` and add `buildFilter.paths`** (the backlog item): fixes `shared/` and `scripts/`, but not the last-commit-only evaluation that caused both misses.
- **Squash every push to `main` into one commit**: a rule people must remember, and a docs-only last commit would still skip both services.

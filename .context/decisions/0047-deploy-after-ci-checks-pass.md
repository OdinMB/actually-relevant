---
id: ADR-0047
title: Deploy both Render services only after the commit's GitHub checks pass, with both builds and a migration check in CI
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [deployment, testing, data]
---

# ADR-0047 · Deploy both Render services only after the commit's GitHub checks pass, with both builds and a migration check in CI

## Context

Every push to `main` deployed both services to production (`autoDeployTrigger: commit`), and the backend build applies every pending migration to the production database. CI existed (ADR-0044) but was advisory: a commit with failing tests, a broken build or a migration that drops the pgvector index still went live, and a broken build was first seen in Render's log. The owner approved making CI the gate on 2026-10-19, together with running both production builds in CI and a check on new migrations.

## Decision

Both services in `render.yaml` set `autoDeployTrigger: checksPass`: Render deploys a commit on `main` only when all of its GitHub checks have passed, and deploys nothing for a commit with a failing check or no checks. `.github/workflows/ci.yml` runs on every push and pull request with no path filter, and its `server` and `client` jobs now also run both `npm run build` scripts (the client's with its puppeteer prerender) and `npm run check:migrations`. That check fails on any migration that drops `stories_embedding_idx` without re-creating it, and on `DROP TABLE`, `TRUNCATE` or any `ALTER ... DROP` in a migration added since the base branch unless the file carries `-- reviewed-destructive: <reason>`. Requiring the checks before merging is a GitHub ruleset the owner sets; it is documented, not encoded (`.context/deployment.md`, "CI gate").

## Consequences

A deploy now starts a CI run's length after the push. A red `main` deploys nothing until a later commit is green, and that deploy carries everything since the last one. A path filter or `[skip ci]` on `main` would leave a commit undeployed, and any GitHub app that adds its own check to commits gates deploys too. A manual deploy from the dashboard still bypasses the checks, which keeps a way to ship past a broken check. CI cannot see production data, so a migration that fails only there still fails in the Render build. A destructive migration needs a person to add the marker, which is the point.

## Alternatives considered

- **Keep `commit` and treat CI as advisory**: no delay, but a red commit reaches production, migrations included.
- **Deploy from GitHub Actions with a Render deploy hook**: full control over ordering, but a secret in CI, and the Blueprint would have to set `off`, losing Render's own trigger.
- **Gate only through branch protection**: stops red merges into `main`, not a red direct push, and the owner pushes to `main` directly.
- **Block every destructive statement in every migration**: the historical drops would fail, and a reviewed two-phase drop would need an exception list kept apart from the migration it excuses.

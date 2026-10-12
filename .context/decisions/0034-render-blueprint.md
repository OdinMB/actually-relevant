---
id: ADR-0034
title: Declare both Render services in one committed render.yaml, naming every variable and keeping values in the dashboard
status: superseded
superseded-by: ADR-0036
date: 2026-10-13
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [handover]
---

# ADR-0034 · Declare both Render services in one committed render.yaml, naming every variable and keeping values in the dashboard

## Context

The backend web service and the static site were configured only in the Render dashboard: build and start commands, root directories, the health check path, the order-sensitive `/sitemap.xml`, `/podcast.xml` and SPA rewrites, and the environment variables. The README and `.context/deployment.md` described those settings by hand, so drift between the dashboard and the prose went unnoticed, nobody could review a settings change, and a lost or misconfigured service had to be rebuilt from prose.

The owner's standing convention for Render projects is a committed blueprint per deployed service, naming its variables with their values kept in the dashboard, deploying from `main`. Render reads one blueprint file per repository by default, and both services build from this repository. When a blueprint is connected to existing services, Render matches entries to services by name; a `value:` on a variable is rewritten on every sync, while a `sync: false` variable is prompted for only when the blueprint is first created. The exact service names and the backend's region were not known from the repository; the rewrites' backend host is the API's custom domain, `api.actuallyrelevant.news` (ADR-0019).

## Decision

We declare the backend (`runtime: node`, root `server`) and the static site (`runtime: static`, root `client`) in one `render.yaml` at the repository root, both deploying from `main` on every commit. It is the source of truth for the services' settings: commands, root directories, the health check, the rewrite rules and their order, and the names of the environment variables production sets. Every variable is named with `sync: false`, including non-secrets, and the file never carries a `value:`. Values and secrets, custom domains and the instance plan stay in the dashboard. Settings the repository cannot know are committed as `FROM-DASHBOARD-…` placeholders, filled in from the dashboard's generated blueprint by the adoption runbook in `.context/deployment.md` before a blueprint is connected. The database is outside this decision (ADR-0035).

## Consequences

Service settings are now reviewable in git and restorable from the file, and the README no longer has to reconstruct them. Once a blueprint is connected, a dashboard edit to a field the file declares is overwritten on the next sync, so settings changes must go through the file. Adding a variable takes two steps, a `sync: false` entry and a value set by hand in the dashboard, because later syncs never prompt. The committed file is a draft until the owner runs the adoption runbook; until then the dashboard stays the source of truth and the placeholders are deliberately invalid, so a premature connection fails validation or shows "create" on Render's review screen rather than reconfiguring production. Two omitted fields are not kept on adoption (`buildFilter` is emptied, `previews` turned off), so the runbook has to copy them from the generated blueprint. No CI validates the file; `render blueprints validate` is a manual step.

Revisit this if a service moves off Render, if a third deployed service joins the repository, or if Render changes how blueprints adopt existing services or treat `sync: false`.

## Alternatives considered

- **Keep the dashboard as the source of truth and document it better** — the status quo, and drift between the dashboard and its description was the problem.
- **Commit the dashboard-generated blueprint verbatim** — only the owner can produce it; it is used as the inventory to fill and diff the committed file instead.
- **Two blueprint files with custom paths, one per service** — two blueprints to connect and keep in step, for no gain while both services build from one repository.
- **`value:` for non-secrets such as `NODE_ENV`** — rewritten on every sync, silently undoing any dashboard change.
- **`fromService` for `VITE_API_URL`** — no property gives another service's public URL, and production uses a custom API domain.
- **Waiting for the owner's inventory before writing the file** — would block the implementation and gains nothing, since the owner diffs against the generated blueprint anyway.

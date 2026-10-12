---
plan-id: 2026-10-12_render-blueprint
title: Declare the backend and the static site in a committed Render blueprint and adopt the live services into it
status: implemented
created: 2026-10-12
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [handover]
decisions:
  - ref: .context/decisions/0034-render-blueprint.md
  - ref: .context/decisions/0035-database-outside-blueprint.md
type: refactor
complexity: complex
---

# Render blueprint for the backend and the static site

Confirmed by Odin Mühlenbein on 2026-10-12: every decision this plan states

Companion to `.plans/2026-10-12_trust-proxy-client-ip.md`. It lands after that plan, in the same branch or the next one: the blueprint names `TRUST_PROXY`, which that plan introduces. Both plans keep `TRUST_PROXY`'s value in the dashboard, so neither depends on the other's rollout order.

## Problem

Both Render services are configured only in the dashboard: build and start commands, root directories, the health check path, the order-sensitive `/sitemap.xml` and SPA rewrites, and the environment variables. The README and `.context/deployment.md` describe them by hand, so drift between them goes unnoticed and nobody can review a settings change. A lost or misconfigured service has to be rebuilt from prose.

## Approach

**One `render.yaml` at the repository root, declaring the two deployed services (ADR-0034).** The owner's standing convention is a committed blueprint per deployed service, with variables named, values kept in the dashboard, and deploys from `main`. Render reads one blueprint file per repository by default, and both services build from this repository, so one file holds both entries. Two files with custom blueprint paths would be two blueprints to connect and keep in step, for no gain.

**The database stays out (ADR-0035).** Render adopts an existing resource whose name matches a blueprint entry. A database entry that does not match exactly could create a second, empty database. Render's docs also say that a resource deleted by hand while a blueprint manages it is recreated on the next sync. `fromDatabase` would give `DATABASE_URL` a link instead of a pasted value, but that saving does not justify any risk to the production data.

So the file has no `databases:` section, and `DATABASE_URL` is named with `sync: false`. Render keeps existing variables, so its value stays where it is.

Alternatives rejected:
- **Adopting the database by its exact name, with no destructive fields.** Safe if every field matches, but one typo stands between the plan and an empty database.
- **Referencing it without managing it.** `fromDatabase` on a database the blueprint doesn't manage is not documented as supported.

A plan reviewer argued this is a scoping detail that ADR-0034 could absorb. It stays a separate stub: the owner asked for this choice to be made and justified, and "why isn't the database in the blueprint?" is the question a later reader will ask.

**What Render does when a blueprint adopts live services** (docs read 2026-10-12: blueprint-spec, infrastructure-as-code, redirects-rewrites, deploys, node-version). This drives the runbook.

- **Matching is by name.** An entry whose `name` matches an existing service applies the file's configuration to that service. Type and region cannot change after creation, so they must match too. The docs don't say when the creation flow adopts a service and when it creates a duplicate with a suffix. **The review screen's change list is the gate:** cancel on any "create" for a service that already exists.
- **Fields left out of the file.** Most keep their current value: `plan`, `autoDeployTrigger`, the subdomain policy and the IP allow list. Two don't. Leaving out `buildFilter` *empties* an existing filter. Leaving out `previews` disables previews. The commands have no "retains" rule, so the file states them exactly as the dashboard runs them today.
- **Environment variables.** Variables absent from the file are kept. A `value:` is overwritten on every sync. A `sync: false` variable is prompted for only when the blueprint is first created and ignored afterwards. The docs don't say whether that first prompt pre-fills, or could blank, a value already set on an adopted service. The runbook handles that case.
- **Routes and headers.** They merge rather than replace: dashboard rules that the file lacks are kept. The docs don't say how the file's routes are ordered against the kept rules. The runbook checks the rule list right after the sync.
- **Custom domains.** `domains:` has no documented retain behavior for adopted services. The file leaves it out, so custom domains stay a dashboard setting.
- **Downtime.** A sync redeploys the affected services. Web services and static sites redeploy with zero downtime unless a persistent disk is attached. A failed deploy leaves the previous one serving.
- **Disconnecting.** "Changes to a Blueprint never cause a resource to be deleted": disconnecting the blueprint leaves every service intact. That is the rollback.
- **Generate Blueprint.** The dashboard can generate a `render.yaml` from selected existing services. The runbook uses it as the exact inventory, which is how the dashboard-only values reach the committed file.

**What the file contains.**

Backend, `type: web`:
- `runtime: node`
- `name` and `region`: placeholders
- `rootDir: server`
- `buildCommand`: the README's command
- `startCommand: npm start`
- `healthCheckPath: /health`
- `branch: main`
- `autoDeployTrigger: commit`
- `plan` left out, so the current plan is kept
- `envVars`, each with `sync: false`:
  - required: `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`, `FRONTEND_URL`, `NODE_ENV`
  - URLs and keys: `SITE_URL`, `CLIENT_URL`, `API_URL`, `PUBLIC_API_KEY`, `FORM_TOKEN_SECRET`
  - Plunk: `PLUNK_SECRET_KEY`, `PLUNK_PUBLIC_KEY`, `PLUNK_FROM_EMAIL`, `PLUNK_FROM_NAME`, `PLUNK_TEST_SEGMENT_ID`
  - extraction: `EXTRACTION_API`, `DIFFBOT_TOKEN`, `PIPFEED_API_KEY`
  - social: `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `BLUESKY_AUTO_POST_ENABLED`, `MASTODON_URL`, `MASTODON_TOKEN`, `MASTODON_AUTO_POST_ENABLED`
  - operations: `WEBHOOK_URL`, `LOG_LEVEL`, `TRUST_PROXY`

Static site, `type: web`:
- `runtime: static`
- `name`: placeholder
- `rootDir: client`
- `buildCommand: npm install && npm run build`
- `staticPublishPath`: `dist`, corrected from the generated blueprint if that differs (the docs leave open whether the path is relative to `rootDir`)
- `branch: main`
- `autoDeployTrigger: commit`
- `routes`, in this order:
  1. rewrite `/sitemap.xml` to `https://FROM-DASHBOARD-backend-host/api/sitemap.xml`
  2. rewrite `/*` to `/index.html`
- `envVars`: `VITE_API_URL` with `sync: false`

**The committed file is a deliberate draft until the owner fills it.** The repository cannot know the exact service names, the backend's region or the sitemap destination's host. The implementer writes each as a literal `FROM-DASHBOARD-<what>` string, with a comment saying where to copy it from. Each placeholder fails closed:

- an invalid region fails `render blueprints validate`;
- a placeholder name would create a new service, and the review screen stops that before anything changes.

The draft is harmless on `main`: Render ignores `render.yaml` until a blueprint is connected. No guessed value can quietly reconfigure production. The comment notes the backend's onrender host in `server/src/lib/openapi.ts` (`actually-relevant-api`) as a hint for its name, but the file doesn't use it as the value. Waiting for the owner's inventory before implementing was the alternative. It would block an unattended implementer and gains nothing, since the owner diffs against the generated file anyway.

**Which variables are named.** The names come from two sources:

- the code: the list above, every variable the deployment sets that the code reads;
- the generated blueprint: any other variable the dashboard actually sets, added in the runbook.

The roughly 60 tunables in `server/src/config.ts` that have code defaults are not pre-listed. `config.ts` documents them, and naming ones production never sets would mislead. The same goes for `LOG_DIR`, `LOG_RETENTION_DAYS`, `FAVICON_DIR` and `NODE_VERSION`: they are named only if the dashboard sets them. `PORT` is left out because Render sets it.

Every entry uses `sync: false`, even non-secrets like `NODE_ENV=production`. That follows the owner's convention, and a `value:` would be rewritten on every sync, silently undoing a dashboard change. `render.yaml` owns the list of names. The README's variable tables stay as descriptions of what each one does.

**Validation, kept light.** The first line of `render.yaml` is `# yaml-language-server: $schema=https://render.com/schema/render.yaml.json`, so editors with the YAML extension flag schema errors for free. The runbook runs `render blueprints validate render.yaml` (Render CLI v2.7.0+, authenticated; exits non-zero on failure) before applying. A vitest check would need a YAML parser, which is a new dependency, for a file that changes a few times a year, and the repository has no CI.

**Docs.**
- **`.context/deployment.md`** becomes the operating reference: `render.yaml` owns service settings, and the dashboard holds values, custom domains, the plan and the database.
- **The adoption runbook** below goes there too, as "Adopting the services into the blueprint". It is the procedure for the first adoption and for any re-adoption after a disconnect, so it doesn't go stale once used. Render's own field semantics are not restated; the file links to the blueprint spec.
- **README's "Deploying to Render.com"** keeps the database step and points at `render.yaml` for the two services.

**The trust-proxy plan** is edited only where it says there is no `render.yaml`. Its `TRUST_PROXY` handling is unchanged, with the measured value set in the dashboard. When both plans are implemented, the implementer words the trust-proxy plan's deployment-doc line on `TRUST_PROXY` as "named in `render.yaml` with `sync: false`, value set in the dashboard".

**Alternatives considered:**
- **Keep the dashboard as the source of truth and document it better.** This is the status quo, and drift is the problem.
- **Commit the dashboard-generated blueprint verbatim.** Only the owner can produce it. It is used as the inventory and diff instead.
- **`fromService` for `VITE_API_URL`.** No property gives another service's public URL, and production uses a custom API domain.
- **Pinning `NODE_VERSION`.** This is a separate concern from declaring settings. It is noted as later work.
- **Moving migrations to `preDeployCommand`.** That changes behavior and is paid-plan only.

Separate architect agents were not spawned. The owner's convention fixes the shape, and the open questions were Render's adoption semantics, which research settled as far as the docs allow.

## Runbook: adopting the live services

The owner runs this after merge. The implementer also writes it into `.context/deployment.md`. Allow 30 minutes and watch both services. It can come before or after the trust-proxy rollout. Before keeps one change at a time.

**A. Inventory (nothing changes yet).**

1. In the dashboard, select the backend web service and the static site, **not the database**, and click **Generate Blueprint**. Save the YAML as `DOCS/2026-10-12_render-generated-blueprint.yaml` (gitignored) and keep it until step 13. It lists variables as `sync: false` without values. If any value does appear, delete the file after step 13.
2. Record, per service, from the generated file and each Settings tab:
   - exact name, type and region; plan, instance count and scaling;
   - branch and auto-deploy setting;
   - root directory, build command, start command, pre-deploy command and health check path;
   - max shutdown delay, build filter and pull-request previews;
   - persistent disk (name, mount path and size);
   - the publish directory;
   - every redirect, rewrite and header rule, in order, noting whether `/sitemap.xml` already sits above `/*`;
   - every environment variable *name*;
   - custom domains (they stay in the dashboard);
   - whether `NODE_VERSION`, `LOG_DIR`, `LOG_RETENTION_DAYS` or `FAVICON_DIR` are set.
3. Edit the committed `render.yaml`:
   1. **Placeholders.** Replace each `FROM-DASHBOARD-…` with the generated value.
   2. **Commands and paths.** Diff the build command, start command, root directories, publish path and health check against the generated ones. Where they differ, the generated value wins, because it is what production runs.
   3. **Variables.** Add every variable name the dashboard has and the file lacks, as `sync: false`.
   4. **Copied blocks.** Copy exactly as generated any build filter (left out, it would be emptied), pre-deploy command, disk, header rule or extra route the dashboard has. If previews are on, copy the `previews` block too (left out, previews turn off).
   5. **Auto-deploy.** If it is off today, either accept `commit`, which is the convention, or set `off` on purpose.
4. Run `render blueprints validate render.yaml`, then commit and push `main`. With no blueprint connected, Render deploys the commit as usual.

**B. Apply.**

5. Go to New → Blueprint, connect this repository, and choose branch `main` and path `render.yaml`. Name the blueprint `actually-relevant`.
6. **Gate:** on the review screen, every service must show as an update to an existing service. Cancel if any service shows as "create" or carries a name suffix, or if any database appears. Nothing has changed yet. Fix the name in the file and start again.
7. If the screen asks for `sync: false` values, check each against the service's Environment tab:
   - **The variable already exists:** paste its current value. Never leave it blank.
   - **The variable doesn't exist:** leave it empty only if the README marks it optional.
8. Click Deploy Blueprint. Both services redeploy with zero downtime, unless a persistent disk is attached, in which case expect a short gap on the backend.

**C. Verify, straight after the deploys finish.**

9. Open the static site's Redirects/Rewrites tab. It must list `/sitemap.xml` above `/*`, plus only the extra rules copied in step 3, with no duplicates. Fix the order and delete duplicates now: until you do, a wrong order serves the SPA shell at `/sitemap.xml`.
10. Run `curl -I https://actuallyrelevant.news/sitemap.xml`. It must return XML from the backend.
11. Run `curl https://<backend-host>/health`. It must return `{"status":"ok"}`. Then load the site and log in to the admin, which proves `JWT_SECRET`, CORS and cookies. Run the trust-proxy `/health/client-ip` check if that plan is live.
12. Each service's custom domains must still be listed and verified, and each Environment tab must still hold every variable with a value.
13. Each Settings tab must match the step-2 record, apart from intended changes. Then delete the generated file if it held any values.

**D. Rollback.**

- **Before step 8:** cancel. Nothing has changed.
- **After step 8:**
  1. Use each affected service's **Rollback** to its last pre-blueprint deploy. Rollback restores code and build only, not settings.
  2. Under Blueprints, disconnect `actually-relevant`. No resource is deleted.
  3. Restore any changed setting from the step-2 record in the dashboard.
  4. **Turn auto-deploy back on** for each rolled-back service, because a manual rollback switches it off. Confirm it in Settings.
- **While a blueprint manages a service,** never delete it to start over: the next sync recreates it. After a disconnect, the dashboard is the source of truth until you run this runbook again.

## Changes

| File | Change |
|------|--------|
| `render.yaml` (new) | The schema comment line, a header comment, and the two `services:` entries as in Approach. The header says: values, secrets, the database, custom domains and the plan live in the dashboard; `FROM-DASHBOARD-…` strings are filled by the adoption runbook in `.context/deployment.md`; never add `value:`. No `databases:`, `domains:` or `value:` entries. *Responsibility:* declares the backend's and static site's Render service settings. *Exports:* none. |
| `.context/deployment.md` | **Edits:** The intro now says `render.yaml` owns service settings, and the dashboard holds values, custom domains, the plan and the database (ADR-0034, ADR-0035). The build-command table points at `render.yaml`. In lines 12, 14 and 16, "dashboard build command", "the dashboard's own install" and "the dashboard command's own `npm install --include=dev`" become the build command in `render.yaml`. The Key Files row "README.md \| Render dashboard settings per service" becomes `render.yaml` \| service settings. **New sections:** "Changing deployment settings": edit `render.yaml`, not the dashboard, since a dashboard edit to a declared field is overwritten on the next sync; add a variable as a `sync: false` entry, then set its value in the dashboard, because later syncs never prompt; never delete a managed service; validate with `render blueprints validate`; link to Render's blueprint spec. "Adopting the services into the blueprint": the runbook above, with its rollback. |
| `.context/seo.md` | "Render Rewrite Rule": the rule lives in `render.yaml` `routes`, still first. Keep the warning that no static `sitemap.xml` may exist. |
| `README.md` | "Deploying to Render.com": (1) the database, created by hand with pgvector, unchanged; (2) the backend and static site come from `render.yaml` via New → Blueprint, filling the prompted values. A new deployment changes the `FROM-DASHBOARD-…` names, region and sitemap host to its own. The backend and frontend field tables and the rewrite-rules table become a pointer to `render.yaml`. The variable tables stay as descriptions. "Post-deploy Steps" drops "Add the `/sitemap.xml` rewrite rule". Troubleshooting's "Missing `Root Directory`" points at `render.yaml`. Existing services: see `.context/deployment.md`. |
| `BACKLOG.md` | One entry: add `buildFilter.paths` covering each service's directory plus `shared/**` and `scripts/**`. With a root directory set, Render auto-deploys a service only for changes inside it, so a change confined to `shared/` or `scripts/install-dev-deps.mjs` redeploys neither service. |
| `.plans/2026-10-12_trust-proxy-client-ip.md` | Already edited during planning. Its two "no `render.yaml`" sentences now say that plan creates none and this plan names `TRUST_PROXY` with `sync: false`. |

## Tests

No tests: this change is static configuration and documentation. `render blueprints validate` and the review-screen gate are the checks.

## Out of Scope

- Managing the database, its plan or its backups through the blueprint (ADR-0035).
- Custom domains in the blueprint.
- Moving `prisma migrate deploy` from the build command to `preDeployCommand`.
- Changing the instance plan, the region or the Node version, or pinning Node.
- A CI job or vitest check for `render.yaml`.
- The build-filter fix for `shared/` and `scripts/`, which goes to `BACKLOG.md` instead.
- New security headers for the static site, beyond copying any that already exist.

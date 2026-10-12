# Deployment

Render.com runs three services: the PostgreSQL database, the backend web service (root `server/`) and the frontend static site (root `client/`). The root `render.yaml` blueprint owns the two services' settings: commands, root directories, health check, rewrite order and the names of their environment variables. The dashboard holds the variables' values, custom domains, the instance plan and the database, which the blueprint deliberately leaves out. Decision records: [ADR-0034](decisions/0034-render-blueprint.md), [ADR-0035](decisions/0035-database-outside-blueprint.md).

Until the adoption runbook below has been run, the blueprint is a draft: its `FROM-DASHBOARD-…` placeholders stand for the exact service names and the backend's region, and the dashboard stays the source of truth.

**Auto-deploy from `main`.** Both the backend and the static site deploy automatically on every push to `main`, at the same time and in no guaranteed order. A push to `main` is therefore a production release: the backend build runs `prisma migrate deploy`, so every migration committed since the last deploy is applied to the production database. Nothing is staged in between. A change that needs the backend live before the frontend (a new endpoint the client calls, a required env var) must keep the new client working against the old backend for the minutes in between, or land in two pushes. On the static site, `VITE_*` values are baked in at build time, so changing one needs a rebuild.

| Service | Root | Build command (in `render.yaml`) |
|---------|------|----------------------------------|
| Backend (web service) | `server` | `npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build` |
| Frontend (static site) | `client` | `npm install && npm run build` |

## Why the builds install devDependencies and pin `tsc`

On 2026-09-24 chosenpath's Render build broke (fixed in chosenpath commit `100c457`): Render installed with devDependencies omitted under `NODE_ENV=production`, so the build's bare `tsc` fell through to a global TypeScript 7 on Render's PATH, which rejects options such as `baseUrl` (the client tsconfig uses it). Here the backend runs with `NODE_ENV=production` too, and both builds need devDependencies: with them omitted, npm still installs TypeScript (and, in `server/`, the Prisma CLI, both optional peers of `@prisma/client`), but not the type packages (`@types/*`, Vite's and Vitest's types), so `tsc` fails with type errors. Rehearsed on 2026-09-25: the old client build fails that way under `NODE_ENV=production`, and so does the backend when its build command lacks `--include=dev`.

So both `build` scripts start with `node ../scripts/install-dev-deps.mjs`, which runs `npm install --include=dev` in the package, whatever the build command in `render.yaml` is (the script also sidesteps an npm quirk on Windows, described in the file). Then they call `node node_modules/typescript/bin/tsc`, never bare `tsc`, and print its version first: a missing install fails loudly instead of silently using another compiler, and the Render log shows which compiler ran. Upgrade TypeScript through the lockfiles, not the platform's PATH.

The backend's `npx prisma generate` and `npx prisma migrate deploy` run before `npm run build`, so they rely on the `render.yaml` build command's own `npm install --include=dev`. Keep it: without it they currently still find the lockfile's Prisma through `@prisma/client`'s optional peer dependency, but if that ever changes, `npx` would fetch `prisma@latest` instead.

On success the build logs show:

- Backend: `✔ Generated Prisma Client (v6.19.3)`, then `> node ../scripts/install-dev-deps.mjs && node node_modules/typescript/bin/tsc --version && node node_modules/typescript/bin/tsc`, npm's install summary (`up to date` after the build command's own install), and `Version 5.9.3`.
- Frontend: `> node ../scripts/install-dev-deps.mjs && node node_modules/typescript/bin/tsc --version && ...`, npm's install summary, `Version 5.9.3`, then `vite v7.3.5 building client environment for production...`.

The versions are the lockfiles' (`client/package-lock.json`, `server/package-lock.json`); a different version in the log means the lockfile changed.

## Scheduler during deploys

A zero-downtime deploy runs the old and the new backend side by side for a while, both with the scheduler on. The job lease on each `job_runs` row (ADR-0017, `.context/scheduler.md`, "Overlap prevention") keeps them from running the same job at once: a boot catch-up on the new instance while the old one's cron run is mid-flight is skipped quietly. The old instance releases its leases on SIGTERM; one killed without that release blocks its jobs for at most the lease length, 2 minutes by default (`JOB_LEASE_SECONDS`, renewed every `JOB_LEASE_RENEW_SECONDS`, 30; ADR-0020). Neither needs setting on Render. Any extra process pointed at the production database (a one-off shell, a second service) should run with `SCHEDULER_ENABLED=false`, so that it schedules nothing; its admin Run button still works, fenced by the same lease.

## ffmpeg on the backend

The podcast assembles its MP3 with `ffmpeg-static` (exact version `5.3.0` in `server/package.json`), whose install script downloads a static ffmpeg binary (about 76 MB on Linux) into `server/node_modules/ffmpeg-static/` during `npm install`. Render's native Node runtime has no system ffmpeg, so a build that skips install scripts (`--ignore-scripts`) would leave the podcast unable to reach `ready` ("ffmpeg binary not found"). Measured on Render on 2026-10-06: joining and loudness-normalising a 5-minute episode took 16.5 s with a 73 MB ffmpeg peak, well inside the instance's memory. The podcast's environment variables (`ELEVENLABS_API_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`) are described in `.context/podcast.md`.

## Client IPs behind Cloudflare and Render

Requests reach the backend through Cloudflare and then one or more of Render's internal proxies. Express derives `req.ip` from `X-Forwarded-For` (XFF) by trusting a fixed number of hops, `TRUST_PROXY` (`config.trustProxyHops`, default 1). With N hops, `req.ip` is the entry N steps left of the socket address: for XFF `a, b, c`, N=1 gives `c`, N=2 gives `b`. Every rate limiter (search, which pays for embedding calls; subscribe; feedback and its stored `ipHash`; login; refresh; the general and expensive-op limiters) keys on `req.ip`, so the count matters both ways:

- **Too low:** `req.ip` is a proxy address and visitors share every bucket. That is a cost and availability problem.
- **Too high:** a visitor picks their own bucket by sending `X-Forwarded-For`, because Cloudflare appends to a client-sent XFF rather than replacing it. That silently bypasses every limit.

`TRUST_PROXY` accepts only a plain non-negative integer; anything else (`true`, an address list, `2abc`) stops startup, so on Render the previous deploy keeps serving. No Render document gives the count; reports from Render users suggest 2 or 3. Decision record: [ADR-0033](decisions/0033-trusted-proxy-hop-count.md).

**The check.** `GET /health/client-ip` returns the caller's own view of their request (`ip`, `cloudflareIp` from `CF-Connecting-IP`, raw `forwardedFor`, `trustProxyHops`, `matchesCloudflare`) with `Cache-Control: no-store`, and stores and logs no address. Cloudflare sets `CF-Connecting-IP` and overwrites any value a visitor sends, so it is the ground truth. One request with a spoofed header tests both directions:

```bash
curl -s -H "X-Forwarded-For: 203.0.113.7" https://<backend-host>/health/client-ip
```

- **Correct count:** `matchesCloudflare: true`.
- **Too low:** `ip` is a proxy address and `matchesCloudflare` is `false`.
- **Too high:** `ip` is `203.0.113.7` and `matchesCloudflare` is `false`.

The right count is the position of `cloudflareIp` in `forwardedFor`, counted from the right with the rightmost entry as 1. Run the check against both hostnames the backend answers on, the `onrender.com` one and the custom API domain, `api.actuallyrelevant.news` (ADR-0019). If they need different counts, no single value is right; make the backend reachable through one path only rather than picking a compromise.

**Rollout, and again after any change of domain, proxy or Render plan:**

1. Deploy. With the default of 1, behavior is unchanged.
2. Run the `curl` above against both hostnames. Expect `matchesCloudflare: false` and an `ip` that is not your own. Count `cloudflareIp`'s position in `forwardedFor` from the right.
3. Set `TRUST_PROXY` to that count (expect 2 or 3). It is named in `render.yaml` with `sync: false`, value set in the dashboard: the backend's Environment tab. Render redeploys.
4. Run the `curl` again against both hostnames. Expect `matchesCloudflare: true`, and `ip` must not be `203.0.113.7`.

## Changing deployment settings

- **Edit `render.yaml`, not the dashboard,** for any field the file declares. Once a blueprint is connected, a dashboard edit to a declared field is overwritten on the next sync.
- **A new variable** goes in as a `sync: false` entry, and its value is set in the dashboard's Environment tab: Render prompts for `sync: false` values only when the blueprint is first created, never on later syncs. Never add a `value:`, which is rewritten on every sync.
- **Never delete a service the blueprint manages** to start over: the next sync recreates it. Disconnect the blueprint first; disconnecting deletes nothing.
- **Validate before pushing:** `render blueprints validate render.yaml` (Render CLI v2.7.0+, logged in; exits non-zero on failure). The file's first line points editors with the YAML extension at Render's schema.
- Field semantics: Render's [blueprint spec](https://render.com/docs/blueprint-spec).

## Adopting the services into the blueprint

The procedure for the first adoption, and for any re-adoption after a disconnect. Allow 30 minutes and watch both services. Render matches a blueprint entry to an existing service by name (type and region must match too), merges routes and headers with the dashboard's rather than replacing them, keeps variables the file lacks, and redeploys the affected services with zero downtime unless a persistent disk is attached. Two omitted fields are not kept: leaving out `buildFilter` empties an existing filter, and leaving out `previews` turns previews off.

**A. Inventory (nothing changes yet).**

1. In the dashboard, select the backend web service and the static site, **not the database**, and click **Generate Blueprint**. Save the YAML as `DOCS/<date>_render-generated-blueprint.yaml` (gitignored) and keep it until step 13. It lists variables as `sync: false` without values; if any value does appear, delete the file after step 13.
2. Record, per service, from the generated file and each Settings tab:
   - exact name, type and region; plan, instance count and scaling;
   - branch and auto-deploy setting;
   - root directory, build command, start command, pre-deploy command and health check path;
   - max shutdown delay, build filter and pull-request previews;
   - persistent disk (name, mount path and size);
   - the publish directory;
   - every redirect, rewrite and header rule, in order, noting whether `/sitemap.xml` and `/podcast.xml` already sit above `/*` and which host their destinations name;
   - every environment variable *name*;
   - custom domains (they stay in the dashboard);
   - whether `NODE_VERSION`, `LOG_DIR`, `LOG_RETENTION_DAYS` or `FAVICON_DIR` are set.
3. Edit `render.yaml`:
   1. **Placeholders.** Replace each `FROM-DASHBOARD-…` with the generated value.
   2. **Commands and paths.** Diff the build command, start command, root directories, publish path and health check against the generated ones. Where they differ, the generated value wins, because it is what production runs.
   3. **Variables.** Add every variable name the dashboard has and the file lacks, as `sync: false`.
   4. **Copied blocks.** Copy exactly as generated any build filter, pre-deploy command, disk, header rule or extra route the dashboard has. If previews are on, copy the `previews` block too.
   5. **Auto-deploy.** If it is off today, either accept `commit`, which is the convention, or set `off` on purpose.
4. Confirm `grep -n FROM-DASHBOARD render.yaml` prints nothing. Then run `render blueprints validate render.yaml`, commit and push `main`. With no blueprint connected, Render deploys the commit as usual.

**B. Apply.**

5. Go to New → Blueprint, connect this repository, and choose branch `main` and path `render.yaml`. Name the blueprint `actually-relevant`.
6. **Gate:** on the review screen, every service must show as an update to an existing service. Cancel if any service shows as "create" or carries a name suffix, or if any database appears. Nothing has changed yet. Fix the name in the file and start again.
7. If the screen asks for `sync: false` values, check each against the service's Environment tab:
   - **The variable already exists:** paste its current value. Never leave it blank.
   - **The variable doesn't exist:** leave it empty only if the README marks it optional.
8. Click Deploy Blueprint. Both services redeploy with zero downtime, unless a persistent disk is attached, in which case expect a short gap on the backend.

**C. Verify, straight after the deploys finish.**

9. Open the static site's Redirects/Rewrites tab. It must list `/sitemap.xml` and `/podcast.xml` above `/*`, plus only the extra rules copied in step 3, with no duplicates. Fix the order and delete duplicates now: until you do, a wrong order serves the SPA shell at `/sitemap.xml` or `/podcast.xml`.
10. Run `curl -I https://actuallyrelevant.news/sitemap.xml` and `curl -I https://actuallyrelevant.news/podcast.xml`. Both must return XML from the backend.
11. Run `curl https://<backend-host>/health`. It must return `{"status":"ok"}`. Then load the site and log in to the admin, which proves `JWT_SECRET`, CORS and cookies. Run the `/health/client-ip` check above.
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

## Key Files

| File | Purpose |
|------|---------|
| `render.yaml` | Service settings for the backend and the static site, and their variable names |
| `scripts/install-dev-deps.mjs` | The `npm install --include=dev` step of both builds |
| `client/package.json` | `build`: install devDependencies, pinned `tsc -b`, `vite build` (with prerender) |
| `server/package.json` | `build`: install devDependencies, pinned `tsc` |
| `server/src/config.ts` | `parseTrustProxyHops`, `trustProxyHops` |
| `server/src/routes/health.ts` | `GET /health/client-ip` check |

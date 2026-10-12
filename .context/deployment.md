# Deployment

Render.com runs three services: the PostgreSQL database, the backend web service (root `server/`) and the frontend static site (root `client/`). The root `render.yaml` blueprint owns the two services' settings: names, the backend's region and plan, custom domains, commands, root directories, health check, rewrite order and the environment variables production sets. Its service-level settings mirror Render's own export of the live services (backend `actually-relevant-api`, Frankfurt, plan `starter`, domain `api.actuallyrelevant.news`; static site `actually-relevant`, domains `actuallyrelevant.news` and `www.actuallyrelevant.news`, `onrender.com` subdomain disabled), because Render's docs say that on adoption every setting the file leaves out is overridden by its default. Each variable is in one of two modes:

- **A fixed `value:`** for settings that are not secret and are the same on every host: `NODE_ENV=production`, `TRUST_PROXY=2` and `NODE_VERSION=22.22.0` (both services). A sync writes it over the dashboard, so it must equal what production runs.
- **`sync: false`** for secrets (including `FEEDBACK_IP_HASH_SECRET`), canonical addresses (`FRONTEND_URL`, `API_URL`, `VITE_API_URL`), switches (`SUBSCRIPTIONS_ENABLED`, `*_AUTO_POST_ENABLED`, `AUTH_COOKIE_SAMESITE`) and values production sets that the repository cannot see (`CONCURRENCY_CRAWL_FEEDS`, `CONCURRENCY_CRAWL_ARTICLES`). Their values live in the dashboard.

The dashboard also holds the database, which the blueprint deliberately leaves out. `server/src/blueprint.test.ts` holds `render.yaml`, `.node-version`, `server/env.example` and `client/env.example` to the variables the code reads (a source scan of `process.env.NAME`, `env("…")` in the Prisma schema, and `import.meta.env.VITE_*` in the client), and checks that the backend lists the domain the rewrites target. A new variable goes into the code, `server/env.example` (or `client/env.example`) and `render.yaml` together, or into one of the test's three exclusion lists with its reason: `NOT_IN_BLUEPRINT` (`PORT`, `SCHEDULER_ENABLED`), `RUNS_ON_ITS_CODE_DEFAULT` (the tunables in `config.ts`) or `NOT_SET_IN_PRODUCTION` (`SITE_URL`, `CLIENT_URL`, `PUBLIC_API_KEY`, `FORM_TOKEN_SECRET`, `PLUNK_FROM_NAME`, `EXTRACTION_API`, `WEBHOOK_URL`, `LOG_LEVEL`: production did not set them as of 2026-10-13, and each read treats an empty value like an unset one). Setting one of those in production means moving it into `render.yaml`. Decision records: [ADR-0036](decisions/0036-fixed-values-and-blueprint-test.md) (superseding [ADR-0034](decisions/0034-render-blueprint.md)), [ADR-0038](decisions/0038-mirror-render-service-settings.md) (domains and plan in the file, replacing that part of ADR-0034 and ADR-0036), [ADR-0035](decisions/0035-database-outside-blueprint.md).

Until a blueprint is connected (runbook below, part B), Render ignores the file and the dashboard stays the source of truth.

**Auto-deploy from `main`.** Both the backend and the static site deploy automatically on every push to `main`, at the same time and in no guaranteed order. A push to `main` is therefore a production release: the backend build runs `prisma migrate deploy`, so every migration committed since the last deploy is applied to the production database. Nothing is staged in between. A change that needs the backend live before the frontend (a new endpoint the client calls, a required env var) must keep the new client working against the old backend for the minutes in between, or land in two pushes. On the static site, `VITE_*` values are baked in at build time, so changing one needs a rebuild.

| Service | Root | Build command (in `render.yaml`) |
|---------|------|----------------------------------|
| Backend (web service) | `server` | `npm install --include=dev && npx prisma generate && npx prisma migrate resolve --applied 20260209120000_add_feed_region && npx prisma migrate deploy && npm run build` |
| Frontend (static site) | `client` | `npm install && npm run build` |

The backend's `migrate resolve --applied 20260209120000_add_feed_region` step is a leftover from a one-off migration fix that production's dashboard command still carried at adoption; `render.yaml` copies it exactly so that adoption changes nothing. Removing it is a separate change.

## Why the builds install devDependencies and pin `tsc`

On 2026-09-24 chosenpath's Render build broke (fixed in chosenpath commit `100c457`): Render installed with devDependencies omitted under `NODE_ENV=production`, so the build's bare `tsc` fell through to a global TypeScript 7 on Render's PATH, which rejects options such as `baseUrl` (the client tsconfig uses it). Here the backend runs with `NODE_ENV=production` too, and both builds need devDependencies: with them omitted, npm still installs TypeScript (and, in `server/`, the Prisma CLI, both optional peers of `@prisma/client`), but not the type packages (`@types/*`, Vite's and Vitest's types), so `tsc` fails with type errors. Rehearsed on 2026-09-25: the old client build fails that way under `NODE_ENV=production`, and so does the backend when its build command lacks `--include=dev`.

So both `build` scripts start with `node ../scripts/install-dev-deps.mjs`, which runs `npm install --include=dev` in the package, whatever the build command in `render.yaml` is (the script also sidesteps an npm quirk on Windows, described in the file). Then they call `node node_modules/typescript/bin/tsc`, never bare `tsc`, and print its version first: a missing install fails loudly instead of silently using another compiler, and the Render log shows which compiler ran. Upgrade TypeScript through the lockfiles, not the platform's PATH.

The backend's `npx prisma` steps run before `npm run build`, so they rely on the `render.yaml` build command's own `npm install --include=dev`. Keep it: without it they currently still find the lockfile's Prisma through `@prisma/client`'s optional peer dependency, but if that ever changes, `npx` would fetch `prisma@latest` instead.

On success the build logs show:

- Both services, near the top: Render's Node line, `Using Node.js version 22.22.0 (from NODE_VERSION)` or similar on the backend and `Installing Node.js version 22.22.0...` on the static site. Any other version means `NODE_VERSION` differs from `.node-version`.
- Backend: `✔ Generated Prisma Client (v6.19.3)`, then `> node ../scripts/install-dev-deps.mjs && node node_modules/typescript/bin/tsc --version && node node_modules/typescript/bin/tsc`, npm's install summary (`up to date` after the build command's own install), and `Version 5.9.3`.
- Frontend: `> node ../scripts/install-dev-deps.mjs && node node_modules/typescript/bin/tsc --version && ...`, npm's install summary, `Version 5.9.3`, then `vite v7.3.5 building client environment for production...`.

The versions are the lockfiles' (`client/package-lock.json`, `server/package-lock.json`); a different version in the log means the lockfile changed.

## Node version

Both services run one exact Node version, `22.22.0`, the version production ran when it was pinned on 2026-10-12 (until then Render's default, which changes over time). Two places carry it, and `server/src/blueprint.test.ts` checks that they agree:

- **`NODE_VERSION`, a fixed value on both services in `render.yaml`.** Render reads it before any version file, so it holds whatever Render does with a `rootDir` (Render's docs do not say whether `.node-version` is read from the repository root or from `server/` and `client/`; not verified). Until the blueprint is connected, the same value is set by hand on both services' Environment pages.
- **`.node-version` at the repository root,** for local tools (fnm, nvm, Volta, asdf).

An upgrade changes `.node-version` and both `NODE_VERSION` values in one commit, and sets the dashboard values to match until the blueprint is connected. Use an exact `major.minor.patch`: a major-only pin lets Render move minor versions under production.

## Scheduler during deploys

A zero-downtime deploy runs the old and the new backend side by side for a while, both with the scheduler on. The job lease on each `job_runs` row (ADR-0017, `.context/scheduler.md`, "Overlap prevention") keeps them from running the same job at once: a boot catch-up on the new instance while the old one's cron run is mid-flight is skipped quietly. The old instance releases its leases on SIGTERM; one killed without that release blocks its jobs for at most the lease length, 2 minutes by default (`JOB_LEASE_SECONDS`, renewed every `JOB_LEASE_RENEW_SECONDS`, 30; ADR-0020). Neither needs setting on Render. Any extra process pointed at the production database (a one-off shell, a second service) should run with `SCHEDULER_ENABLED=false`, so that it schedules nothing; its admin Run button still works, fenced by the same lease.

## ffmpeg on the backend

The podcast assembles its MP3 with `ffmpeg-static` (exact version `5.3.0` in `server/package.json`), whose install script downloads a static ffmpeg binary (about 76 MB on Linux) into `server/node_modules/ffmpeg-static/` during `npm install`. Render's native Node runtime has no system ffmpeg, so a build that skips install scripts (`--ignore-scripts`) would leave the podcast unable to reach `ready` ("ffmpeg binary not found"). Measured on Render on 2026-10-06: joining and loudness-normalising a 5-minute episode took 16.5 s with a 73 MB ffmpeg peak, well inside the instance's memory. The podcast's environment variables (`ELEVENLABS_API_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`) are described in `.context/podcast.md`.

## Client IPs behind Cloudflare and Render

Requests reach the backend through Cloudflare and then one or more of Render's internal proxies. Express derives `req.ip` from `X-Forwarded-For` (XFF) by trusting a fixed number of hops, `TRUST_PROXY` (`config.trustProxyHops`, default 1). With N hops, `req.ip` is the entry N steps left of the socket address: for XFF `a, b, c`, N=1 gives `c`, N=2 gives `b`. Every rate limiter (search, which pays for embedding calls; subscribe; feedback; login; refresh; the general and expensive-op limiters) keys on `req.ip`, and feedback stores an HMAC-SHA256 of it keyed by `FEEDBACK_IP_HASH_SECRET` as `ipHash` ([ADR-0037](decisions/0037-feedback-ip-hmac.md); without the secret every feedback submission gets a 503 and nothing is stored; rows from before 2026-10-12 keep unkeyed hashes that never match new ones). So the count matters both ways:

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
3. Set `TRUST_PROXY` to that count (expect 2 or 3). It is a fixed value in `render.yaml`, `"2"` since the measurement on 2026-10-12 on both hostnames (XFF `spoof, client, cloudflare-edge`): change it there. Until the blueprint is connected, the dashboard value (the backend's Environment tab) applies and must also match; it is 2. Render redeploys.
4. Run the `curl` again against both hostnames. Expect `matchesCloudflare: true`, and `ip` must not be `203.0.113.7`.

## Changing deployment settings

- **Edit `render.yaml`, not the dashboard,** for any field the file declares. Once a blueprint is connected, a dashboard edit to a declared field is overwritten on the next sync.
- **A new variable** goes into the code, `server/env.example` and `render.yaml` together, or into one of the blueprint test's exclusion lists; the test fails otherwise. In `render.yaml` it takes a fixed `value:` only if it is not secret and is the same on every host, and `sync: false` otherwise. A `sync: false` value is set by hand on the service's Environment page: Render prompts for those only when the blueprint is first created, never on later syncs. Say so in the commit that adds one.
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
   - custom domains and the `onrender.com` subdomain setting (`renderSubdomainPolicy`);
   - whether `LOG_DIR`, `LOG_RETENTION_DAYS` or `FAVICON_DIR` are set; `NODE_VERSION` must equal `.node-version` on both services.
3. Edit `render.yaml`:
   1. **Service settings.** Diff the names, the backend's region and plan, `domains:` and `renderSubdomainPolicy` against the generated ones, and copy the generated values exactly (ADR-0038): Render matches services by name, and on adoption a setting the file leaves out is overridden by its default. On the first adoption (2026-10-13) the file carried `FROM-DASHBOARD-…` placeholders for the names and the region; a later re-adoption diffs the values already there.
   2. **Commands and paths.** Diff the build command, start command, root directories, publish path and health check against the generated ones. Where they differ, the generated value wins, because it is what production runs. The publish path is relative to the root directory (`dist`, not `client/dist`), as the 2026-10-13 export showed.
   3. **Variables.** Add every variable name the dashboard has and the file lacks, as `sync: false`, or as a fixed value if it is not secret and the same on every host, with the value read off the dashboard. If the name is in one of the blueprint test's `RUNS_ON_ITS_CODE_DEFAULT` or `NOT_SET_IN_PRODUCTION` lists, production sets it after all: move it from the list into the file. In the other direction, a name the file carries that the dashboard lacks is either something production is missing (find out before connecting) or a variable production runs without: then move it into `NOT_SET_IN_PRODUCTION` with its reason, so that the creation prompt cannot create it empty.
   4. **Fixed values.** Compare each fixed `value:` (`NODE_ENV`, `TRUST_PROXY`, both `NODE_VERSION`s) with the dashboard. They must be equal, since a sync writes them over the dashboard; where they differ, find out which is right before connecting.
   5. **Copied blocks.** Copy exactly as generated any build filter, pre-deploy command, disk, header rule or extra route the dashboard has. If previews are on, copy the `previews` block too.
   6. **Auto-deploy.** If it is off today, either accept `commit`, which is the convention, or set `off` on purpose.
4. Run the blueprint test (`npm run test --prefix server -- --run src/blueprint.test.ts`; it fails on any `FROM-DASHBOARD-…` placeholder left in a setting). Then run `render blueprints validate render.yaml`, commit and push `main`. With no blueprint connected, Render deploys the commit as usual.

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
11. Run `curl https://<backend-host>/health`. It must return `{"status":"ok"}`. Then load the site and log in to the admin, which proves `JWT_SECRET`, CORS and cookies. Run the `/health/client-ip` check above. Send one test message through the feedback form: it must succeed (a 503 means `FEEDBACK_IP_HASH_SECRET` is missing), then delete it in the admin.
12. Each service's custom domains must be exactly those in `render.yaml`, all verified, and each Environment tab must still hold every variable with a value. A variable that appears with an empty value was created by the step-7 prompt: delete it unless the README marks it required.
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
| `render.yaml` | Service settings for the backend and the static site, and their variables (fixed values or `sync: false`) |
| `server/src/blueprint.test.ts` | Holds `render.yaml`, `.node-version` and both `env.example` files to the variables the code reads |
| `.node-version` | The one Node version, for local tools; equals both `NODE_VERSION` values |
| `server/src/lib/feedbackIpHash.ts` | Keyed feedback IP hash; logs an error at boot when `FEEDBACK_IP_HASH_SECRET` is unset |
| `scripts/install-dev-deps.mjs` | The `npm install --include=dev` step of both builds |
| `client/package.json` | `build`: install devDependencies, pinned `tsc -b`, `vite build` (with prerender) |
| `server/package.json` | `build`: install devDependencies, pinned `tsc` |
| `server/src/config.ts` | `parseTrustProxyHops`, `trustProxyHops` |
| `server/src/routes/health.ts` | `GET /health/client-ip` check |

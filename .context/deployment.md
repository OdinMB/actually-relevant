# Deployment

Render.com runs three services: the PostgreSQL database, the backend web service (root `server/`) and the frontend static site (root `client/`). There is no `render.yaml`; the dashboard settings are the source of truth, and the README's "Deploying to Render.com" section documents them.

| Service | Root | Dashboard build command |
|---------|------|-------------------------|
| Backend (web service) | `server` | `npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build` |
| Frontend (static site) | `client` | `npm install && npm run build` |

## Why the builds install devDependencies and pin `tsc`

On 2026-09-24 chosenpath's Render build broke (fixed in chosenpath commit `100c457`): Render installed with devDependencies omitted under `NODE_ENV=production`, so the build's bare `tsc` fell through to a global TypeScript 7 on Render's PATH, which rejects options such as `baseUrl` (the client tsconfig uses it). Here the backend runs with `NODE_ENV=production` too, and both builds need devDependencies: with them omitted, npm still installs TypeScript (and, in `server/`, the Prisma CLI, both optional peers of `@prisma/client`), but not the type packages (`@types/*`, Vite's and Vitest's types), so `tsc` fails with type errors. Rehearsed on 2026-09-25: the old client build fails that way under `NODE_ENV=production`, and so does the backend when its dashboard command lacks `--include=dev`.

So both `build` scripts start with `node ../scripts/install-dev-deps.mjs`, which runs `npm install --include=dev` in the package, whatever the dashboard build command is (the script also sidesteps an npm quirk on Windows, described in the file). Then they call `node node_modules/typescript/bin/tsc`, never bare `tsc`, and print its version first: a missing install fails loudly instead of silently using another compiler, and the Render log shows which compiler ran. Upgrade TypeScript through the lockfiles, not the platform's PATH.

The backend's `npx prisma generate` and `npx prisma migrate deploy` run before `npm run build`, so they rely on the dashboard command's own `npm install --include=dev`. Keep it: without it they currently still find the lockfile's Prisma through `@prisma/client`'s optional peer dependency, but if that ever changes, `npx` would fetch `prisma@latest` instead.

On success the build logs show:

- Backend: `✔ Generated Prisma Client (v6.19.3)`, then `> node ../scripts/install-dev-deps.mjs && node node_modules/typescript/bin/tsc --version && node node_modules/typescript/bin/tsc`, npm's install summary (`up to date` after the dashboard's own install), and `Version 5.9.3`.
- Frontend: `> node ../scripts/install-dev-deps.mjs && node node_modules/typescript/bin/tsc --version && ...`, npm's install summary, `Version 5.9.3`, then `vite v7.3.5 building client environment for production...`.

The versions are the lockfiles' (`client/package-lock.json`, `server/package-lock.json`); a different version in the log means the lockfile changed.

## Scheduler during deploys

A zero-downtime deploy runs the old and the new backend side by side for a while, both with the scheduler on. The job lease on each `job_runs` row (ADR-0017, `.context/scheduler.md`, "Overlap prevention") keeps them from running the same job at once: a boot catch-up on the new instance while the old one's cron run is mid-flight is skipped quietly. The old instance releases its leases on SIGTERM; one killed without that release blocks its jobs for at most the lease length, 2 minutes by default (`JOB_LEASE_SECONDS`, renewed every `JOB_LEASE_RENEW_SECONDS`, 30; ADR-0020). Neither needs setting on Render. Any extra process pointed at the production database (a one-off shell, a second service) should run with `SCHEDULER_ENABLED=false`, so that it schedules nothing; its admin Run button still works, fenced by the same lease.

## ffmpeg on the backend

The podcast assembles its MP3 with `ffmpeg-static` (exact version `5.3.0` in `server/package.json`), whose install script downloads a static ffmpeg binary (about 76 MB on Linux) into `server/node_modules/ffmpeg-static/` during `npm install`. Render's native Node runtime has no system ffmpeg, so a build that skips install scripts (`--ignore-scripts`) would leave the podcast unable to reach `ready` ("ffmpeg binary not found"). Measured on Render on 2026-10-06: joining and loudness-normalising a 5-minute episode took 16.5 s with a 73 MB ffmpeg peak, well inside the instance's memory. The podcast's environment variables (`ELEVENLABS_API_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`) are described in `.context/podcast.md`.

## Key Files

| File | Purpose |
|------|---------|
| `scripts/install-dev-deps.mjs` | The `npm install --include=dev` step of both builds |
| `client/package.json` | `build`: install devDependencies, pinned `tsc -b`, `vite build` (with prerender) |
| `server/package.json` | `build`: install devDependencies, pinned `tsc` |
| `README.md` | Render dashboard settings per service |

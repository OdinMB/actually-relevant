# Deployment

Render.com runs three services: the PostgreSQL database, the backend web service (root `server/`) and the frontend static site (root `client/`). There is no `render.yaml`; the dashboard settings are the source of truth, and the README's "Deploying to Render.com" section documents them.

| Service | Root | Dashboard build command | What makes it independent of Render's install |
|---------|------|-------------------------|-----------------------------------------------|
| Backend (web service) | `server` | `npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build` | `--include=dev` in the dashboard command; `build` calls the pinned `tsc` |
| Frontend (static site) | `client` | `npm install && npm run build` | `build` installs devDependencies itself and calls the pinned `tsc` |

## Why the builds install devDependencies and pin `tsc`

On 2026-09-24 chosenpath's Render build broke (fixed in chosenpath commit `100c457`): Render installed with devDependencies omitted under `NODE_ENV=production`, so the build's bare `tsc` fell through to a global TypeScript 7 on Render's PATH, which rejects options such as `baseUrl` (the client tsconfig uses it). Here TypeScript, Vite, the Prisma CLI and the prerenderer are devDependencies too, and the backend runs with `NODE_ENV=production`. So the client `build` script runs `npm install --include=dev` itself (`client/scripts/install-dev-deps.mjs`, which also sidesteps an npm quirk on Windows described in the file), whatever the dashboard build command is. The backend's dashboard build command has to keep its leading `npm install --include=dev`: `npx prisma generate` and `npx prisma migrate deploy` run before `npm run build`, and without a local Prisma CLI `npx` would fetch `prisma@latest` instead of the lockfile's Prisma 6. Both `build` scripts call `node node_modules/typescript/bin/tsc`, never bare `tsc`, and print its version first: a missing install fails loudly instead of silently using another compiler, and the Render build log shows which compiler ran. Upgrade TypeScript through the lockfiles, not the platform's PATH.

On success the build logs show:

- Backend: `✔ Generated Prisma Client (v6.19.3)`, then `> node node_modules/typescript/bin/tsc --version && node node_modules/typescript/bin/tsc` followed by `Version 5.9.3`.
- Frontend: `> node scripts/install-dev-deps.mjs && node node_modules/typescript/bin/tsc --version && ...`, npm's install summary, then `Version 5.9.3` and `vite v7.3.5 building client environment for production...`.

The versions are the lockfiles' (`client/package-lock.json`, `server/package-lock.json`); a different version in the log means the lockfile changed.

## Key Files

| File | Purpose |
|------|---------|
| `client/package.json` | `build`: install devDependencies, pinned `tsc -b`, `vite build` (with prerender) |
| `client/scripts/install-dev-deps.mjs` | The `npm install --include=dev` step of the client build |
| `server/package.json` | `build`: pinned `tsc` |
| `README.md` | Render dashboard settings per service |

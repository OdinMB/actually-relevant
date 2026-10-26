# Actually Relevant

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Looking for Maintainer](https://img.shields.io/badge/looking%20for-maintainer-orange)](https://actuallyrelevant.news/stewardship)

News that matter to humanity. Curated with care by AI.

Crawls news sources, assesses relevance with structured AI analysis, and publishes curated stories.

## Tech Stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS
- **Backend:** Express + TypeScript + LangChain + OpenAI
- **Database:** PostgreSQL + pgvector (Prisma ORM)
- **Deployment:** Render.com

## Local Development

### Prerequisites

- Node.js 18+ and npm
- Docker (for the local PostgreSQL + pgvector database)
- OpenAI API key

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/OdinMB/actually-relevant.git
   cd actually-relevant
   ```

2. Install dependencies:
   ```bash
   cd client && npm install
   cd ../server && npm install
   ```

3. Start the database (PostgreSQL 17 + pgvector on `localhost:5433`, database `actually_relevant_dev`):
   ```bash
   docker compose up -d
   ```

4. Configure environment variables:
   ```bash
   cp server/env.example server/.env   # then fill in the values
   cp client/env.example client/.env
   # Required at minimum: DATABASE_URL, OPENAI_API_KEY, JWT_SECRET, FRONTEND_URL;
   # FEEDBACK_IP_HASH_SECRET too if you use the feedback form.
   # The template's comment gives the Docker database's DATABASE_URL
   #   (postgresql://ardev:...@localhost:5433/actually_relevant_dev, see docker-compose.yml)
   # and how to generate the secrets.
   # See server/src/config.ts for all available settings and their defaults.
   ```

5. Start development servers:
   ```bash
   # Terminal 1 — Frontend (localhost:5173)
   cd client && npm run dev

   # Terminal 2 — Backend (localhost:3001)
   cd server && npm run dev
   ```

   Starting the backend first applies any pending migrations and regenerates the Prisma client if the schema changed (`npm run db:prepare`, also runnable on its own). It only does this when `DATABASE_URL` points at this machine (`localhost`, `127.0.0.1` or `::1`); for any other host it warns and skips. Set `SKIP_DB_PREPARE=1` to skip it. A failing migration stops the backend from starting. See [`.context/database-migrations.md`](.context/database-migrations.md).

6. Optional: to run against made-up content instead (stories, newsletters, podcast episodes and an admin login, with no paid API calls), fill a separate local database with `npm run db:seed:synthetic --prefix server` and start the server against it with the run line in "Run Locally with Synthetic Data" ([`.context/database-migrations.md`](.context/database-migrations.md)), which replaces the email, social and other outbound credentials from `server/.env` with placeholders.

## Deploying to Render.com

This project requires **three services** on Render: a managed PostgreSQL database, an Express backend (web service), and a React frontend (static site). The backend and frontend run on separate origins.

The database is created by hand. The backend and the static site are declared in the [`render.yaml`](render.yaml) blueprint at the repository root: service names, region, instance plan, custom domains, commands, root directories, health check, rewrite rules and the environment variables production sets. Three non-secret settings that are the same on every host are fixed values in the file: `NODE_ENV=production`, `TRUST_PROXY=2` and `NODE_VERSION`, which pins Node on both services and equals the root `.node-version`. Every other value, and all secrets, stay in the dashboard. `server/src/blueprint.test.ts` holds the file to the code and both `env.example` files. Services that already exist are adopted into the blueprint with the runbook in [`.context/deployment.md`](.context/deployment.md).

### 1. PostgreSQL Database

1. Create a new PostgreSQL instance on Render
2. Note the **Internal Database URL** (used by the backend service)
3. Enable pgvector — connect to the database and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

### 2. Backend and Static Site

1. In `render.yaml`, replace the service names, the backend's region and plan, and the custom domains (`domains:`) with your own, and point the `/sitemap.xml` and `/podcast.xml` rewrites at your own backend host. Render matches services by name, so pick names no existing service in your account uses. Without a custom domain, remove the `domains:` lists and `renderSubdomainPolicy: disabled`, which would otherwise leave the site unreachable.
2. In the dashboard, go to New → Blueprint, connect the repository and choose `render.yaml` on `main`.
3. Fill in the prompted variable values. The tables below describe the main ones; the rest (newsletter, extraction, social posting) are optional and documented in `server/env.example`, `server/src/config.ts` and the matching `.context/` files. Render prompts for values only on this first creation; set later additions in each service's Environment tab.

### Backend (Web Service)

The build generates the Prisma client, applies any pending database migrations, and compiles TypeScript (its command is in `render.yaml`). Migrations run automatically on every deploy via `prisma migrate deploy`, which is a no-op when there are no pending migrations. `NODE_ENV=production` makes a plain `npm install` skip devDependencies, so the command installs them with `--include=dev`, and the `build` script installs them again itself and compiles with the lockfile's TypeScript (see `.context/deployment.md`).

**Environment Variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Internal PostgreSQL connection string from step 1 |
| `OPENAI_API_KEY` | Yes | OpenAI API key for LLM analysis |
| `FRONTEND_URL` | Yes | Frontend URL for CORS (e.g. `https://actuallyrelevant.news`) |
| `JWT_SECRET` | Yes | Random string (32+ chars) for signing auth tokens |
| `NODE_ENV` | Fixed in `render.yaml` | `production` (enables secure cross-origin cookies) |
| `NODE_VERSION` | Fixed in `render.yaml` | Exact Node version, equal to `.node-version` (`22.23.4`); set on both services |
| `PORT` | No | Render sets this automatically (defaults to 10000) |
| `PUBLIC_API_KEY` | No | Static key for partners of the public API: sent as `Authorization: Bearer <key>`, it raises the rate limit from 100 requests per 15 minutes per IP to 1,000 per 15 minutes for the key (`RATE_LIMIT_PUBLIC_API_KEY_MAX`). It grants no other access; unset, no key is accepted (`.context/authentication.md`) |
| `LOG_LEVEL` | No | Logging verbosity (default: `info`) |
| `SUBSCRIPTIONS_ENABLED` | No | `true` opens newsletter signups; unset or anything else keeps them paused (`.context/subscription.md`) |
| `TURNSTILE_SECRET_KEY` | For signups | Cloudflare Turnstile secret for the signup and feedback forms; without it, production refuses every signup, and feedback skips the check |
| `TRUST_PROXY` | Fixed in `render.yaml` | Proxy hops to trust for client IPs: `2`, measured on 2026-10-12 with the `/health/client-ip` check (code default `1`; see `.context/deployment.md`) |
| `FEEDBACK_IP_HASH_SECRET` | For feedback | Key for the hashed IP stored with feedback (64 hex characters: `openssl rand -hex 32`, or in Windows PowerShell `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b \| ForEach-Object { $_.ToString('x2') })`). Without it, feedback is refused |

**Architecture notes:**

- **Cron jobs** run in-process via node-cron — no separate worker service is needed. Job configuration lives in the `job_runs` database table and is managed from the admin dashboard.
- **Graceful shutdown** handles `SIGTERM` (sent by Render on deploy) by draining in-flight LLM tasks before disconnecting from the database.
- **Reverse proxy** trust is a hop count, `TRUST_PROXY`, because requests pass Cloudflare and then Render's proxies: `2` on Render, fixed in `render.yaml` (code default 1). Too low and visitors share rate limits; too high and a visitor can spoof their address. Verify it after deploy, and after any change of domain or proxy, with `GET /health/client-ip` (see `.context/deployment.md`).
- **Node** is pinned to one exact version by `NODE_VERSION` on both services and the root `.node-version` (for local tools); an upgrade changes all three in one commit, and the blueprint test enforces that they agree.
- **Cross-origin cookies** use `sameSite: 'none'` + `secure: true` in production, which is required while the frontend and backend are on different sites. This is why `NODE_ENV=production` is mandatory. The API answers at `api.actuallyrelevant.news` (same site as the frontend) since 2026-10-07; once the static site's `VITE_API_URL` points there and the admin works on it, set `AUTH_COOKIE_SAMESITE=strict`; see `.context/authentication.md`.

### Frontend (Static Site)

The `build` script installs devDependencies itself (`npm install --include=dev`, see `.context/deployment.md`), then type-checks, bundles with Vite, and prerenders public routes using Puppeteer. Render's build environment includes Chromium, so prerendering works without extra setup.

**Rewrite rules** are the static site's `routes` in `render.yaml`: `/sitemap.xml` and `/podcast.xml` to the backend's `/api/sitemap.xml` and `/api/podcast/feed.xml`, then the catch-all `/*` to `/index.html`. **Order is critical:** the `/sitemap.xml` and `/podcast.xml` rules must stay *before* the catch-all `/*` rule (Render evaluates rules top-to-bottom, first match wins). If reversed, the catch-all matches first and serves the SPA shell, resulting in a 404.

The sitemap rewrite proxies requests to the backend, which generates the sitemap dynamically from published stories. The podcast rewrite serves the podcast's RSS feed at its permanent public URL (`.context/podcast.md`). No static `sitemap.xml` or `podcast.xml` file should exist in `client/public/` — Render serves static files before applying rewrite rules.

**Environment Variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend URL (e.g. `https://api.actuallyrelevant.news`) |
| `VITE_TURNSTILE_SITE_KEY` | For signups | Cloudflare Turnstile site key for the newsletter and feedback forms |
| `NODE_VERSION` | Fixed in `render.yaml` | Same exact Node version as the backend, equal to `.node-version` |

### Post-deploy Steps

1. Set backend `FRONTEND_URL` to match the frontend URL (and vice versa for `VITE_API_URL`)
2. Database migrations run automatically during the build step — no manual action needed
3. Create the first admin user from the Render shell (in the service's root, `server/`):
   ```bash
   npm run admin:create
   ```
4. Verify the health endpoint: `curl https://<backend-url>/health`
5. Verify the sitemap: `curl https://<frontend-url>/sitemap.xml`

## Project Structure

```
actually-relevant/
├── client/          # React frontend
│   ├── src/         # Source code
│   ├── scripts/     # Build scripts (sitemap, images)
│   ├── dist/        # Built output (gitignored)
│   └── package.json
├── server/          # Express backend
│   ├── src/         # Source code
│   ├── prisma/      # Database schema and migrations
│   ├── dist/        # Built output (gitignored)
│   └── package.json
├── shared/          # Shared types and constants
├── scripts/         # Build helper shared by client and server (devDependency install)
├── .context/        # Subsystem docs (behavior and implementation) and the decision log
├── CONTRIBUTING.md  # Contribution guidelines
├── LICENSE          # AGPL v3
└── README.md        # This file
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, including how to set up the development environment, submit pull requests, and the project's lightweight contributor agreement.

## Stewardship

Actually Relevant is actively seeking a long-term institutional owner in journalism, civic tech, or effective altruism. If your organization could give this project a home, visit [actuallyrelevant.news/stewardship](https://actuallyrelevant.news/stewardship) to learn more.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). Organizations interested in running actuallyrelevant.news as a long-term steward can receive more accommodating license terms — see [Stewardship](https://actuallyrelevant.news/stewardship).

### AI-generated content markings

This software marks the content it generates as AI-generated in machine-readable form: the `aiGenerated` block on story objects in the public API, `data-ai-generated` attributes on story pages, and XMP metadata in the carousel images and PDF. See [`.context/ai-transparency.md`](.context/ai-transparency.md).

Please do not intentionally remove or tamper with the machine-readable markings (such as metadata or watermarks) that identify content generated by this software as AI-generated.

## Troubleshooting

### Build Fails
Check the build logs. Common issues:
- Wrong root directory: check `rootDir` in `render.yaml` (`server` for the backend, `client` for the static site)
- Node version mismatch — add `engines` to package.json if needed
- Missing `npx prisma generate` before server build

### API Calls Fail (CORS Error)
1. Verify `FRONTEND_URL` is set correctly on the backend
2. Ensure it matches exactly (including `https://`, no trailing slash)
3. Redeploy after changing environment variables

### Database Connection Fails
1. Verify `DATABASE_URL` is correct
2. Ensure pgvector extension is installed: `CREATE EXTENSION IF NOT EXISTS vector;`
3. Run migrations: `npx prisma migrate deploy`

### Health Check
```bash
curl https://api.actuallyrelevant.news/health
# Should return: {"status":"ok"}
```

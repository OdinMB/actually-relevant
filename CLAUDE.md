# Actually Relevant

AI-curated news platform that evaluates article relevance to humanity using LLM analysis. Crawls news sources, assesses relevance, and publishes curated content.

**Live site:** https://actuallyrelevant.news

## Implementation Workflow

**IMPORTANT**: Unless specified otherwise, follow the process outlined in the `/workflow` skill.

**Behavior is documented in `.context/`:** each subsystem's `.context/<topic>.md` states its rules and guarantees as well as how it is built. Read it while planning; when a change alters behavior, correct that file in the same change. Hard-to-reverse choices go in the ADR log (`.context/decisions.md`).

## Project Structure

```
actually-relevant/
├── client/          # React frontend (Vite + TypeScript + Tailwind)
├── server/          # Express backend (Prisma + LangChain + OpenAI)
├── shared/          # Shared types and constants
├── scripts/         # Build helper shared by client and server
├── .context/        # Subsystem docs -- behavior, how it's built and operated; ADR log
├── .plans/          # Active development plans
│   └── completed/   # Archive of all past plans (70+ files)
├── BACKLOG.md       # Deferred features
├── CLAUDE.md        # This file
└── README.md        # Project documentation
```

## Tech Stack

**Frontend:** Vite + React 18 + TypeScript, Tailwind CSS, react-helmet-async + @prerenderer, Vitest + RTL

**Backend:** Express + TypeScript, PostgreSQL + pgvector (Prisma ORM), LangChain + OpenAI (structured output with Zod), node-cron, Zod

**Deployment:** Render.com (static site + web service + PostgreSQL). **Every push to `main` deploys both services to production once CI passes on it**, including pending migrations (`.context/deployment.md`, "CI gate").

## Commands

**Assume the client dev server is already running** -- do not start it yourself. Use Playwright to verify visual changes.

Use `--prefix` for all npm commands:

```bash
npm run dev --prefix client           # Start client dev server
npm run build --prefix client         # Build (installs devDeps first, includes prerendering)
npm run typecheck --prefix client     # Type-check client (tsc --noEmit; fast, no prerender)
npm run test --prefix client -- --run # Run client tests
npm run dev --prefix server           # Start server with hot reload
npm run build --prefix server         # Build server (installs devDeps first)
npm run typecheck --prefix server     # Type-check server (tsc --noEmit)
npm run test --prefix server          # Run server tests
npm run test:db --prefix server       # PostgreSQL integration tests (needs TEST_DATABASE_URL, a local *_test database; fails without it)
npm run check:migrations --prefix server # Embedding-index drop anywhere, unmarked DROP/TRUNCATE in new migrations (CI)
npm run lint --prefix <client|server>          # ESLint, warnings fail (CI)
npm run format --prefix <client|server>        # Prettier write; CI runs format:check
npm run test:coverage --prefix <client|server> # Unit tests + coverage floor; raise thresholds, never lower (CI)
npm run audit:prod --prefix <client|server>    # npm audit --omit=dev at high, minus audit-allowlist.json (CI)
```

**Type-checking:** use `npm run typecheck --prefix <client|server>`. It's the canonical TS check and runs without a permission prompt. Do **not** invoke `tsc` via `node .../node_modules/typescript/bin/tsc` or bare `tsc` -- those are not allowlisted and force a confirmation.

### Database

```bash
npm run db:migrate:create --prefix server -- --name <name>  # Write migration SQL, don't apply
npm run db:prepare --prefix server    # Apply migrations + regenerate client if schema changed (local DB only)
npm run db:studio --prefix server     # Open Prisma Studio
```

**IMPORTANT database rules** (full workflow: `.context/database-migrations.md`):
- **Migrations apply automatically on server dev start** -- `predev` runs `db:prepare`, which only touches a local `DATABASE_URL` (Docker DB on `localhost:5433`). Author with `db:migrate:create`, review the SQL (delete any `DROP INDEX "stories_embedding_idx"`), then restart the dev server.
- **Never use `npx prisma` directly** -- use `npm run db:*` with `--prefix server`.
- **Never apply with `prisma migrate dev` / `npm run db:migrate`** -- DLL locks on Windows. `--create-only` is fine.
- **Never pass `--no-engine` to `prisma generate`** -- breaks all direct PostgreSQL queries.
- **`db:generate` requires the dev server to be stopped** -- `prisma generate` replaces a DLL that is locked while the server runs. Ask user to stop first.

## CI and deploy gate

- **CI must pass before Render deploys.** Both services use `autoDeployTrigger: checksPass`: a `main` commit deploys only once the `server` and `client` jobs of `.github/workflows/ci.yml` are green; a red `main` deploys nothing.
- **Pushes to `main` need green checks or the admin bypass** of the GitHub ruleset `no-nonsense-main` (required checks `server` and `client`, Repository admin bypass). A bypassing push prints `remote: Bypassed rule violations for refs/heads/main`; for this rule that is expected, not a broken pull-request rule.
- **Never rename a CI job** without changing the ruleset in the same step (the rule would wait for a check that never comes), and never path-filter or `[skip ci]` a push to `main`.
- **Before pushing, run what CI runs:** `npm run lint`, `npm run format` (CI runs `format:check`), `npm run test:coverage` (a floor; raise it, never lower it) in both packages, plus `check:migrations`, both typechecks, `test:db` and both builds.
- **`audit:prod` can turn `main` red with no code change.** Update the dependency, or add a reviewed entry to `server/audit-allowlist.json` / `client/audit-allowlist.json` (`.context/ci.md`, "Dependency audit").
- **A destructive migration statement** (DROP, TRUNCATE, ALTER … DROP) needs a `-- reviewed-destructive: <reason>` line, or `check:migrations` fails.
- Details: `.context/ci.md` (checks, triggers, minutes) and `.context/deployment.md`, "CI gate".

## Key Conventions

- **Prefer file tools over bash** -- Use Read, Write, Edit, Glob, Grep instead of cat, sed, grep, find.
- **Server config** -- All tunable constants centralized in `server/src/config.ts` with env var overrides. Each override goes through a parser that throws at startup on a bad value (`parseWholeNumber`, `parseOneOf`, …), never a bare `parseInt` (`.context/deployment.md`).
- **Logging** -- Use `createLogger('module')` from `server/src/lib/logger.ts`. Never `console.log` in application code (scripts exempt). See `.context/logging.md`.
- **Prompts** -- Read `.context/prompting.md` before modifying any prompt in `server/src/prompts/`. Reasoning-model conventions (declarative constraints, XML scaffolding); prompts are tuned for the GPT-6 defaults, so check a rating, dedup, social-post or selection prompt change with `eval:recalibrate` (`.context/model-eval.md`).
- **Retry logic** -- External HTTP calls use `withRetry()` from `server/src/lib/retry.ts`. LLM calls do not: the OpenAI SDK retries them (`maxRetries` in `createChatModel()`), and wrapping them too stacks retries (`.context/llm-analysis.md`, "Retries").
- **AI transparency (EU AI Act)** -- Changing an AI feature, model, AI label, model-written story field or export pipeline? Update `.context/ai-transparency.md` in the same change. It is the compliance record: feature inventory with model ids, labels and machine-readable markers, and the owner decisions still open. Visible AI label wording is owner-approved and lives only in `client/src/components/ai/aiDisclosureCopy.ts` and `server/src/lib/aiLabelCopy.ts`; don't change it without the owner, and render new story listings through `StoryCard`/`StoryTitleLabel` so they carry the "AI" badge.
- **American English** -- All UI text uses American English spelling ("analyzed" not "analysed").
- **Em dashes** -- One per paragraph max in user-facing copy.
- **Completed plans as context** -- `.plans/completed/` has 70+ plans. Search by topic before asking the user.

## Resilience

- **Retry logic**: `withRetry()` (3 retries, exponential backoff) for external HTTP calls; the OpenAI SDK's `maxRetries: 3` for LLM calls.
- **Graceful shutdown**: `server/src/index.ts` handles `SIGTERM`/`SIGINT`.
- **Route errors**: services throw `ServiceError` subclasses (`NotFoundError`, `BadRequestError`, `ConflictError`, … in `server/src/utils/errors.ts`), never errors a route matches by message; routes don't catch, they name their 500/404/409 texts with `failsWith()`, and the global handler answers (`.context/server-conventions.md`).
- **Request correlation**: Every request gets `X-Request-Id` header.
- **Health check**: `GET /health` verifies DB connectivity.

## API Documentation

- **OpenAPI spec** generated from Zod schemas in `server/src/lib/openapi.ts`
- When adding/modifying public API endpoints: update Zod schema, route definition in `openapi.ts`, add `.openapi()` metadata
- Verify with `npm run build --prefix server`

## Known Issues

- **Prisma client out of sync**: TS errors for `clusterId`, `storyCluster`, etc. are pre-existing. Fix: `npm run db:generate --prefix server`.
- **clusters.test.ts**: Pre-existing failure (`html-encoding-sniffer` ESM compat). Not code-related.
- **Windows vitest teardown**: `kill EPERM` errors are normal on Windows.

## UI & Testing Patterns

- **UI conventions** -- See `.context/ui-conventions.md` for SEO checklist, CSS utility classes, bundle splitting rules, accessibility requirements, and spelling rules.
- **Admin side panels**: `EditPanel` with `PANEL_BODY`/`PANEL_FOOTER` CSS classes.
- **Toast provider**: Components using `useToast()` need `<ToastProvider>` in tests.
- **Headless UI dialogs**: Use `getByRole('heading', { name: ... })` to disambiguate from buttons.
- **URL-persisted state**: Admin pages use `useSearchParams()` for state (e.g., `?open=id`).
- **Server tests**: `vi.hoisted()` for mocks, `supertest` + `authHeader()` for route tests. `_`-prefixed exports (`_resetShutdownState`, `_resetApiState`) exist for tests only; app code never calls them.

## Project Management (`pm/`)

Separate git repo for marketing, research, strategy. **Never write, edit, or create files in `pm/`**. Read only.

Key dirs: `pm/state/` (business context), `pm/backlog/` (priorities), `pm/plans/` (active/completed plans), `pm/references/` (research).

## Context Files (`.context/`)

Subsystem docs: behavioral rules and implementation reference. **Read the relevant file before modifying a subsystem.** See `.context/README.md` for conventions.

| File | Topic |
|------|-------|
| `story-pipeline.md` | Status transitions (`storyLifecycle.ts` is the only status writer; a test fences it), rejection reasons, jobs, admin endpoints, slugs, field reference |
| `content-extraction.md` | 3-tier extraction chain, crawl flow, conditional RSS, resource limits, adding feeds |
| `story-retention.md` | Monthly cleanup: which old stories are deleted or kept, the `story_archive_counts` roll-up, lifetime totals, cleared embeddings and how publishing restores them |
| `feed-management.md` | Feed CRUD and soft delete, crawl due rule, crawl-health counters, quality metrics, favicons |
| `llm-analysis.md` | Model tiers (GPT-6 defaults; prompts and models change together), prompt directory, schema-driven format, analysis stages |
| `model-eval.md` | Model-comparison eval harness: read-only fixtures, budget, rating sets (run before changing a model tier); `eval:recalibrate` for prompt recalibration and the phase-2 ship checks |
| `prompting.md` | Prompt conventions for the GPT-5/GPT-6 reasoning models and calibration lessons (read before modifying prompts) |
| `scheduler.md` | Job registry, overlap prevention (job lease), catch-up, `SCHEDULER_ENABLED`, concurrency, admin API |
| `task-queue.md` | Bulk LLM operations, polling, processing indicators |
| `newsletter-podcast.md` | Newsletter: create-assign-select-generate workflow, issue ordering, templates, Plunk sending, carousel |
| `decisions.md` | Architectural decision log: the index, with one file per decision in `.context/decisions/`; append-only history |
| `podcast.md` | Two-speaker podcast, weekly and standalone episodes (kind, person-chosen stories, copy gate): stages, lease, weekly run and blocks, interactive/automated modes, a person's edits and rewinds, progress toast, selection and dialogue rules (segues), ElevenLabs voicing, ffmpeg assembly, Bunny storage (never reuse a file name), spend cap, dry run, publish/unpublish rules, the RSS feed and `/podcast` page, admin endpoints, the Friday generate and Saturday (Berlin) auto-publish jobs |
| `authentication.md` | JWT flow, cookie config, token rotation and reuse rules, roles |
| `admin-notices.md` | Owner alerts: `notify()` records every alert as an admin notice (optional `WEBHOOK_URL` forward), dedupe and reopen, global seen, retention, no personal data; the hourly Plunk complaint and bounce poll |
| `subscription.md` | Double opt-in newsletter signup: server switch (`SUBSCRIPTIONS_ENABLED`), bot gate (honeypot, form token, Turnstile), per-address and hourly send limits, Plunk, contact cleanup |
| `admin-dashboard.md` | TanStack Query patterns, URL-persisted filters, bulk actions |
| `public-website.md` | Routes, positivity slider, RSS feeds, design system |
| `dedup.md` | Cluster model, primary election, auto-reject, admin cluster operations, pipeline integration |
| `embeddings.md` | Trigger points, hybrid RRF search, related stories and cache, backfill script |
| `ui-conventions.md` | SEO checklist, CSS classes, bundle splitting, accessibility, spelling |
| `accessibility.md` | Full WCAG 2.2 AA patterns, ARIA, forms, testing checklist |
| `seo.md` | Sitemap, Render rewrites, robots.txt, route registration, head-tag defaults (`DefaultSeo` + `data-rh` fallbacks in `index.html`), story link previews (story pages proxied through the backend, per-story `og.png`) |
| `images.md` | WebP optimization, size presets, CLI commands |
| `logging.md` | Pino config, error serialization, structured data, log levels |
| `server-conventions.md` | Route errors (typed `ServiceError`s, `failsWith()`, the one global handler), test-only `_` exports |
| `database-migrations.md` | Docker dev DB, automatic `db:prepare` on dev start (local-only guard, skip var, failure modes), authoring migrations, allowed/banned commands, the PostgreSQL integration tests (`*.db.test.ts`, `TEST_DATABASE_URL`, guard rules) and CI |
| `ci.md` | The CI checks Render waits for (lint, format, types with `noUncheckedIndexedAccess`, coverage ratchet, audit allowlist, builds): commands, rules turned off and why, what to do when `main` is red; triggers, cancelling, caches; measuring CI minutes and the levers if they ever matter |
| `deployment.md` | Render services and the `render.yaml` blueprint (service settings change there, not in the dashboard); why builds install devDependencies and pin `tsc` (read before touching build scripts or `render.yaml`, or adding an env var: `server/src/blueprint.test.ts` fails until it is in the code, `env.example` and `render.yaml`) |
| `bluesky.md` | AT Protocol auth, post format, auto-post, metrics |
| `mastodon.md` | Static token auth, shared social logic (candidates, metadata line, one post per story per channel), post format |
| `ai-transparency.md` | EU AI Act Art. 50 record: AI inventory, labels, machine-readable markers, text-watermark gap, open owner decisions |
| `client/.context/skeletons.md` | Skeleton components for loading states (prevents CLS) |

## Memory

All project memory lives in this `CLAUDE.md` file. Do not use or update the auto-memory file under `~/.claude/projects/`.

## Maintaining This File

Before restructuring or adding to this file, review [Anthropic's best practices](https://code.claude.com/docs/en/best-practices) (see "Write an effective CLAUDE.md"). Key rule: for each line, ask "would removing this cause Claude to make mistakes?" If not, cut it or move it to a `.context/` file.

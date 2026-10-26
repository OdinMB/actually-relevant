# CI checks

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`, with no path filter. Its two jobs, `server` and `client`, are the GitHub checks Render waits for before deploying `main` (`deployment.md`, "CI gate"; ADR-0047), and the required checks of the GitHub ruleset `no-nonsense-main`, so a red check here means nothing deploys. Every check below also runs locally with the same command.

| Check | Server | Client | Fails when |
|---|---|---|---|
| Migration check | `npm run check:migrations --prefix server` | | a migration drops `stories_embedding_idx`, or a new one holds an unmarked destructive statement (`database-migrations.md`, "Migration check") |
| Type-check | `npm run typecheck --prefix server` | `… client` | any `tsc` error; both tsconfigs set `strict` and `noUncheckedIndexedAccess`. The server's also checks the development seed in `prisma/` against the generated client (`prisma/tsconfig.json`, no emit), so a schema change the seed no longer matches fails here |
| Lint | `npm run lint --prefix server` | `… client` | any ESLint error or warning (`--max-warnings 0`) |
| Format | `npm run format:check --prefix server` | `… client` | a file Prettier would change; fix with `npm run format --prefix <pkg>` |
| Tests and coverage | `npm run test:coverage --prefix server` (unit and db projects, needs `TEST_DATABASE_URL`) | `… client` | a failing unit or db test (`database-migrations.md`, "Integration Tests"), or coverage below a threshold |
| Build | `npm run build --prefix server` | `… client` | the production build fails; the client's includes the puppeteer prerender |
| Dependency audit | `npm run audit:prod --prefix server` | `… client` | a production advisory at high or above that the allowlist does not excuse |

The build runs after the tests so a type or test failure is reported first; the audit runs last because it is the one check that can turn red without a code change (below).

## Type-check: `noUncheckedIndexedAccess`

An index into an array or a record is `T | undefined`. Guard it where the value can be missing (`const [first] = rows; if (!first) return null`, `.at(-1)?.id`, a destructuring default); use `!` only where an invariant makes it present (a bounded loop index, a regex group that always matches). Route params are the common case: `req.params.id!`. A typed middleware before the handler (`failsWith`, `validateBody`, a rate limiter) makes Express infer `ParamsDictionary` rather than the path's own params, so the type cannot see that `/:id` guarantees `id`.

## Lint

Flat configs in `server/eslint.config.js` and `client/eslint.config.js`: `@eslint/js` recommended, `typescript-eslint` recommended (not the type-checked presets), and on the client `eslint-plugin-react-hooks` 7 recommended. Deliberate departures, each commented in the config:

- **Both:** `no-unused-vars` ignores `_`-prefixed names, caught errors and keys dropped by a rest spread. `no-explicit-any` is off in tests and test fixtures (mocks stand in for typed collaborators).
- **Server:** `no-irregular-whitespace` skips regexes (number parsing matches no-break spaces, a CSV reader strips a BOM). `no-namespace` allows `declare global { namespace Express }`. Three inline `no-explicit-any` disables in source: pino's error serializer, the recursive OpenAPI issue schema, `req.parsedQuery`. A new inline disable states its reason after `--`.
- **Client:** off, from react-hooks 7's React Compiler rules: `set-state-in-effect` (9 effects that sync state from storage, the URL or loaded data; each rewrite is a behavior change to test on its own) and `static-components` (3 false positives on `getCategoryPattern()`, which returns a module-level component). `preserve-caught-error` is off in `src/` because the client's ES2020 lib has no `Error` `cause`; it stays on for `scripts/`. Two inline `react-hooks/exhaustive-deps` disables in source (`IssuePage`, `NoticesPage`), and two `no-empty-object-type` ones in `src/test/setup.ts` (the vitest-axe matcher type augmentation).

Turning one of these back on is a follow-up, not a CI change: fix the findings in the same commit.

## Format

Prettier 3, one config at the repository root (`.prettierrc.json`): no semicolons, single quotes, width 160, `arrowParens: avoid`, trailing commas. These match the code as it was written, chosen by measuring the reformat diff. Each package's `.prettierignore` leaves out build output, server logs, lockfiles, Markdown, `server/prisma/migrations/` (applied migrations stay byte-for-byte), `client/index.html` (build-time placeholders) and the static assets in `client/public/`. A line meant for one folder at the package root starts with `/`: without it the line matches every file or folder of that name, as `public/` once matched `client/src/layouts/public/` and left it unchecked. Files outside the two packages (root `scripts/`, the workflow) are not checked.

## Coverage floor

`test:coverage` runs the tests with v8 coverage and global thresholds. On the server it runs **both vitest projects, `unit` and `db`, in one run**, so the PostgreSQL tests count: a module whose guarantee lives in SQL is tested against the database and its mock test deleted ("replace, don't layer") without the figure dropping. Thresholds: server statements 73, branches 69, functions 68, lines 75, re-baselined once on 2026-10-25 when the db project joined the measurement (owner decision; unit alone had measured 69.78, 65.24, 64.09, 71.28, and the floor had been 69, 65, 63, 70); client 53, 53, 44, 53, set just below the value measured on 2026-10-19 after the Prettier reformat (which moves the line count, not the statement count), client functions raised on 2026-10-25 after dead code was removed. The measured values sit beside the thresholds in `server/vitest.config.ts` and `client/vite.config.ts`. It is a ratchet: when coverage rises, raise the threshold in the same change; never lower one to land a change. Reports go to `coverage/` (gitignored).

**The server's `test:coverage` needs `TEST_DATABASE_URL`** (`database-migrations.md`, "Integration Tests") and fails at once without it, with the same message as `test:db`, before any test runs. That is deliberate: a unit-only figure would sit below the floor and read as a regression, and CI, which has the database, is what enforces the floor. Without a database, `npm run test --prefix server` still runs the unit tests. In CI the one step replaces the separate unit-coverage and `test:db` steps; `test:db` stays as the quick local command for the db tests alone.

## Dependency audit

`audit:prod` (`scripts/audit-check.mjs`) runs `npm audit --omit=dev` and fails on any advisory at high or above unless the package's `audit-allowlist.json` excuses it. An entry names one advisory (GHSA id) in one package, a `via` package, a reason and a review date; it holds only while every production path to the package runs through `via`, and an entry that matches nothing fails the check so that it is deleted once the fix lands.

Entries on 2026-10-25 (the 2026-10-19 `braces` entry was deleted once the @scalar update no longer reported it; `body-parser` and `undici` were fixed by `npm audit fix` the same day):

- **Server:** `zod` (GHSA-mrhx-c7xc-m3w5, high; memory exhaustion validating a large array, fixed only in zod 4.6.6). zod 3 is a direct dependency, so the entry's `via` is `zod` itself and does not narrow anything; the reason is that request bodies are capped at 100kb by `express.json` and model output is bounded. It goes with a move to zod 4, which is the owner's call (every schema, `zod-openapi`, LangChain structured output).
- **Client:** `zod` (same advisory) via `@scalar/api-reference-react`, whose agent chat pulls in `ai` with zod 3.25; it runs in the visitor's browser on our own OpenAPI spec. `postcss-selector-parser` (GHSA-rj75-hqrm-r3gf) on @scalar's tailwindcss 3 path is moderate, below the bar, so it needs no entry.

**A new advisory can turn `main` red with no code change**, and while it is red nothing deploys. Then either update the dependency, or, after reviewing that the advisory does not reach the running app, add an allowlist entry with its reason; both are a commit to `main`, which deploys once green.

## Triggers and cancelling

- **Pull requests** run on every push to the pull request's branch. A push to any other branch without a pull request runs nothing; open a (draft) pull request to get checks.
- **`main`** runs on every push, unfiltered: Render deploys a `main` commit only once its checks pass and deploys nothing for a commit with no checks, so a path filter or `[skip ci]` on `main` would leave that commit undeployed.
- **Concurrency:** runs share the group `ci-<ref>`. A newer push to a pull request cancels the older run still going; runs on `main` are never cancelled (`cancel-in-progress` is false for `refs/heads/main`), so every `main` commit gets its own complete checks.
- **Timeouts:** each job stops after 20 minutes (`timeout-minutes`), so a hung prerender or test cannot burn the default six hours.
- **Caches:** npm's cache per package lockfile (`actions/setup-node`), and puppeteer's Chrome (`~/.cache/puppeteer`, keyed on `client/package-lock.json`), which `npm ci` then does not download again.

## CI minutes

The repository is public, and GitHub Actions on standard GitHub-hosted runners (`ubuntu-latest`) are free and unlimited for public repositories; the plan's included minutes (2,000 a month on GitHub Free, 3,000 on Pro) are spent only by private repositories, and larger runners are never free ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans); checked 2026-10-25 through search results, the docs site was not reachable from the session). The owner still wants CI frugal and measured, and the numbers change if the repository ever goes private.

**Measuring.**

- One run: Actions tab → the run → **Usage** (job durations and, for a private repository, billable time).
- From the command line: `gh run list --workflow CI --limit 20 --json databaseId,event,headBranch,conclusion,createdAt,updatedAt`, then `gh run view <id> --json jobs --jq '.jobs[] | [.name, .startedAt, .completedAt] | @tsv'` for each job's start and end.
- REST: `gh api repos/OdinMB/actually-relevant/actions/runs/<id>/timing` returns `run_duration_ms` and per-OS `billable` milliseconds (zero for a public repository).
- Account total: **Settings → Billing and licensing → Usage**, filtered to Actions.

**Baseline** (first runs, 2026-10-25, warm npm cache, cold puppeteer cache; `billable` was 0 ms, the repository being public):

| Run | `server` job | `client` job | Wall clock | Billed if private (each job rounded up to the minute) |
|-----|--------------|--------------|------------|------|
| Before the strictness checks (#39) | 2:01 | 2:24 | 2:25 | 6 min |
| With lint, format, coverage and audit (#40) | 1:49 | 2:54 | 2:57 | 5 min |

The heaviest steps are the client's unit tests (about 50 s) and its prerender build (about 45 s), and the server's unit tests (about 40–47 s). At about 6 billed minutes a run and two runs per merged change (its pull request and `main`), a private repository would spend roughly 12 minutes per merged change, plus 6 for every further push to an open pull request.

**What starts a run.** One run (two jobs in parallel) per push to a pull request and per push to `main`. Merging a pull request is a push to `main`, so a merged change runs once on its pull request and once more on `main`; the second run is what Render waits for. Dependabot's own "Dependabot Updates" runs are a separate workflow GitHub manages, not this one.

**Levers, if minutes ever matter** (none is needed while the repository is public):

1. Path filters on `pull_request` only (for example skip a docs-only pull request with `paths-ignore: ['**/*.md', '.plans/**']`), never on `push` to `main`. A required check that is skipped by a path filter never reports, so the ruleset would block the pull request; pair a filter with a stub job of the same name or drop the requirement first.
2. Run the db project (the Postgres service and its tests) only on `main`, or on pull requests that touch `server/`, accepting that a pull request can then merge with a db test red. The coverage floor now counts the db tests, so the runs without them would need their own, lower floor or none.
3. Skip the client's prerender on pull requests (build without it) and keep it on `main`, where Render's build would otherwise be the first to run it.
4. Draft pull requests: add `if: github.event.pull_request.draft == false` to the jobs and `types: [opened, synchronize, reopened, ready_for_review]` to the trigger.
5. Run lint and the format check in one short job ahead of the rest, so a formatting slip fails in a minute instead of after the tests.
6. Cancel superseded runs (already on) and keep the caches warm (already on).

Measure before and after any of these, and record the change here.

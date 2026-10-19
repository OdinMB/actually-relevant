# CI checks

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`, with no path filter. Its two jobs, `server` and `client`, are the GitHub checks Render waits for before deploying `main` (`deployment.md`, "CI gate"; ADR-0047), and the required checks of the GitHub ruleset `no-nonsense-main`, so a red check here means nothing deploys. Every check below also runs locally with the same command.

| Check | Server | Client | Fails when |
|---|---|---|---|
| Migration check | `npm run check:migrations --prefix server` | | a migration drops `stories_embedding_idx`, or a new one holds an unmarked destructive statement (`database-migrations.md`, "Migration check") |
| Type-check | `npm run typecheck --prefix server` | `… client` | any `tsc` error; both tsconfigs set `strict` and `noUncheckedIndexedAccess` |
| Lint | `npm run lint --prefix server` | `… client` | any ESLint error or warning (`--max-warnings 0`) |
| Format | `npm run format:check --prefix server` | `… client` | a file Prettier would change; fix with `npm run format --prefix <pkg>` |
| Unit tests and coverage | `npm run test:coverage --prefix server` | `… client` | a failing test, or coverage below a threshold |
| PostgreSQL tests | `npm run test:db --prefix server` | | a failing db test (`database-migrations.md`, "Integration Tests") |
| Build | `npm run build --prefix server` | `… client` | the production build fails; the client's includes the puppeteer prerender |
| Dependency audit | `npm run audit:prod --prefix server` | `… client` | a production advisory at high or above that the allowlist does not excuse |

The build runs after the tests so a type or test failure is reported first; the audit runs last because it is the one check that can turn red without a code change (below).

## Type-check: `noUncheckedIndexedAccess`

An index into an array or a record is `T | undefined`. Guard it where the value can be missing (`const [first] = rows; if (!first) return null`, `.at(-1)?.id`, a destructuring default); use `!` only where an invariant makes it present (a bounded loop index, a regex group that always matches). Route params are the common case: `req.params.id!`. A typed middleware before the handler (`failsWith`, `validateBody`, a rate limiter) makes Express infer `ParamsDictionary` rather than the path's own params, so the type cannot see that `/:id` guarantees `id`.

## Lint

Flat configs in `server/eslint.config.js` and `client/eslint.config.js`: `@eslint/js` recommended, `typescript-eslint` recommended (not the type-checked presets), and on the client `eslint-plugin-react-hooks` 7 recommended. Deliberate departures, each commented in the config:

- **Both:** `no-unused-vars` ignores `_`-prefixed names, caught errors and keys dropped by a rest spread. `no-explicit-any` is off in tests and test fixtures (mocks stand in for typed collaborators).
- **Server:** `no-irregular-whitespace` skips regexes (number parsing matches no-break spaces, a CSV reader strips a BOM). `no-namespace` allows `declare global { namespace Express }`. Three inline `no-explicit-any` disables in source carry their reason (pino's error serializer, the recursive OpenAPI issue schema, `req.parsedQuery`).
- **Client:** off, from react-hooks 7's React Compiler rules: `set-state-in-effect` (9 effects that sync state from storage, the URL or loaded data; each rewrite is a behavior change to test on its own) and `static-components` (3 false positives on `getCategoryPattern()`, which returns a module-level component). `preserve-caught-error` is off in `src/` because the client's ES2020 lib has no `Error` `cause`; it stays on for `scripts/`.

Turning one of these back on is a follow-up, not a CI change: fix the findings in the same commit.

## Format

Prettier 3, one config at the repository root (`.prettierrc.json`): no semicolons, single quotes, width 160, `arrowParens: avoid`, trailing commas. These match the code as it was written, chosen by measuring the reformat diff. Each package's `.prettierignore` leaves out build output, lockfiles, Markdown, `server/prisma/migrations/` (applied migrations stay byte-for-byte) and `client/index.html` (build-time placeholders). Files outside the two packages (root `scripts/`, the workflow) are not checked.

## Coverage floor

`test:coverage` runs the unit tests (the server's `unit` project only) with v8 coverage and global thresholds: server statements 69, branches 65, functions 63, lines 70; client 53, 53, 43, 53, each set just below the value measured on 2026-10-19 after the Prettier reformat (which moves the line count, not the statement count) (recorded beside the thresholds in `server/vitest.config.ts` and `client/vite.config.ts`). It is a ratchet: when coverage rises, raise the threshold in the same change; never lower one to land a change. Reports go to `coverage/` (gitignored).

## Dependency audit

`audit:prod` (`scripts/audit-check.mjs`) runs `npm audit --omit=dev` and fails on any advisory at high or above unless the package's `audit-allowlist.json` excuses it. An entry names one advisory (GHSA id) in one package, a `via` package, a reason and a review date; it holds only while every production path to the package runs through `via`, and an entry that matches nothing fails the check so that it is deleted once the fix lands.

- **Server:** no entries.
- **Client:** `braces` (GHSA-vfj7-8cjw-p6xm, high) via `@headlessui/tailwindcss`: `@scalar/api-reference-react` pulls in tailwindcss 3 through it, with chokidar and micromatch. `postcss-selector-parser` (GHSA-rj75-hqrm-r3gf) on the same path is moderate, below the bar, so it needs no entry. Both go when @scalar moves off tailwindcss 3.

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

**What starts a run.** One run (two jobs in parallel) per push to a pull request and per push to `main`. Merging a pull request is a push to `main`, so a merged change runs once on its pull request and once more on `main`; the second run is what Render waits for. Dependabot's own "Dependabot Updates" runs are a separate workflow GitHub manages, not this one.

**Levers, if minutes ever matter** (none is needed while the repository is public):

1. Path filters on `pull_request` only (for example skip a docs-only pull request with `paths-ignore: ['**/*.md', '.plans/**']`), never on `push` to `main`. A required check that is skipped by a path filter never reports, so the ruleset would block the pull request; pair a filter with a stub job of the same name or drop the requirement first.
2. Run `test:db` (the Postgres service and its tests) only on `main`, or on pull requests that touch `server/`, accepting that a pull request can then merge with a db test red.
3. Skip the client's prerender on pull requests (build without it) and keep it on `main`, where Render's build would otherwise be the first to run it.
4. Draft pull requests: add `if: github.event.pull_request.draft == false` to the jobs and `types: [opened, synchronize, reopened, ready_for_review]` to the trigger.
5. Run lint and the format check in one short job ahead of the rest, so a formatting slip fails in a minute instead of after the tests.
6. Cancel superseded runs (already on) and keep the caches warm (already on).

Measure before and after any of these, and record the change here.

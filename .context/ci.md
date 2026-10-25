# CI checks

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`, with no path filter. Its two jobs, `server` and `client`, are the GitHub checks Render waits for before deploying `main` (`deployment.md`, "CI gate"; ADR-0047), and the required checks of the GitHub ruleset `no-nonsense-main`, so a red check here means nothing deploys. Every check below also runs locally with the same command.

| Check | Server | Client | Fails when |
|---|---|---|---|
| Migration check | `npm run check:migrations --prefix server` | | a migration drops `stories_embedding_idx`, or a new one holds an unmarked destructive statement (`database-migrations.md`, "Migration check") |
| Type-check | `npm run typecheck --prefix server` | `… client` | any `tsc` error |
| Unit tests | `npm run test --prefix server` | `npm run test --prefix client -- --run` | a failing test |
| PostgreSQL tests | `npm run test:db --prefix server` | | a failing db test (`database-migrations.md`, "Integration Tests") |
| Build | `npm run build --prefix server` | `… client` | the production build fails; the client's includes the puppeteer prerender |

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
5. Cancel superseded runs (already on) and keep the caches warm (already on).

Measure before and after any of these, and record the change here.

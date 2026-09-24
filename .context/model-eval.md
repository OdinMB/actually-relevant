# Model Eval Harness

Compares OpenAI models and reasoning efforts on this project's real call sites, using stored data. It was built for the GPT-6 migration (gpt-5-nano/mini → gpt-6-luna, gpt-5.2 → gpt-6-sol) and is meant to be re-run whenever a model or undated alias changes. It never writes to any database and never changes production settings.

## Running

```bash
npm run eval:models --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --api-check --budget 0.1   # 1 trivial call per arm, no DB
npm run eval:models --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --dry-run                 # sample fixtures, print estimates, no API calls
npm run eval:models --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --suites related --limit 2 # smoke run (6 calls)
npm run eval:models --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval                           # full run (default --budget 18)
```

| Flag | Meaning |
|------|---------|
| `--out` | Output folder (required). Use a dated folder under the gitignored `DOCS/`; `--prefix server` makes the path relative to `server/`. |
| `--suites` | Comma list of `preassess, assess, dedup, related, social, large` (default: all) |
| `--limit N` | At most N fixture items per suite part (partial runs; verdicts are then not evidence) |
| `--dry-run` | Sample fixtures and print per-suite call counts and $ estimates; refuses any uncached API call |
| `--api-check` | One trivial structured-output call per arm of the selected suites; proves each model accepts `reasoning_effort` through the production client. Needs no database. |
| `--budget` | USD stop for live calls (default 18; values above 20, this project's cap, are refused) |
| `--concurrency` | Parallel calls (default 4; the related-stories suite always runs one at a time for latency) |
| `--refresh-fixtures` | Resample fixtures instead of reusing `.cache/fixtures.json` |

The run needs `DATABASE_URL` reachable (the local Postgres service must be running) except for `--api-check`. It prints only `local`/`remote` for the database and `present`/`missing` for `OPENAI_API_KEY`, never values.

## Outputs (in `--out`)

- `results.md` — per call site: arms, outcome counts (ok / parse failure / empty-or-declined / truncated / error / budget-skipped), p50/p95 latency, mean input/cached/output/reasoning tokens, $/call and $/month at the inventory volumes, quality metrics, the automated verdict; then the per-tier Phase 2 recommendation, current-vs-proposed monthly cost, "Is gpt-5.2 better in any way?", fixture shortfalls, prices (gpt-5.2 marked unverified) and spend. A "Fabricated-number spot check" section is left for a person to fill.
- `rating-sets.json` / `rating-key.json` — the owner's blind-rating sets (full assessments 12, social posts 10, newsletter intros 4, podcast script 1, story selection 5 at most). The key maps each item's labels to `model@effort`. No model name may appear in set titles, instructions, item IDs or options unless the item's context contains it; leaking drafts are dropped at build time and the written files are re-validated (a failure exits non-zero).
- `.cache/fixtures.json` — the sampled inputs, reused so prompts (and cache keys) stay stable while the DB changes.
- `.cache/calls.jsonl` — response cache **and** spend ledger, keyed by `sha256(model@effort + schema + prompt)`. Re-runs and resumes never pay twice; errors are not cached so they retry.

## How it stays safe

- **Read-only DB.** `readOnlyDb.ts` opens a session with `default_transaction_read_only=on`, or, if a pooler rejects that option, runs all reads inside one `SET TRANSACTION READ ONLY` transaction; `SHOW transaction_read_only` must be `on` before any query. `fixtures.ts` issues SELECTs only.
- **No second write path.** The eval calls prompt builders, Zod schemas and `createChatModel` directly and never the persisting service functions. It may import only `createChatModel` (`services/llm.ts`) and `calcMaxBlurbChars` (`services/bluesky.ts`, `services/mastodon.ts`); `imports.test.ts` enforces this statically, plus no `lib/prisma`, `rateLimitDelay`, `withRetry` or Prisma write calls.
- **Budget.** Estimates use chars/4 (Han chars/1) input and per-suite output assumptions (Luna +25%, low ×0.4, high ×1.5). A suite whose estimate exceeds the remaining budget is skipped; live calls stop once the ledger reaches `--budget`, and call sites with skipped calls get no verdict.
- **No retries around calls.** Parse failures and declines are what is measured, so calls are not wrapped in `withRetry` (ChatOpenAI's own transport retries still apply).

## Methodology

- **Baselines are rerun.** Every suite reruns today's model on the same prompts. Agreement with stored production values is reported for the rerun too: that is the noise floor. An absolute "≥" bar is relaxed to the noise floor minus 5 points only when the baseline rerun itself misses it.
- **Winner** per call site is the lowest-effort candidate that passes every automated check. The per-tier recommendation takes the highest of those efforts across the tier's call sites (small: dedup, related, pre-assess; medium: pre-assess, assess, social pick) and flags any site not tested at that effort.
- **Dedup labels** come from arm consensus; sets where the arms disagree go to two judges (gpt-5.2@high, gpt-6-sol@high) with the unchanged prompt, and pairs the judges split on are excluded. Existing clusters were made by gpt-5-nano, so agreement with them is secondary.
- **Windows are anchored on the data.** "Last N days" windows count back from the newest assessed crawl date, so a stale local DB copy still yields fixtures (the dry run warns when the anchor is over 14 days old).
- **Prompt-input shaping is mirrored, not shared.** `fixtures.ts` re-creates each service's DB-row → prompt-input mapping (commented with the production function it mirrors). Both arms always get the identical prompt, so drift from production cannot bias a comparison, but it can make the eval less representative. If shaping in a service changes, update the mirror.

## Adding a suite or arm

1. Add `suites/<name>.ts` exporting a `Suite` (`name`, `arms`, `describe`, `plan`, `run`) and a pure `decide*` function with a test; reuse `runArms`/`metricRow` from `suites/shared.ts` and `pickLowestPassing`/`effectiveBar` from `decide.ts`.
2. Add its fixture sampling to `fixtures.ts` (SELECT only) and its name to `SUITE_NAMES` in `options.ts` and `SUITES` in `run.ts`.
3. A new model needs a price row in `MODELS` (`models.ts`). GPT-6 rejects `minimal`; gpt-5-mini/nano reject `none` (`createChatModel` throws).
4. A new taste set needs a slug in `RatingSetSlug`, a budget in `RATING_BUDGET` and a picking rule in `SET_SPECS` (`ratingSets.ts`).

## Key Files

| File | Role |
|------|------|
| `server/src/scripts/eval/run.ts` | CLI orchestration |
| `server/src/scripts/eval/options.ts` | Flag parsing, suite names, the $20 cap |
| `server/src/scripts/eval/readOnlyDb.ts` | The read-only database session |
| `server/src/scripts/eval/fixtures.ts` | Sampling queries and fixture shapes |
| `server/src/scripts/eval/sampling.ts` | Deterministic stratified picking and selection groups |
| `server/src/scripts/eval/models.ts` | Price table, metered/cached/budget-guarded calls |
| `server/src/scripts/eval/checks.ts` | Output-quality checks and statistics |
| `server/src/scripts/eval/decide.ts` | Noise-floor bar and lowest-passing-effort rule |
| `server/src/scripts/eval/suites/` | One suite per call site (large tier groups its four) |
| `server/src/scripts/eval/ratingSets.ts` | Blind-rating deliverable and its validation |
| `server/src/scripts/eval/resultsReport.ts` | `results.md`, volumes, tier recommendation |

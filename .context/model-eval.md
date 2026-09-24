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
| `--floor YYYY-MM-DD` | Earliest crawl date for the pre-assess, assess, dedup and social-post samples (default 2026-03-01, when the current prompts and issue set were in place). Move it earlier only for a database copy older than that; the report states the floor. Cached fixtures with a different floor are resampled, so pass the same `--floor` on every run against one output folder. |

The run needs `DATABASE_URL` reachable (the local Postgres service must be running) except for `--api-check`. It prints only `local`/`remote` for the database and `present`/`missing` for `OPENAI_API_KEY`, never values.

## Outputs (in `--out`)

- `results.md` — per call site: arms, outcome counts (ok / parse failure / empty-or-declined / truncated / error / budget-skipped), p50/p95 latency, mean input/cached/output/reasoning tokens, $/call and $/month at the inventory volumes, quality metrics, the automated verdict; then the per-tier Phase 2 recommendation, current-vs-proposed monthly cost, "Is gpt-5.2 better in any way?", fixture shortfalls, prices (gpt-5.2 marked unverified) and spend. A "Fabricated-number spot check" section is left for a person to fill.
- `rating-sets.json` / `rating-key.json` — the owner's blind-rating sets (full assessments 12, social posts 10, newsletter intros 4, podcast script 1, story selection 5 at most). The key maps each item's labels to `model@effort`. **Written only when the folder has none yet** (`ratingFiles.ts`): the owner rates from this file with a local tool (which keeps its own `ratings.json`, never touched here), so a re-run or a partial run leaves an existing deliverable alone. To regenerate one set, use the recalibration's `rating-set` step, which swaps in a versioned set (`…-v2`, new item IDs) and leaves every other set byte for byte. **No model name may appear anywhere in `rating-sets.json`, item context included** (owner's decision, 2026-09-24; terms in `blinding.ts`: the eval model IDs, `Luna`, `Sol`, `nano`, and anything starting `gpt`, `ChatGPT` or `OpenAI`). Single-story items whose story or output mentions one are dropped at build time; multi-story fixtures (selection groups, newsletters, the podcast) drop such stories before any prompt is built, so no arm sees them. The written files are re-validated and a failure exits non-zero.
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
- **Windows are anchored on the data.** "Last N days" windows count back from the newest assessed crawl date, so a stale local DB copy still yields fixtures (the dry run warns when the anchor is over 14 days old). The fixed crawl floor is not anchored; see `--floor`.
- **Adaptations are reported.** When the data is thin, `fixtures.ts` records what it changed in `adaptations` (moved floor, extra nearest-neighbour dedup sources filling missing cluster-member slots, the synthetic social-pick scan, blinding removals with the terms that matched), and `results.md` lists them under Fixtures.
- **Prompt-input shaping is mirrored, not shared.** `fixtures.ts` re-creates each service's DB-row → prompt-input mapping (commented with the production function it mirrors). Both arms always get the identical prompt, so drift from production cannot bias a comparison, but it can make the eval less representative. If shaping in a service changes, update the mirror.

## Phase-2 recalibration (`eval:recalibrate`)

Checks the recalibrated rating prompts (pre-assessment and full assessment) and the tightened dedup prompt on gpt-6-luna against the owner's acceptance rules (2026-09-24), on the phase-1 sample cached in `--out`. It needs no database and never resamples: the split and the labelled dedup set are defined on those fixtures.

```bash
npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --half calibration --dry-run      # estimates + labelled-set preflight
npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --half calibration --budget 5.9    # iterate here only
npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --half holdout --budget 5.9        # report once the prompt is final
npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --steps rating-set --budget 5.9    # full-assessment set v2
```

| Flag | Meaning |
|------|---------|
| `--half` | `calibration`, `holdout` or `all` (default). Tune prompts on `calibration` only; the holdout is the result. |
| `--steps` | Comma list of `preassess, assess, dedup, rating-set, social-post` (default: the three checks). `rating-set` and the ship checks run only when named; `rating-set` refuses `--limit`. |
| `--effort` / `--dedup-effort` | gpt-6-luna effort for the rating checks, the rating set and social posts (default `medium`) / for dedup (default `low`). |
| `--budget` | Cap on the **ledger total** for the folder, as in eval:models. The ledger already holds phase 1's $2.96, so pass the ledger plus this run's allowance. |
| `--limit`, `--dry-run`, `--concurrency`, `--floor` | As in eval:models; `--floor` is only checked against the cached fixtures |

- **What is judged against what** (`recalibration.ts`): ratings against the stored production values (the archive the site must stay comparable with): mean offset within ±0.25 on both stages, share at or above 5 within 5 points of stored, published stories passing the pre-assessment gate ≥ 75%, issue and emotion agreement not below phase-1 Luna@medium (74.0%, 70.3%; 71.6% is reported as the aim), full-assessment format checks not below phase-1 gpt-5-mini, and no full assessment whose published fields talk about the input ("the article does not quantify…", "the supplied excerpt"; `metaCommentary.ts`, which skips the verbatim quote). Dedup: no more wrong merges than gpt-5-nano and a recall at least 15 points above nano's, on the same labelled pairs.
- **The report name says what ran.** `recalibration-<half>.md` is the report of record: default steps at the default efforts. Another effort, step list or `--limit` adds tags (`recalibration-holdout-effort-high.md`, `recalibration-all-assess-social-post.md`, `…-limit-3.md`), so a trial never overwrites it. Re-running the same command does overwrite its own file: rename a report first if you need it as a before/after reference.
- **Ship checks** (`shipChecks.ts`, rules in `shipRules.ts`) cover the other prompt changes that ship with the phase-2 switch, on the whole cached sample whatever `--half` says. `social-post`: Luna at `--effort` drafts every cached Bluesky and Mastodon post; every draft must name the story's main actor or a key number (`storyAnchors.ts`: a capitalised word the story uses mid-sentence, an acronym other than topic ones like AI or HIV, or a number the story states), stay within the limit and state no number the story lacks. Names the story never mentions are listed for the embellishment spot check but do not fail it; the report lists every draft for that read.
- **The split** (`splitHalves` in `sampling.ts`) alternates items in a salted hash order within strata (published × stored gate; stored split × language; dedup set kind), so the halves are balanced and fixed across runs.
- **The labelled dedup set is phase 1's.** Labels come from `labelDedupSets` run with the frozen phase-1 prompt (`suites/dedupPhase1Prompt.ts`) through a cache-only context, so they cost nothing and cannot drift as the production prompt changes; gpt-5-nano's phase-1 verdicts on the same pairs are the reference. Never edit the frozen prompt. eval:models still labels with the current prompt.
- **Versioned schema names.** The cache key holds the schema name, not the schema, so these checks call with `versionedSchemaName` (`name#<hash of the JSON schema>`): editing only a Zod `.describe()` is never answered from the old cache. eval:models keeps plain names so phase-1 entries stay reachable.
- **The rating set** runs gpt-5-mini@medium and Luna@`--effort` on every fixture story with the recalibrated prompt, then `replaceRatingSetFiles` swaps `actually-relevant-full-assessment` for `…-v2`. It refuses files not in the harness's own JSON format (so re-serializing cannot change other sets) and an empty set.
- Output: `recalibration-<half>[-tags].md` in `--out` (criteria table per check, wrong-merge and missed-duplicate titles, meta-commentary hits, every social draft, $/call and $/month). Stored phase-1 numbers in `results.md` are not rewritten.
- **The halves are small for the full assessment.** On 25 stories, gpt-5-mini's own phase-1 rerun sits 0.52 below stored on the calibration half and 0.24 above it on the holdout, so the ±0.25 offset bar is inside the noise there. The 2026-09-24 run therefore aimed the full assessment at parity with the gpt-5-mini rerun on the calibration half, not at that half's stored mean. Pre-assessment halves (150 stories) do not have this problem (mini rerun +0.05 / -0.01).
- **Both halves are now spent.** The 2026-09-24 recalibration tuned on the calibration half and reported the holdout (results in `DOCS/2026-09-24_gpt6-eval/results.md`, "Recalibration"). A further wording change needs a fresh sample to be judged on.

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
| `server/src/scripts/eval/numbers.ts` | Reading numbers in text; numbers an output states that its source lacks |
| `server/src/scripts/eval/metaCommentary.ts` | Published text that talks about the input |
| `server/src/scripts/eval/storyAnchors.ts` | The story's names and numbers a social post repeats, and names it adds |
| `server/src/scripts/eval/decide.ts` | Noise-floor bar and lowest-passing-effort rule |
| `server/src/scripts/eval/suites/` | One suite per call site (large tier groups its four) |
| `server/src/scripts/eval/ratingSets.ts` | Blind-rating deliverable, versioned set replacement and validation (pure) |
| `server/src/scripts/eval/ratingFiles.ts` | The deliverable on disk: write-once, and the byte-preserving swap of one set |
| `server/src/scripts/eval/recalibrate.ts` | `eval:recalibrate` CLI orchestration |
| `server/src/scripts/eval/recalibration.ts` | Owner's acceptance rules, phase-1 reference numbers, the calibration/holdout sample |
| `server/src/scripts/eval/recalibrationChecks.ts` | The recalibration steps (pre-assess, assess, dedup, rating set) |
| `server/src/scripts/eval/recalibrationReport.ts` | `recalibration-<half>[-tags].md` and its name |
| `server/src/scripts/eval/shipRules.ts` | Owner's rules for the phase-2 ship checks (pure) |
| `server/src/scripts/eval/shipChecks.ts` | The ship-check steps (`social-post`) |
| `server/src/scripts/eval/blinding.ts` | Model-name terms and the story filter behind the blinding rule |
| `server/src/scripts/eval/resultsReport.ts` | `results.md`, volumes, tier recommendation |

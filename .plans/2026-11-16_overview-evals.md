---
status: approved
type: feature
complexity: medium
---

# Overview evals, first increment: answer keys, the fact check under planted errors, and research's cost baseline

Approved by Odin on 2026-11-16 ("go for it" to starting the evals and the plan alongside the job-groups change). Part of `.plans/2026-11-16_story-overviews.md` (decision D8). The approach below is the coordinating session's implementation choice.

## Problem

Every new model step of the overviews feature needs an eval before it ships, and the whole system needs a replay against past developments (design: `/mnt/project-files/story-directions/2026-11-16_ebola-lifecycle.md`, "Evals"). None of the steps exist yet, but three things can be built now without touching production code:

- **Answer keys** for about nine past developments (Ebola in Congo, Hormuz shipping, El Niño, the war in Lebanon, one development in Sudan, the WHO pandemic agreement's pathogen-sharing annex, the Colorado River rules, the UN talks on autonomous weapons, H5N1 in Australia): which of our published stories belong, which are turning points, which numbers they state, which statuses changed, when it ended, and the tempting near misses. They are the slow, durable asset every later eval scores against. Drafts arrive as JSON files from the coordinating session; this plan gives them a schema, a home, tests and a database check.
- **The fact check under planted errors.** Decision D4 makes the fact-check call the only defense against a wrong number, so its leniency must be measured: how often it catches a fact that misstates its source sentence, and how often it wrongly rejects a faithful rewording ("half" for 50%). Research already stores thousands of extracted facts with their supporting sentences in `story_research_runs`, so this runs today on production's own fact-check prompt and gives module 1 its baseline.
- **Research's cost baseline:** what a research run really costs per story, from the same table, to replace the desk estimates in the design's cost table.

## Approach

**A new CLI in the eval harness, `eval:overviews`,** beside `eval:research`, on the same terms (`.context/model-eval.md`): the read-only database session (`readOnlyDb.ts`), production's prompts and schemas imported read-only, the call cache and ledger with a `--budget` (default $3, the $20 cap applies), `--dry-run` refusing any API call, no `withRetry` around model calls, keys printed only as present or missing.

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --dry-run
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps keys,baseline     # no API calls
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps fact-check --repeat 3 --budget 3
```

`--steps` takes a comma list of `keys`, `fact-check`, `baseline` (default all three). Other flags: `--out` (required), `--budget`, `--dry-run`, `--concurrency`, `--repeat N` (fact check only, 1 to 10, with `repeats.ts`'s per-run cache keys), `--size N` (facts to sample, default 300, at most 600), `--arms` (comma list of `model@effort` from `MODELS`; default production's research fact-check arm, gpt-6-luna@low), `--refresh-fixtures`. Its own CLI rather than an `eval:models` suite, for the reasons `eval:research` gave: its steps are not arm comparisons on fixed prompts and its fixtures are its own.

### Step `keys`: answer keys

- **Home:** `server/src/scripts/eval/overviews/keys/<id>.json`, one file per development, committed. They hold slugs, our own published wording (short quotes) and labels, nothing fetched from other sites.
- **Schema** (`keySchema.ts`, Zod, the format rules in `.describe()`s): `schemaVersion: 1`, `id`, `title`, `charter { in, out[], endEvent }`, `closed` (`null` or `{ slug | null, date }`), `figures[] { key, name, unit, definition, cumulative, variants[] }`, `entries[] { slug, date, title, join: must|optional, role: turning_point|routine, kind (string, null for routine), values[] { figure, value, approx: exact|at_least|about|under, asOf, matches, countedAs (null unless matches is false), quote }, statuses[] { subject, status, asOf }, why }`, `nearMisses[] { slug, date, title, why }`, `notes`. The coordinating session's current draft of these rules is `FORMAT.md` beside the drafts; copy its "Field rules" into the `.describe()`s.
- **Pure checks** (`validateKey`, tested): dates `YYYY-MM-DD`; entries in date order and unique; a turning point has a `kind`, a routine entry has none; every value names a figure of the key; every figure has at least 3 values; `countedAs` set exactly when `matches` is false; no slug both an entry and a near miss; `closed.slug`, when set, is an entry.
- **Committed keys can't rot:** `keys.test.ts` loads every file in `keys/` and runs the schema and `validateKey` on it, with no database. A small inline key in the test covers each rule's failure.
- **Against the database** (the `keys` step, read-only SELECTs): every slug exists and is published; each entry's `date` is its `date_published` day (UTC); every value's `quote` occurs in that story's published text (title, summary, relevance reasons, antifactors, and the applied research's paragraphs where the story has them), after normalizing whitespace, quote marks and dashes. A miss is a key error to fix, reported, never a pass or fail of anything in production. Also report per development: entries (must, optional), near misses, figures, values, closed or open, and how many entry stories have a stored research run (what module 1's replay will need).

### Step `fact-check`: planted errors against production's fact check

- **Sample** (`factFixtures.ts`, SELECT only, cached in `.cache/fact-fixtures.json`): facts from `story_research_runs.result` of finished runs, newest first: each source's facts whose supporting sentence code found in the source text (`found: true`) and whose statement states at least one number (`readNumbers` from `lib/numbers.ts`, `significant`). At most 10 facts per run and at most 3 per source, so the sample spreads over stories and outlets, non-English sources included. Record per fact: run id, story id, source id, outlet, language if known, statement, measures, supporting sentence. Read the shape from `StoryResearch` (`services/researchPipeline.ts`); a run stored in an older shape is skipped and counted.
- **Variants** (`plant.ts`, pure, the heart of the tests), each labeled by construction:
  - `faithful`: the statement as extracted (expected supported, once the label check below accepts it).
  - `reworded` (expected supported), one rule per variant where it applies, never more than one change: 50% → "half", 25% → "a quarter", 75% → "three quarters", a whole million (2,000,000 or 2 million) ↔ the other form, a number of at least 1,000 rounded to two significant figures with "about" (4,887 → "about 4,900"). A fact no rule applies to gets no reworded variant.
  - `wrong-number` (expected unsupported): one significant number changed, keeping its format: multiplied by 1.5 and rounded to the same precision, or by 2 when that leaves it unchanged.
  - `dropped-qualifier` (expected unsupported, the prompt's own rule): "nearly", "almost", "about", "around", "more than", "over", "at least", "up to", "some" removed before a number.
  - `wrong-year` (expected unsupported): a year from 1900 to 2099 moved back by one.
  - `wrong-scale` (expected unsupported): "thousand" ↔ "million" ↔ "billion" swapped once.
  Each variant is applied with the same number reader the hints use, so a rewrite never touches a number inside a word or an id.
- **Labels for `faithful`:** the extracted statement may itself misstate its sentence, which would make a correct rejection look like a false one. So each sampled fact is judged once by gpt-6.1-sol@high with the same prompt and schema (below). Facts it finds unsupported are reported as "extraction errors the strong judge found" (a fidelity number for extraction, worth having on its own) and leave the sample; variants are built only from facts it accepts. Its calls are cached like any other and count toward the budget.
- **The call:** production's `buildFactCheckPrompt(items, [], [])` and `factCheckSchema` (with `versionedSchemaName`), about 10 items per call, items shuffled with a fixed seed so variants of one fact rarely share a call. Each item is shaped as the module-1 check will read a fact: `text` the variant, `facts` one `PoolFact` whose `statement` and `supportingSentence` are both the source sentence and whose `measures` is empty (the judge sees only the source's words, never the extraction's own statement), `numbersNotFound` from `findUnsupportedNumbers(text, sentence)` exactly as production computes hints. Only `supported` is scored; the copying fields are ignored.
- **Scored per arm** (`factCheckScore.ts`, pure): catch rate per planted kind (share judged unsupported) and overall; false rejections on `faithful` and on `reworded` (share judged unsupported); unjudged items; with `--repeat`, each rate's spread across runs (`repeats.ts`'s `spread`) and per item how often the verdict flips. Against the design's first bars: catch at least 90% overall, false rejection at most 5%, shown as met or not, never as a gate. List up to 30 misses and 30 false rejections with the sentence beside them, for a read.

### Step `baseline`: research's real cost

One SELECT over `story_research_runs` of the last 30 days, anchored on the newest run: runs by trigger and by verdict; `cost_usd` mean, median and 90th percentile; `tavily_credits` mean and as USD at $0.008; model cost as `cost_usd` minus credits where the run's result records both, else as stored. Pure aggregation, tested.

### Report

`overview-eval.md` in `--out` (with `-steps-…` and `-limit-N` tags when not the default run, so a trial never overwrites the report of record): a section per step that ran, then spend (this run, folder total) and the fixtures' anchor. Caches in `--out/.cache`.

## Changes

| File | Change |
|------|--------|
| `server/src/scripts/eval/overviews.ts` | New CLI: options, presence of `OPENAI_API_KEY`, `local`/`remote`, steps, report |
| `server/src/scripts/eval/overviews/keySchema.ts` | Zod schema and `validateKey` (pure) |
| `server/src/scripts/eval/overviews/keys/*.json` | The answer keys (from the coordinating session) |
| `server/src/scripts/eval/overviews/keys.test.ts` | Every committed key passes; each rule's failure on an inline key |
| `server/src/scripts/eval/overviews/keyCheck.ts` | The database check (SELECTs) and its pure matching and summary |
| `server/src/scripts/eval/overviews/factFixtures.ts` | SELECT and pure sampling of facts from research runs |
| `server/src/scripts/eval/overviews/plant.ts` | The variant rules (pure) |
| `server/src/scripts/eval/overviews/factCheck.ts` | Items, batching, the label pass and the arms' calls through the eval context |
| `server/src/scripts/eval/overviews/factCheckScore.ts` | Rates, spread, the miss lists (pure) |
| `server/src/scripts/eval/overviews/baseline.ts` | The SELECT and the pure aggregation |
| `server/src/scripts/eval/overviews/report.ts` | `overview-eval.md` and its name (pure) |
| `server/src/scripts/eval/options.ts` | `parseOverviewOptions` |
| `server/src/scripts/eval/imports.test.ts` | The new files under its guard (read-only, no `withRetry`, production imports only from allowed modules: add `prompts/research.ts`'s `buildFactCheckPrompt`, `schemas/research.ts`'s `factCheckSchema`, `lib/numbers.ts` if not yet allowed) |
| `server/package.json` | `"eval:overviews": "tsx src/scripts/eval/overviews.ts"` |
| `.context/model-eval.md` | New section "Overview evals (`eval:overviews`)": commands, flags, the three steps, the answer-key format and where keys live, the variant rules and why `faithful` is labeled by the strong judge, the bars, outputs, safety; rows in Key Files |

## Tests

Pure units first (TDD): every variant rule, including the cases it must leave alone (a number inside an id like `S2F3`, a year in a URL-like string, "over" not before a number); `validateKey` per rule; scoring and spread on hand-made verdicts; the baseline aggregation; the report name tags; the option parser (defaults, caps, unknown step). No test calls OpenAI or a database.

## Not in this increment

The replay runner and the per-step suites for linking, founding, roles, figures, closure and reviews come with the module plans that create those steps, since they call prompts that don't exist yet. Module 1's gap-list key (what context 30 one-off stories need) comes with module 1's plan.

## Checks before the commit

`npm run lint`, `npm run format`, `npm run typecheck` and `npm run test:coverage` in `server` (coverage floor raised if it went up, never lowered); `npm run build --prefix server`. `test:db` needs a local test database, which the cloud container lacks: say so in the report rather than skipping silently.

# Follow-up: overview evals, first increment (implementer)

Plan: `.plans/2026-11-16_overview-evals.md` (left as it is: status `approved`, not archived). Branch `claude/project-thread-egeer5`.

**ashoka-engineering not loaded:** `plan-decisions`, `adr`, `project-context`, `arch-overview`. So no plan-header change, no ADR and no overview edit. The first commit wrote no `.context/` change; the coordinating session added the `eval:overviews` section to `.context/model-eval.md` (e92b210), and at its request the review-fix commit corrected that section where the fixes changed what it says.

## Controversial Decisions

- **`--limit N` added**: label and judge only the first N sampled facts, for a smoke run. The plan's report-name tag `-limit-N` implies it, but its flag list leaves it out. The report marks a limited run "a smoke run, not evidence".
- **The report name tags every departure from the default run**: steps, arms, size, repeat and limit (for example `overview-eval-steps-keys-baseline.md`). The plan names only the steps and limit tags; without the others, a `--repeat 3` or `--arms` trial would overwrite the report of record.
- **One run per story in the fact sample, the story's newest**, so a story researched twice does not count twice.
- **The fraction rewording ("half", "a quarter", "three quarters") applies only before "of" or after "by"** ("50% of", "rose by 25%"). Elsewhere the result is ungrammatical ("a 50% rise" would become "a half rise").
- **Planted-error rules leave some numbers alone:**
  - `wrong-number` skips years.
  - The rounding rewording skips any bare four-digit number: one with no group separator, no currency, percent or scale word, and under 10,000.
  - `dropped-qualifier` skips a negated qualifier and a qualifier before a year.
- **The ×2 fallback in `wrong-number` almost never fires**: ×1.5 changes every nonzero value at its own precision (`2.25%` becomes `3.38%`). The fallback stays as the plan says, and `0` gets no variant.
- **A fact's language is known only when its source URL is one of our crawled stories** (the feed's `language`); otherwise it is "unknown". The run result stores no language.
- **Fact-check items are labeled `Fact N`** in the prompt. Each item's evidence is built by production's `checkedItems`, as a story paragraph citing `S<N>F1`, so the source's date fact `S<N>F0` joins it the way production adds it.
- **Fixture version 2:** each fact now carries its source's date, and a cached sample of version 1 is resampled.
- **A key-less run of a fully cached fact check now runs** rather than being skipped for the missing key. A pass is refused only for uncached calls.
- **The baseline's cost statistics count only runs with a stored result**, so a running reservation or a $0 skipped run does not skew them. The report says how many runs were left out.
- **`storedResearchText` (`services/researchedStory.ts`, pure) is allow-listed in `imports.test.ts`**. The key check uses it to find quotes in the applied research's paragraphs, the same text readers see.
- **`SelectDb` interface added to `readOnlyDb.ts`**: the samplers take only tagged SELECTs, so a test can pass a stub.
- **`validateKey` and the file reader are stricter than `validate.cjs`**:
  - `countedAs` must be null when `matches` is true.
  - A key file must be named `<id>.json`.
  - `title` and `date` are required on entries and near misses.
  - `charter.out` and figure `variants` must hold strings.
  - `closed.slug` must be an entry.

## Implementation Issues

- **`npm run test:coverage` could not run.** It needs `TEST_DATABASE_URL`, and the cloud container has no database.
  - Unit tests alone measure below the combined floor, as they did before this change.
  - The new code measures above every threshold.
  - The floor was left unchanged. Run `test:coverage` locally and raise the floor if it went up.
- **`npm run test:db` and the eval itself could not run** (no database, no `OPENAI_API_KEY`).
  - The SQL was checked against `prisma/schema.prisma` by reading, never run.
  - The first real run should be `--dry-run`, then `--steps fact-check --limit 5`.

## User Input Needed

- None.

## DB Migrations

- None.

## Landing Queue

- `claude/project-thread-egeer5`: push and land through the coordinating session's route for this repository. Check the remote's protection at landing (ruleset `no-nonsense-main`, required checks `server` and `client`).

## Mod code and load settings written

- None.

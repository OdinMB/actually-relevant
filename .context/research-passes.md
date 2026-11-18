# Research passes (the `research_pass` step, built in part and switched off)

A **research pass** is one repeatable step over one **evidence pool** per story: it searches, extracts and checks facts into the story's pool, writes the article from the pool's supported facts (research's write, checks, repair and gate) and the context cards from the pool (context's write and box check). A story's first pass writes version 1 of its article; a later pass will judge the current version against what the pool gained since and rewrite only what new facts make wrong or substantially different. It is to replace the research step (`research_stories`, `.context/story-research.md`) and story context (`build_story_context`, `.context/story-context.md`) with one switch, one budget and one spending line. Plan: `.plans/2026-11-17_research-passes.md` (approved 2026-11-17; built in phases). Decision: ADR-0067.

**What is built and what it does today.** The records (phase 1), the first pass and its input (phase 2) and the evals' adapters. **Nothing in production calls the pass**: the `research_pass` job is seeded disabled, enabling it is refused, and its handler only reports that it is not wired. The tables are empty until a pass runs. The old steps, their tables and their readers are unchanged. Still to come: the later pass (judge, rewrite, Update note, demotions), the pass lifecycle and job (claim, reservation, store, apply, the publish gate, mutual exclusion with the old jobs), the admin view and "Research again", the public Updates, and the old steps' retirement.

## The pool

A story's pool (`services/researchPool.ts`, the in-memory types; `services/passRecords.ts`, the rows):

- **Sources** (`evidence_sources`): the original article (`S0`), cluster members, confirmed neighbours and search results (`S1`, `S2`, …), and our own earlier stories research links (`E1`, …; origin `earlier`, keyed `story:<id>`, no URL). A source is one per page by its normalized URL (`sourceKey`), with its outlet, title, date, kind, country, relation, voices (with their stance), and whether the publisher's opt-outs were checked. A page a pass read and left out (an unusable extraction) is a source row with a `drop_reason` and no ref: it is never read again.
- **Facts** (`pool_facts`), refs `S2F3` (the source's ref and a number within it), stable within the story; one per story by `poolFactKey` (context's `factKey` over the source key, the supporting sentence and the statement), so a fact found again is not added again. Each fact holds its **evidence** (supporting sentence, a search fact's passage, whether code found the sentence in the text, the statement, what it measures, the slot it was searched for), its **structured fields** (value, range, unit, approx, provisional, counted, place, as-of with its precision, credited body, validity, with the structure call's model and prompt version; null until structured), its **extraction** (model, prompt version, the pass that found it) and its **judgment**: the verdict (`unjudged`, `supported`, `rejected`), the problem, the check's model, prompt version and pass. **A fact is checked once**: a pass checks only `unjudged` facts of pages, never one an earlier pass or a legacy context run judged, and never our own earlier stories' (our text). **Demotion is a status**, never a deletion: `status` `unreviewed`, `reviewed` or `demoted`, with `drop_reason` (`contradicted`, `editor`), the pass that demoted it and `contradicted_by`. A fact is usable when supported and not demoted (`usable`).
- **Searches** (`evidence_searches`): every query a pass or a legacy run made, coverage (research's, with its window and depth) or gap (context's, with its slot and `response` angle), its results and credits, and the pass (null for an imported one). A normalized query made before is not searched again, nor a `response` angle (`researchPassPlan.ts`).

## Records

- **`research_passes`**: one row per pass, numbered per story, with its trigger, kind (`first`, `later`), status (`running`, `completed`, `skipped`, `failed`), outcome, research's gate verdict on a first pass, costs (`cost_usd`, `model_usd`, `tavily_credits`), `record` (research's run record, context's run record, what became of the cards, the coverage queries skipped as made before), a sanitized error and the version it made. `story_id` is SET NULL on delete, as for research runs.
- **`article_versions`**: a story's article as each pass left it: number, kind (`first`, `update`, `legacy`), status (`current`, `superseded`, `reverted`), the text columns an apply writes, the reader projection (`research`), the changes and the Update note. **At most one `current` version per story**, by the partial unique index `article_versions_one_current` (raw SQL in the migration; Prisma cannot model it, and `check:migrations` fails on a migration that drops it, `.context/database-migrations.md`).
- **`pass_boxes`**: the cards a pass wrote, `context_boxes`' columns with the pass. Each takes over the editor's choices (hidden, moved) on the card of its type shown before: the newest earlier pass's cards, else the story's legacy context cards.
- **Writing a pass** (`storePassResult`, in the caller's transaction): fenced on the pass still `running` (nothing is written once a restart marked it cut off), then the pass row, its new searches, the pages it left out, its new sources and facts, the judgments it changed on stored facts, its version (the current one superseded) and its cards. **Reading** (`loadPool`, `currentVersion`, `newestPassBoxes`) is SELECT only, through the client given.
- **The old tables stay read-only history**: `story_research_runs`, `story_context_runs`, `context_facts` and `context_boxes` are never written by a pass.

## Legacy import

`importLegacyPool(tx, storyId)` (`services/legacyPool.ts`) turns a story's legacy runs into pool rows and version 1, once, inside the transaction that will claim the story's first pass (built; nothing calls it until the lifecycle is wired). From the newest completed research run whose sources hold facts (the one context reads): its sources and earlier stories, its facts `unjudged` unless a context run judged them (matched by `factKey`, taking that verdict and the structured fields, prompt version `legacy`), its coverage queries. From the context runs: their own search facts with their verdicts, as new sources, their gap searches, and the pages they left out. A story with `stories.research` set gets version 1 (`legacy`) from its columns and projection, so its next pass is a later pass judged against what readers see. It returns `imported`, `present` (the story has pool rows or versions: nothing happens) or `none`.

## Input

`loadPassInput(db, storyId, passId, now)` (`services/researchPassInput.ts`, SELECT only through the client given): the story as research's loader gives it (`researchStoriesByIds`: original, cluster members, neighbours, earlier-coverage candidates; null when research cannot run on it), the pool, the current version, the story as readers see it (title, summary and places from the current version, else from the story's columns), the story's day (the publishing day, else `now`'s), and the reusable facts of the earlier-coverage candidates (context's `reusableFacts`: supported, not demoted, current on that day, each once). Those facts are read from `context_facts` only: reading earlier stories' pool facts comes with the wiring. They come uncapped; the pass offers only those of the stories it links, at most `storyContext.maxReusedFacts` (30). `loadFirstPassInput` is the same with an empty pool and no version, reading no pass table: the eval's replay of a first pass.

## The steps

`runResearchPass(input, deps)` (`services/researchPass.ts`) does no I/O of its own, like `researchStory` and `buildStoryContext`: the metered call, research's coverage search, context's gap search, the opt-out policy and `transient` are injected, so the eval runs the same code. It never throws. A first pass:

1. **Own sources, coverage queries, search and extraction**: research's (`extractCoverage`), with the pool's pages left out of the candidates (`knownPages`, drop kind `known`) and the queries an earlier pass made skipped (`coverageSearches`, recorded as `skippedQueries`). Research's sources and facts join the pool, each source once by its page and each fact once by its key; research's extraction prompt is not versioned, so its facts carry `research-extract`.
2. **Structure** (context's call) on the pages' facts that have no structured fields.
3. **Gap list and searches** (context's `gapStage`) over the pool and the offered earlier facts, the searches planned by `planSearches` (`response` first from both angles while not covered and not reported, then the other slots), at most `research.pass.maxGapSearches` (3), skipping what any earlier pass searched; pages the pool holds or left out are not read. The gap facts join the pool.
4. **Fact check**: research's fact-check prompt through context's `checkFacts`, once on every `unjudged` fact of a page.
5. **Article**: research's write, checks, repair rounds, derive and gate (`runPassArticle`) from the pages' **supported** facts and our earlier stories' facts, every source shown to the copying checks. A kept draft becomes version 1 (`first`).
6. **Cards**: context's write and box check (`writeBoxes`) from the pages' supported, structured facts and the offered facts of the earlier stories the pass links, on version 1's places when it made one, else the story's own. An offered fact a kept card cites joins the pool (`reused_from_id`), and the card cites it by its pool ref.

Rules:

- **Cards never fail a pass.** A technical failure of steps 2-3 or 6 completes the pass with its article and records `cards: failed`; a budget skip in step 6 records `cards: budget`. A first-pass fallback (no article) still writes cards for a story with research facts; **a story research found no fact in gets no cards**, as context's rule had it.
- **A budget skip before the cards ends the pass** as research's `fallback: budget` does (outcome `budget`), with no article and no cards. A technical failure of the fact check fails the pass (`status: failed`): the article needs its verdicts.
- **Outcomes:** `written` (a kept draft), `stale`, `contradicted`, `research-rating`, `fallback`, `budget`, `technical`.
- **A later pass is not built yet**: a story with a current version gets `status: failed`, "later passes are not built yet". `passEligibility` (below) says which kind a story would get.
- **Step names** (`PASS_STEPS`, `PASS_STEP_TIERS`): research's steps, then the card steps, named apart from research's steps of the same name: `structure`, `gap-list`, `gap-extract`, `facts-check`, `cards-write`, `box-check`, each on its context step's tier (`CARD_STEPS`). `passCalls` lists every call of a pass under these names, `cardFacts` the pool's facts as context reads them, `cardsLayout` the places the cards were written for.

## Budget

One meter for the whole pass: research's `createRunMeter` (`services/researchCalls.ts`), which meters the card steps' calls (their desk output estimates in `STEP_OUTPUT_TOKENS`) and the gap searches (at basic depth's credits; a cached answer costs nothing) as it meters research's, against the pass's ceiling and what the month's cap leaves. A call without room is `skipped`, a search without room throws `BudgetExhaustedError`. The ceilings are `config.research.pass.firstPassUsd` (0.40) and `laterPassUsd` (0.25), about twice a pass's target; `perRun` (20) and `concurrency` (4) are the job's, for the wiring. Reserving the ceiling at start under research's advisory lock comes with the lifecycle.

## The job

`research_pass` (`jobs/researchPass.ts`, "Research Passes" on the Jobs page): seeded **disabled** by `20261117230407_research_passes` and `seed-jobs.ts`, with a $20 spending warning level (build_story_context's). **Enabling it is refused** (`PASS_NOT_WIRED`, `jobs/jobEnableChecks.ts`) until the step is wired; its handler only reports "Research passes are off: the step is not wired yet", so "Run now" writes nothing. It is in `MODEL_JOBS` (a Flex switch, and a $0 line on the Spending page) and `RESUMABLE_JOBS`, and in no chain yet.

## Admin

`passEligibility(db, storyId)` (`services/researchPassInput.ts`): the story's status, whether a pass of it is running (one at a time), and the kind of pass it would get: `later` when it has an article to judge (a current version, or `stories.research` set, which the legacy import makes version 1), else `first`, so a story whose first passes kept no article gets a first pass again. No route reads it yet.

## Evals and the gate

`eval:research` and `eval:overviews --steps context` run the first pass through one adapter (`scripts/eval/research/pipeline.ts`; `.context/model-eval.md`): eval:research reads it as research's record, with the card steps' calls and credits counted; the `context` step replays it on the gap keys' stories (`loadFirstPassInput`), judges its cards, and holds the whole pass to $0.20 a story at flex. The step stays off until the plan's bars hold on the judged half; the owner switches it on.

## Key Files

| File | Role |
|------|------|
| `server/src/services/researchPool.ts` | The pool's and versions' in-memory types; source and fact keys, ref numbering, `usable` |
| `server/src/services/passRecords.ts` | The pool and versions read back (SELECT only) and one pass's result written in the caller's transaction |
| `server/src/services/legacyPool.ts` | The legacy research and context runs imported once, version 1 included |
| `server/src/services/researchPass.ts` | One pass's steps over injected deps (first passes); step names and tiers |
| `server/src/services/researchPassPlan.ts` | Which coverage and gap searches a pass makes, and the pages it never reads again |
| `server/src/services/researchPassInput.ts` | One story's pass input, a first pass's input for the eval, and `passEligibility` |
| `server/src/services/researchCalls.ts` | The run meter, shared with research runs |
| `server/src/jobs/researchPass.ts` | The job's stub handler and `PASS_NOT_WIRED` |
| `server/prisma/migrations/20261117230407_research_passes/` | The six tables, the partial index, the disabled job row and its warning level |
| `server/src/scripts/eval/research/pipeline.ts` | The evals' adapter to the pass |

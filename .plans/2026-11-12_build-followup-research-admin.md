# Build follow-up: research admin action (2026-11-12)

Plan: `.plans/2026-11-12_story-research-admin.md` (left in place, status `approved`, not archived: see "Implementation Issues").
Commit: `78fd45a` on `claude/project-thread-iap26u`, not pushed.

`ashoka-engineering not loaded: plan-decisions, adr, project-context, arch-overview`. So this change wrote no plan header, no ADR, no `CLAUDE.md` and no `.context/` file. Every doc change the plan lists is drafted below, ready to paste, under "Doc drafts".

## Decisions to Review

None. With `adr` not loaded, nothing went into the ADR log, so no entry names only the agent. The plan's one ADR-worthy choice is drafted below ("Draft ADR: research runs in their own table"). It is the planner's decision, which the coordinating session accepted; review it when the ADR is written.

## Landing Queue

- Push branch `claude/project-thread-iap26u` (commit `78fd45a`) once the doc drafts below are committed on it.
- Landing on `main` is a production deploy: CI's deploy job runs migration `20261112050114_story_research_runs` on Render and puts the Research section in front of editors. It waits for Odin's explicit go (plan header). Two answers come first: "User Input Needed" below, and setting `TAVILY_API_KEY` in Render (unset, research stays switched off and the section says so).

## User Input Needed

- **May admin-only runs go live before the publishers' AI opt-out check exists?** The plan put this to Odin separately. As built, every run records `optOutChecked: false` and the admin view says "AI opt-out not checked". Searched sources are fetched by Tavily and shown to editors only; nothing is published. If the answer is no, leave `TAVILY_API_KEY` unset in Render until the crawler's check is wired to `ResearchDeps.sourcePolicy`. That switch-off works even after the code is on `main`.
- **Set `TAVILY_API_KEY` on the Render API service** (dashboard, `sync: false` in `render.yaml`) to switch research on. `RESEARCH_MONTHLY_CAP_USD` defaults to 30 and needs no entry.

## DB Migrations

- `server/prisma/migrations/20261112050114_story_research_runs/migration.sql`. It is additive: the enum `ResearchRunStatus`, the table `story_research_runs`, indexes on `(story_id, started_at)` and `started_at`, and a foreign key to `stories` with `ON DELETE SET NULL`. It was generated with `db:migrate:create` against a throwaway local database, and the proposed `DROP INDEX "story_embeddings_embedding_idx"` line was deleted. `check:migrations` passes.
- It was applied only to throwaway databases in a local cluster this run started (`ar_test` for `test:db`, `ar_migrate_test` for authoring). It was never applied to dev or production. Locally it applies on the next `npm run dev --prefix server` (`predev` runs `db:prepare`); on Render, CI's deploy applies it.
- The Prisma client was regenerated locally (`db:generate`); that changes no tracked file.

## Controversial Decisions

- **The opt-out drop lives in `researchFilter.ts`** as `dropOptedOut(candidates, policy)`, next to the other drop reasons. The pipeline applies it to own and search candidates before `filterCandidates` and counts its drops under `opt-out`. Its alternative, an inline loop in the pipeline, would have split drop logic across two modules.
- **`optOutChecked` is derived in the pipeline** as `deps.sourcePolicy !== undefined`, so no caller can claim a check it didn't pass.
- **The batch check is an optional `admit(batch)` dependency.** Production's meter sums the estimates for the parallel extraction batch plus the earlier-coverage call and refuses the batch when the total doesn't fit, which ends the run as `fallback: budget`. The eval passes none and keeps its own per-story budget.
- **Per-call estimates are desk constants** (`STEP_OUTPUT_TOKENS` in `researchCalls.ts`: 500 to 5,500 output tokens per step). Input is estimated at one token per Han character and four characters a token otherwise. They only gate calls. The recorded cost is always the measured usage.
- **A model call that throws is counted at $0.** The SDK's billed retries before a final error are invisible to us, so this can undercount slightly. The run's $0.25 reservation holds against the cap until the run finishes, and a run that throws keeps its full reservation as its cost.
- **The month's room is re-read before every call and search** (`monthRoomUsd`, one aggregate query each, about 10-20 per run), not once at the start. The run's own reservation is excluded, so the room is the cap minus every other run's spend this month. Concurrent runs can therefore not pass the cap by more than one in-flight batch.
- **A search the budget refuses throws `BudgetExhaustedError`,** and the pipeline maps it to `fallback: budget`. Other Tavily errors stay `fallback: tavily: <sanitized message>`.
- **The run time for an unpublished story is `now() AT TIME ZONE 'UTC'`** inside the SQL `COALESCE`, matching the `timestamp without time zone` columns, so the earlier-coverage window is computed in UTC.
- **Refusal order: switch and model prices first, then 404.** A server with research switched off answers 409 for any story id, unknown ones included. Then come 404 for an unknown story, 409 for its status, 409 "lacks the analysis research needs", and in the reservation transaction 409 for a run in progress and then the cap.
- **The runs list of an unknown story is `[]`,** not 404. The list is only reached from a loaded story.
- **Stored errors are `unexpected error (<name> <code>)`** only. A message may quote fetched text or a query's arguments, so it is never stored or logged.
- **A run marked interrupted before it finished** drops its result. The task counts it as failed with "The run was marked interrupted before it finished", and the row stays failed at its reservation.
- **The interrupted-run sweep runs** inside the reservation transaction and before each list read, so no job or timer is needed.
- **The client's `shared/types` research types are hand-written mirrors** of the server's `StoredResearch`, `RunCostSummary` and views. The server does not import `shared/types` anywhere (project pattern), so they can drift. The route test pins the JSON shape the list returns.
- **The Research section renders nothing while its usage query loads, and nothing on a 404,** so a new client deployed before the server shows no section rather than an error. It is admin-only, so a late appearance costs no layout-shift budget.
- **"In progress" has two sources:** the tab's own polled task (`processingIds`) and any `running` run in the story's list. The list re-reads every 5 s while a run is running, so a run started in another tab also disables the button.
- **The client's reason order is** the usage refusal (switched off, unpriced model, cap), then the story's status, then a run in progress. The server checks the same conditions in its own order.
- **Citation chips are links when safe.** A source chip links to its http(s) URL in a new tab with `rel="noopener noreferrer"`. A chip for our earlier coverage (`E…` facts, labeled Actually Relevant) links to the public `/stories/<slug>`. Any other URL renders as text.
- **The `env.example` entry** is `TAVILY_API_KEY=` (empty, uncommented, replacing the eval-only comment) plus a commented `# RESEARCH_MONTHLY_CAP_USD=30` line, which the blueprint test allows for a code-default tunable.
- **Tooling for this run:** a local PostgreSQL 16 cluster with pgvector on `localhost:5432` (databases `ar_test` and `ar_migrate_test`), so `test:db` and coverage ran with the DB project. Both databases are outside the project and were left in place.

## Implementation Issues

- **Docs not written (guard).** `plan-decisions`, `adr`, `project-context` and `arch-overview` were not loaded, so the plan's doc rows (`.context/story-research.md`, the `CLAUDE.md` row, `ai-transparency.md`, `llm-analysis.md`, `task-queue.md`, `admin-dashboard.md`, `model-eval.md`, `story-retention.md`, `deployment.md`, `database-migrations.md`, the ADR) are drafted below for the coordinator. CLAUDE.md says a behavior change corrects its `.context/` file in the same change, so these belong on the branch before it is pushed.
- **The plan stays where it is,** status `approved`, not archived: archiving and the header are `plan-decisions`' to write.
- **Code review (implement step 5) was skipped,** for want of the Agent tool, and so were the `tdd-guide` and check-worker delegations: those ran inline. A reviewer pass over `9cfca35..78fd45a` should run before the push.
- No failures. Lint, format, typecheck and coverage pass in both packages: server 237 files and 3,346 tests with the DB project; client 139 files and 1,162 tests. `check:migrations`, the API snapshot (unchanged) and both builds also pass.

## Suggested Follow-Up Work

- **Wire the crawler's AI opt-out check to `ResearchDeps.sourcePolicy`** (ADR-0050's rule) once it can judge a single URL. Until then every run records `optOutChecked: false`.
- **Share `GENERIC_LIMITING_FACTORS`** between `prompts/research.ts` and `prompts/assess.ts` at the switch, when the research prompt is rewritten (debt the plan names; a comment marks it).
- **The eval keeps its own price table** (`costOf`) beside `config.research.modelPrices`, on purpose (the plan names it as debt). Revisit if the two drift.
- **Generate the client's research types from the server,** or add a contract test, if the result shape changes often. They are mirrors today.
- **`researchPipeline.ts` is 485 lines** (444 in the eval), carrying the step sequence, the pool build and the result assembly. This change moved it and grew it within that one responsibility: the injected deps, the batch admit and the opt-out drop. If the switch adds steps, the pool build (`buildPool` and the extraction mapping) is the natural seam.

## Mod code and load settings written

None.

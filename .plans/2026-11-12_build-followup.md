# Build follow-up: research measurement (2026-11-12)

Plan: `.plans/2026-11-12_research-eval-suite.md` (`eval:research`), built on branch `claude/project-thread-iap26u`, not pushed.

`ashoka-engineering not loaded: plan-decisions, adr, project-context, arch-overview`. The implementer therefore wrote no plan-header change, no ADR, no `CLAUDE.md` or `.context/` change and no overview edit (see Implementation Issues).

## Decisions to Review

None recorded: `ashoka-engineering not loaded: adr`, so no decision went into the ADR log. The planner's decisions remain in the plan's `## Approach`, and the implementer's own choices are listed under Controversial Decisions below.

## Controversial Decisions

- **Cost aggregation is in `research/costs.ts`, not in `report.ts`.** The plan lists `summarizeCosts` as an export of `report.ts`. It now sits in `costs.ts`, together with the 250-story monthly projection, the desk estimate per step and the per-story budget estimate the CLI reserves. Two reasons: the CLI uses the estimates before any report exists, and keeping them apart leaves `report.ts` with one job, rendering. `report.ts` imports from `costs.ts`.
- **A new `research/storyQueue.ts` runs the stories under the budget.** The plan says "before each story the CLI checks the remaining budget against the desk estimate for one story". Stories run concurrently (`--concurrency`, default 4), so a story only starts when the budget, minus the folder's spend, minus the estimates already reserved by running stories, still covers its own estimate.
  - When it does not and other stories are still running, the story waits for them to finish.
  - When nothing else is running, the run stops cleanly and the remaining stories are reported as skipped with the reason.
  - The live guard in `models.ts` stays the hard stop behind this.
  - This keeps the concurrency loop out of the CLI.
- **The cap of 6 sources includes the original article (S0).** That means up to 5 others: at most 2 cluster members and 2 confirmed neighbours, with search results filling the rest. Reading: the design's "up to 6 sources in total".
- **Extraction reports `relation` as one of `same-development`, `background` or `off-topic`, not a boolean "same development".** Background sources are kept for context; only `off-topic` (and unusable) sources are dropped after extraction. This keeps background facts the write step can use without adding a separate step.
- **Search results without a date are dropped,** like those outside the window. The window cannot be checked without a date. Own sources (cluster members, neighbours) are not date-filtered, because they come from our own corpus.
- **Domain spread is decided by top-level domain** (`.de`, `.uk`, `.com`, as a cheap stand-in for country spread). When search results compete for the last slots, results from a TLD not yet among the sources are preferred, the original's included. The selected sources are then kept in their input order. "Domain" for one-per-domain means the registrable domain, aware of country second levels such as `bbc.co.uk`.
- **The window anchor is the article's own date when plausible.** The Tavily window is 14 days before to 7 days after the original article's `datePublished`, used only when it falls within 30 days before to 1 day after its crawl date; otherwise the crawl date is used. The plan says "the story's publication date". The article's date is the closest to the development, while our `date_published` can lag by days. Neighbours still use ±14 days around the crawl date, as the plan says.
- **The original article (S0) failing extraction ends the story as `fallback`.** Without S0 there is no fact pool for the story's own claims. A failed extraction of any other source only drops that source, and the report counts it as `extraction-failed`. A story left with no source beyond S0 after extraction is `fallback` (`no usable source`): our earlier stories alone do not count as research. A failed earlier-coverage call only leaves the earlier pool empty.
- **The fact-check call runs only after the deterministic citation check passes.** A draft with unknown ids or unsupported numbers goes straight to the one rewrite, which saves a fact-check call on a draft that is already known to need one. Every draft that ends as `keep`, `stale`, `contradicted` or `research-rating` has passed both checks.
- **The desk estimate has two rows the design's token table does not have.** These are the neighbour confirmation (`confirm`, 1.5k in / 0.5k out, small) and the rewrite (`rewrite`, 17k / 5.5k, medium). The dry run and the report show them marked "not in the design", and give the estimate both with and without them.
- **Tavily request parameters are an assumption the code does not test.** `include_raw_content: 'text'` (plain text rather than markdown) and `include_usage: true` (so the response reports credits) follow Tavily's documented parameters. The code falls back to depth-based credits when `usage` is absent. A `--limit 1` smoke run confirms that Tavily accepts them (see User Input Needed).
- **`fixtures.test.ts` was written after `fixtures.ts`.** It was not written test-first: the SQL shape had to exist before a fake database could route on it. It covers assembly, cutting, language and shortfalls; the SQL itself is untested here (no database in this container).
- **Generating the Prisma client for the checks.** It was generated with a placeholder `DATABASE_URL`, as CI does. Typecheck and the eval tests need the generated client; no database was touched.

## Implementation Issues

- **`.context/model-eval.md` was not updated** (`ashoka-engineering not loaded: project-context`). The plan's Changes table asks for a new section "Research measurement (`eval:research`)" and rows in Key Files. `research.ts`'s header points to that file, so the section should land before or with the push. A ready-to-paste draft:
  - Section, after "Phase-2 recalibration": the commands `npm run eval:research --prefix server -- --out ../DOCS/<date>_research-eval [--dry-run] [--limit N] [--budget 3] [--size 30] [--concurrency 4] [--refresh-fixtures]`.
  - Sampling: the newest published stories (30 by default, `--size` at most 60), cached in `--out/.cache/research-fixtures.json`.
  - Steps and models:
    - confirm neighbours: production dedup prompt, gpt-6-luna@low
    - queries: luna@low
    - Tavily news search: advanced depth, window 14 days before and 7 after the article's date, 8 results a query
    - deterministic filter
    - extraction per source: luna@low
    - earlier coverage: luna@low
    - write: luna@medium
    - citation check, then fact check: luna@low
    - one rewrite: luna@medium
    - gate
  - Budget: one `--budget` (default $3, $20 cap) covers the folder's model ledger plus every Tavily credit recorded in `.cache/tavily.jsonl` at $0.008 each, free credits counted as paid. Stories start only while the remaining budget covers one story's estimate; the rest are reported as skipped.
  - Outputs: `research-report.md` and `research-drafts.md` (with `-limit-N` for a `--limit` run); caches `calls.jsonl` and `tavily.jsonl`.
  - Safety:
    - read-only session, SELECT only
    - Tavily is the eval's only HTTP besides OpenAI, the one `withRetry` exception in `imports.test.ts`
    - key sent in a header, never cached, printed only as present/missing
    - errors sanitized to a status or code
    - sources treated as untrusted input
    - `TAVILY_API_KEY` only on the owner's computer, never on Render
  - Key Files rows: `research.ts` (CLI) and `research/{fixtures, tavily, filter, prompts, schemas, pipeline, checks, costs, storyQueue, report}.ts`, each with its one-line responsibility from its header comment.
- **The plan's header and place were left unchanged** (`ashoka-engineering not loaded: plan-decisions`). It is still `status: approved` in `.plans/`, not archived, and is uncommitted, like this file. Promote it to completed and archive it to `.plans/completed/` once the skill is loaded or by hand.
- **The ADR log and the architecture overview were not touched** (`ashoka-engineering not loaded: adr, arch-overview`). Candidate decisions for the log are its own CLI rather than an `eval:models` suite, and Tavily as the eval's one `withRetry` exception. Both are in the plan's `## Approach`.
- **The combined CI branch coverage could dip by about 0.1 point** (no database here, so the `db` project could not run).
  - Unit-only coverage rose on every measure: statements 71.23 → 72.20, branches 68.34 → 68.57, functions 65.83 → 67.56, lines 72.56 → 73.44.
  - The new files cover their branches at 72.4% (the `research/` folder 77.7%; the untested CLI `research.ts` 0%). That is a little below the last combined branch figure in `vitest.config.ts` (73.97 on 2026-11-05).
  - The estimated combined effect is about −0.1 point on branches, and a rise on the other three. The floor is 73. Run `npm run test:coverage --prefix server` with `TEST_DATABASE_URL` before the push.
- **The step-5 code review did not run:** the implementer had no Agent tool. Review the branch cold before landing.
- **Implemented, but checked here only with made-up data:** the dry run was checked against a made-up two-story fixture, which printed the estimate and made no call. A live run without keys stops with `OPENAI_API_KEY is missing`. The live path, SQL sampling and real Tavily responses are unverified.

## User Input Needed

- **Smoke run with `--limit 1` before the full run:** `npm run eval:research --prefix server -- --out ../DOCS/2026-11-12_research-eval --limit 1`, on the owner's computer, with `TAVILY_API_KEY` set in `server/.env`. It confirms:
  - that Tavily accepts `include_usage` and `include_raw_content: 'text'`, and that `usage.credits` comes back;
  - that the SQL sampling works against the local copy;
  - the real cost per story against the desk estimate.

  Then run the full 30 with `--budget 3`.

## Suggested Follow-Up Work

- **Syndication check for Han text:** it uses 5-word shingles on whitespace-split words, so Chinese or Japanese copies (no spaces) are barely compared. If the sample has many such sources, use character n-grams for Han text in `research/filter.ts` (`shingles`).
- **Cut the shared assess text when the production stage is built:** the write prompt carries copies of the assess prompt's generic limiting factors and relevance-calculation bullets, as the plan decided. When the production research stage is written, export them from `prompts/assess.ts` instead.
- **Unit-test the CLI `research.ts`:** it has no unit test (it is orchestration only and kept thin). If coverage needs it, split fixture caching (`getFixtures`) and the dry-run printout (`printPlan`) into a tested module.

## Records to Refresh

None. Tavily appears only in a script the owner runs on his own computer, with no production code path, data flow to users or deployment change. `.context/ai-transparency.md` is out of scope per the plan: nothing is published.

## DB Migrations

None.

## Deletions Outside the Project

None. The dry-run check folder `DOCS/2026-11-12_research-dryrun-check` (made-up fixture, inside the project, gitignored) was deleted after the check.

## Landing Queue

- **Repository:** `OdinMB/actually-relevant`, local folder `/home/user/actually-relevant`.
- **Branch:** `claude/project-thread-iap26u`, holding one commit, `618e4f2` (the `eval:research` feature), on top of `main` at `5dcf89e`.
- **Action:** push the branch only: `git -C /home/user/actually-relevant push origin claude/project-thread-iap26u`. Name the branch: its upstream is `origin/main`, so a bare `git push` could aim at `main`, which deploys production.
- **Before landing to `main`:**
  - the `.context/model-eval.md` section above;
  - a cold code review;
  - the full CI set with the database (`test:coverage`, `test:db`, builds);
  - a check of the remote's `main` rules (`no-nonsense-main`: required checks `server` and `client`).
- **Leave uncommitted:** the plan and this follow-up file.

# Follow-up: research fact figures

Plan: `.plans/completed/2026-11-24_research-fact-figures.md`. Branch `claude/project-thread-egeer5`. Two parts: phase 2 (the fix, implemented 2026-11-24) first, then phase 1 (the drift bar) as its run left it.

# The fact rules of 2026-11-25 (after phase 2)

No plan file: the main session's task description and the design memo (`DOCS/2026-11-24_research-facts-improvement-design.md`, changes A to E) were the plan. One commit on `claude/project-thread-egeer5`. Not measured: no paid eval was run.

## Controversial Decisions

- **Ten of the memo's prompt examples were replaced, because they restated judged-half facts.** The task's rule was that no fact from either half is a prompt example. The correctness review found four in the judged half's report and a search found six more: "a toll of 1,200 as of March 22" (Lebanon's toll as of March 22), "since 1980" (South Africa's maize), "after the 2015 drought" (the 2015 El Niño), "a forecast peak" (the El Niño forecast), "parts of Ethiopia", "the first dose" (twice), "hundreds of targets", "the army began an incursion", "cases per week". Each now has an invented example of the same pattern ("4,300 homes without power as of July 9", "since 1995", "after the 2019 floods", "the date a forecast is for", "southern Norway", "the second phase", "thousands of homes" as 2,000 to 9,999, "the regulator fined the airline", "tonnes per day"), none of which occurs in either folder's cached sources. Everything else of the memo's wording is as written. Two limits no rewording removes are in `.context/prompting.md`: the rules were written from the judged half's errors, and the figure check's examples of 2026-11-24 are judged-half cases too (not changed here: `BACKLOG.md`).
- **The memo's third statement example was kept though its "good" statement repeats its source's clause word for word** ('the agency said on Thursday that the pipeline had been hit overnight'). It teaches the opposite of own words; it is the first thing to reword if `eval:research` shows statements copying more.
- **The weekday form of a source's date is in three prompts, not one**: research's extraction, story context's extraction and the structure call's `published` attribute. All three carry the `asOf` description that has a weekday counted from the publication date.
- **The shared rule lines are constants in a new module, `server/src/prompts/factRules.ts`** (`STATEMENT_LIMITS`, `AS_OF_RULE`, `CREDIT_RULE`, `FIGURE_SCOPE_RULE`, `publishedWithWeekday`). The as-of and figure lines were hand copies in two prompt files before. A reviewer's Structure check called `prompts/research.ts` a violation once it held them, so they moved out before the commit. `FACT_RECORD` and `RECORD_GOVERNS` stay in `prompts/research.ts` (five docs and three other modules name them there); the backlog line now sends them to the same module.
- **`CREDIT_RULE` is not in story context's extraction rules, and that extraction's support stays one sentence**, as the memo places them. Its statement description got "and how strongly", to stay in step with the statement lines it now carries.
- **`passageAround` was rewritten, and it changes more than two-sentence supports.** It now joins sentence parts that the split cut inside a token, finds the support in the whole text and ends the passage where `supportFound` finds the whole support. Before, a passage could end before its support did and could read "1. 5 million" for "1.5 million", in the words the figure check and the fact check read for a search fact. So the stored passage of a new gap fact can differ from what the old code would have stored for the same page.
- **A rate's unit keeps its currency or percent sign.** The memo's new unit description ("USD per year") would have cost tiles their "$": `formatFigure` knew a symbol only when it was the whole unit. It now reads the unit before " per " ("$52m"; the checks read "$52 million per year"). Found in review, fixed with tests.
- **`structured()`'s source date is a required parameter**, so a caller with none says so (`null`); the three callers pass it.
- **An as-of one day after its source's day is dropped too.** A source dated in UTC about an event dated a day later in local time loses its as-of and falls back to the source's day, one day off. Accepted as designed.
- **This round is dated 2026-11-25 in docs and comments** (the day it was committed), to tell it from ADR-0080's change of 2026-11-24 in stored prompt versions.
- **No ADR.** The choices are prompt wording and three small pure rules, each reversible by an edit; the one with weight, that the as-of stays a point and a period has no field, keeps what is there and is in `.context/story-context.md`, "Validity".
- **`.context/model-eval.md`, `.context/public-website.md` and `BACKLOG.md` were edited too**, each for something the change made untrue or left open.

## Decisions to Review

None.

## Records to Refresh

- `.context/ai-transparency.md` (kept by hand): rows 15 and 16 checked, nothing made untrue. No model, effort default, label, feature, destination or outbound host changed; the prompts' wording and what a citation card may quote did. If the owner keeps two-sentence supports in readers' cards (below), row 15's "supporting sentences" may want a clause.

## Skipped Items

- **No paid eval.** `--dry-run` and `--cache-only` only (below).
- **Server DB tests, coverage floor and the client checks were not run**: no SQL, migration or client code changed (`shared/types/index.ts` got a comment).
- **The eval's fields judge was not changed** (below, User Input Needed).
- **The reuse order's and the later pass's missing fallback were not fixed** (`BACKLOG.md`, research facts, 8): one is SQL with DB tests, the other the later pass's rule.

## User Input Needed

- **Readers can now see two sentences of a publisher's text in a citation card.** A research fact's support may be two adjacent sentences, and the story page's source card quotes the support (`cite`, `researchedStory.ts`; context cards and overview pages show the same field). The research step is on in production, so this reaches readers at the next deploy. The memo did not consider it. If one sentence is the limit: show readers the support's first sentence only, or keep the neighbour in a field of its own for the checks (`BACKLOG.md`, research facts, 10).
- **`--budget 10` probably does not cover the tune run.** The folder stands at $4.82, the 29 first passes are all paid again (the cache-only run: "0 of 29 stories gave offerable facts"), and a story starts only while $0.40 is left. `--budget 15` is safer; the dry run's ceiling is $11.60 for the passes alone.
- **The eval's fields judge reads the old as-of and credit definitions** (`scripts/eval/overviews/prompts.ts`, lines 290, 291 and 352). It is not used by the `--facts pool` runs; before the next `--steps context` run it needs `AS_OF_RULE` and `CREDIT_RULE` in its requirements, or the 95% bar falls for the wrong reason (`BACKLOG.md`, research facts, 9).
- **The owner's decision after the measurement**: whether "credited to" stays in the rendering if the `credit` kind has not clearly fallen (the memo).

## DB Migrations

None.

## Files to Delete

None.

## Implementation Issues

- **The cache-only run wrote a report** into `DOCS/2026-11-19_upkeep-tune`: `overview-eval-steps-pass-pool-fact-check-figure-check-facts-pool-half-tune-cache-only.md` (tagged, so it overwrote nothing). It can be deleted.
- **An arm at another extraction effort overwrites the report of the same flags** (the report's name carries no effort): rename arm 1's report before running arm 2 (`.context/model-eval.md`, "`pass-pool`").

## Borderline Insights

- Every source is cut to its first 4,000 characters before extraction, mid-sentence if need be (`SOURCE_TEXT_MAX_CHARS`, `RAW_CONTENT_MAX_CHARS`). Now in `.context/story-research.md`; a credit or period the article gives further down can appear in no fact.
- `supportFound` already found two adjacent sentences (tests added, no code change). It does not find a copy with a space where a scraped text joins two sentences with none; that only clears the `found` flag.

## Suggested Follow-Up Work

In `BACKLOG.md`, research facts (8) to (12) and the "small helpers" line: the two readers that do not fall back to a source's day, the fields judge, the readers' card, the figure check's judged-half examples, `passageAround`'s first-occurrence search, one module for "is this support in this text" with the source-date readers, and `FACT_RECORD`/`RECORD_GOVERNS` to `prompts/factRules.ts`.

## Showing the run

- Server unit suite: 340 files and 4,913 tests before, 341 files and 4,936 tests after, all green at commit `3279a064` (typecheck, lint, format check and build too).

## Mod code and load settings written

None.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `claude/project-thread-egeer5`, base `main`, push only (the main session lands it). Case for a pull request: none known from this run (the session's rule index shows the landing group's REPO-004 and REPO-006 off); remote protection: check at landing (`no-nonsense-main` needs green `server` and `client` checks or the admin bypass). A push to `main` deploys both services and changes production's research extraction prompt (the research step is on); no migration. Status: done; local commit, not pushed.

# Phase 2 (the fix)

## Controversial Decisions

- **A failed figure call fails the run or pass; the plan's "no answer, no figure" rule is gone for failed calls.** This is the main session's change 1, not the plan's text, which called "a figure without an answer is removed" the owner's rule. As built, only a figure that a parsed answer leaves out or answers with anything but `given` is removed. ADR-0080 records the change as the main session's and lists the plan's first rule among the alternatives. If the owner meant the stricter rule for failed calls too, that is a new decision.
- **ADR-0080 names Odin Mühlenbein and claude-code as deciders**, on the main session's relay of the owner's approval of A and B on 2026-11-24 (the plan says the same in its opening paragraph; it holds no `Confirmed by` line, which the plan left to the main session to record). The entry's first paragraph says which parts are whose. If the owner's approval was narrower than relayed, the deciders line is what to correct.
- **Filler fields are also read as empty when a stored fact is shown** (`renderFact`, the figure item, a figure's unit as the checks spell it, the box check's MEASURES), not only in `structured()` as change 2 said. Reason: facts stored before the change (an editor's earlier "Gather context" runs, carried into later runs) would otherwise still render "credited to: none". One helper, `fieldText` in `schemas/factFields.ts`, serves all three. The list: none, unknown, n/a, null, not specified, unspecified, not stated, not given, not applicable, not available, and a lone dash; any case, the whole field, one trailing period ignored. "na" and "nil" were left out (a place or unit could be abbreviated so).
- **The fact check's record rule accepts an as-of date that is only the source's publication day**, "only for what the evidence states as its present". Not in the plan's wording. Reason: a present-tense count with an as-of of the publication day is what the eval's second judge already calls context, and without the sentence the small model may reject such facts wholesale. It is unmeasured calibration in a prompt research's own check shares (inert there); the `--facts pool` run measures it (false rejections, faithful share). Listed in `BACKLOG.md`.
- **The figure prompt differs from the plan's text in two places.** The rounded-form example "nearly 3 million for about 2.9 million" would have taught the checker to accept a precision the source does not give; it now reads "2,880,000 for about 2.9 million, nearly 3 million for about 3 million". `other-thing` gained two cases measured on 2026-11-24: the three weeks a report covers taken as how long the fighting lasted, and a year taken as an amount ("by 2027" as 2,027 years).
- **`RECORD_GOVERNS` and the stands prompt say more than the plan's sentences**, as the main session asked: the governing sentence names dates, periods and credit with one example each, and the stands prompt adds that a record's brackets and labels never appear in a sentence (the plan had that line for the card write only; the stands rule's own example now quotes "credited to: the health ministry", which a writer could copy).
- **The eval's second judge no longer gets research's statement as a separate element** (the rendering holds it), and gained one requirement: a record is read with its statement, so a field is a change for what it states that the source does not, never for leaving out a period or a "would" its statement keeps. Without it a faithful statement with a bare "figure: 50%" beside it would count as changed. The judge's prompt therefore differs between the "before" and "after" measurements, which `.context/model-eval.md` says.
- **The figure check is folded into step 8** of `.context/story-context.md` instead of getting a number of its own, so no other step number moved (code comments and other docs cite them).
- **`.context/ai-transparency.md`: row 16 only.** The plan also named row 15, which is research's own run; it has no figure check, so adding it there would be untrue.
- **The two agreement shares of the figure eval are shown with counts and no bar** (the plan gives them no target); the two planted-error shares are bars, report only.
- **The plan got an "As built (phase 2)" note** above its Tests section, since several of its paragraphs no longer hold (the failed-call rule above all).
- **`CLAUDE.md`'s context table** got a few words in the story-context and model-eval rows so the figure check can be found from the index.

## Decisions to Review

None that names only the agent: ADR-0080 (`.context/decisions/0080-fact-statement-governs-model-judges-figures.md`, accepted) names the owner beside claude-code. See the first two items above for what in it is the agent's.

## Records to Refresh

- `.context/ai-transparency.md` (this repository's own AI record, kept by hand, not one `ashoka-engineering:records` keeps): refreshed in this change, row 16 (a model now judges each figure against its source; the small-tier step list). No label, copy, model, provider or outbound host changed; the new call sends a fact's figure and its source sentence to the same provider as the fact check. No personal-data change.

## Skipped Items

- **No paid eval was run.** The measurements after the change are the main session's.
- **The client build's prerender and the server's DB tests and coverage floor** were not part of this run's checks beyond what the summary names (the caller asked for the unit suite; `test:db` and `test:coverage` on the server need the test database).
- **`researchPassFlow.db.test.ts` was not run or changed**: none of its facts carries a figure, so it makes no figure call.

## User Input Needed

- **The stands line overwrites an existing report.** `--steps pass-pool,stands,fact-check --facts stands --half judge --repeat 3` writes `overview-eval-steps-pass-pool-stands-fact-check-facts-stands-half-judge-repeat-3.md` in `DOCS/2026-11-19_upkeep-eval`, the name of the report from before the change. Rename the old one first if it is to be kept.
- **The owner sets the bars** after the first measurement: the two faithful shares, the figure check's catch and false-removal shares.
- **The methodology page** says "A separate AI check compares each fact with the sentence it came from and drops what that sentence does not say" (the approved paragraph waiting for the context switch, `.context/story-context.md`). It stays true; whether it should mention that a figure can be dropped while its fact is kept is the owner's wording.

## DB Migrations

None.

## Files to Delete

None.

## Implementation Issues

- **Prettier's write in the client rewrote the line endings of about 230 files on disk** (CRLF to LF; `.gitattributes` sets `eol=lf`, so git sees no content change, but `git status` lists them as modified until the index is refreshed). The commit names its files by pathspec and leaves them out. `git add --renormalize .` or a fresh checkout clears the listing; not done here.
- **A pass's failure reason reads `facts-check: figure-check: error`** when the figure call fails, because the figure check runs inside the fact-check stage's catch. Left as it is and documented in `.context/research-passes.md`.
- **A figure the check answered against can stay stored** when the fact check then leaves its fact unjudged (the fact is judged again by the next pass, figure and all). By design (the plan); the figure eval leaves such a figure out of both groups.
- **Found in review and fixed before the commit:** `checkFacts` recorded the removals before the fact check ran, so a pass whose fact check then failed or hit its budget kept, in its record and on the admin's pass view, figures "removed" that the pool still held. The removals are now recorded only with the facts the checks return (tests for a failed and a skipped fact check, in the pass and in a context run). And the figure eval counted an unjudged fact's figure as kept by production; it now samples only figures of facts the fact check judged.

## Borderline Insights

- The eval's import guard (`scripts/eval/imports.test.ts`) forbids importing `storyContextVisuals` from the eval, so the figure eval spells a planted number through `figureItemOf` rather than `spelledFigure`. Worth knowing before adding another eval that needs a number spelled.
- `wrongFigure`'s times-2 fallback is reached only where times 1.5 rounds back to the same value at the figure's own precision (0.001), so in practice almost every planted number is times 1.5.

## Suggested Follow-Up Work

Everything left open is in `BACKLOG.md`, each with its seam, so each is ready to queue:

- What stays open on research facts (seven points, among them the pool's `measures` keeping a removed figure's counted phrase, which the correctness review found: it needs `updateFacts`' SQL and its DB test, so it was not done here).
- The split of `storyContextPipeline.ts`.
- **One two-pass runner for the eval's label-then-arms checks.** The simplicity review rated this important: `figureCheck.ts` repeats `factCheck.ts`'s harness function for function. Deferred, not fixed: the shared runner means rewriting `factCheck.ts` and `factDrift.ts`, which this change did not otherwise touch, right before paid runs whose cached calls depend on the planned calls matching the calls made. The architecture review judged the module sound as shaped.
- **The eval CLI's `main`.** All three reviews' Structure checks called it a violation this change worsened (one more step branch). Fixed for what this change added, and a little more: both sampling steps (`fact-check`, `figure-check`) and their dispatch moved to `overviews/samplingSteps.ts`, so `main` is shorter than before the change (the file went from about 690 lines to 634). The step table for the other steps is the backlog item.
- Small helpers copied instead of shared (one line in the backlog).

## Showing the run

- Server unit suite: 340 files, 4,913 tests green at the commit (334 files after phase 1).
- Client suite: 188 files, 1,696 tests green.

## Mod code and load settings written

None.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `claude/project-thread-egeer5`, base `main`, push only (the main session lands it). Case for a pull request: none known from this run (the session's rule index shows the landing group's REPO-004 and REPO-006 off); remote protection: check at landing (`no-nonsense-main` needs green `server` and `client` checks or the admin bypass). A push to `main` deploys both services; this change has no migration. Status: done; local commits, not pushed.

# Phase 1 (the drift bar)

Phase 1 only measured; its notes follow as its run left them.

## Controversial Decisions

- **The fact sources are two tables, not the plan's one.** The plan has one `FACT_SOURCES` map in `overviews/factSources.ts` (the step each source needs and its sampler) that `options.ts` reads. That would make the flags module, which all four eval CLIs import, load the step modules (`stands.ts`, `link.ts`, the sandbox and the services behind them) and import a module that imports it back for its types. So the vocabulary stays where the other flag vocabulary is, `OVERVIEW_FACT_SOURCES` in `options.ts` (per source: the step it needs, what it samples, whether the sample is rendered module-1 facts), and `factSources.ts` holds the samplers, `FACT_SAMPLERS`. Both are keyed by `OverviewFactSource`, so the compiler refuses a source that has one entry and not the other. Alternative: the plan's single map, with `options.ts` importing it. Phase 2's `figure-check` validation ("refused without `--facts pool` or `context`") reads the `rendered` flag in `options.ts`. Two reviewers judged the split better than the plan.
- **Every rejected fact is listed, by group, in place of the capped list.** The plan says the unfaithful facts "are already listed with the judge's reason". That list stops at 30 and does not say which facts carry a figure, and the "before" list cannot be printed again from the cache once phase 2 changes the rendering. So for a rendered sample (`--facts pool`, and `--facts context` too) the fact check's section now ends with the measure's block: the two shares, each group's counts, then every rejected fact, those with a figure first. The other samples keep the capped list. This changes the tail of a `--facts context` report as well: the same facts, uncapped and grouped.
- **The fact check's report section moved to its own module, `overviews/factCheckReport.ts`.** Not in the plan. `report.ts` rendered that one step's section inline while every other step has its own report module, and this change grew it; two reviewers' Structure checks called it a violation. The move is word for word for research's and the stands' samples.
- **`FactSample` moved from `report.ts` to `factSources.ts`,** beside the samplers that build it, with `sampledFacts`, which the report and the CLI both read.
- **`runPassPool` returns each story's facts, not its context record.** The plan's phase 1 table also names the record; its only reader is phase 2's `figure-check` sample (`record.removedFigures`), so phase 2 adds it with that reader.
- **The shortfall line of a module-1 sample reads "run 1 kept no more"** instead of "the context step kept no more", since the pools use the same sampler. Report wording only; nothing sent to a model changed.
- **An "As built" note was added to the plan** under its phase 1 table (the names phase 2 will meet: no `FACT_SOURCES`, `stories` without the record, `factCheckReport.ts`). The plan's own rows were left as written.
- **Two stale sentences in `.context/model-eval.md` were corrected** though this change did not make them untrue: the upkeep section and the gate's cost paragraph said no paid run had been made, while the new text relies on the upkeep folder's cache. Checked against the reports in `DOCS/2026-11-19_upkeep-eval` and `DOCS/2026-11-19_review-eval` (all dated 2026-11-24) and the dry run's ledger line ($5.16). The measured costs were not carried into the gate's estimates: that is the main session's, with the runbook.
- **A second commit formats `upkeepReport.ts`.** `npm run format:check` (which CI runs) failed on that file as it stood at `aa4d911a`, before this work: one long line Prettier wraps. It is not a line-ending rewrite, so it was not left out; it is its own commit so it can be dropped or kept apart from phase 1.

## Decisions to Review

None. ADR-0080 stays a `proposed` stub in the plan: phase 1 only measures and carries out none of it, so nothing was promoted to the log.

## Records to Refresh

None: phase 1 changes no model, prompt, provider, stored data or outbound host. It adds an eval sample and a report section.

## Skipped Items

- **One helper for the bars' console line.** `overviews.ts` prints a step's bars with the same expression in six places, one of them new here. Left as it is: the fix would touch five steps this change does not.

## User Input Needed

- **The "before" run's budget.** `--budget` caps the upkeep folder's running total, and a `pass-pool` story starts only while the folder has a first pass's reserve of $0.40 left, even when the cache answers it. The dry run on 2026-11-24 printed a ledger of $5.16, so `--budget 13` leaves $7.84: enough for the reserve and the plan's $1.50–2.50. The harness cannot price the labels and arms before `pass-pool` has run, so the dry run prints no estimate for them.
- **The owner sets the two bars** after the first measurement (the plan). Until then both shares are shown against 95% and decide nothing.

## DB Migrations

None.

## Files to Delete

None.

## Implementation Issues

- **The plan's phase 1 list of rejected facts was not enough to read the measure with** (capped at 30, unsplit); fixed as above.
- **`format:check` was red on the branch before this work** (`upkeepReport.ts`); fixed in its own commit.

## Borderline Insights

- `.context/model-eval.md`, under `key-draft`, still says "No paid run has been made." This run found no key-drafts folder under `DOCS/`, so it may be true; not changed.
- The group "facts with a figure" holds two renderings: fields alone where the fact names what its figure counts (the drift the plan is about), and the statement with the figure beside it where it does not. The report and `.context/model-eval.md` say so; if the first run shows the second kind is common, a third row would separate them.

## Suggested Follow-Up Work

- **Phase 2's figure section in its own report module.** The plan's phase 2 row sends "Figure check against its source" into `overviews/report.ts`; it should go beside `factCheckReport.ts` (the plan's "As built" note says so).

## Showing the run

- Server unit tests after phase 1: 334 files green (the count before was not taken).
- `format:check` on the server package: failing on one file before, passing after.

## Mod code and load settings written

None.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `claude/project-thread-egeer5`, base `main`, push only (the main session lands it). Case for a pull request: none known from this run (the session's rule index shows the landing group's REPO-004 and REPO-006 off); remote protection: check at landing (`no-nonsense-main` needs green `server` and `client` checks or the admin bypass). Status: done; two local commits, not pushed.

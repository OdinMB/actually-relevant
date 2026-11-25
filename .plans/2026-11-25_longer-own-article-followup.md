# Follow-up: research reads more of a story's own article (2026-11-25)

Task: the owner's decision of 2026-11-25, implemented directly from the caller's description (no plan file). Branch `claude/project-thread-egeer5`, on top of `bdde2f05`.

## Controversial Decisions

1. **Only the story's own article (S0) gets 12,000 characters and 12 facts; cluster members and neighbours keep 4,000 and 8.** One rule for all own texts would not have been simpler: they reach the extraction as candidates of the source filter, whose syndication comparison reads a candidate's whole text against the original's first 4,000 characters, so a longer candidate text changes which reports are dropped as copies; and with up to four of them a story, 12 facts each would outweigh the search results in the pool. Cost was not the reason (an estimated $0.0005 a story more on average, about $0.004 at most). To extend it later: `sourceText`'s third argument in `researchInput.ts`, `selectedText`'s cut and `maxFacts` in `extractCoverage`.
2. **The facts cap reaches the model in a closing `<REQUEST>` block, and the schema's `facts` description names that block instead of a number.** This follows the house order (`.context/prompting.md`, item 4) and keeps one schema and one cached prefix for every source. Its price: every extraction prompt changed, a search result's too (their cap of 8 is now stated in `<REQUEST>`, no longer in the schema), so the change to search sources is not zero, and every cached extraction call in the eval folders misses once. The alternative, a second schema for S0 with "At most 12" in its description, would have left the other five calls of a story byte for byte as they were, at the price of a forked schema, a second cached prefix and a number in a description.
3. **Cluster members' and neighbours' texts are cut at a sentence end too** (same function, same 4,000). It is not strictly "changes nothing else": the syndication comparison now reads such a candidate up to its last whole sentence, at most 500 characters less (measured: 269 of 526 such texts in the two eval folders are shorter, by at most 489 characters). The original's side of that comparison and the queries prompt read exactly the characters they read before.
4. **The cut does more than "the last sentence end".** Measured on the eval folders' real texts, a first version (the later of the last cautious sentence end and the last line break) ended 14 of 211 cut texts on a dangling heading or caption and cut 25 mid-sentence at the limit: texts scraped with their paragraphs joined ("…on Monday.The ministry said"), which the cautious splitter of the reader quotes does not split. The final rule, in order: the last cautious sentence end in the 500 characters before the limit; with none, the last line break; then the last stop with no space after it (titles and abbreviations excepted); then the limit. Result on the same texts: 207 end at a sentence's stop, 4 at a line break after a caption or reference line, none at the limit. The joined-stop rule is used by the cut only, never for reader quotes.
5. **One budget estimate for every extraction call, raised from 2,000 to 3,000 output tokens**, instead of a larger one for S0 alone: the meter keys estimates by step, and the difference is about a third of a cent of reservation a run against a $0.25 ceiling.
6. **Both eval caches that hold loader output got a version.** `PASS_INPUTS_VERSION` 2 (the overview evals' `pass-inputs.json`: every slug is loaded again from the local database by the next run that needs it) and, after review, `RESEARCH_FIXTURES_VERSION` 2 (eval:research's `research-fixtures.json`: resampled, as a size change already was). Resampling takes the stories published last in the database as it is then; reloading the same ids was not built.
7. **`RAW_CONTENT_MAX_CHARS` was merged into `sourceLimits.other.textChars`** (both 4,000, both in `selectedText`): no behavior change, one limit for what an extraction reads of another source.
8. **`.context/ai-transparency.md`, row 15, got one dated clause** (not in the caller's list): `CLAUDE.md` asks for it when an AI feature changes, and the row already records the extraction's effort the same way.
9. **The review fixes were written test-first inline**, not through a second `tdd-guide` run (the cut's order and joined stops, the research fixtures' version).

## Decisions to Review

None. No choice here passes the test for an ADR (two constants, a prompt layout that follows ADR-0069, a cut rule): none is hard or expensive to reverse. The owner's decision is recorded with its date in `.context/story-research.md`, "What the extraction records".

## Records to Refresh

None of the plugin's records exist here (no data inventory, model card or DPIA-lite). The project's own AI record, `.context/ai-transparency.md`, was updated in the change (Controversial Decisions, 8).

## Skipped Items

- `npm run test:db`, `test:coverage`, `check:migrations`, the client's checks and both `audit:prod` were not run: the caller asked for typecheck, lint, format check, unit tests and build. No `*.db.test.ts` pins a text length or a facts cap (searched). CI runs them on a push to `main`.
- No paid eval. Only `--dry-run` and `--cache-only`.

## User Input Needed

- **Whether to push before the paid runs.** Every extraction prompt changed and the own article's text is up to three times as long; `.context/prompting.md` has a changed prompt go through its eval, and `research_stories` runs in production nightly. The change is live at the next deploy either way.

## DB Migrations

None.

## Files to Delete

None outside the project. Inside it, in the gitignored `DOCS/` (kept on purpose, the owner's to delete):

- `DOCS/2026-11-19_upkeep-tune/.cache/pass-inputs.v1-own-text-4000.json` and `DOCS/2026-11-19_upkeep-eval/.cache/pass-inputs.v1-own-text-4000.json`: the pass inputs as cached on 2026-11-24, before my `--cache-only` runs reloaded `pass-inputs.json` at version 2.
- `DOCS/2026-11-19_upkeep-tune/overview-eval-steps-pass-pool-fact-check-figure-check-facts-pool-half-tune-cache-only-2026-11-24.md`: the earlier cache-only report of that name, which my run overwrote.

## Implementation Issues

- **`.context/eval-baselines.md` appeared untracked at 02:32 during this run**, written by another session (its text names this change as not yet measured). It is not mine: left as it was, not committed.
- **The judged folder's ledger reads $8.61**, not about $9.50 (`--dry-run`, 2026-11-25).
- **`pass-inputs.json` in both upkeep folders was replaced by this run** (the `--cache-only` evidence runs load the inputs before any call, and the version bump made them load from the database). The old files are kept beside them (Files to Delete). Compared with them, the reloaded inputs differ in the cut texts and the load day alone.

## Borderline Insights

- A stored article text can be "joined": paragraphs concatenated with no space after the stop (25 of 211 cut texts in the eval folders, wire-agency copy on several outlets). The reader-quote splitter treats such a support as one sentence (`.context/story-research.md`, "Where the split still errs"). Whether the crawler should store a space or line break between paragraphs is a content-extraction question, not looked into here.

## Suggested Follow-Up Work

- **Pool row order** (in `BACKLOG.md`): a pool read back from its rows orders one pass's facts by `ref` as text, so `S0F10` to `S0F12` come before `S0F2`; with 12 facts on S0 this now happens for any full own article once research passes are on. Nothing in production reads a pool today.
- **Split `researchPipeline.ts`** (in `BACKLOG.md`, with the seams): all three reviewers' Structure checks called the 853-line file a violation; this change grew it by ten lines inside its coverage steps and added no responsibility, so it was not split here.
- **An arm that separates the two changes is not built.** The paid runs measure the longer text, the 12-fact cap and the cap's move into `<REQUEST>` together; on the judged half also the fact rules and effort `low` of earlier that day, never run there. Separating them needs the two numbers in `config.research.sourceLimits.original` set back locally and the pass inputs loaded again, at about one more run's cost a half.
- **The eval's desk estimate** (`STEP_ESTIMATES.extract`, `scripts/eval/research/pipeline.ts`: 15,000 input and 10,000 output tokens a story) is the design's row and was left; S0 can add about 2,000 input tokens.
- **A stop at a line's end as a sentence end** (the fix review's note, not built): one of the 211 cut texts ends on a photo-credit line because the paragraph's own stop is followed by a line break and "©", which the cautious rule does not take for an end. A tier between the sentence end and the line break (the last stop, not an abbreviation's, that a line break follows) would end it at the paragraph. It changes cuts, so both eval caches' versions go up with it. Also cosmetic: a joined stop followed by a straight quote keeps that quote at the cut's end (`…press release."And` ends on `"`).

## Showing the run

- Cut texts ending at a sentence's stop, on the 211 cut own-corpus texts of the two eval folders: 207 (98%) with the final rule; 172 with the first version of the rule; before the change every text was cut at character 4,000 wherever that fell.
- Own article text reaching the extraction, mean characters: tune half 3,386 → 4,798 (15 of 29 longer), judged half 3,554 → 5,547 (25 of 37 longer).

## Mod code and load settings written

None.

## Landing Queue

- repo `OdinMB/actually-relevant`, branch `claude/project-thread-egeer5`, base `main`: push only, on the owner's word (a push to `main` deploys production once CI passes, `CLAUDE.md`, "CI and deploy gate"). Pull-request case: none (REPO-004 and REPO-006 are not among the rules active here); remote protection: check at landing (ruleset `no-nonsense-main`, required checks `server` and `client`). folder: the session's main folder. Commit `46ab57b2` on top of `bdde2f05`. status: done.

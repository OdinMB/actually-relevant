# Follow-up: readers see one source sentence; extraction at effort `low` (2026-11-25)

Direct task, no plan file. Branch `claude/project-thread-egeer5`, on top of 3279a064.

## Controversial Decisions

1. **How the one sentence is picked: code, not the model.** `quotedSentence` (`server/src/services/readerQuotes.ts`) splits a fact's support into sentences and quotes one of them, picked against the fact's own statement: the sentence that gives the most of the statement's figures; among those, the one that shares the most numbers and words (four characters or more) with it; among those, the later one. No prompt, no schema, no migration changed, so no paid eval cache is invalidated.
   - Why not have the extraction name the stating sentence (the task's first example): it changes the extraction's schema, so every cached eval call of it misses and the tune-half numbers of 2026-11-25 would describe a schema that no longer ships; the mark needs a column in both fact tables (`context_facts`, `pool_facts`), and the Prisma client cannot be regenerated unattended; and it would not have held the limit by itself, because extractions copy more than they are asked for. Measured on the cached tune-half extractions with the shipped function: 10% of supports hold more than one sentence under the two-sentence rule (71 of 677 at `none`, 72 of 692 at `low`), 3% did before it (18 of 594), and 9% of story context's own extraction, which asks for one (55 of 631). So readers were already shown more than one sentence in a few percent of cards before 3279a064, and the code rule ends that too.
   - Why not "the first sentence" (the backlog's suggestion) or "the last": read on about 120 real multi-sentence supports from the cache, the stating sentence is first about as often as it is second.
   - Why figures first (added after code review): a statement names its speaker in the words the neighboring sentence uses and restates the claim in its own, so counting shared words alone favors the sentence that only names the speaker. A year and a day beside its month are not figures, because the sentence that names the period carries them too (seen in the cache: with dates counted as figures, a fact dated "November 3" was quoted with the sentence about the date). Digits inside a name ("H5N1", "COVID-19") are no number.
   - What it still gets wrong: a statement that draws on both sentences is quoted with one of them; a claim without a figure whose speaker has a long name can be quoted with the sentence that names the speaker, most of all for a support in another language (only names and numbers match an English statement).
   - The splitter is cautious on purpose (a false split would cut a one-sentence quote short, and nine in ten supports are one sentence): it does not split after an initial or dotted abbreviation, a listed title, company form or month where capitalized, a number of one or two digits (German dates), a quoted question or exclamation followed by who said it (after a CJK stop, any quotation), or an ellipsis before "I". A piece without a letter or a digit is never quoted. So two sentences still show together where the first ends in one of those, where the second starts with a digit or lower-case letter, or where the scraped text joins them without a space (seen in the cached supports). A bracketed ellipsis, which a search engine puts between two passages, always splits and is never quoted.
   - One reviewer suggestion not taken: never to end a sentence at an ellipsis. The three ellipsis-then-capital cases in about 1,400 cached supports were all real sentence ends (a quotation cut between two sentences), so only the ellipsis before "I" is kept from splitting.
2. **The picked sentence is stored in the projection at apply, not trimmed at read time.** `stories.research` and article versions built from now on hold the one sentence. Versions applied earlier keep the support they stored (3279a064 is not deployed, so none holds a deliberate two-sentence support; about 3% hold more than one sentence the model copied anyway), and a later pass carries an unchanged section's citations over byte for byte. Trimming old projections at read time would need the fact's statement, which the projection does not hold. **For the owner:** his rule reads "everything a reader can see"; those roughly 3% of older citations stay as they are until the story is researched again. Accept that, or re-apply those stories.
3. **One shared function for the three reader-facing places** (`citationsOf`), replacing three copies of the same loop. Two small behavior changes with it: on context cards and overview pages, a source first cited by a fact with an empty support now takes the sentence of its next cited fact, as researched stories already did (not expected to show: context's pipeline drops facts without a support); and a quoted sentence is trimmed and never carries a search engine's "[...]" joiner.
4. **`server/env.example` gained a commented `RESEARCH_EXTRACTION_EFFORT=low` entry.** The variable was not listed there before (the blueprint test lets code-default tunables stay out); the task said to update the file. `render.yaml` is unchanged: the blueprint test does not require the variable there.
5. **The test that pinned the default effort's literal (`'none'`) now only checks that the small tier's model accepts the default.** A literal-equals-literal assertion would have had to be edited with every change of the default.
6. **No ADR.** Checked against the handbook's test for an ADR (costly to reverse, constrains what is built next, or "why on earth"): the reader rule is one pure function at three call sites and the effort is one default with an env override. The reasons are in `.context/story-research.md` ("What a card quotes", "What the extraction records") and the commit message. The owner's decision itself (readers see one sentence) is recorded in the same places as his.

## Decisions to Review

none

## Records to Refresh

none: `.context/ai-transparency.md` is updated in the same commit (row 15's extraction effort; §3's note on what a citation card quotes). No dependency, model, provider, prompt, stored personal data or outbound host changed.

## Skipped Items

- **DB tests were not run** (`npm run test:db`): `TEST_DATABASE_URL` is not set in this shell. The two DB-backed reader views (`storyContextView.ts`, `overviewPublic.ts`) changed only by calling `citationsOf`; their DB tests use one-sentence supports without an inner stop, which the function returns unchanged, so they should pass, but that is not verified. No `*.db.test.ts` was added or edited: neither view has a test with a two-sentence support yet (the fence test and the unit tests cover the rule). Run `npm run test:db --prefix server` (and `test:coverage`) before pushing.
- **The paid eval was not run**, as instructed. Nothing in this change alters a prompt or a schema sent to a model.

## User Input Needed

none

## DB Migrations

none

## Implementation Issues

- **Two review rounds changed the rule after the first green run.** The first review found false splits after unlisted abbreviations and a bias toward the sentence that names the speaker; the second, a narrow one on the fix, found two defects in the splitter's CJK branch (a closing quotation mark split off as a "sentence" and then quoted on a tie; a quoted Chinese statement split from who said it). All are fixed with tests seen failing first. The CJK cases rest on unit tests with invented sentences only: the cached supports read during this run were English and French, and none was checked for Chinese, Japanese or Korean text.

## Borderline Insights

- The eval's tune folder shows that "one sentence" was never fully held by the model: 3% of supports held more before the two-sentence rule and 9% of story context's. Any future limit on how much publisher text readers see should be enforced in code at the reader boundary, not asked of a prompt. Recorded in `.context/story-research.md`, "What a card quotes".

## Suggested Follow-Up Work

- **Measure the two other extraction steps at `low`.** The default now also moves a pass's gap-search extraction and structure call to `low`; the tune folder's cache holds no call of either at `low`, and none of research's own extraction (`extractionSchema`, the one production's research step runs today). Cost is bounded (their estimates of 2,000 and 1,500 output tokens are unchanged); what `low` does to their facts is unmeasured. In `BACKLOG.md`, research facts (1).
- **A DB test with a two-sentence support for each of the two DB-backed views** (`storyContextView.db.test.ts`, `overviewPublic.db.test.ts`), written where `TEST_DATABASE_URL` is available.
- **If wrong picks show up on pages**, the sturdier rule is a mark from the extraction. In `BACKLOG.md`, research facts (12), with the older versions' whole supports.
- **Two sentence splitters now exist** (`sentenceParts` in `storyContextSources.ts`, `sentencesOf` in `readerQuotes.ts`). In `BACKLOG.md`, research facts (11): merge them together with the `passageAround` fix, between paid runs, since both change the checks' prompts.
- **Sentences a scraped text joins with no space** ("…response.""A vessel…") are quoted together. A split at a lower-case word, a stop and a capital with no space between them would catch them at some risk to names such as "Example.Com"; left out until it is seen on a page.

## Showing the run

- Supports holding more than one sentence, cut to one for readers (cached tune-half extractions, the shipped function): 71 of 677 at effort `none`, 72 of 692 at `low`.
- Extraction call at `none` against `low` (146 calls each): output tokens 743 against 1,039 (reasoning 0 against 209), $0.00047 against $0.00063.

## Mod code and load settings written

none

## Landing Queue

- repo `OdinMB/actually-relevant`, branch `claude/project-thread-egeer5`, base `main`, push only (the caller lands it); the repository's own rule: pushes to `main` need green checks or the admin bypass (CI ruleset `no-nonsense-main`); remote protection: check at landing. Status: done.

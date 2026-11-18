---
status: in-progress
type: feature
complexity: complex
---

# Research passes: one repeatable research step over one evidence pool per story

Approved by Odin on 2026-11-17 ("If the new system for gathering information and displaying it in the story and context cards is still to be built, do that now"), after agreeing to one step with one budget, the article kept unless something is wrong or substantially different, and Updates that keep the earlier text. The For Odin items proceed on their recommendations until he says otherwise.

Owner direction (Odin, 17 Nov, this thread): "research should be one step to add context, and which can be repeated to get more and more context, always adding sources (if any are new), updating context boxes, dropping facts, etc. With the initial pass that is part of the pre-publication chain closing the most important context gaps like perspectives from other news outlets." This plan merges story research (`.context/story-research.md`) and story context (`.context/story-context.md`, overviews module 1) into that one step. It builds on the roadmap `.plans/2026-11-16_story-overviews.md`. Module 2 (overviews) will read the pool this plan creates.

The handbook's `plan-decisions` skill was not loaded when this plan was written, so the plan has no handbook header and no decision stubs. Each decision is set out under "Approach" with its alternatives, "ADRs to write" says what the implementer records, and "For Odin" lists the decisions that change what readers or the owner would notice, each with a recommendation.

Naming used below: a **pass** is one run of the step on one story. The **pool** is the story's evidence: its sources, facts and searches, kept across passes. A **version** is one state of the article's text. An **Update** is the note readers see when a version changes the article. A **box** is the stored card record, and a **card** is how the page shows it.

## Standing decisions this plan keeps

- No person in the loop for the nightly chain (ADR-0062, roadmap D3).
- Nothing about context holds the edition: a failure in the card stage never fails the pass, and the chain's publish gate holds only what research's gate holds today (below).
- Research's fact check judges facts and numbers, never code (ADR-0057, D4). One named source is enough (ADR-0063, D5).
- Always look for a constructive element. Its searches go first, from two angles, and no card is shown when nothing sourced is found (ADR-0065 and its amendment, D10).
- Cards have no In numbers box, and each figure sits in its slot's card (ADR-0063 amendment). Placement modes and limits, the tile and chart rules (ADR-0064) and validity stay as they are.
- Every model step has an eval, and the step ships switched off until its eval passes (ADR-0066, D8).
- The article's own facts, research's own-words and copying checks, repair rounds (ADR-0058), "newest information leads", the key-quote rules, publishers' opt-outs (ADR-0056) and the story's AI labels stay as they are. The label wording is owner-approved and does not change without him.

## For Odin

The decisions below change what readers or you would notice. Each has a recommendation. Everything else in this plan is an implementation choice the plan settles.

1. **The monthly cap.** The merged step has one budget, research's `RESEARCH_MONTHLY_CAP_USD`, which today is $30 a month and counts research only. At the targets below (about $0.16 for a first pass), 120 to 330 selected stories a month cost about $20 to $55, plus editors' passes. Once the cap is reached, the nightly chain records a $0 skipped pass and the story publishes single-source with no cards (today's rule). **Recommendation: raise the default to $60 when the step is switched on.** The alternative is to keep $30 and accept single-source stories late in a busy month.
2. **Where Updates show and how the old text is shown.** **Recommendation:**
   - The header line gets "Updated Nov 19", after the original's date, linking to `#updates`.
   - A ruled "Updates" section sits after Caveats and before More context, newest first. Each entry gives its date, then the note (what changed and why, one or two sentences, cited like a paragraph), then a closed "Earlier version" disclosure per changed section, holding that section's old text with its citations.
   - A small "Updated" link after each rewritten paragraph or point leads to its entry.
   - Alternatives: the notes at the top of the article (more prominent, but they push the story down on phones), or the section at the very end before Sources (less visible).
3. **An editor's "Research again" applies itself.** One step means the same rules for the nightly pass and an editor's: an editor's pass writes its version and its Update at once. "Undo this update" (the newest version only) and "Revert to single-source" stay one click away. **Recommendation: yes.** "Use this version", bulk apply and the review-before-apply flow then go. The alternative keeps "Use this version" for editors' passes, which means two apply paths and two kinds of pass.
4. **Retire the after-publish catch-up.** Today the context step's second part builds the cards of stories published without them within 3 days. With context before publishing inside the one pass, a story published without a pass (step off, published by an editor, cap reached) would get a first pass after it went live, and the article would change minutes or hours after publication, which you ruled out on 17 Nov. **Recommendation: retire it.** Such a story gets a pass when an editor clicks "Research again". The alternative keeps an automatic pass on published stories still owed one, cards only, never rewriting the article.
5. **A first pass on an already-published single-source story** (only an editor's button starts one). The pass turns the story into a researched story, with a new headline, paragraphs and analysis, as "Use this version" does today. **Recommendation: record it as an Update**: "Researched with N more sources on Nov 19; the story was rewritten from them." The earlier version stays readable behind "Earlier version". The alternative is a silent swap, as today.
6. **Cards refresh without an Update.** A later pass rewrites the cards from the whole pool. Their "As of" footers show the new date, but no Update entry lists card changes. **Recommendation: yes.** Updates are for the article. Listing card changes would crowd the section with small refreshes. The alternative lists "Context cards updated" in the Updates section.
7. **Methodology wording.** The paragraph you approved on 16 Nov ends "Each card gives the date its facts are from; we don't update cards later." That becomes untrue. The proposed replacement goes into "Researched Stories" in the same change that switches the step on, in place of the held paragraph. **Please approve or edit it:**
   > Many stories carry context cards: how big the development is compared with what came before, why it is happening now, who it reaches, what is being done and what comes next. An AI model reads the sources our research found and, where something a reader needs is missing, searches for more. Every number on a card names its source, and when sources disagree we show both. A separate AI check compares each fact with the sentence it came from and drops what that sentence does not say. Each card gives the date its facts are from. When we research a story again, its cards are rewritten from everything found so far, and if new facts make part of the story wrong or substantially different, we rewrite that part and add an update saying what changed, when and why. The earlier text stays readable under the update.

No new AI label is proposed. The Update notes and the earlier text are AI-written and fall under the story's existing "Researched and written by AI." line, as the cards do (owner decisions of 2026-11-16 and 2026-11-17). They also carry the machine-readable markers below.

## Problem

Research and context are two steps over two sets of records. Research's runs are jsonb rows that write nothing until applied. Context's runs keep their own per-run facts and boxes and re-check research's facts. They have two budgets (research's $30 cap against context's uncapped spending line), two switches, two admin buttons and two run views. Neither can update a published story. Research can only replace the whole article, and context only adds cards. So the owner's model of research, one step that is repeated and adds sources, refreshes cards, drops facts that turned out wrong and corrects the article openly, cannot be built on either one. Module 2 (overviews) needs a story's evidence in one place with its provenance, and today that evidence is split across a jsonb blob and per-run copies.

## Approach

### What changes, in one paragraph

A new step, the `research_pass` job, replaces `research_stories` and `build_story_context`. It has one switch (its job flag), one budget (research's monthly cap, now counting every pass), one spending line and one admin button ("Research again"). A pass reads and grows the story's **pool**: sources, facts with their verdicts, and the searches made, each with the pass that added it. A **first pass** (the nightly chain, before publishing) writes the researched article from the pool with research's existing write, checks and repair, then writes the cards with context's existing write and box checks. A **later pass** (an editor's button only, for now) adds what is new, drops facts a newer source contradicts, and asks per section whether anything is now wrong or substantially different. It rewrites only those sections and adds an Update. Then it rewrites the cards from the whole pool. Every version of the article is kept, so readers can open the earlier text under each Update. The old tables stay as read-only history.

### Records (the pool and the versions)

New tables, all keyed to the story. Each carries the pass that wrote it, which is its provenance. The split follows the roadmap's Evidence and Judgments rule: what was fetched is kept word for word, and every model answer carries its model and prompt version. Nothing written by the model is fed back as evidence.

- **`research_passes`**: one row per pass, replacing both run tables for new work.
  - Columns: `id`, `story_id` (SET NULL, so a deleted story's spend still counts), `number` (1… per story), `trigger` (`pipeline` | `editor`), `kind` (`first` | `later`), `status` (`running` | `completed` | `skipped` | `failed`), `outcome` (`written`, `updated`, `unchanged`, `stale`, `contradicted`, `fallback`, `update_failed`, `budget`, `technical`), `verdict` (research's gate kind on a first pass), `cost_usd` (the reservation while running, then the measured cost, as ADR-0055), `model_usd`, `tavily_credits`, `record` jsonb, `error` (sanitized), `started_at`, `finished_at`, `version_id` (the article version it produced, or null).
  - `record` holds everything else the pass did: research's `StoryResearch` fields (calls, checks, problems, failedOn, verdict with category) and context's `ContextRunRecord` fields (slots, drops, tally, responseNotFound), plus the later pass's section judgments and fact drops.
- **`evidence_searches`**: one row per search made. Columns: `story_id`, `pass_id` (null for searches imported from legacy runs), `kind` (`coverage` | `gap`), `slot`, `angle`, `query`, `normalized_query`, `window_start`, `window_end`, `depth`, `credits`, `results`, `cached`. This is the skip list: a normalized query and a `response` angle are searched once per story over all its passes (ADR-0061's on-demand rule, now for coverage searches too). It also lets module 2 reuse searches across a development later. `context_search_cache` stays as the 7-day exact-query cache.
- **`evidence_sources`** (Evidence): one row per source per story, unique on `(story_id, normalized_url)`.
  - Columns: `ref` (`S0`, `S1`…, stable within the story), `origin` (`original` | `cluster` | `neighbour` | `search` | `earlier`), `earlier_story_id`, `url`, `outlet`, `title`, `published_date`, `kind`, `country`, `relation`, `favicon`, `used_raw_content`, `voices` jsonb (name, role and quote word for word), `first_pass_id`, `opt_out_checked`. Also `drop_reason` and `pass_id` for a source that was read and then left out (unusable, off-topic, opt-out), so a later pass never reads it again.
  - **No page text is stored.** Only the supporting sentences, a passage of at most 600 characters around each, and the quotes are kept, as ADR-0061 already decided ("never a page's text"; publishers' rights, and the TDM exception's retention limit). The roadmap lists "its text" under Evidence. This plan reads that as the words a fact rests on, which is what the checks need. *Decided by the planner; see "Decisions recorded".*
- **`pool_facts`**: one row per fact per story, unique on `(story_id, fact_key)`, where `fact_key` is context's `factKey` (normalized URL, supporting sentence, statement). A fact therefore lives once in the pool. It is no longer copied per run with `reused_from_id`, except for facts offered from linked earlier stories, which keep `reused_from_id` pointing at the other story's fact.
  - Evidence columns: `source_id`, `supporting_sentence` (word for word), `passage`, `support_found`.
  - Extraction judgment: `ref` (`F1`… stable within the story), `statement`, `measures`, the structured fields (`value`, `value_high`, `unit`, `approx`, `provisional`, `counted`, `place`, `as_of`, `as_of_precision`, `credited`, `credited_kind`, `validity`), `slot`, `extract_model`, `extract_prompt_version`, `first_pass_id`.
  - Check judgment: `verdict` (`supported` | `rejected` | `unjudged`), `verdict_problem`, `check_model`, `check_prompt_version`, `checked_pass_id`.
  - Status: `status` (`unreviewed` | `reviewed` | `demoted`), `dropped_pass_id`, `drop_reason` (`contradicted` | `editor`), `contradicted_by` (fact refs).
  - A fact is checked once. A later pass never re-judges a fact that already has a verdict. A demotion is a status change with its pass and reason, which a later pass may undo (D7: automatic corrections only remove or downgrade). Re-judging by module 2's reviews would add a `fact_judgments` table then, as ADR-0061 left join tables to module 2.
  - Our earlier stories' facts (`origin = earlier`) feed the article writer as today, but never the cards and never module 2's figures, because they are our own text.
- **`article_versions`**: one row per researched version of the article.
  - Columns: `story_id` (CASCADE), `number`, `pass_id` (SET NULL), `kind` (`first` | `update` | `legacy`), `status` (`current` | `superseded` | `reverted`, with a partial unique index on one `current` per story), the text fields an apply writes (`title`, `title_label`, `summary`, `marketing_blurb`, `quote`, `quote_attribution`, `relevance_reasons`, `antifactors`, `emotion_tag`), `research` (the reader projection, `researchedStorySchema`), `changes` jsonb (`[{ section, before: CitedText | null, after: CitedText | null }]`: null `after` is a dropped section, null `before` an added one), `note` (the Update text, with its citations), `created_at`.
  - The story's own columns stay the live copy every reader reads, so the swap model of `researchSwap.ts`, the `pre_research` snapshot, the edit lock and every downstream reader are unchanged. Versions are the history and the source of Updates. No column is added to `stories`.
- **`pass_boxes`**: the cards a pass wrote. They have `context_boxes`' columns, with `pass_id` in place of `run_id`, and cite pool facts by their story-level ref. The newest pass that wrote boxes is the one served. Editor choices carry over by box type, as `editorChoices` does today.

**The old tables become read-only history.** `story_research_runs`, `story_context_runs`, `context_facts` and `context_boxes` get no new rows once the step is switched on, and no migration drops or rewrites them, so no destructive statement is needed.

- The admin lists a story's legacy runs under its passes, with today's `ResearchRunView` and `ContextRunView` read-only.
- The cap's month sum is `research_passes` plus `story_research_runs` of the month. The legacy table gets no new rows after the switch, so the union never counts a run twice.
- Cards stored before the switch keep being served from `context_boxes` until a pass of that story writes boxes (`servedBoxes` falls back). Only a handful of stories have them: the ones an editor gathered context for.

**Legacy import, per story, at its first pass** (`importLegacyPool`, run inside the pass's claim transaction when the story's pool is empty and legacy rows exist; idempotent):

- Sources and facts come from the story's newest completed research run with facts (the run context reads today). Its facts arrive `unjudged`, so the pass's fact check judges them once, unless a context run of the story already judged them. A `factKey` match then takes that verdict and its structured fields.
- The context runs' search facts come in with their verdicts.
- Both kinds of runs' queries and angles become `evidence_searches` rows with a null `pass_id`.
- When `stories.research` is set, version 1 (`kind: legacy`) is made from the story's columns and projection, so that pass is a later pass judged against what readers see.
- Which run's version was applied is not recorded today. The import takes the newest run, and the pass's judgment works against the article as it stands, so a mismatch costs at most a redundant fact.

*Alternatives considered:* (a) Extend `story_context_runs`, `context_facts` and `context_boxes` into the pool. Their facts are copied per run and cite run-level refs, so the old rows would carry the wrong meaning under a per-story pool. (b) Copy all legacy runs into the new tables in a migration. The research results are deep jsonb, and the old jobs keep writing until the owner switches over, so a migration-time copy would miss rows. (c) One jsonb pool per story. That gives module 2 nothing to query or demote by row. The chosen design gives module 2 rows to point at and leaves history untouched.

### The pass pipeline

`runResearchPass(input, deps)` (`services/researchPass.ts`) does no I/O of its own, like `researchStory` and `buildStoryContext` today. Its deps are the metered call, search, the opt-out policy and `transient`, so the eval runs the same code. It composes the existing modules: research's prompts, schemas, filter, checks, copying, quote and repair, and context's gap list, structure, extraction, checks, visuals and write. Only the later pass's three new prompts are new, so the prompts that already have eval baselines keep them.

**Input** (`loadPassInput`): the story as research's loader gives it (original, cluster, neighbours, earlier-coverage candidates), the pool (sources, facts with verdicts, searches made, URLs read), the current version (null when the story has none), the story's places from that version, the reusable facts of linked earlier stories (context's step 1), the story day, and the previous boxes' editor choices.

**Steps.** Tiers are given as today. The new steps start on the tier named here, and their eval decides whether one moves up (D6).

| # | Step | First pass | Later pass |
|---|---|---|---|
| 1 | Own sources | Cluster members, and research's neighbour confirmation (small) | Only cluster members and neighbours not already in the pool or confirmed or denied before |
| 2 | Coverage search plan | Research's queries prompt, unchanged (small; 1 query, 2 for a non-English article), advanced news search in research's window | The same prompt, its window starting at the last pass's day and ending now: what other outlets reported since. A normalized query already made is skipped |
| 3 | Search, filter, extract (coverage) | Research's Tavily search, opt-outs, deterministic filter and extraction (small, parallel), and earlier coverage (small) | The same, dropping URLs already in the pool or read before. Earlier coverage only when published stories are new since |
| 4 | Structure | Context's structure call (small) on the pool's facts that have no structured fields: this pass's coverage facts and imported research facts | The same, on the new coverage facts |
| 5 | Gap plan | Context's gap list (small) over the whole pool. `planSearches`: `response` first, both angles, while not covered and not reported (ADR-0065), then the other slots. At most `config.research.pass.maxGapSearches` (3) | The same, skipping queries and angles made in any earlier pass (`evidence_searches`) |
| 6 | Search, filter, extract (gaps) | Context's basic search with its 7-day cache, `pickNewSources`, context extraction (small, parallel, structured fields included) | The same, dropping pages already read |
| 7 | Fact check | Research's fact-check prompt via context's `factCheckItems`, **once per unjudged fact** (up to 25 a call): coverage facts, gap facts and imported research facts alike | The same, on the new facts only |
| 8 | Article | Research's write (medium) from the pool's **supported** facts and the earlier-story facts, then the citation, copying and fact checks, up to two repair rounds, derive, and the gate (`stale`, `contradicted`, `research-rating`, `keep`, `fallback`), all unchanged. A kept draft becomes version 1 | **Judge** (new, medium): per section of the current version, `unchanged`, `wrong` or `substantially_different`, with the new or contradicting fact refs and a reason, plus the old facts the new ones contradict. **Rewrite** (research's repair prompt and merge, medium) of the flagged sections only, with every other section frozen byte for byte (`withRepairs`), then research's checks and repair rounds on those sections. **Update note** (new, medium): what changed and why, checked like a paragraph. Details below |
| 9 | Cards | Context's write (medium) from the pool's supported, current, non-demoted facts (never `earlier` ones), with the new version's places, then box code checks and the box check, no repair (ADR-0061) | The same from the whole pool. Skipped when the pool gained no supported fact and lost none, so the cards stay |
| 10 | Store | One transaction: pass row, new searches, sources and facts, verdicts, demotions, version, boxes, and the story write through `putResearch` | The same |

**The later pass's judgment, rewrite and Update** (`services/researchPassUpdate.ts`, pure apart from the injected call):

- **What counts as substantially different** (the judge prompt's rule, one block): a reader who read the old section would now hold a materially false or outdated belief about the development. Examples: a figure revised beyond rounding, a decision reversed or taken, a plan dropped or narrowed, an outcome now known, the main claim now disputed by a later credible report. New detail that only adds to the section is not substantially different. It goes to the cards. Contradiction keeps research's meaning ("a disagreement no later report settles"), and a later reversal is a change, not a contradiction ("Newest information leads").
- **Code flags sections too.** A section citing a fact this pass demotes is always a target, whatever the judge says. A section the judge flags without naming a new or demoted fact is not rewritten (recorded as `unfounded`), so a rewrite always rests on a fact found since.
- **Title, summary and blurb** are judged against the pool, as research's checks judge them today. When the first paragraph is flagged, all three are judged.
- **Rewrite** uses research's repair prompt, with the judge's reason in place of a check problem, the "newest information leads" block, and the whole story shown, so a rewritten paragraph stays coherent with its neighbours. If the rewritten sections still fail after the repair rounds, a droppable section is dropped, and the drop is recorded as a change with `after: null`. If an undroppable one fails (title, first paragraph, summary, blurb), the article stays as it is: the pass ends `update_failed`, and one admin notice ("Research found the story out of date and could not fix it: <title>", `research-update-failed:<storyId>`, linking the story page) says so. The cards still refresh. Nothing is unpublished or rejected automatically.
- **The Update note**: one or two sentences, at most 60 words, saying what changed and why, citing the new facts' sources ("The death toll was revised to 212 from 180, according to WHO's situation report of Nov 18."). It allows no more than one em dash, and no quoted words. Code dates it with the pass's day, never the model. It is checked by research's fact check against the facts it cites, by both copying checks, and by a code check that it cites at least one fact new in this pass or one it demoted. A note that fails after one repair round falls back to a fixed line from the changes: "Updated: <section names> rewritten after new reporting from <outlets>." No new text then needs approval.
- **Dropping facts**: the judge's `contradicts` pairs (an old fact and the newer supported facts that contradict it) demote the old fact (`drop_reason: contradicted`, `contradicted_by`). A fact superseded by a newer value of the same measure is not dropped. It stays a past value, and the tile rule and validity already show the newest. Demoted facts leave the cards on that pass's card write and are never offered again.
- **When nothing is flagged**, no version is made. The pass records `unchanged`, and only the cards refresh.

**Cards never fail a pass.** A technical failure or budget skip in step 9 completes the pass with its article and records `cards: failed` or `cards: budget`. A first-pass fallback (no article) still writes cards for a story that has research facts, as context does today for single-source stories with a research run.

**Budget, per pass:** one meter (research's `createRunMeter`, extended to the card steps' calls and searches) runs against the pass's ceiling and the month's cap. The ceilings are `firstPassUsd` 0.40 and `laterPassUsd` 0.25, about twice the targets below, and are reserved at start under `RESEARCH_RESERVATION_LOCK` as today. A budget skip in steps 1 to 8 ends the pass as research's `fallback: budget` does, and in step 9 as above.

### The chain, the gate, the job and the spending line

- **The job**: a new `research_pass` job, seeded **disabled**. It is a step of `daily_edition_chain` placed after `build_story_context` and before `publish_stories` while the old steps still exist. It gets its own Flex switch (`MODEL_JOBS`), a place in `RESUMABLE_JOBS`, a note, and the failure-share notices (`recordItems` with context's tally plus the article's checked items, and the stories-failing notice). It works through up to `perRun` (20) selected stories, 4 at a time, with no time limit, and applies first-pass verdicts as research's step does (`applyVerdict`, fenced on status and `updatedAt`; only `stale` and `contradicted` reject). A failure of the job as a whole stops the chain, as research's does today. Per-story failures never fail the job.
- **One switch at a time** (`jobEnableChecks.ts`): enabling `research_pass` is refused while `TAVILY_API_KEY` is unset. When enabled, it switches `research_stories` and `build_story_context` off in the same write, and the Jobs page note says so. Enabling either old job is refused while `research_pass` is on. Switching back is the rollback: disable `research_pass`, enable the old two.
  - *Alternative rejected:* swap the pipeline behind `research_stories` and keep its row. That job is live in production, so the merged step would ship switched on, before its eval.
- **The publish gate** (`awaitingPass`, `services/researchPassQueue.ts`) replaces `awaitingResearch` and `awaitingContext`. While `research_pass` is enabled and the key is set, a selected story with no settled pipeline pass waits at most `maxWaitMinutes` (120) from its selection, which is research's rule today, including in the daily edition. A pass settles when it is completed, skipped, failed, or cut off by a restart (context's `staleBefore` rule, now for every pass). The card stage is inside the pass, so no separate wait for cards exists, and a card failure holds nothing.
- **The after-publish part is retired** (For Odin 4). With it go `SPLIT_STEPS` (its only user) and `GOES_ON_PAST_FAILURE` (its only member) in the retirement phase. Removing dead chain machinery belongs to retiring its only user.
- **Spending**: the pass's month is `research_pass`'s `job_month_spend` row. An editor's pass adds its usage there through `addMonthSpend`, as an editor's context run does today, and it checks that scope's warning level. So the overview shows one line for the step, and `editor_research` and `build_story_context` keep only their past months. The migration seeds `research_pass` with build_story_context's $20 warning level. The cap stays the only stop.
- **At retirement** (phase 6) a migration deletes the two old `job_runs` rows (with a `-- reviewed-destructive:` line even though DELETE is not flagged, so a reader sees why) and the `build_story_context` warning level. Their `job_month_spend` rows stay, so the Spending page shows their past months under their names until those months age out of its three-month view.

### Admin

- **One button, "Research again"** (`StoryActionBar`), shown in place of Research and Gather context while `research_pass` is enabled. Until then the old buttons stay, so the switch is one act. It is eligible for `analyzed`, `selected` and `published` stories, with one pass per story at a time, the key on and room under the cap. Refusals come with their reasons as today, through `ReasonButton`. The pass runs as a one-story `research` task. A story with no pass and no version gets a first pass, and any other story a later pass. The bulk bar's Research becomes "Research again" over up to 50 stories, 4 at a time. Bulk apply goes (For Odin 3).
- **The pass view** (`ResearchPassView.tsx`) merges both run views:
  - **What changed**: on a first pass, the article written. On a later pass, each flagged section with its judgment, before and after, and the Update note, or "Article unchanged: nothing new makes it wrong or substantially different".
  - **Searches**: kind, slot or angle, query, and the ones skipped because made before.
  - **Sources**: new this pass, and the pool.
  - **Facts**: new, checked, rejected, and demoted with their reasons.
  - **Cards**: kept and dropped, with today's context admin for hiding and moving them.
  - **Checks**: today's problem list.
  - **Cost.**
  - The picker lists passes newest first, then the legacy runs, read-only.
- **Applying and reverting.** A pass applies its own result (For Odin 3). "Undo this update" on the current version restores the previous version's fields through the same fenced write and marks the version `reverted`, which takes its Update off the page. "Revert to single-source" restores `pre_research` as today and marks every version `reverted`. A re-assess, which clears the research columns today, also marks every version `reverted`. "Use this version" stays for nothing: legacy runs are read-only.

### Public site

- **Updates**: `GET /api/stories/{slug}` gains `updates: [{ date, note: CitedText, changes: [{ section, before: CitedText | null }] }]`, newest first, built from the versions that are not reverted and have `kind` `update` (and the first-pass Update of For Odin 5). Only sections shown on the page are listed (headline, paragraphs, key quote, Why This Matters, Caveats). Summary and blurb changes stay in the admin. The change is additive to `PublicStoryDetail`, so `api:snapshot` takes it without `--accept-breaking`. `research` is unchanged.
- **The page** (`client/src/components/research/StoryUpdates.tsx`, and `StoryPage.tsx` for the header link and the per-section markers) renders the section as For Odin 2 decides. The disclosures are native `<details>`/`<summary>`, so they work by keyboard and screen reader with no script. The old text keeps its citation group (`Citation`), so a reader can see what it rested on.
- **Markers**: `data-ai-generated="research"` on the Updates section and every earlier-version block. `aiGenerated.fields` adds `updates` when any are served. The NewsArticle JSON-LD (`structured-data.ts`) gains `dateModified`, the newest Update's date, and the page gets `article:modified_time`.
- **Labels**: unchanged (For Odin, closing note). The slug never changes when a headline is rewritten, so links stay stable. Lists, RSS, newsletter, podcast and social posts read the story's columns as today, so they take the current version. Issues, episodes and posts already sent keep their text.
- **Cards**: `GET /api/stories/:slug/context` keeps its shape and serves the newest pass's boxes (`pass_boxes`), else the legacy boxes. The client's context components need no change. Another agent is changing `client/src/components/context/` now, so this plan touches nothing there.

### Costs

These are estimates at list prices. Flex halves the model part of the nightly pass, and the eval's `baseline` step replaces them with measured figures.

| Pass | Model | Search | Target |
|---|---|---|---|
| First | Research's calls (about $0.04–0.06) plus structure, gap list, about 5 extractions, fact check of about 50–60 facts (3 calls), card write and box check (about $0.02–0.04) | 1–2 advanced coverage searches (2 credits each), 2 response searches and 1 slot search at basic (1 credit each): about 5–7 credits, $0.04–0.06 | $0.12–0.20 |
| Later, no rewrite | Coverage queries, structure, gap list, 2–4 extractions, 1 fact-check call, judge, card write and check: about $0.03–0.05 | 1 advanced "since" search plus 0–2 gap searches: $0.016–0.03 | $0.05–0.08 |
| Later, with rewrite | Plus rewrite, recheck, up to two repair rounds and the note: about $0.03–0.04 more | — | up to $0.12 |

The owner's estimate is a rewrite in perhaps one later pass in five. The weekly tally adds the rewrite rate and the `update_failed` share beside research's repair rate.

### Evals and the gate

- **Carried over**:
  - `eval:research` runs the first pass's article path through a new adapter on `runResearchPass`. It keeps the own-words tally, fallbacks by category, cost per step, and comparison against the 2026-11-13 baseline. The change to watch: the writer now reads supported facts only.
  - `eval:overviews --steps context` replays the first pass's card path against the gap keys' bars, judged half, means over 3 runs (ADR-0066). The cost bar becomes the whole first pass's, at most $0.20 at flex.
  - `fact-check` keeps both `--facts research` and `--facts pool` (renamed from `context`).
  - `baseline` reads `research_passes` as well.
- **New**, in `eval:overviews --steps update`:
  - **Update judgment.** The fixtures are researched stories from the development answer keys (`keys/*.json`). A story at date t gets, as its new facts, the later key entries' figure values and turning points. A turning point or a changed figure the story's sections state is expected to be flagged. Routine entries are expected unchanged. Planted cases on top: a contradicting fact built from a cited fact with `plant.ts`'s `wrong-number` and `wrong-year` kinds (expected flagged), and a benign fact on another aspect (expected unchanged). Bars: at least 90% of expected changes flagged on the right section, at most 10% false rewrites, and every unchanged section byte-identical (a code assertion: 100%).
  - **Fact drops.** Planted contradictions demote their old fact at least 90% of the time. False demotions stay at most 5%.
  - **Update-note quality.** gpt-6.1-sol@high, the strong judge, gets the before and after text and the note, and decides whether the note says what changed and why, accurately and completely. Production's fact check judges whether the note is supported. Bars: at least 90% of notes accurate and complete, none unsupported, and the copying flags no higher than the paragraph rate.
- **The gate** (D8): `research_pass` stays disabled until the carried-over bars hold (no regression against research's baseline on fallbacks and copying flags, and the context bars) and the update bars hold, each on the judged half or the held-out fixtures. The owner reads the report and switches the step on. Both kinds of pass sit behind the one job flag, because the "Research again" button appears only while the job is enabled.

### ADRs to write (by the implementer, when the code they govern lands)

- **ADR-0067 · Research passes: one repeatable step over one evidence pool per story.** Lands with phase 1. It covers the step and its one switch, budget and spending line; the pool tables (Evidence and Judgments columns, a fact checked once, demotion as a status); old tables read-only with a lazy legacy import; and the job swap with mutual exclusion. It amends ADR-0055 (new work no longer goes in `story_research_runs`; the cap counts passes) and ADR-0061 (records per story, not per run; the step merged; the after-publish part retired).
- **ADR-0068 · Articles are versioned; a later pass rewrites only sections new facts make wrong or substantially different, with a public Update that keeps the old text readable.** Lands with phase 3. It records the substantially-different rule, code flags for demoted facts, no automatic unpublish (`update_failed` plus a notice), the fixed-line fallback for a failing note, and the owner's answers to For Odin 2, 3, 5 and 6.
- The owner's answers to For Odin 1, 4 and 7 are recorded in ADR-0067 when they come.

### Rollout

Each phase merges with every CI check green and changes nothing readers see, because the job stays disabled and nothing reads the new tables until the switch. An implementer follows the phases in order.

1. **Records.** Migration: the six tables and their enums, the `research_pass` job row (disabled) and its $20 warning level. Prisma models, the records module with round-trip db tests, `importLegacyPool` and its db test. No reader yet.
2. **First pass.** `runResearchPass` for first passes, with plan, search, extraction, fact check, article and cards composed from existing modules; `loadPassInput`; the meter extended to the card steps; the eval adapters for `eval:research` and `eval:overviews --steps context`.
3. **Later pass.** The judge, rewrite, note and drops (`researchPassUpdate.ts`, three new prompts and schemas), versions with undo and revert (`articleVersions.ts`), and the `update` eval with its fixtures and scorers.
4. **Wiring.** Pass lifecycle (claim, reserve, execute, store, apply, interrupted passes, editor task), the job and its chain entry, enable checks, `awaitingPass`, the cap union, spending, the admin routes, and the public `updates` field with the snapshot refresh. All of it is inert while the job is off: no pass runs, so no version or Update exists.
5. **Interfaces.** The pass view, "Research again" (one story and bulk) shown only while the job is on, Undo this update, the Updates section, the header link and section markers, JSON-LD, and `servedBoxes` reading `pass_boxes` with the legacy fallback.
6. **Gate and switch** (owner): the eval report, then the owner enables `research_pass`. In the same change: the methodology paragraph (For Odin 7), the cap default (For Odin 1), `ai-transparency.md` rows 15 and 16 merged into one row (Updates and earlier text added to its surfaces, `aiGenerated.fields` `updates`), and `.context/story-research.md` rewritten as the step's doc.
7. **Retirement**, one or two weeks after the switch, once passes run cleanly:
   - Remove `research_stories` and `build_story_context` from `CHAINS`, the handlers, `RESUMABLE_JOBS`, `MODEL_JOBS`, the enable checks, the notes, the shared and client job lists, and `seed-jobs.ts`. Remove `SPLIT_STEPS` and `GOES_ON_PAST_FAILURE` from `chains.ts`.
   - Delete the old job rows and the warning level.
   - Remove the old buttons, the apply and bulk-apply endpoints and their client parts, research's editor run and pipeline-step code (`researchRuns.ts`, `researchQueue.ts`, `researchBatch.ts`, `researchApplyBatch.ts`, `jobs/researchStories.ts`), context's run, queue and on-demand code (`storyContextRuns.ts`, `storyContextQueue.ts`, `storyContextOnDemand.ts`, `jobs/buildStoryContext.ts`), and the legacy `story_research_runs` month sum once its last month is past.
   - Keep the legacy read views and the `context_boxes` fallback.
   - `.context/story-context.md` shrinks to the cards' reference (tiles, charts, placement, validity, the route's shape), and CLAUDE.md's table is updated.

What stays behind the switch until phase 6: every pass, the button, every version and Update, and the new cards. Phases 1 to 5 add code paths that no running job or visible button reaches.

### Risks

- **The update judgment is the new trust risk.** False rewrites churn the article and its Updates. Misses leave wrong text standing. The `unfounded` rule, the byte-for-byte freeze, the update eval's bars and the editor's Undo bound it. Still, a published story that changes is more visible than a card. The eval's fixtures come from nine developments only, and replay hindsight (pages updated after their date) flatters it.
- **A rewritten section that clashes with a frozen neighbour.** The rewrite sees the whole story, and the judge judges every section against the new facts. A pair that still clashes is caught only by the eval's note judge, so watch it in the first weeks.
- **Cost against the cap.** First passes cost two to four times today's research run. At $30 the cap would run out in a busy month (For Odin 1). The first night after the switch also runs the legacy import, which costs no money but adds a fact check of imported research facts to every first pass of a story researched before.
- **Edition delay.** The pass runs research and cards in sequence per story, 4 at a time, which is what research plus the context step's first part take today: about 5 to 15 minutes more than research alone on a normal night.
- **Legacy mismatches.** The applied version's run is not recorded, so the imported pool can differ from the facts the live article cites. The later pass works against the live text, and citations the pool lacks are only less evidence, never a failure.
- **The public contract.** `updates` is additive. The `research` field stays as it is (its `sentences` misnomer included).
- **Naming.** The design of 2026-11-15 calls below-bar items in an ongoing story "updates". Modules 2 and 6 call those "entries" (the roadmap's records), so "Update" stays the article's own note. Module plans must keep it so.
- **Concurrent work.** Another agent is changing `client/src/components/context/`. Phase 5 changes no file there. `StoryPage.tsx` is shared, so rebase on that work first.

## Changes

Grouped by phase. "New" marks a new file, each with its responsibility and exports.

| File | Change |
|------|--------|
| **Phase 1** | |
| `server/prisma/schema.prisma` | Models `ResearchPass`, `EvidenceSearch`, `EvidenceSource`, `PoolFact`, `ArticleVersion`, `PassBox`, and enums `PassKind`, `PassTrigger` (reuse `ResearchRunTrigger` values), `PassStatus`, `VersionKind`, `VersionStatus`, `FactDropReason`. Reuse `ContextValidity`, `ContextVerdict`, `JudgmentStatus` and `ContextBoxType` |
| `server/prisma/migrations/<ts>_research_passes/migration.sql` | Authored with `db:migrate:create` (remove the embedding-index drop). The tables, the partial unique index for one `current` version per story, the `research_pass` job row disabled with `ON CONFLICT DO NOTHING`, and `spend_warnings` `research_pass` $20. No DROP |
| `server/src/services/passRecords.ts` (new) | *Responsibility:* the pool's and versions' rows both ways (a row to its pass-pipeline type and back), with no queries beyond the reads named. *Exports:* `loadPool`, `storePassResult`, `newestPassBoxes`, `poolFactKey` |
| `server/src/services/legacyPool.ts` (new) | *Responsibility:* a story's legacy research and context runs turned into pool rows and version 1, once. *Exports:* `importLegacyPool` |
| `server/src/scripts/seed-jobs.ts` | `research_pass`, disabled |
| `server/src/jobs/handlers.ts`, `jobs/modelJobs.ts`, `jobs/interruptedRuns.ts`, `shared/types` (`JobName`), `client/src/lib/constants.ts` | Register `research_pass` (handler stub that reports "Research passes are off" until phase 4; the registry test needs a handler) |
| **Phase 2** | |
| `server/src/services/researchPass.ts` (new) | *Responsibility:* one pass's step sequence over injected deps, first pass in this phase. *Exports:* `runResearchPass`, `PassInput`, `PassResult`, `PASS_STEPS`, `PASS_STEP_TIERS` |
| `server/src/services/researchPassPlan.ts` (new) | *Responsibility:* which coverage and gap searches a pass makes, in order (response first), skipping what the pool already has. *Exports:* `coverageSearches`, `gapSearches` |
| `server/src/services/researchPassInput.ts` (new) | *Responsibility:* one story's pass input (SELECT only): research's loader, the pool, the current version and places, reusable facts. *Exports:* `loadPassInput`, `passEligibility` |
| `server/src/services/researchPipeline.ts` | Export the stage functions `runPassArticle` (write, checks, repair, derive, gate; today's `research` body minus searching and extraction) and `extractCoverage`, so the pass composes them. `researchStory` keeps working on top of them until retirement |
| `server/src/services/storyContextPipeline.ts` | Export the card stage (`writeBoxes`: write, structural checks, box check) and the gap and extraction stages over a pool input. `buildStoryContext` keeps working on top of them until retirement. `planSearches` takes the made-searches list from `evidence_searches` |
| `server/src/services/researchCalls.ts` | `createRunMeter` meters context steps too (the steps' names and output estimates added to `STEP_OUTPUT_TOKENS`), and takes the pass ceiling |
| `server/src/config.ts` (`research.pass`) | `firstPassUsd` 0.40, `laterPassUsd` 0.25, `maxGapSearches` 3, `perRun` and `concurrency` (4). No new env overrides |
| `server/src/scripts/eval/research/pipeline.ts`, `scripts/eval/overviews/context.ts` | The adapters run `runResearchPass` (first pass), with production's tiers as constants |
| **Phase 3** | |
| `server/src/services/researchPassUpdate.ts` (new) | *Responsibility:* the later pass's pure rules: rewrite targets from the judge and from demoted facts, the `unfounded` rule, the changes record, the note's code checks and fallback line, fact demotions. *Exports:* `rewriteTargets`, `versionChanges`, `checkNote`, `fallbackNote`, `demotions` |
| `server/src/prompts/researchPass.ts`, `server/src/schemas/researchPass.ts` (new) | *Responsibility:* the three new prompts and their output schemas (judge, rewrite framing on top of research's repair prompt, update note), with prompt versions as `CONTEXT_PROMPT_VERSIONS` computes them. *Exports:* `buildJudgePrompt`, `buildUpdateRewritePrompt`, `buildNotePrompt`, `judgeSchema`, `noteSchema`, `PASS_PROMPT_VERSIONS` |
| `server/src/services/researchPass.ts` | Add the later-pass branch: judge, rewrite through `researchRepair.ts`'s `withRepairs`, recheck, note, demotions, cards skipped when the pool is unchanged |
| `server/src/services/articleVersions.ts` (new) | *Responsibility:* version state: make the next version from a pass, undo the current one, mark all reverted, and the public Updates projection. *Exports:* `nextVersion`, `undoUpdate`, `revertAllVersions`, `publicUpdates` |
| `server/src/services/researchApply.ts` | `revertResearch` calls `revertAllVersions` in its transaction. `putResearch` gains the version write when given one |
| `server/src/services/analysis.ts` (or wherever `assessStory` clears the research columns) | Mark versions reverted in the same write |
| `server/src/scripts/eval/overviews/update.ts`, `updateFixtures.ts`, `updateScore.ts` (new) | *Responsibility:* the `update` eval's fixtures from the keys plus planted cases, the replay of the later pass, and the scores against the bars. *Exports:* `runUpdateStep`, `updateFixtures`, `scoreUpdates` |
| **Phase 4** | |
| `server/src/services/researchPassRuns.ts` (new) | *Responsibility:* a pass's lifecycle: claim and reservation under the lock (with `importLegacyPool`), production deps, execution with one second attempt for a failure that may pass, the fenced store and apply, interrupted passes, the editor's task, month spend for editors' passes. *Exports:* `runPipelinePass`, `startEditorPass`, `markInterruptedPasses`, `monthToDateUsd` |
| `server/src/services/researchPassQueue.ts` (new) | *Responsibility:* the step's state, which selected stories it owes, and the publish gate, one definition (SELECT only). *Exports:* `passStepState`, `nextForPass`, `awaitingPass` |
| `server/src/jobs/researchPass.ts` (new) | *Responsibility:* the `research_pass` job: sweep, queue, the worker pool, switch-off re-checks, tallies and summary line. *Exports:* `runResearchPass` (the handler) |
| `server/src/jobs/chainDefinitions.ts` | `research_pass` after `build_story_context` in `daily_edition_chain` |
| `server/src/jobs/jobEnableChecks.ts` | The key check, the old jobs switched off on enable, and their enabling refused while it is on |
| `server/src/jobs/publishStories.ts` | Add `awaitingPass` beside the two old gates (each holds only while its own job is on) |
| `server/src/jobs/jobNotes.ts`, `jobs/failureShare.ts` | The note and the failure-share message |
| `server/src/routes/admin/researchPass.ts` (new) | *Responsibility:* the pass endpoints: list passes and legacy runs, start one (and a bulk), undo the current update, usage with the cap. *Exports:* the router |
| `server/src/services/publicStories.ts`, `server/src/lib/openapi.ts`, `server/src/lib/aiProvenance.ts` | `updates` on the story detail, its schema and `.openapi()` metadata, `aiGenerated.fields` `updates`. Then `npm run api:snapshot --prefix server` |
| `server/src/services/spending.ts` | The cap's month and the overview read passes. The `editor_research` row shows legacy months only |
| **Phase 5** | |
| `client/src/components/admin/ResearchPassView.tsx`, `client/src/hooks/useResearchPass.ts` (new) | *Responsibility:* the merged pass view and the pass queries and actions. *Exports:* `ResearchPassView`; `usePasses`, `useStartPass`, `useUndoUpdate` |
| `client/src/components/admin/StoryActionBar.tsx`, `StoryResearch.tsx`, `BulkActionsBar` and `bulkResearch.ts` | "Research again" while the job is on, else today's buttons. The picker lists passes then legacy runs |
| `client/src/components/research/StoryUpdates.tsx` (new) | *Responsibility:* the public Updates section with its earlier-version disclosures. *Exports:* `StoryUpdates` |
| `client/src/pages/StoryPage.tsx`, `client/src/lib/structured-data.ts` | The header's "Updated" link, the section's place, per-section markers, `dateModified` |
| `server/src/services/storyContextServed.ts`, `storyContextView.ts`, `storyContextAdmin.ts` | Serve the newest pass's `pass_boxes`, else legacy `context_boxes`. Hiding and moving work on both |
| `shared/types` | Pass, version and update types (hand-written mirrors, as research's) |
| **Phase 6** | |
| `client/src/pages/MethodologyPage.tsx` | The approved paragraph (For Odin 7) at the marked spot |
| `server/src/config.ts`, `env.example`, `render.yaml` | The cap default per For Odin 1 (`blueprint.test.ts` keeps the three together) |
| `.context/story-research.md`, `.context/story-context.md`, `.context/scheduler.md`, `.context/ai-transparency.md`, `.context/public-website.md`, `.context/admin-dashboard.md`, `.context/model-eval.md`, `CLAUDE.md` | The step documented as it runs: pass, pool, versions, Updates, gate, spending, evals. Rows 15 and 16 merged |
| **Phase 7** | |
| The old jobs, services, routes and client parts listed under Rollout 7; `jobs/chains.ts`, `jobs/handlers.ts`, `jobs/chainDefinitions.ts`; a migration deleting the two job rows and the warning level | Retirement |

`researchPipeline.ts` and `storyContextPipeline.ts` are already large. The plan only exports their existing stages, adds no case to either, and puts the new orchestration in `researchPass.ts`, so both shrink at retirement instead of growing now.

## Tests

Following the server's patterns (`vi.hoisted()` mocks, `*.db.test.ts` against `TEST_DATABASE_URL`, the fake deps of `test/contextDeps.ts`):

- `researchPassPlan.test.ts`: response angles first while not covered and not reported. A normalized query and an angle already in `evidence_searches` are skipped and recorded. A later pass's coverage window starts at the last pass's day. URLs and domains already read are dropped.
- `legacyPool.db.test.ts`: a story with a research run and a context run imports sources, facts (verdicts taken over by `factKey`, the rest `unjudged`), searches and version 1 from `stories.research`. A second call writes nothing. A story without legacy rows gets nothing.
- `passRecords.db.test.ts`: a pass result round-trips. A fact already in the pool by key is not inserted twice. A demotion records its pass and reason.
- `researchPass.test.ts` (fake deps): a first pass checks each unjudged fact once and writes from supported facts only. A card-stage failure or budget skip completes the pass with its article. A later pass with no flagged section makes no version and refreshes the cards. With an unchanged pool, it makes no card write.
- `researchPassUpdate.test.ts`: a section citing a demoted fact is a target whatever the judge says. A flag without a new or demoted fact is `unfounded`. Unflagged sections are byte-identical after the merge. A failing undroppable section gives `update_failed`, and a failing droppable one a change with `after: null`. The note check requires a new or demoted fact. The fallback line names the sections and outlets. A superseded value is not demoted.
- `articleVersions.db.test.ts`: next version supersedes the current one. Undo restores the previous fields, marks the version reverted and removes its Update from `publicUpdates`. Revert to single-source and a re-assess mark all versions reverted. Only page sections appear in `publicUpdates`.
- `researchPassQueue.db.test.ts`: `awaitingPass` holds a selected story with no settled pipeline pass for at most 120 minutes, only while the job is on and the key set. A pass cut off by a restart settles.
- `researchPassRuns.db.test.ts`: concurrent reservations never pass the cap. The month sum counts passes plus legacy research runs once. An editor's pass adds to `research_pass`'s `job_month_spend` row. The store is fenced on `updatedAt` (an editor's edit during the pass wins). Interrupted passes are marked and keep their cost.
- `jobEnableChecks.test.ts`: enabling `research_pass` disables the two old jobs, and enabling an old job while it is on is refused.
- `jobRegistry.test.ts` and `blueprint.test.ts` keep holding the lists (no new test, the entries only).
- `storyContextServed.test.ts`: pass boxes win over legacy boxes, and legacy boxes are served when a story has no pass boxes.
- `StoryUpdates.test.tsx`: newest first, the disclosure holds the old text with its citations, no section without updates, the `data-ai-generated` marker.
- `updateScore.test.ts` and `updateFixtures.test.ts`: the scorer's flag and false-rewrite rates on fixed answers, and fixture construction from a key (expected flags on turning points and changed figures, none on routine entries).

## Out of Scope

- Automatic later passes (nightly re-research of published stories). The owner deferred them. The `kind: later` path and its eval make them a scheduling change later.
- Overviews (module 2) and anything reading the pool across stories. The pool's tables are shaped for it, but no cross-story search reuse or join is built here.
- Merging research's and context's extraction prompts into one call. The plan reuses both unchanged so their eval baselines hold. A merged prompt would save the structure call (about $0.003 a pass) and needs both evals.
- Dropping the old tables, or migrating `story_research_runs` and the context tables into the new ones.
- Re-sending or correcting newsletters, podcast episodes or social posts that went out before an Update.
- Editor edits of facts, or demotion of a fact by hand. Hiding and moving cards stay as they are.
- Any change to the AI label wording, the tile and chart rules, placement modes, or the client's context card components.

# Story context (context cards, the `build_story_context` step)

Story context gives a published, researched story **context cards**: how big the development is compared with what came before, why now, the build-up, who it reaches, what is being done, what comes next, a key term, and the figures. A **box** is the stored record and a **card** is how the page shows it. The `build_story_context` step builds a story's boxes once, after it is published, from its research run's facts and from up to 3 searches of its own; every fact and every card is checked against its source, and what fails is dropped. **The step writes only its own tables** (`story_context_runs`, `context_facts`, `context_boxes`, `context_search_cache`): it never moves a status, never writes a story field or rating, and never holds up publishing. **It is switched off**: seeded disabled, and enabling it needs the Tavily key and, by the plan, the eval gate (below). Overviews module 1 of `.plans/2026-11-16_story-overviews.md`; plan `.plans/2026-11-16_story-context.md`. Decisions: ADR-0061 (records, after publishing, reuse), ADR-0062 (no person in the loop), ADR-0057's amendment of 2026-11-16 (numbers judged by the fact check), ADR-0063 (one named source, the tile rule), ADR-0064 (no images; charts from fixed rules), ADR-0065 (always a constructive element; its amendment of 2026-11-17: no card when nothing sourced is found).

## The step

- **Fourth step of `daily_edition_chain`**, after `publish_stories` (`jobs/chainDefinitions.ts`): select, research, publish, context. A failed step stops its chain, so placed last it can never delay or stop publishing (ADR-0061). The cost: a story is live for a few minutes, at about 01:00 UTC, before its cards appear. The step does not read the chain's deadline.
- **Which stories** (`nextForContext`, `services/storyContextInput.ts`): published within the last `lookbackDays` (3), with a completed research run whose sources hold facts, and no context run yet; oldest published first, at most `perRun` (20) a run, `concurrency` (3) at once. Single-source stories count once research ran on them; a story without a research run gets nothing. **A story is settled by its first night's context run, whatever its outcome**: a failed, skipped or interrupted run is never tried again on a later night (a failure that may pass gets one more attempt within the same run, Failures below), and stories published while the step was off are filled in while still within the lookback.
- **The switch is the job's flag** on the Jobs page; the job is seeded disabled (migration `20261116225456_story_context`, `scripts/seed-jobs.ts`). Enabling is refused while `TAVILY_API_KEY` is unset (`jobEnableChecks.ts`: "story context needs web search"). A run without the key builds nothing and says so ("Web search is off, no context built"). Switching the step off keeps the cards already built, as research's switch does; hiding them is the admin's (below).
- **"Run now"** does what a scheduled run does, the disabled job's included, so a trial run writes cards that readers see. The job's note says so.
- **Flex:** the step is in `MODEL_JOBS` (`jobs/modelJobs.ts`) with its own Flex switch; it usually runs before the chain's 03:30 flex cut-off.
- **Interrupted runs:** a `running` run older than `staleRunMinutes` (120) is marked `failed`/`technical` ("interrupted: the server restarted during the run") at the next run's start (`markInterruptedContextRuns`), and settles its story. The store is conditional on the run still being `running`, so a run marked meanwhile writes nothing. `build_story_context` is in `RESUMABLE_JOBS` (`jobs/interruptedRuns.ts`).
- **Failures:** a step's failure inside one story's run (a parse failure of a required call, a Tavily error) ends that run as `failed`/`technical` with what it spent and nothing else stored. What it spent includes every search that completed: a story's searches are all waited for, and when one fails after its retries, the others' credits still go into the run's `tavily_credits` and `cost_usd` and its record's `searches` (with nothing kept), since Tavily billed them. An error outside the run records a failed run for the story (`recordFailedRun`), and the next story goes on. The job never throws for a story.
- **A second attempt in the same run** (owner decision 2026-11-17, ADR-0061's amendment): a technical failure that may pass (`transientFailure`, `services/storyContextRuns.ts`: a rate limit, a server error, a timeout or a lost connection, once the SDK's and `withRetry`'s own retries are spent, on a required model call or a search) is tried once more after every other story of the run, on its own run row (`runStoryContext(storyId, deps, { runId })`): the row goes back to `running`, keeps its start, and stores only the second attempt's outcome, record, facts and boxes, while its `cost_usd`, `model_usd` and `tavily_credits` add both attempts' (the store increments them; the job's usage counts both attempts' calls and searches anyway). A second failure settles the story like any other. A parse failure, a refused request, an answer of the wrong shape, an error of ours and an error outside the run are not tried again. The pipeline carries the flag (`ContextCallResult.transient`, `ContextDeps.transient`, `StoryContextResult.transient`); the eval sets neither, so its runs are never tried twice.
- **The failed-stories notice** (`jobs/buildStoryContext.ts`): when more than `jobs.failureShare.share` (20%) of the stories a run took failed technically, after their second attempts, from `failedStoriesMin` (5) stories on, the step records one warning notice, title "Build Story Context: 3 of 9 stories failed in the last run", linking to `/admin/jobs`, deduped as `stories-failing:build_story_context` (a repeat reopens it). Nothing pauses, and those stories get no cards.
- **The failure share** (`jobs/buildStoryContext.ts`, `jobs/failureShare.ts`): the run's item tally (below) goes into its usage (`recordItems`). When more than `jobs.failureShare.share` (20%) of at least `minItems` (20) checked items failed, the run's finish records one warning notice, as for any job that counts items (`.context/scheduler.md`, "Failure share"): title "Build Story Context: 14 of 45 checked items failed in the last run", this step's own message, linking to `/admin/jobs`, deduped as `step-failing:build_story_context` (a repeat on a later night reopens it), and the Jobs page shows the same line under the step from the last run's usage (`failureShareWarning`). **Nothing pauses**: the step runs the next night as usual (owner decision 2026-11-16).
- **The summary line:** "Built the context of 9 stories: 31 cards kept, 4 of 120 checked items failed, 1 story failed (2 tried twice)", always with the stories that failed and with the second attempts when there were any; or "No story owed its context".

## What one story goes through

`runStoryContext(storyId)` (`services/storyContextRuns.ts`) writes the run row (`running`), loads the input (`loadContextInput`; none: the run is `skipped`, outcome `no-research`), runs the pipeline with production's deps and stores the result in one transaction. `buildStoryContext(input, deps)` (`services/storyContextPipeline.ts`) does no I/O of its own: its deps are the model call, the search and the opt-out policy, so the eval runs the same code. Production's call (`productionCall`) is one structured-output call on the step's tier after `rateLimitDelay()`, never in `withRetry` (the SDK retries). Tiers (`CONTEXT_STEP_TIERS`): every step small, the write medium.

| # | Step | Where | What it does |
|---|---|---|---|
| 1 | Load | `storyContextInput.ts` | The story (title, summary, its places: `storyContextLayout.ts`), the newest completed research run with facts (its sources `S0`… with facts, outlet, title, date, kind and voices), and the **reusable facts**: the supported, non-demoted context facts of the earlier stories research linked in `run.earlier`, kept only while current on this story's day, newest first, each fact once (an earlier story's stored copy of a fact it reused counts as that fact: the newest is offered), at most `maxReusedFacts` (30). Our own earlier stories' facts (`E…`) are never loaded: they are our text. |
| 2 | Structure (pass 1) | `buildStructurePrompt` | One call returns the structured fields of every research fact by id (value, value high, unit, approx, provisional, what is counted, place, as-of, credited body and kind, validity). Answers count only for the ids asked; a fact left out is not checked and counts as failed. A range whose two ends are equal is stored as a single value (here and in step 6), so a chart can draw it. |
| 3 | Gap list | `buildGapListPrompt`, `planSearches` | One call: per slot (`compared`, `why_now`, `build_up`, `who_affected`, `response`, `next`, `key_term`) whether a reader needs it and whether the current facts cover it (yes, partly, no), the story's own sentence reporting the response, if any, two `response` queries (`responseSearches`: `action`, who is responding and what is being done; `elsewhere`, what has worked against the same problem in other places or times) and up to 3 searches for the other slots. Code: `response` is always needed (ADR-0065) unless the story reports it (the quote must stand in our text, `supportFound`; else it is ignored). While the facts do not cover it (`covered` is not `yes`) and the story does not report it, **its two searches go first, one per angle** (owner decision 2026-11-17, ADR-0065's amendment); an angle the gap list left empty gets a query from the title (action: its first 9 words and "response"; elsewhere: its first 6 and "solutions that worked elsewhere"; either sets `responseFallback`). Then the other slots' searches, dropping those for slots not needed or covered; a repeated query runs once; at most `maxSearches` (3) in all, so an open `response` leaves one for the rest. None left: no search. |
| 4 | Search (pass 2) | `storyContextSearch.ts`, `storyContextSources.ts` | Tavily, basic depth, topic `general`, 5 results with raw text, ending on the story's day, starting 30 days before only when recent data is wanted. A query asked within `searchReuseDays` (7) is answered from `context_search_cache` at no credit cost (the key: normalized query, depth, topic and the recent flag, not the end date). |
| 5 | Filter | `dropOptedOut`, `pickNewSources` | Publishers' opt-outs (`researchSourcePolicy`, ADR-0056), checked before a result is cached and again on every answer; research's `BLOCKED_DOMAINS`; a URL or domain already among the story's sources (or a reused fact's URL); a result without text; at most `perQuerySources` (2) a search and `maxNewSources` (5) in all. Drops are recorded with their reason. The text is chosen as research chooses it (`selectedText`). |
| 6 | Extract (pass 2) | `buildContextExtractionPrompt` | One call per kept source, in parallel: `usable`, the source's kind and outlet, and at most 5 facts answering the wanted items, each with a statement, the supporting sentence verbatim, the structured fields and its slot. Sources get ids after research's and the reused ones' (`S3`…), facts `S3F1`…. One failed or unusable extraction skips that source only. |
| 7 | Fact code checks | — | A pass-2 fact without a statement or sentence fails its structure (counted as left out). `supportFound` is recorded; the passage (the sentence with one either side, at most 600 characters) is kept. |
| 8 | Fact check | `factCheckItems`, research's `buildFactCheckPrompt` | Research's prompt and schema, unchanged, at most `checkBatchSize` (25) items a call. Each item is the fact as `renderFact` renders it ("Area burned in Indonesia: about 2.88 million hectares, as of 2026, according to KLHK (estimate)"), its evidence the sentence (pass 2: the passage) plus the source's date fact (`publishedFact`), its number hints as research gives them. A rejected or unjudged fact is stored with its verdict and never offered or shown. |
| 9 | Write | `buildBoxesPrompt` | One call (medium) writes from the supported facts and the reused ones: the figures box (tiles only) and at most 6 boxes, each with a slot, a heading (at most 8 words), a teaser (at most 8 words, the phone's one-line note), its place (`P<n>`, `W<n>` or `section`), 0–3 sentences citing fact ids and at most one visual (tiles, bars or line, with `apart` points for a different measure beside bars). |
| 10 | Box code checks | `structuralBoxes`, `resolveVisuals` | First the caps the prompt states, held in code (`maxBoxes` 6, `maxSentences` 3, `maxTiles` 4): the first box of each slot is kept and a second dropped, a box past the sixth, a sentence past the third and a tile past the fourth (the figures box's too) are dropped in the order written, each a structural failure. Then a cited id that is not a supported fact drops its sentence, tile or point (structural failure); a place the story lacks becomes the section; a tile with no current fact is dropped; a chart that breaks the chart rules is not drawn, and its box keeps its sentences (no failure). The copying check (`checkCopying`, a 12-word run against the sources' lines) runs on box sentences. |
| 11 | Box check | `boxCheckItems`, `applyBoxVerdicts` | Research's fact-check prompt again, with the sources' lines, so it judges copying as well as support: every sentence, tile ("people under smoke: about 12.5 million people") and chart ("area burned in Indonesia, hectares: 2015, 2.6 million; 2026, 2.88 million (estimate)") against its cited facts, numbers spelled as the facts render them (`spelledFigure`). A failing or unjudged item is dropped, and a box left with nothing in it. **No repair rounds** (ADR-0061). |
| 12 | Response not found | — | When pass 2 searched for `response`, no supported fact answers it, no kept box is a `response` box and the story does not report the response, the run records `responseNotFound` and **no card says so** (owner decision 2026-11-17, ADR-0065's amendment; until then a fixed-wording "honest gap" card did). |
| 13 | Store | `storeContextResult` | One transaction: the run's status, outcome (`built`, `none-kept`), box count, costs and record; every fact with its verdict, and the reused facts a kept box cites, copied into the run with `reused_from_id`; the kept boxes in order, each with the newest as-of of its facts, the writer's model and prompt version. |

**The item tally** (`itemTally`): checked = facts supported, rejected, unjudged and left out, plus box items dropped as structural and box items judged; failed = facts rejected, unjudged and left out, plus box items dropped as structural or by the check. Charts not drawn under the rules and technical failures do not count; a run that failed counts nothing.

**Prompt versions** (`CONTEXT_PROMPT_VERSIONS`): the first 8 hex characters of a sha256 over the step's prompt built from a fixed canonical input, plus its JSON schema, computed at load. Each model-written fact and box stores its model id and its step's version.

**Untrusted input:** fetched text reaches only the extraction prompt, escaped and marked untrusted as research's is (`UNTRUSTED`, `tag` from `prompts/research.ts`); every parsed answer is XML-unescaped (`unescapeXmlDeep`).

## Validity

A fact's `validity` (`isCurrent`, `services/storyContextVisuals.ts`): `fixed` is always current; `slow` for `slowValidDays` (365) and `fast` for `fastValidDays` (14) from the start of its as-of period (`2026-11` counts from Nov 1), else from its source's date; without either it is not current. **Current is judged on the story's own day, never today**: a one-off story's cards describe the time of the story, and the footer's as-of date says so. Expiry decides which reused facts are offered, what the gap list may count as covering a slot, which facts a tile may show, and that the writer may state an expired fact only as a past value with its date.

## Tiles and charts

**The tile rule** (`tileDisplay`; ADR-0063): of a tile's facts, only shown (supported, not demoted), current ones with a figure count. The headline is the newest from the most authoritative kind present: official, research, news, other (the credited body's kind, else the source's: `official-body` is official, `news-report`, `analysis` and `opinion` news, `press-release` other). Every other such fact dated on or after it with a different value is shown beside it, each naming its source; a value the headline gives is not repeated. A tile with none is not shown.

**The chart rules** (`validChart`; ADR-0064): every point a shown fact with a single value (a range is no point; such points are removed before counting), one unit across the points, no negative value (the axis starts at zero); bars need 2 points, a line 3 at different as-of dates, drawn in date order. An `apart` group (a different measure shown beside a comparison, never in it) is kept beside bars only, when it holds points of one unit. A provisional point is drawn hatched; a point within 30 days of the story's day is `recent` (the area's color). A chart not drawn leaves its box's sentences.

**Numbers come formatted** (`formatFigure`): "12.5m", "2.6bn", "400,000", "400,000+", "about 2.9m", "under 5,000", "5,000–5,400", a symbol unit kept ("$52m", "63%", "1.5°C"), with `estimate` for a provisional figure.

## Places

A story's places (`storyLayout`, `services/storyContextLayout.ts`): a researched story's paragraphs `P1`… and Why This Matters points `W1`… from `stories.research`, each with the URLs of the sources it cites; a single-source story's summary as `P1` and its relevance reasons split as the page splits them (`parsePoints`, mirroring the client's) as `W1`…, each citing the story's own article.

**Where a box sits is worked out when the page is served** (`placeBoxes`, `services/storyContextPlacement.ts`, pure), so a change of mode or limits reaches every story at once. One entry point decides it for the public view, the admin and the eval alike (`servedBoxes` and `placeServed`, `services/storyContextServed.ts`, pure): only the boxes the page serves compete (not hidden, something still shown; "What readers get"), each by the sources of every fact it cites, a chart's `apart` points included (`boxRefs`).

- An editor's place (`place_by_editor`) is kept in every mode, under the same limits; editor-placed boxes are placed first.
- Otherwise `STORY_CONTEXT_PLACEMENT` decides (`config.storyContext.placement`, default `model`): `model`, the place the write call chose; `random`, a draw among the paragraphs and points that cite one of the box's sources (by normalized URL), seeded by the story id and the box's index, so a page never reshuffles (a second-search box has no such spot and goes to the section); `section`, none beside the text.
- Then the limits, in box order: at most `notesInText` (2) beside paragraphs, `notesByPoints` (2) beside points, one per paragraph or point; the rest go to the section. The figures box always sits in the section (`placeable`; the admin gets it as `movable`, so the client holds no copy of the rule). A place the story no longer has (it was edited) becomes the section.

## Records

- **`story_context_runs`**, one per story and night (a second attempt in the same run reuses its row, its costs both attempts'): `story_id` (SET NULL on delete, so its cost stays counted), `research_run_id` (the run it read, SET NULL), `status` (`running`, `completed`, `skipped`, `failed`), `outcome` (`built`, `none-kept`, `no-research`, `technical`), `boxes`, `cost_usd` (model plus credits at `research.tavilyUsdPerCredit`; model calls at standard price, so an upper bound), `model_usd`, `tavily_credits`, `result` (`ContextRunRecord`: the gap list's slots, `responseInStory`, `responseFallback`, the searches with cache hits, credits, result counts and kept URLs, source and extraction drops, fact counts, each dropped fact with its problem, box drops by cause, number hints, `responseNotFound`, the item tally, every call with its tokens, cost and model, `optOutChecked`), `error` (sanitized: our own step messages and Tavily's, never fetched text), `started_at`, `finished_at`.
- **`context_facts`**, every fact a run structured or extracted, with its verdict: `ref` (unique per run), `origin` (`research`, `search`), `reused_from_id`; evidence `source_url`, `source_outlet`, `source_title`, `source_date`, `source_kind`, `supporting_sentence` (verbatim), `passage` (pass 2 only), `support_found`; the structured fields (`statement`, `value`, `value_high`, `unit`, `approx`, `provisional`, `counted`, `place`, `as_of` with `as_of_precision`, `credited`, `credited_kind`, `validity`); `verdict` (`supported`, `rejected`, `unjudged`) with `verdict_problem`; `status` (`unreviewed`, `reviewed`, `demoted`); `model`, `prompt_version`. **No page text is stored**, only the sentence and the short passage.
- **`context_boxes`**: `position`, `type` (the seven slots plus `figures`), `heading`, `teaser`, `sentences` (`[{ text, factIds }]`), `visual` (a stored tiles, bars or line spec citing refs, `storedVisualSchema`), `as_of` with its precision, `place` (`P<n>`, `W<n>`, or null for the section), `place_by_editor`, `status` (`demoted` is hidden), `model`, `prompt_version`, `written_at`. The `gap` column is unused since 2026-11-17 (always false; it marked the honest gap, and dropping it would be a destructive migration). Boxes cite their own run's facts by ref; facts and boxes cascade with their story and run.
- **`context_search_cache`**: `key`, `query`, `results` (URL, title, date and chosen text of each result that passed the opt-out check), `credits`, `created_at`. Rows past `searchReuseDays` are deleted at each run's start (`pruneSearchCache`): a short-lived processing copy.

## Reuse

Two kinds (ADR-0061): the exact-query cache above, and the earlier linked stories' current, supported facts (step 1), offered under new source ids and stored with the run only when a kept box cites them. The run records cache hits (`searches[].cached`) and reused facts (`facts.reused`). If the cache's hit rate stays near zero for a month, the cache goes (follow-up). A cached answer is reused for a story up to 7 days apart, so its results may end a few days after an older story's day.

## Cost

No budget stops the step (owner decision 2026-11-16, ADR-0060). A story's calls are fixed in number: at most 3 searches (1 credit each at basic depth), 5 extractions and about 7 model calls, about $0.03 a story, at most about $0.10 with no cache hit, twice that for a story tried a second time (Failures, above); with at most `perRun` stories a run costs at most about $2, more only by the second attempts. The step's spend is in the Spending overview (`.context/scheduler.md`, "Spending"), with a warning level of $20 seeded with the job. A run's model cost and credits are kept apart on its row; `job_month_spend` gets them through the run's usage.

## What readers get

`GET /api/stories/:slug/context` (`routes/public/stories.ts`, `services/storyContextView.ts`), `Cache-Control: public, max-age=60`. **Not in the OpenAPI contract**, like `/appearances`, so modules 2 and 3 can still change the shape. Only a published story's boxes of its newest run that wrote any, not demoted, in order; a sentence citing a fact no longer shown (rejected or demoted) is dropped with it, and a box left with no sentence and no visual is left out before places are worked out (so is an honest gap stored before 2026-11-17). A story without context, unknown or not published gets `boxes: []`.

```ts
{
  boxes: {
    id: string
    type: 'compared' | 'why_now' | 'build_up' | 'who_affected' | 'response' | 'next' | 'key_term' | 'figures'
    heading: string
    teaser: string             // the phone's one-line note
    place: string              // 'P<n>' | 'W<n>' | 'section'
    sentences: { text: string; citations: { sourceId: string; sentence: string | null }[] }[]   // research's CitedText
    visual:
      | { kind: 'tiles'; tiles: { label: string; values: { text: string; estimate: boolean; sourceId: string }[] }[] }
      | { kind: 'bars' | 'line'; caption: string; unit: string
          points: { label: string; value: number; text: string; provisional: boolean; recent: boolean; asOf: string | null; sourceId: string }[]
          apart: { caption: string; unit: string; points: /* as points */ [] } | null }
      | null
    asOf: string | null        // 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY': the newest date its facts describe
    sourceIds: string[]        // the box's sources, first-cited order, for its footer
  }[]
  sources: {                   // research's ResearchedSource shape; ids C1… in first-cited order, one per normalized URL
    id: string; origin: 'original' | 'source'; outlet: string; host: string | null; url: string | null
    title: string; date: string | null; country: null; kind: string; storyId: null; slug: null
  }[]
  asOf: string | null          // the newest asOf of the boxes
  aiGenerated: { fields: ('heading' | 'teaser' | 'sentences' | 'visual')[]; model: string; digitalSourceType: string }
}
```

`aiGenerated.fields` is empty without boxes; `model` is the model recorded with the boxes (`contextAiMarker`, `lib/aiProvenance.ts`). The page carries `data-ai-generated="context"` on each note and on the section, and no visible label of its own: the story's "Researched and written by AI" line covers the cards (owner decision 2026-11-16), and on a story whose research run was never applied its "Summary and analysis by AI." line does (owner decision 2026-11-17; `.context/ai-transparency.md`). How the page lays the cards out is the client's (`.context/public-website.md`).

## Admin

Routes in `routes/admin/storyContext.ts` (mounted under `/api/admin/stories`, admin auth), service `services/storyContextAdmin.ts`. 404 for an unknown story or a box of another story.

- `GET /api/admin/stories/:id/context` →
  ```ts
  {
    run: { id; status; outcome; startedAt; finishedAt; costUsd; modelUsd; searchUsd; tavilyCredits; boxes; error; result /* ContextRunRecord */ } | null,  // the newest run
    boxes: { id; type; heading; teaser; status; hidden; place /* where the page shows it now; its stored place, or section, when the page does not serve it */; storedPlace /* P<n>, W<n> or null */; placeByEditor; movable /* false for the figures box */; sources: { outlet; url }[]; asOf; position }[],  // the newest run that wrote boxes, hidden ones included; placed as the page places them, on the story's day (today for a story not published)
    places: { place /* P<n>, W<n>, section */; label /* 'Paragraph 1', 'Why This Matters 1', 'More context' */; text /* its start, 80 characters */ }[],
    placement: 'model' | 'random' | 'section'
  }
  ```
- `PUT /api/admin/stories/:id/context { hidden: boolean }` → 204: hides every box (`demoted`) or shows the hidden ones again (`unreviewed`). Nothing is deleted.
- `PATCH /api/admin/stories/:id/context/boxes/:boxId { hidden?: boolean, place?: 'P<n>' | 'W<n>' | 'section' }` (at least one) → 204: hides or shows one box, and moves it, setting `place_by_editor`. 400 for a place the story does not have, and for moving the figures box out of the section.

Hiding and moving are the one way a person changes what the step built (ADR-0062). Who hid a card, and when, is not recorded.

## Checking it locally

The synthetic data set (`npm run db:seed:synthetic --prefix server`, `.context/database-migrations.md`) gives one researched story context: `/stories/varrowen-province-makes-free-school-lunches-permanent-for-600-000-pupils` has the figures tiles, a bar chart beside `P1`, a line chart beside `W1` and a card of sentences in the section, and its run records the response as searched for and not found (`scripts/synthetic-data/context.ts`). Its rows are written by hand: no model wrote them.

## Before switching on

The step is gated on `eval:overviews` (roadmap D8, ADR-0066): planted errors on context facts, structured fields, the gap list and searches, what's being done (ADR-0065), boxes, placement (below its bar the step goes live with `STORY_CONTEXT_PLACEMENT=section`) and cost, as means over 3 runs on the judged half of the gap keys of 30 one-off stories (`.context/model-eval.md`, "Overview evals": the `gap-draft`, `gap-keys` and `context` steps and `--facts context`). The keys are drafted and checked after merge; until they are committed, the `context` step has nothing to run on. The owner switches the step on. A change to a prompt, schema or model tier of the step reruns the gate before it ships.

**The methodology paragraph waits for the switch.** While the step is off, the methodology page says nothing about context cards, since "Many stories carry context cards" would be untrue on the live site. The owner-approved paragraph (2026-11-16; plan, "For Odin" 2) goes back into the "Researched Stories" section of `client/src/pages/MethodologyPage.tsx`, after the paragraph ending "…starting with the article where we first found the story." (a comment marks the spot), **in the same change that commits the eval's gap keys**, which lands right before the owner switches the step on. Word for word (on the page, "don't" is written `don&apos;t`):

> Many stories carry context cards: how big the development is compared with what came before, why it is happening now, who it reaches, what is being done and what comes next. An AI model reads the sources our research found and, where something a reader needs is missing, searches for up to three more. Every number on a card names its source, and when sources disagree we show both. A separate AI check compares each fact with the sentence it came from and drops what that sentence does not say. Each card gives the date its facts are from; we don't update cards later.

That change also sets `.context/ai-transparency.md` (the story-context row) and `.context/public-website.md` ("Story context") back to saying the paragraph is on the page.

## Modifying

- **A prompt** (`prompts/storyContext.ts`): read `.context/prompting.md`; the version changes by itself. Research's fact-check prompt is shared: a change there changes both checks here, and needs research's eval too.
- **A visual kind or rule:** `schemas/storyContext.ts` (`boxesSchema`, the stored schemas), `storyContextVisuals.ts`, the box items in `storyContextChecks.ts`, the view and the client.
- **The route's shape:** the client reads it; it is not a public contract, but a cached page may hold the old shape for 60 seconds.
- **A new place kind:** `storyContextLayout.ts` (and the client's `parsePoints` mirror), the admin's place regex (`contextBoxUpdateSchema`).
- **How points split:** change both `parsePoints` (server `storyContextLayout.ts`, client `lib/parse-points.ts`) and the case table both packages' tests run, `shared/fixtures/parse-points.json`.

## Key files

| File | What |
|---|---|
| `server/src/jobs/buildStoryContext.ts` | The step: stale runs, prune, queue, workers, item tally (its failure-share notice's words are in `jobs/failureShare.ts`) |
| `server/src/services/storyContextRuns.ts` | One story's run: row, production deps, transactional store, interrupted runs |
| `server/src/services/storyContextPipeline.ts` | Steps 2–12 with injected deps; tiers; prompt versions; `planSearches` |
| `server/src/services/storyContextInput.ts` | The queue and one story's input (SELECT only) |
| `server/src/services/storyContextRecords.ts` | The records both ways: a fact's and a box's row, a row read back as the fact (the input's SELECT names its columns as the row's fields), a box's refs and as-of, a story's newest boxes and facts; a round-trip db test holds them |
| `server/src/services/storyContextChecks.ts` | `renderFact`, fact and box check items, verdicts, structural checks, the tally |
| `server/src/services/storyContextVisuals.ts` | Validity, number formatting, the tile and chart rules |
| `server/src/services/storyContextSources.ts`, `storyContextSearch.ts` | Pass 2's request, source filter, cache key and passage; the cache and Tavily |
| `server/src/services/storyContextLayout.ts`, `storyContextPlacement.ts` | A story's places; where each box sits |
| `server/src/services/storyContextServed.ts` | Which boxes the page serves and what each shows, placed: the one entry point of the view, the admin and the eval |
| `server/src/services/storyContextView.ts` | The public route's answer |
| `server/src/services/storyContextAdmin.ts`, `server/src/routes/admin/storyContext.ts` | The admin's view and edits |
| `server/src/prompts/storyContext.ts`, `server/src/schemas/storyContext.ts` | Prompts; output, stored and request schemas |
| `server/src/scripts/synthetic-data/context.ts` | The synthetic story's context |
| `server/src/test/db/storyContext.ts` | DB test fixtures |
| `client/src/components/context/` | The story page's notes, sheet, More context, tiles and charts (`.context/public-website.md`, "Story context") |
| `client/src/components/admin/StoryContextAdmin.tsx`, `ContextRunView.tsx` | The admin's Context section (`.context/admin-dashboard.md`) |

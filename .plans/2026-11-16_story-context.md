---
status: approved
type: feature
complexity: complex
---

# Story context: context cards, figures and charts from a second research pass (overviews module 1)

Module 1 of `.plans/2026-11-16_story-overviews.md`. That roadmap's decisions D3, D4, D5, D8 and D9 bind this plan. Design: `/mnt/project-files/story-directions/2026-11-16_ebola-lifecycle.md` ("Which model does what", "The records", rules 1, 4 and 5, "Module 1: story context", "Costs"). The reader-facing target is `mockups/story-context-desktop-clean.png` with `-phone.png`, and the thinking behind it is in `2026-11-15_updates-context-and-charts.md`. The handbook's `plan-decisions` skill was not loaded when this plan was written, so it has no handbook header and no decision stubs. Each decision is set out under "Approach" with its alternatives, and "ADRs to write" says which ones the implementer records.

Naming: a **box** is the stored record and a **card** is how the page shows it.

## For Odin

All items are decided (Odin, 16 Nov). Items 4, 5 and the methodology text follow the recommendations: Odin's "Alright. Let's build this in a branch and see how it goes" answered the decision note that offered them. The build goes on the branch; nothing reaches `main` without Odin's word.

1. **How the context sits on the story page. Decided (Odin, 16 Nov).** Mockups on the live Indonesia story, in `mockups/`: `context-split-margin.png` (desktop), `context-split-phone.png` (phone, closed and tapped) and `context-split-phone-full.png`.
   - **The story stays complete without the cards.** No card changes the story's text, "Why This Matters" or "Caveats", and card sentences never restate them (write step, rule list).
   - **The cards are split.**
     - **Notes beside the text:** up to 2 beside story paragraphs and up to 2 beside "Why This Matters" points, at most one per paragraph or point. A note is the full card.
     - **The rest in a section** after Caveats, before Sources, under the page's own ruled heading, "More context", with nothing under the heading but the cards ("show, don't tell"). The "In numbers" card always goes here.
     - **Desktop: side notes in the right margin**, level with their paragraph, so the text column runs on uninterrupted. When a story has notes, the column moves left to make room. Below about 1,100 pixels of width the notes sit inside the column, after their paragraph. Section cards sit three a row.
     - **Phones: one-line notes** under their paragraph or point: an icon, the kicker and a teaser such as "The rainy season, 20–30 days late". A note under a "Why This Matters" point is indented to line up with the point's text, not its number (Odin, 16 Nov). A tap brings the full card up from the bottom over the page, and the page stays where it was. The section uses the same one-line notes, so it takes a few lines.
     - **No AI badge or label on notes, cards or the section.** The story's own "Researched and written by AI" line at the top covers the page.
   - **How a card finds its place** (`STORY_CONTEXT_PLACEMENT`, a server setting read when a page is served, so a change applies to every story at once):
     - `model`, the default: the write call names each card's place (a paragraph, a point, or the section) in the same call, at no extra cost, and it is stored with the card. Code applies the limits, and notes over them go to the section in card order. The eval judges whether each note adds to the paragraph or point beside it; if that falls short of its bar, the step goes live with `section` until it doesn't.
     - `random`: cards are placed at random among the paragraphs and points that cite at least one of the card's sources, under the same limits. The draw is seeded by the story, so a page never reshuffles. A card with no such spot goes to the section, and so cards from the second search always do in this mode.
     - `section`: every card in the section, nothing beside the text.
   - **The cards follow the mockup:**
     - a kicker naming the slot (Compared with what, Why now, The long build-up, Who it reaches, What's being done, What comes next, Key term, In numbers);
     - a short heading;
     - at most one visual: big-number tiles, comparison bars, or a line over time;
     - up to three cited sentences;
     - a footer that names each source and gives the date the facts are from.
   - **Which stories get it:** every published story that has a research run, single-source ones included. A story without a research run shows nothing new.
   - **Always a constructive element (Odin, 16 Nov; roadmap D10).** Every story's context looks for what is being done about the problem: responses under way, solutions tried, or what has worked against the same problem elsewhere. When research's facts don't cover it, its search goes first. A story that itself reports the response (a new policy, a breakthrough) counts, and gets no extra card. When nothing sourced turns up, no card is shown (Odin, 17 Nov, replacing the honest-gap card that said so); nothing is written to sound hopeful without a source.
   - **Where this differs from the mockup:**
     - The map in the header is not part of this module.
     - The key quote stays where it is today and is not repeated as a card.
     - The ×3/×5 pictograms and the split bar in "Why this year" become big-number tiles until a later module adds those chart types.
     - The mockup's honest-gap card ("Our sources don't say…") is not shown: when nothing sourced turns up, there is no card (Odin, 17 Nov).
   - **Considered and set aside:** notes inside the text column on desktop (`context-split-inline.png`), one block without notes (`context-place-*.png`), and full cards on phones instead of one-line notes.
2. **The AI disclosure. Decided (Odin, 16 Nov): no new visible label.** The story's existing "Researched and written by AI" line covers the cards, so `aiDisclosureCopy.ts` gains nothing. The machine-readable markers stay: `data-ai-generated="context"` on each note and the section, and the route's `aiGenerated` field.
   - **The methodology text (decided, as recommended):** a paragraph in the existing researched-stories section, which the "Researched and written" link already opens: "Many stories carry context cards: how big the development is compared with what came before, why it is happening now, who it reaches, what is being done and what comes next. An AI model reads the sources our research found and, where something a reader needs is missing, searches for up to three more. Every number on a card names its source, and when sources disagree we show both. A separate AI check compares each fact with the sentence it came from and drops what that sentence does not say. Each card gives the date its facts are from; we don't update cards later."
     - **Held until the step is switched on (review of 17 Nov).** The paragraph would be untrue on the live site while `build_story_context` is off, so it is not on the page yet. It goes back into the researched-stories section of the methodology page, word for word, in the same change that commits the eval's gap keys, which lands right before Odin switches the step on (`.context/story-context.md`, "Before switching on").
3. **Spending: one overview of every job, with warning levels and no caps. Decided (Odin, 16 Nov).** Mockup: `mockups/admin-dashboard-spending.png`.
   - The Dashboard gets a "Spending" table: every job that spends money, grouped as on the Jobs page, with this month's AI and web search spend, the month at this pace, and the two months before. Research started by an editor has its own row. The earlier months fill in from the month this ships; there is no history to backfill.
   - A warning level can be set for each job and for the total, in the table. Passing it, or heading past it at this pace from the 8th of the month on, records one notice per job and month. Story context starts at $20; the other levels start empty.
   - Nothing stops on cost. OpenAI's project limits cover AI spend. They don't cover web search: research keeps its own monthly cap as it is, and story context's runs are bounded by their size (at most 20 stories at most $0.10 each, so at most about $2 a night; a usual night is about $0.30).
   - Expected spend for story context: about $6–10 a month at today's roughly 9 stories a day, about $12 in a busy month. That is about $0.03 a story, two thirds of it web search.
   - Not in the table: podcast voices, which the ElevenLabs plan covers and the podcast's character cap limits (the table shows the characters used as a line), and AI actions started from the admin, such as bulk re-assessing, which run outside any job and are not recorded today.
4. **When the step fails a lot: a notice, no pause. Decided (Odin, 16 Nov), as recommended in answer to his question of what a pause would give if the step retries the next night anyway.**
   - When more than 20% of the items a night's run checked fail their checks (with at least 20 checked), the Jobs page shows a warning line under the step and one notice is recorded. A repeat on a later night reopens that notice and counts it. The step runs the next night as usual, and you switch it off on the Jobs page if it keeps happening. Each story's admin section shows what was dropped and why (item 5).
   - **Why no pause:** a failed item is dropped by the checks, so readers never see it, and the step runs every night anyway. A pause would only save the rest of one night's run, about $0.30. What it would also buy: that night's remaining stories would wait for the next night instead of being settled with fewer cards, which is a handful of stories. A step that keeps failing costs at most about $0.30 a night until you act, and the $20 warning level catches anything bigger.
   - **Alternative:** the earlier design, a pause for the rest of the run and a hold after 3 bad nights in a row with "Lift pause" on the Jobs page. It adds three columns, a guard in the chain runner and a button for about $0.30 a night.
5. **Managing a story's context in the admin. Decided (Odin, 16 Nov): all of it, as recommended.** Mockup: `mockups/admin-story-context.png`. A "Context" section on the story's edit form, after Research:
   - every card with its kicker, heading, phone line, sources and where it sits;
   - per card, "Hide" and "Show", and where it sits: beside another paragraph or point, or under More context. A moved card keeps its place whatever the placement mode, and the limits still apply;
   - "Hide all context", which asks first;
   - "What the run did": per slot whether it was found, searched for or not needed, the searches with cache hits, each dropped fact with the check's reason, and the cost.
   - **Recommended:** all of it. The run view is where the failure notice of item 4 leads, and it needs no new records: the run rows already hold it. Nothing is ever deleted; hiding sets a card's status.
   - **Alternative:** only "Hide all context", the earlier recommendation. Less work, but one wrong number takes down all of a story's context, and checking a bad night means reading the database.
   - Without either, a wrong number a reader reports stays on the page until someone edits the database. D3 lets a person only switch a step off or set it to review, and switching the step off keeps the cards already shown, as research's switch does.

## Problem

Research already gathers the facts that would let a reader size a story: the record to compare with, the causes, who is affected. They sit in prose or in the run's stored facts, and nothing looks for the context research did not find. Readers get no comparisons, no figures with their sources and no charts. The fix has to keep the relevance bar where it is, run with no person in the loop, never hold up publishing, and make its cost and its bad nights visible. Nothing does the last part yet: no page shows a job's spend over a month, nothing warns when spend climbs, and no notice says that a step's checks failed far more than usual.

## Approach

### Where it runs

There is a new job, `build_story_context` ("Story context"). It is the **fourth step of `daily_edition_chain`, after `publish_stories`**: select, research, publish, context.

- It is seeded **disabled**, with a spending warning level of $20 (For Odin 3).
- Each run takes the published stories it still owes, oldest published first:
  - published within the last `lookbackDays` (3);
  - with a completed research run whose sources hold facts;
  - with no context run yet.
- It takes at most `perRun` (20) stories, `concurrency` (3) at a time.
- A story is settled by its first context run, whatever that run's outcome. A run cut off by a restart is marked failed after `staleRunMinutes` (120) and settles its story, as research's runs do.

**Why after publishing.** The roadmap says "right after research", and the chain's deadline then would have to decide between publishing late and publishing without context. Placed after publish, the context step can never delay publishing and can never stop it. That matters because a failed step stops its chain, so a new module that throws before publish would hold the day's edition. The cost is that a story is live for a few minutes, at about 01:00 UTC, before its cards appear. Stories past the per-run limit, and stories published while the step was off, are filled in at the next run while they are still within the lookback.

**Alternatives rejected:**
- Between research and publish, stopping at the deadline. This holds publishing by up to one story's run and makes a top-level failure stop the edition.
- A separate schedule outside the chain. This breaks the roadmap's rule that each module is a step with its own switch and its own cost line.

The step keeps its own Flex switch (`MODEL_JOBS`). Since it usually runs before the chain's 03:30 flex cut-off, it runs at flex price.

**Run by hand.** "Run now" does what a scheduled run does, the disabled job's included, so a trial run writes cards that readers see. The job's note says so.

**Enabling.** Enabling the job is refused while `TAVILY_API_KEY` is unset (`jobEnableChecks.ts`). Without the key no research runs exist, and pass 2 cannot search.

### What one story goes through

`buildStoryContext(input, deps)` (`services/storyContextPipeline.ts`) does no I/O of its own, as `researchStory` doesn't. Its deps are model calls, search and the opt-out policy, so the eval runs the same code. The tiers below are the starting tiers, and each step's eval decides whether a step moves up (design, "Which model does what"). Small is gpt-6-luna at low effort and medium is gpt-6-luna at medium effort, so every step runs on the small model, as the design says.

| # | Step | Tier | What it does | Checks |
|---|---|---|---|---|
| 1 | Load (I/O, before the pipeline) | — | Loads the story (title, summary, the researched paragraphs where applied, Why This Matters, Caveats, publication day, issue) and its newest completed research run's sources: `S0` and the sources found by search, with their facts, outlet, title, date and kind. It also loads the **reusable facts**: the supported, non-demoted context facts of the earlier stories that research linked in `run.earlier`, kept only if still current on this story's date (see Validity below). | Our own earlier stories' facts (`E…`) are never loaded as facts: they are our text, and a judgment never becomes evidence. |
| 2 | Structure (pass 1) | small | One call reads every research fact (statement, supporting sentence, `measures`, and its source's outlet, date and kind) and returns the structured fields of each fact by its id (see `structuredFactFields` under "Records"). | Code takes answers only for the ids it asked for. A fact left out is not checked, and counts as failed in the failure share. |
| 3 | Gap list | small | One call sees the story, the fixed checklist (`compared`, `why_now`, `build_up`, `who_affected`, `response`, `next`, `key_term`, each with its definition) and every available fact, marked current or expired. It returns, per slot, whether a reader needs it and whether the facts cover it (yes, partly, no). It also returns up to 3 searches in priority order, each with its slot, what is wanted (one line), a query of 4–10 words, and whether it needs data from the last 30 days. `response` is defined as what is being done about the problem: responses under way, solutions tried, or what has worked against the same problem elsewhere. It is always needed (D10); the call may instead answer that the story itself reports the response, quoting our text. | Code runs at most `maxSearches` (3) searches. Code treats `response` as needed whatever the answer says, and puts a `response` search first while it is uncovered and the story doesn't report it. If the answer lists none, code adds one from the story's title and "response", and the run records the fallback. Otherwise, with nothing needed and uncovered, there is no search: the story's context is still valid, and pass 2 is skipped. |
| 4 | Search (pass 2) | — | Each query goes to Tavily at **basic** depth, topic `general`, 5 results with raw text. The end date is the story's publication day, and the start date is 30 days before it only when recent data is wanted. A query already asked within `searchReuseDays` (7) is answered from `context_search_cache` at no credit cost. | Same query means the normalized text, depth, topic and the recent flag. |
| 5 | Filter (code) | — | Publishers' opt-outs (`dropOptedOut` with `researchSourcePolicy`, ADR-0056), research's `BLOCKED_DOMAINS`, any URL or domain already among the story's sources, at most 2 sources per query and `maxNewSources` (5) in all. The text for extraction is chosen as research chooses it: the passages, or the raw text when the passages are short, cut to 4,000 characters. | — |
| 6 | Extract (pass 2) | small | One call per kept source, in parallel. It extracts at most 5 facts that answer the wanted items, each with a statement in its own words, the supporting sentence copied verbatim, the structured fields and the slot it answers. It also returns `usable`, the source's kind and its outlet. | Every string is XML-unescaped, as research does. |
| 7 | Fact code checks | — | A fact must name a source we fetched; otherwise it is a structural failure and is dropped. Hints: numbers in the rendered fact that the sentence lacks (`findUnsupportedNumbers`, ADR-0057). Code also records `supportFound` (the sentence found word for word in the fetched text, `supportFound` in `researchChecks.ts`). | Nothing but structure fails here. |
| 8 | Fact check | small | Research's own `buildFactCheckPrompt` and `factCheckSchema`, unchanged, in calls of at most 25 items. Each item's text is the fact rendered by `renderFact`: value with its qualifier, unit, what is counted, place, "as of", "according to", and "estimate" where it applies. Its evidence is the supporting sentence (for a pass-2 fact, the passage: the sentence with one sentence either side) plus the source's date fact (`publishedFact`). Number hints go in as research gives them. Lines are empty, since copying doesn't apply to facts. | A rejected fact is stored with verdict `rejected` and its problem, and is never offered or shown. A fact the answer leaves out is `unjudged`, treated the same way, and counts as failed in the failure share. |
| 9 | Write | medium | One call writes the boxes from the supported facts. The figures box (`figures`, tiles only) comes first. After it come at most 6 context boxes, each with a slot, a heading of at most 8 words, 0–3 sentences each citing fact ids, and at most one visual: `tiles` (1–4, each a label and fact ids), `bars` or `line` (a measure, a unit, and points, each a label and a fact id), plus `apart` points for a different measure shown beside a comparison, never in it. Each box also names its `place`: the story paragraph (`P1`…) or Why This Matters point (`W1`…) it adds most to, or `section`, and a `teaser` of at most 8 words for the phone's one-line note. The prompt numbers the paragraphs and points for this. The figures box's place is always `section`. | The rules are in the prompt, with Bad/Good pairs: a box only where facts support it, nothing from general knowledge, no sentence that restates what the story's text, Why This Matters or Caveats already says (tiles and charts may show the story's own numbers; the writer sees those three texts for this), our own words, American English, no talk about the input, at most one em dash a box, and an expired fact stated only as a past value with its date. |
| 10 | Box code checks | — | A cited id must be a supported fact; otherwise that sentence, tile or point is dropped (structural). A tile's facts must be current. `validChart` applies the chart rules (below). The copying check (`checkCopying`, a 12-word run) runs on box sentences against the sources' lines (`sourceLines`). Numbers a sentence states that its cited facts don't are passed on as hints. A `place` naming a paragraph or point that doesn't exist becomes `section`; the limits are applied when the page is served (below). | A chart that breaks a rule is not drawn. Its box keeps its sentences, and this does not count as a failure. |
| 11 | Box check | small | Research's fact-check prompt once more, now with the sources' lines, so it judges copying as well as support. Items are each sentence, each tile ("12.5 million people under hazardous smoke across Southeast Asia") and each chart ("area burned in Indonesia, hectares: 2015, 2.6 million; 2026, 2.88 million (estimate)"), each against its cited facts. A chart's facts must all measure what the chart says. That is how "one definition" is judged: by the check, not matched in code. | A failing item is dropped. A box left with nothing in it is dropped. There are **no repair rounds**. |
| 12 | Response not found (code) | — | When pass 2 searched for `response`, no supported fact answers it, and the story doesn't report the response itself, the run records `responseNotFound` and no card is shown (Odin, 17 Nov; this replaced an "honest gap" box with `gap: true`, no sentences and fixed wording on the page). | — |
| 13 | Store (I/O) | — | One transaction writes every fact with its verdict, the kept boxes, and the run's result and costs. | — |

**Failure share.** The step records, per story, its checked items (every fact judged, every box item judged) and its failed items (facts rejected, unjudged or left out, box items dropped by a check). Charts not drawn under the rules don't count. Technical failures of a story (a parse failure, a Tavily error) end that story's run as `failed` with what it spent. They are in the run's tally and the logs, not in the share. The run's tally goes into its usage (`recordItems`). When more than `jobs.failureShare.share` (0.2) of at least `jobs.failureShare.minItems` (20) checked items failed, the step records a warning notice with key `step-failing:build_story_context` ("Story context: 14 of 45 checked items failed last night (usually 5 to 10%)"), linking to the Jobs page, and the Jobs page shows the same line under the step until a run stays under the share (For Odin 4). Nothing pauses.

**Cost bounds.** No monthly budget stops the step (For Odin 3). A story's calls are fixed in number (at most 3 searches, 5 extractions and about 7 model calls): about $0.03 a story, and at most about $0.10 when no search comes from the cache. With at most `perRun` (20) stories, one run costs at most about $2.

**Prompt version.** Each model-written record stores its model id and a prompt version. The version is the first 8 hex characters of a sha256 over the step's prompt, built from a fixed canonical input, plus its JSON schema. It is computed once at load, so a change to a template or a `.describe()` changes the version without a hand-kept number.

### Validity

A fact has a validity class:

| Class | Current for | Example |
|---|---|---|
| `fixed` | always | "2.6 million hectares burned in 2015" |
| `slow` | `slowValidDays` (365) days from its as-of date | "peat forest down 63% from 1990 to 2010" |
| `fast` | `fastValidDays` (14) days from its as-of date | case counts, a status, an approval |

A fact without an as-of date takes its source's date. "Current" is judged on the story's own date, not today: a one-off story's cards describe the time of the story, and the footer's as-of date says so. Expiry decides:
- which reused facts the gap list may count as covering a slot;
- which facts a tile may show;
- that the writer may state an expired fact only as a past value with its date.

### Records

There are four new tables plus the two generic ones under "Spending overview and warnings". Statuses follow the roadmap's judgment record. Model confidence is not stored: self-reported confidence is uninformative, and the fact check's verdict is the signal.

- **`context_facts`** (Fact). Columns:
  - `story_id` (cascade) and `run_id`;
  - `origin`: `research` (pass 1, its research fact id kept) or `search` (pass 2);
  - **evidence:** `source_url`, `source_outlet`, `source_title`, `source_date`, `source_kind`, `supporting_sentence` (verbatim), `passage` (pass 2 only: the sentence with one sentence either side, at most 600 characters), `support_found`;
  - **judgment:** `statement`, `value`, `value_high`, `unit`, `approx` (`exact`, `about`, `at_least`, `under`, the answer keys' vocabulary), `provisional`, `counted`, `place`, `as_of` (date) with `as_of_precision` (`day`, `month`, `year`), `credited`, `credited_kind` (`official`, `research`, `news`, `other`), `validity` (`fixed`, `slow`, `fast`);
  - **check:** `verdict` (`supported`, `rejected`, `unjudged`) with `verdict_problem`, and `status` (`unreviewed`, `reviewed`, `demoted`);
  - `model`, `prompt_version`, `created_at`.

  The full page text is **not** stored, only the sentence and the short passage. Research keeps no page text either, and copies of whole articles are a press-publisher-right question. The roadmap's evidence list says "its text". Module 2's reviews will read passages, not pages.
- **`context_boxes`** (Context box). Columns: `story_id` (cascade), `run_id`, `position`, `type` (the seven slots plus `figures`), `heading`, `sentences` (jsonb `[{ text, factIds }]`), `visual` (jsonb: a validated tiles, bars or line spec, or null), `gap` (bool; unused since 17 Nov, when the honest gap went, and kept rather than dropped by a destructive migration), `as_of` (the newest as-of of its cited facts), `place` (`P<n>`, `W<n>` or null for the section, as the write call chose it or an editor moved it), `place_by_editor` (bool), `teaser`, `status`, `model`, `prompt_version`, `written_at`. Citations stay in jsonb. A join table for "recompute what a demoted fact touched" is module 2's call.
- **`story_context_runs`**, one per story attempt. Columns: `story_id` (set null), `research_run_id`, `status` (`running`, `completed`, `skipped`, `failed`), `outcome` (`built`, `none-kept`, `no-research`, `technical`), `boxes`, `cost_usd`, `model_usd`, `tavily_credits`, `result` (jsonb: the gap list, searches with cache hits, credits and kept results, filter drops, verdict tallies, box drops by cause, number hints, item tally, calls with tokens and cost), `error` (sanitized), `started_at`, `finished_at`. Model cost and Tavily credits are kept apart per story.
- **`context_search_cache`**: `key` (sha256 of the normalized query, depth, topic and the recent flag), `query`, `results` (jsonb: URL, title, date and the chosen text of each result that passed the opt-out check), `credits`, `created_at`. Rows older than 7 days are deleted at each run's start. This is a short-lived processing copy under the text-and-data-mining terms research already works under.

### What readers see

A site route, `GET /api/stories/:slug/context`, serves the context (`services/storyContextView.ts`). Like `/appearances` it is **not in the OpenAPI contract**, so modules 2 and 3 can still change the shape without a breaking-change decision. It returns `{ boxes, sources, asOf, aiGenerated }`, or empty boxes for a story without context or one not published.

- Only boxes that are not demoted are served.
- Citations use research's `citedTextSchema` and source shape, so the client's `CitedText`, `Citation` and source cards work unchanged. Sources get the ids `C1…` in first-cited order.
- Numbers come formatted from the server (`formatFigure`): "12.5m", "400,000+", "about 2.9m", "estimate".
- The response is cached as the story detail is (`public, max-age=60`).
- It carries an `aiGenerated` marker naming the box fields.
- Each box comes with its resolved `place` (`P<n>`, `W<n>` or `section`), worked out at serve time by `placeBoxes` (pure, in `storyContextPlacement.ts`). A place an editor chose is kept in every mode; otherwise the mode from `STORY_CONTEXT_PLACEMENT` decides:
  - `model`: the stored place;
  - `random`: a draw among the paragraphs and points that cite one of the box's sources (matched by URL against the story's research sources), seeded by the story id;
  - `section`: none beside the text.

  Then the limits, in box order: at most `notesInText` (2) beside paragraphs, at most `notesByPoints` (2) beside Why This Matters points, at most one per paragraph or point, and the figures box always in the section. A place whose paragraph or point no longer exists (the story was edited) becomes the section.

**Tile rule** (`tileDisplay`, pure; D5 and design rule 4):
- Only the tile's facts that are current count.
- The headline is the newest value from the most authoritative kind present: official, then research, then news, then other. The kind is the credited body's kind, else the source's.
- Any other current fact dated on or after it with a **different** value is shown beside it: "5,000 to 5,400, depending on whose count", each value naming its source.
- The same value from several sources shows once, credited to the headline source.

**Chart rules** (`validChart`, pure; D9 and design module-1 table):
- **Bars:** at least 2 points, one unit across them, no negative value, axis from zero.
- **Line:** at least 3 points with distinct as-of dates, one unit, axis from zero.
- Every point is a supported fact. Too few points means no chart.
- A provisional point is hatched. An `apart` point is drawn in a lighter tint, labeled "a different measure: shown, not compared".
- A point within 30 days of the story's date takes the area's color (`getCategoryColor`). Other points are neutral.
- Charts are client-side SVG components. Story pages are not prerendered, and no newsletter, preview image or feed shows context yet, so server-side SVG would buy nothing today.
- Each chart has a visible caption and source line, `role="img"` named by that caption, and a visually hidden table of its values, dates and sources. Marks are not focus stops.

**The page.**
- `StoryPage` asks for the context alongside the story and keeps the skeleton until both requests settle. A failed context request renders the page without context and shows no error. This way cards never shift the text below them.
- `StoryBody` takes the notes per paragraph and per Why This Matters point, and a `context` slot after Caveats, before Sources (For Odin 1).
- A card has a kicker, a heading, its visual, sentences with citation chips, and a footer with the sources and "As of Nov 14, 2026". Every note and the section carry `data-ai-generated="context"`.
- **Notes, desktop (`lg` and up):** the full card in the right margin, level with its paragraph or point; a later note moves down when the one above would overlap it. When the story has notes, the text column shifts left to make room. Between `md` and `lg` the card sits inside the column after its paragraph.
- **Notes, phones (below `md`):** a one-line button (icon, kicker, teaser, chevron) under its paragraph or point; under a point it is indented to the point's text column, past the number. The in-column card between `md` and `lg` is indented the same way. A tap opens the full card in a bottom sheet over the page. The sheet is a Headless UI `Dialog`: focus moves into it, Escape and the close button shut it, and focus returns to the button. The page doesn't scroll.
- **The section:** the ruled heading "More context" and then the cards, with no line between them (For Odin 1). No AI badge or label anywhere in the context: the story's "Researched and written by AI" line covers it (For Odin 2). On desktop the cards sit three a row, wider than the text column. On phones they are the same one-line buttons as the notes.
- No honest-gap card (Odin, 17 Nov): when nothing sourced says what is being done, the page shows no card for it.
- A story without boxes renders exactly as today.

**Admin** (For Odin 5; mockup `admin-story-context.png`). A "Context" section on the story's edit form, after Research, read from `GET /api/admin/stories/:id/context`:
- the summary line: when the newest run built it, how many cards sit where, how many are hidden;
- the cards grouped by where they sit, each with kicker, heading, teaser, sources and as-of date, a place select (the story's existing paragraphs and points, and More context) and "Hide" or "Show". `PATCH /api/admin/stories/:id/context/boxes/:boxId { hidden?, place? }`: hiding sets the box to `demoted`, showing sets it back to `unreviewed`, and a place sets `place` with `place_by_editor`. A place that names no existing paragraph or point is refused (400);
- "Hide all context" and "Show all context", with a `ConfirmDialog`: `PUT /api/admin/stories/:id/context { hidden }`;
- "What the run did", from the newest run's `result`: per slot found, searched for or not needed, the searches with cache hits and kept sources, each dropped fact with its check's problem, and the cost split into AI and web search.

The section is hidden while a story has no context run.

### Spending overview and warnings, for every job

Decided by Odin on 16 Nov in place of per-step caps (For Odin 3). This is generic and lands first, on its own.

- **Monthly spend per job.** A new table, `job_month_spend` (`job_name`, `month` as the first day of the UTC month, `cost_usd` as billed, `standard_cost_usd`, `search_usd`, `search_credits`, `runs`), is upserted by `finishJobRun` from the run's usage, on success and on failure alike.
  - AI spend is `cost_usd` minus `search_usd`. `otherUsd` in run usage is web search today (`lib/tavily.ts` is its only caller), so it is stored as `search_usd`; a later non-AI cost gets a field of its own.
  - An interrupted run's spend is lost, as its `last_run_usage` already is. That gap is bounded by one run.
  - Research started by an editor runs outside any job and keeps its cost on its own rows: the overview sums `story_research_runs.cost_usd` of editor runs by month. Pipeline runs are already in the research job's spend. Research's cost is its standard-price upper bound, and its own monthly cap stays as it is.
- **The overview.** `GET /api/admin/spending` returns, for this UTC month and the two before, each job's AI, search and total spend grouped as the Jobs page groups them, the editor-research row, the total, the month at this pace (spend × days in the month ÷ days so far), each warning level, and the podcast's TTS characters this month against `monthlyTtsCharCap`. Every job that uses models is listed, with a dash where it spent nothing. The Dashboard shows it as the "Spending" card after Unseen notices, anchored `#spending`.
- **Warning levels.** A new table, `spend_warnings` (`scope`: a job name, `editor_research` or `all`; `level_usd`, whole USD), edited in the card's "Warn at" column through `PUT /api/admin/spending/warnings/:scope { levelUsd }` (a whole number of at least 1, or null to clear). Story context's $20 is inserted with its job row.
  - After each `finishJobRun`, `checkSpendWarnings(jobName)` compares the job's month and the total with their levels. Passing a level, or a pace past it from day `spending.paceFromDay` (8) of the month, records one warning notice per scope and month: key `spend-warn:<scope>:<YYYY-MM>`, `reopen: false`, linking to `/admin#spending`. The same check runs when an editor's research run finishes, for its row and the total.
  - The check runs after the finish is written; a failure is logged and never fails the run.
- **The failure share.** Run usage gains `itemsChecked` and `itemsFailed` (`recordItems`, current scope only, so a step's tally does not roll up into its chain) and `searchCredits`. `jobNotes` gives a job's warning line its row's last usage, and the generic `failureShareWarning` shows "41 of 180 checked items failed last night" when the share passes `jobs.failureShare`. Story context is the first step to report items; later modules reuse it.

**Alternatives rejected:**
- A per-step monthly cap with an automatic pause, the earlier design. Odin sets project limits in OpenAI, so a second cap per step guards little and stops features mid-month. Web search, which OpenAI's limits don't cover, keeps research's own cap and story context's per-run bound.
- Monthly spend in two columns on `job_runs`, reset when the month changes. Simpler, but it keeps no history, and the card shows the two months before.
- Spend read from OpenAI's usage API. It would include runs outside the app, but it knows nothing of jobs or of Tavily.

### Cost

These are estimated per story at flex, from the design's prices. The first week's runs replace them.

| Part | Estimate |
|---|---|
| Structure | about $0.001 |
| Gap list | about $0.0006 |
| Up to 5 extractions | about $0.0035 |
| Fact checks | about $0.0015 |
| Write | about $0.002 |
| Box check | about $0.001 |
| **Model total** | **about $0.01** |
| Searches | about $0.024 for 3 basic searches, about $0.016 after skips and reuse |
| **Per story** | **about $0.026–0.034** |

At about 270 stories a month that is **about $7–9 a month, with a range of $6–10 and about $12 in a busy month**. Web search is about two thirds of it, which is why pass 2 starts at basic depth and 3 searches. Always looking for `response` (D10) adds a search only to stories that would otherwise have none: at most about $2 a month, less where research already covers it.

### Eval gate before switching on (D8)

Module 1 is switched on only when all of the bars below hold on the **judged half** of the gap key, as means over 3 repeated runs. Prompts are tuned only on the other half: the halves are fixed by the parity of the first byte of the slug's sha256. Everything is added to `eval:overviews` (`.context/model-eval.md`, "Overview evals"), on its terms:
- the read-only database session;
- production's prompts, schemas and pipeline, imported read-only;
- call and Tavily caches;
- `--budget`, under the eval harness's own $20 ceiling (unrelated to the step's spending warning).

| Measure | Bar (the design's first proposal; the first run measures baseline and noise) |
|---|---|
| Planted errors on module-1 facts (`fact-check --facts context`) | Catches at least 90%; wrongly rejects at most 5% of faithful and reworded facts |
| Structured fields (`context`, strong-judge labels on up to 300 figure facts) | At least 95% fully right (value, unit, counted, place, as-of, credited); no invented number passed by the fact check |
| Gap list and searches (`context`, against the gap key) | Finds at least 60% of the `must` needs the story doesn't already state; at most 1 wasted search per story on average |
| What's being done (`context`, against the gap key; D10) | A supported `response` card on at least 70% of the stories whose key has a findable `response` need the story doesn't already state |
| Boxes (`context`, strong judge) | No sentence, tile or chart left that its cited facts don't support (each one found is listed for a read) |
| Placement (`context`, strong judge) | At least 85% of the notes `model` places beside a paragraph or point add to it without restating it; reported for `random` on the same stories for comparison. Below the bar, the step goes live with `STORY_CONTEXT_PLACEMENT=section` |
| Cost | Mean at most $0.05 a story (model at flex-equivalent, plus credits) |

**What the existing eval doesn't cover, and this plan adds.**
- Today's planted-error step judges research's facts as their extracted statements. Module 1 sends `renderFact`'s rendering of the structured fields, so the step gets `--facts context`.
  - Its sample is the module-1 facts the `context` step produced: supported by production's check, then accepted by the gpt-6.1-sol@high label pass.
  - The existing variant kinds apply to the rendered text.
  - Four field-level kinds are added, each changing one field before production's `renderFact` renders it:
    - `wrong-place`: another place named among the story's facts;
    - `wrong-as-of`: the month moved back one, or the year for year precision;
    - `wrong-credit`: another credited body named among the story's facts;
    - `cumulative-swap`: "total" or "cumulative" swapped with "new" or "weekly" in `counted`, only where one of them is there.
- The `context` step runs production's `buildStoryContext` on the key's stories through eval deps:
  - cached calls;
  - Tavily cached, with the end date at each story's publication day;
  - no opt-out policy, recorded as `optOutChecked: false`, as `eval:research` does.

  It then scores with `contextScore.ts` and three eval-only judge calls on gpt-6.1-sol@high (`contextJudge.ts`):
  - which key needs the kept output meets, each against its `accepts` text, citing fact ids;
  - field labels for figure facts;
  - support for each kept box item.
- **Wasted search:** a search none of whose sources produced a supported fact that a kept box cites. The report also lists searches made for a slot the key marks `notNeeded`.
- **Replay hindsight:** pages updated after the story's date still leak, and `general` results are often undated, so the end date filters less than it does for news. The smoke run checks the result dates, and the report states the flattery.

**The gap key: format.** One file per story, `server/src/scripts/eval/overviews/gapKeys/<slug>.json`, committed like `keys/`. The schema is `gapKeySchema.ts` (Zod, with the field rules in `.describe()`s):

```json
{
  "schemaVersion": 1,
  "slug": "indonesia-s-fires-burn-nearly-3-million-hectares",
  "title": "Indonesia's 2026 fires may set a century record",
  "date": "2026-11-14",
  "needs": [
    {
      "id": "record-2015",
      "slot": "compared",
      "need": "How this year's burned area compares with the 2015 record season",
      "kind": "figure",
      "importance": "must",
      "inStory": null,
      "accepts": "Any figure for the area burned in Indonesia in 2015, in hectares, credited to a named source",
      "example": { "value": "2.6 million hectares", "source": "The Guardian" }
    }
  ],
  "notNeeded": [{ "slot": "key_term", "why": "The story depends on no special term" }],
  "notes": ""
}
```

`validateGapKey` (pure, tested) checks that:
- `date` is `YYYY-MM-DD`;
- the slots come from production's checklist enum, imported so the key can't drift from it;
- there are 2–8 needs with unique ids, at least one of them `must`;
- `kind` is `figure`, `fact` or `term`;
- `inStory`, when set, is a non-empty quote of our published text;
- every checklist slot appears either in `needs` (once or more) or in `notNeeded` (once), never in both;
- `response` is always in `needs` with importance `must` (D10). When the story itself reports the response, that need has `inStory` set; when the drafter found no source for one, its `accepts` says so and `example` is null.

`gapKeys.test.ts` runs the schema and `validateGapKey` on every committed file, with no database.

**The gap key: how it is drafted and checked.**
- **Sample.** `gapDraft.ts` picks 30 published stories deterministically (`sampling.ts`). Each one:
  - has a completed research run with facts;
  - is not an entry or near miss of any development key;
  - is from the last 4 months;
  - falls into strata of the four top-level issues and of figure-heavy versus figure-light stories (by significant numbers in the text).
- **Draft.** `--steps gap-draft` sends each story's published text and its research run's fact statements to gpt-6.1-sol@high with an eval-only drafting prompt. The drafter's job is "what would a careful editor add so a reader can size and place this story", with the checklist. It writes schema-checked drafts to `--out/gap-drafts/<slug>.json`. General knowledge is allowed here, since the key is the answer, not the step. The drafter never sees what pass 2 finds.
- **Check.** The coordinating session, as for the development keys, reads every draft against its story:
  - It cuts generic needs ("more background").
  - It makes each `accepts` concrete enough to judge.
  - It confirms `must` against `nice`.
  - It sets `inStory` where the story already states the need.
  - It commits the files.

  No owner time is needed.
- **Database check.** `--steps gap-keys` (read-only) checks that:
  - every slug is published;
  - the date is its UTC publication day;
  - a research run with facts exists;
  - every `inStory` quote occurs in the published text after normalization, as `keyCheck.ts` checks it.

  A miss is a key error to fix there. A key is edited when a story is corrected or a label proves wrong, never to make a step pass.
- **Cost:** about $2 to draft. A full gate run (3 repeats) is about $3–6, mostly the strong judge. Tavily is paid once and then cached.

### Decisions and their alternatives

1. **After publish, not before.** See "Where it runs".
2. **Pass 1 structures research's stored facts; it does not re-extract.** Research's run keeps each fact's verbatim sentence and `measures` but not the page texts. Rejected alternatives:
   - Re-fetching and re-extracting the pages: this doubles Tavily and extraction cost.
   - Adding the structured fields to research's extraction prompt: this changes a live step, needs research's eval, and would ship module 1's behavior while module 1 is still switched off.
3. **Research's fact-check prompt and schema are reused unchanged** for facts and for boxes.
   - This keeps the existing planted-error baseline meaningful, since the eval already judged items in this shape, and leaves one prompt to keep tuned.
   - Cost: of the design's three hints, only number mismatches reach the judge, as research gives them.
   - "As of later than the source's date" is visible to the judge through the date fact in the evidence.
   - "Sentence not found word for word" is recorded on the fact and measured by the eval, not sent: the judge sees only the sentence and couldn't use the hint.
   - A hint channel, which would change research's prompt, is the follow-up if the eval shows not-found facts are often wrong.
   - Rejected alternative: a purpose-built fact prompt. That means a second prompt to calibrate and no baseline.
4. **No repair rounds.** A failing sentence, tile or chart is dropped, and an empty box with it. Cards are optional by nature ("a card is skipped when the sources don't support it"), and repair calls would add a medium-tier call per story. Rejected alternative: research's repair rounds.
5. **Two kinds of reuse instead of overviews**, which don't exist until module 2:
   - an exact-query cache for 7 days;
   - the current, supported context facts of earlier stories research linked.

   The run records cache hits and reused facts, and if the cache's hit rate stays near zero for a month it goes (follow-up). Rejected alternative: reuse keyed on the overview, which needs module 2.
6. **A site route, not a field on the public story.** See "What readers see". Rejected alternative: adding `context` to `GET /api/stories/:slug` and the snapshot. That avoids one request, but it freezes an unproven shape as public contract.
7. **Only three visual kinds** (tiles, bars, line), drawn on the client. Rejected alternatives:
   - The thinking document's eight types: YAGNI until stories need them.
   - Vega-Lite: hard to enforce "every mark has a source".
8. **One spending overview with warning levels for every job, and no caps** (Odin, 16 Nov), as described under "Spending overview and warnings". A high failure share records a notice and pauses nothing (For Odin 4).
9. **One model tier per step to start**: small, except the write at medium, as research's write. The eval moves a step up.
10. **The write call picks each card's place; the limits and the mode apply when the page is served.** No extra call, and a change of mode or limits reaches every story at once with no rewrite. Rejected alternatives: a separate placement call per story (one more call for a choice the writer is already making), and placing by shared sources alone (free, but the second search's cards could never sit beside the text). `random` stays available as a mode, so the eval can compare it with `model`.

### ADRs to write (when the code lands)

These follow the format of the existing files in `.context/decisions/` (the latest is ADR-0059). The roadmap's stubs this module is the first code for become ADRs:
- **D3**, no person in the loop. It names the admin's hiding and moving of cards as the exception, if Odin approves them (For Odin 5).
- **D4**, as an amendment to ADR-0057: its rule extended to every new step, and its hint list.
- **D5**, one named source is enough, with the tile rule.
- **D8**, the eval gates each launch.
- **D9**, no images per story; charts from fixed rules.
- **D10**, always a constructive element, with `response` always needed and, since 17 Nov (ADR-0065's amendment), no card when nothing sourced is found.

There are also two new ADRs: "Story context: facts and boxes as records, and the step after publishing", with decisions 1, 2, 3 and 5 above, and "Spending: monthly spend per job with warning levels and notices instead of caps", with decision 8.

## Changes

**Generic: spending overview and warnings**

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | New `JobMonthSpend` (`job_month_spend`, primary key `jobName` + `month`) and `SpendWarning` (`spend_warnings`, primary key `scope`) |
| `server/prisma/migrations/<ts>_job_spending/` | Authored with `db:migrate:create`: the two tables. Delete any proposed `DROP INDEX "story_embeddings_embedding_idx"`. Nothing destructive |
| `server/src/lib/runUsage.ts` | `RunUsage` gets `searchCredits`, `itemsChecked`, `itemsFailed`. New `recordItems(checked, failed)` (current scope only). `recordOtherCost(usd, credits = 0)` also adds credits |
| `server/src/lib/tavily.ts` | `TavilySearch` gets optional `depth`, `topic`, `maxResults`, and `startDate` becomes optional. The defaults keep research's request body byte for byte. Credits are passed to `recordOtherCost` |
| `server/src/jobs/jobLease.ts` | `finishJobRun`: upserts `job_month_spend` from a non-null usage, in the same statement batch, then calls `checkSpendWarnings` outside it (a failure is logged, never thrown) |
| `server/src/services/spending.ts` (new) | *Responsibility:* the month's spend per job, editor research and in total, the pace, the warning levels and their once-a-month notices. `paceUsd` and `warningsDue` are pure. *Exports:* `getSpendingOverview`, `setSpendWarning`, `checkSpendWarnings`, `paceUsd`, `warningsDue` |
| `server/src/services/researchRuns.ts` | The editor's run (trigger `editor`) calls `checkSpendWarnings('editor_research')` once it has finished |
| `server/src/schemas/spending.ts` (new), `server/src/routes/admin/spending.ts` (new), `server/src/routes/admin/index.ts` | `GET /api/admin/spending`; `PUT /api/admin/spending/warnings/:scope { levelUsd }` (a whole number at least 1 or null; 400 for an unknown scope). Routes name their 500 texts with `failsWith()` |
| `server/src/jobs/jobNotes.ts` | Warning functions get the job's row; the generic `failureShareWarning(lastRunUsage)` |
| `server/src/config.ts` | `spending: { paceFromDay: 8 }` and `jobs.failureShare: { share: 0.2, minItems: 20 }` (no env overrides) |
| `shared/types/index.ts` | `SpendingOverview`, `SpendingRow`, `SpendScope`. `JobRunUsage`: the three new fields |
| `client/src/components/admin/SpendingCard.tsx` (new), `client/src/hooks/useSpending.ts` (new), `client/src/pages/admin/DashboardPage.tsx` | *Responsibility:* the Dashboard's "Spending" card: grouped rows, pace with its pill, the two months before, the voices line, the "Warn at" fields saved on blur. *Exports:* `SpendingCard` |
| `client/src/lib/admin-api.ts` | The two endpoints |

**Story context: server**

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | Enums `ContextValidity`, `ContextVerdict`, `JudgmentStatus`, `ContextBoxType`, `ContextRunStatus`. Models `ContextFact`, `ContextBox`, `StoryContextRun`, `ContextSearchCache`, with relations on `Story` |
| `server/prisma/migrations/<ts>_story_context/` | The tables and indexes (`story_id` on facts, boxes and runs; `started_at` on runs). The `build_story_context` row, disabled, and its `spend_warnings` level of 20, both inserted `ON CONFLICT DO NOTHING` |
| `server/src/schemas/storyContext.ts` (new) | *Responsibility:* the structured outputs of the context prompts and the stored box shape. *Exports:* `structuredFactFields`, `structureSchema`, `gapListSchema`, `contextExtractionSchema`, `boxesSchema`, plus `CONTEXT_SLOTS` and the stored-visual schema |
| `server/src/prompts/storyContext.ts` (new) | *Responsibility:* the structure, gap-list, extraction and write prompts (Role, Goal, XML constraints; fetched text escaped as untrusted). *Exports:* `buildStructurePrompt`, `buildGapListPrompt`, `buildContextExtractionPrompt`, `buildBoxesPrompt` |
| `server/src/prompts/research.ts` | Export the private `tag` and `UNTRUSTED` for reuse. No prompt text changes |
| `server/src/services/researchedStory.ts` | Export `citedTextSchema` and the source schema for the context view. No shape change |
| `server/src/services/storyContextPipeline.ts` (new) | *Responsibility:* one story's steps 2–12 with injected deps, no I/O. *Exports:* `buildStoryContext`, `CONTEXT_STEP_TIERS`, `ContextDeps`, `StoryContextResult`, `CONTEXT_PROMPT_VERSIONS` |
| `server/src/services/storyContextChecks.ts` (new) | *Responsibility:* the pure checks: `renderFact`, the fact and box items with their evidence and hints, applying verdicts, dropping failed items and empty boxes, the item tally. *Exports:* `renderFact`, `factCheckItems`, `boxCheckItems`, `applyBoxVerdicts`, `itemTally`. It reuses research's `checkCopying`, `sourceLines`, `judgedProblems`, `publishedFact` and `supportFound` |
| `server/src/services/storyContextVisuals.ts` (new) | *Responsibility:* validity, number formatting, the tile rule and the chart rules (pure). *Exports:* `isCurrent`, `formatFigure`, `tileDisplay`, `validChart` |
| `server/src/services/storyContextInput.ts` (new) | *Responsibility:* which stories the step owes and loading one story's input (tagged `$queryRaw`, SELECT only, so the eval can call it through the read-only session). *Exports:* `nextForContext`, `loadContextInput` |
| `server/src/services/storyContextSearch.ts` (new) | *Responsibility:* pass 2's search: the 7-day cache (read, write, prune), Tavily through `lib/tavily.ts`, the opt-out and source filter. *Exports:* `contextSearch`, `pruneSearchCache`, `searchKey` |
| `server/src/services/storyContextRuns.ts` (new) | *Responsibility:* one story's run in production: the run row, production deps (structured calls on the tier models after `rateLimitDelay()`, never in `withRetry`), the pipeline, the transactional write, stale runs. *Exports:* `runStoryContext`, `markInterruptedContextRuns` |
| `server/src/services/storyContextView.ts` (new) | *Responsibility:* what readers get of a story's context (published only, not demoted, tiles and charts resolved, sources numbered). *Exports:* `getStoryContext` |
| `server/src/services/storyContextAdmin.ts` (new) | *Responsibility:* the admin's view and edits: boxes with status and place, the newest run's summary for "What the run did", hiding and showing one box or all, moving a box to an existing paragraph or point. *Exports:* `getContextAdmin`, `setContextHidden`, `updateContextBox` |
| `server/src/jobs/buildStoryContext.ts` (new) | *Responsibility:* the step: stale runs, prune, queue, workers, item tally into the scope, the failure-share notice after the run, per-story errors recorded as failed runs (the job does not throw for them). *Exports:* `runBuildStoryContext` |
| `server/src/config.ts` | `storyContext: { lookbackDays: 3, perRun: 20, concurrency: 3, maxSearches: 3, searchDepth: 'basic', resultsPerSearch: 5, maxNewSources: 5, searchReuseDays: 7, fastValidDays: 14, slowValidDays: 365, staleRunMinutes: 120, placement, notesInText: 2, notesByPoints: 2 }`. `placement` reads `STORY_CONTEXT_PLACEMENT` through `parseOneOf` (`model`, `random`, `section`; default `model`), so `render.yaml` and `env.example` gain it, as the blueprint test requires. The rest have no env overrides |
| `server/src/services/storyContextPlacement.ts` (new) | *Responsibility:* where each box goes on the page: the mode, the seeded draw, the limits, the fallbacks (pure). *Exports:* `placeBoxes` |
| `server/src/jobs/chainDefinitions.ts`, `handlers.ts`, `interruptedRuns.ts` | The step after `publish_stories`; the handler; `JOB_PIPELINE_ORDER`; `RESUMABLE_JOBS` |
| `server/src/services/job.ts` | `MODEL_JOBS` adds the step |
| `server/src/jobs/jobNotes.ts`, `jobEnableChecks.ts` | The note (what it does, that it runs after publishing, that a high failure share records a notice and pauses nothing, and that "Run now" writes live cards) and `failureShareWarning` as its warning. The enable check refuses without the Tavily key |
| `server/src/scripts/seed-jobs.ts` | The row, disabled, and its $20 warning level |
| `server/src/routes/public/stories.ts` | `GET /:slug/context`, `Cache-Control: public, max-age=60` |
| `server/src/lib/aiProvenance.ts` | `AI_GENERATED_CONTEXT_FIELDS` and the marker for the context response |
| `server/src/routes/admin/stories.ts` | `GET /:id/context` → `getContextAdmin`; `PUT /:id/context { hidden }` → `setContextHidden` (204); `PATCH /:id/context/boxes/:boxId { hidden?, place? }` → `updateContextBox` (204; 400 for a place that doesn't exist). 404 for an unknown story or box |
| `server/src/scripts/synthetic-data/` | Facts and boxes, one of each visual, on one of the two researched synthetic stories, for local checks; its run records the response as not found (the honest-gap box it had went on 17 Nov) |

**Story context: client**

| File | Change |
|------|--------|
| `client/src/hooks/usePublicStories.ts` | `useStoryContext(slug)` |
| `client/src/pages/StoryPage.tsx` | Asks for the context alongside the story, keeps the skeleton until it settles, and passes it to `StoryBody` |
| `client/src/components/story/StoryBody.tsx` | Notes after their paragraph or Why This Matters point, and a `context` slot after Caveats |
| `client/src/components/context/StoryContext.tsx` (new) | *Responsibility:* the section: ruled heading, the wide grid on desktop and the one-line buttons on phones. *Exports:* `StoryContext` |
| `client/src/components/context/ContextNote.tsx`, `ContextSheet.tsx` (new) | *Responsibility:* a note beside the text (margin card on wide screens, in-column card in between, one-line button on phones) and the bottom sheet a button opens. *Exports:* `ContextNote`, `ContextSheet` |
| `client/src/components/context/ContextCard.tsx` (new) | *Responsibility:* one card: kicker, heading, visual, cited sentences, source and as-of footer (the honest-gap look went on 17 Nov). *Exports:* `ContextCard` |
| `client/src/components/context/FigureTiles.tsx`, `ContextChart.tsx` (new) | *Responsibility:* tiles with side-by-side values and their sources; bars and line as SVG with caption, source line and a hidden table. *Exports:* `FigureTiles`, `ContextChart` |
| `client/src/components/context/contextText.ts` (new) | *Responsibility:* the slot kickers and the as-of wording (pure; the honest-gap sentence, `GAP_TEXT`, went on 17 Nov). *Exports:* `slotKicker`, `asOfLine` |
| `client/src/pages/MethodologyPage.tsx` | The context-cards paragraph in the researched-stories section (For Odin 2), word for word as approved, **held until the step is switched on**: it lands with the commit of the eval's gap keys, right before the switch (`.context/story-context.md`, "Before switching on"); until then a comment marks its spot |
| `client/src/components/admin/StoryContextAdmin.tsx` (new), `StoryEditForm`, `client/src/hooks/useStoryContextAdmin.ts` (new), `client/src/lib/admin-api.ts` | *Responsibility:* the story's "Context" section after Research: summary line, cards grouped by place with the place select and "Hide"/"Show", "Hide all context" with a `ConfirmDialog`, and "What the run did". *Exports:* `StoryContextAdmin` |
| `client/src/lib/constants.ts` | `JOB_DISPLAY_NAMES` and `JOB_PIPELINE_ORDER` |
| `shared/types/index.ts` | `JobName` adds `build_story_context`. `StoryContextView`, `ContextBoxView` and the visual types |

**Eval**

| File | Change |
|------|--------|
| `server/src/scripts/eval/overviews/gapKeySchema.ts` (new) | *Responsibility:* the gap key's schema and `validateGapKey` (pure). *Exports:* `gapKeySchema`, `validateGapKey`, `GapKey` |
| `server/src/scripts/eval/overviews/gapKeys/*.json`, `gapKeys.test.ts` (new) | The 30 committed keys, and every file checked with no database |
| `server/src/scripts/eval/overviews/gapDraft.ts` (new) | *Responsibility:* the sample of 30 one-off stories and the drafting calls. *Exports:* `sampleGapStories`, `draftGapKeys` |
| `server/src/scripts/eval/overviews/gapKeyCheck.ts` (new) | *Responsibility:* the gap keys against the database (SELECTs) and the pure matching. *Exports:* `checkGapKeys` |
| `server/src/scripts/eval/overviews/context.ts` (new) | *Responsibility:* running production's pipeline on the key stories with eval deps (call cache, Tavily cache, end date at publication day). *Exports:* `runContextEval` |
| `server/src/scripts/eval/overviews/contextJudge.ts`, `contextScore.ts` (new) | *Responsibility:* the strong-judge calls (needs met, field labels, box support), and the pure scores, halves and repeats spread. *Exports:* `judgeContext`, `scoreContext`, `halfOf` |
| `server/src/scripts/eval/overviews/plant.ts`, `factFixtures.ts`, `factCheck.ts` | The four field-level kinds. `--facts context` samples module-1 facts from the `context` step's cache, rendered by production's `renderFact` and checked through production's `factCheckItems` |
| `server/src/scripts/eval/options.ts`, `overviews.ts`, `overviews/report.ts` | Steps `gap-draft`, `gap-keys`, `context`; flags `--facts research|context` and `--half tune|judge|all`; the report's sections against the bars |
| `server/src/scripts/eval/imports.test.ts` | Allows the new production imports (`storyContextPipeline`, `storyContextChecks`, `storyContextVisuals`, `storyContextInput`, `prompts/storyContext`, `schemas/storyContext`) |

**Docs**

| File | Change |
|------|--------|
| `.context/story-context.md` (new) | The subsystem: rules and guarantees (no status or rating writes, after publishing, validity, the tile and chart rules, D4's checks), the steps, records, the cost bounds, the failure share and its notice, reuse, costs, the route, the admin section, the eval gate, key files |
| `CLAUDE.md` | A row for `story-context.md` in the context table; `scheduler.md`'s row names the spending overview |
| `.context/scheduler.md` | The step in the chain table; a "Spending" section: `job_month_spend` written at every finish, editor research from its own rows, `spend_warnings`, the pace rule, the notices, no caps (Odin, 16 Nov); run usage's item tally, search credits and `failureShareWarning` |
| `.context/admin-dashboard.md` | The Spending card |
| `.context/admin-notices.md` | The `spend-warn:<scope>:<YYYY-MM>` and `step-failing:<step>` keys |
| `.context/story-research.md` | Module 1 reads research's runs; editor research in the spending overview; its own cap unchanged |
| `.context/public-website.md` | "Story context" on the story page (placement, cards, the route, markers) |
| `.context/ai-transparency.md` | The feature in the inventory (model ids, written fields, `data-ai-generated="context"`, the response marker, no human review per D3, the admin's hide and move). Owner decision of 16 Nov: no visible label of its own, since the story's "Researched and written by AI" line covers the cards on the same page |
| `.context/llm-analysis.md` | The tier table lists the context steps |
| `.context/model-eval.md` | "Overview evals" gets the gap key (format, drafting, checking), `context`, `--facts context`, the bars and the halves |
| `.context/decisions.md`, `.context/decisions/` | The ADRs under "ADRs to write" |

## Tests

These follow the project's patterns: `vi.hoisted()` mocks, `supertest` with `authHeader()`, `*.db.test.ts` against PostgreSQL, RTL with the providers. Each pure unit is tested first.

- **`spending.test.ts`** (pure)
  - `paceUsd`: day 16 of 30, the 1st, the last day, a 28-day February.
  - `warningsDue`: passed; on pace from the 8th and not before; no level; the total and a job at once.
- **`spending.db.test.ts`**
  - The overview sums `job_month_spend` by month, AI as cost minus search, the two months before, and editor research runs only (pipeline runs are in the job's spend).
  - `checkSpendWarnings` records one notice per scope and month, and a second pass in the same month records nothing.
  - Setting and clearing a level.
- **`runUsage.test.ts`:** `recordItems` does not reach the parent; credits roll up.
- **`jobLease.db.test.ts`:** `finishJobRun` inserts and then adds to the month row, starts a new row in a new month, and does nothing on null usage; a warning check that throws doesn't fail the finish.
- **`routes/admin/spending.test.ts`:** `GET` shape; `PUT` sets and clears a level; 400 for an unknown scope, zero or a fraction.
- **`jobNotes.test.ts`:** `failureShareWarning` shows above 20% with at least 20 items, and not at exactly 20% or under 20 items.
- **`tavily.test.ts`:** research's default request body is unchanged; the context options set depth, topic, results and an open start; credits reach the scope.
- **`storyContextVisuals.test.ts`**
  - `isCurrent` for each class, a missing as-of date and the source-date fallback.
  - `tileDisplay`: agreeing values credited to the most authoritative source; different values on the same or a later day shown side by side; older and expired values left out.
  - `validChart`: bars need 2 points, one unit and no negatives; a line needs 3 distinct dates; a point citing a rejected fact is removed before counting.
  - `formatFigure`: m and k, `+`, "about", "estimate".
- **`storyContextChecks.test.ts`**
  - `renderFact`'s branches (no figure, range, qualifier, credit, provisional, coarse as-of).
  - Fact items carry the sentence (or passage) and the date fact as evidence, with production's number hints.
  - Box items for a sentence, a tile and a chart.
  - Dropping failed items and empty boxes.
  - The tally: unjudged and left-out facts count as failed, undrawn charts don't.
  - A cited id that isn't a supported fact is dropped as structural.
- **`storyContextPipeline.test.ts`** (fake deps)
  - A run with no facts is skipped.
  - Nothing needed and uncovered means no search.
  - Searches stop at 3, in the gap list's order.
  - A cached search costs no credits.
  - Opted-out and blocklisted results are dropped.
  - One extraction's parse failure leaves the others.
  - Rejected facts never reach the write prompt.
  - An uncovered `response` is searched first, whatever the gap list's order; with no `response` search listed, the title fallback is added and recorded.
  - When `response` was searched for and not answered, no box is added and the run records `responseNotFound`; never when the story itself reports the response (17 Nov, replacing the honest-gap box).
  - Model cost and credits are totaled apart.
- **`storyContextSearch.test.ts`:** key normalization; a hit within 7 days and a miss after; prune; at most 2 per query, at most 5 in all, and no URL or domain already among the story's sources.
- **`storyContextInput.db.test.ts`**
  - The queue: published within the lookback, with a research run with facts and no context run; oldest first; the limit.
  - Reusable facts: earlier stories' supported, non-demoted, current facts only.
- **`storyContextRuns.db.test.ts`:** facts (with verdicts), boxes and the run in one transaction; a stale `running` row is marked failed; a skipped run is recorded.
- **`buildStoryContext.test.ts`:** the item tally reaches the scope; above the share one notice is recorded, at or under it none; an error outside a run records a failed run and the next story goes on.
- **`storyContextView.test.ts` and the route test**
  - Only published stories get context; demoted boxes are left out.
  - Sources are numbered in first-cited order.
  - Resolved tiles and charts, the marker, and the cache header.
  - Empty boxes for a story without context.
- **`storyContextPlacement.test.ts`**
  - `model` keeps stored places within the limits; the extras go to the section in box order; one note per paragraph or point.
  - `random` only picks spots that cite one of the box's sources, gives the same answer for the same story, and sends a second-search box to the section.
  - `section` places nothing beside the text; the figures box always goes to the section; a place past the story's last paragraph falls back.
  - An editor's place is kept in every mode, under the same limits.
- **`storyContextAdmin.db.test.ts` and the admin stories route:** `GET` returns boxes with status and place and the newest run's summary; hide all sets every box to demoted and show restores them; one box hides, shows and moves; a place that doesn't exist is a 400; 404 for an unknown story or box.
- **`jobEnableChecks` test:** enabling is refused without the Tavily key.
- **Client**
  - `StoryContext.test.tsx`: nothing renders without boxes; cards render in order with kicker, heading, citations and the as-of footer; the `data-ai-generated` marker.
  - `ContextNote.test.tsx`: a note renders after its paragraph or point, and a point's note sits in the point's text column; on a phone width the button opens the sheet, Escape closes it and focus returns to the button.
  - `FigureTiles.test.tsx`: a range names both sources.
  - `ContextChart.test.tsx`: the hidden table holds every value and source; a provisional mark is hatched.
  - `StoryPage.test.tsx`: the skeleton stays until the context settles; a failed context request renders the page without it; the section after Caveats; no images from outside our site and API.
  - `SpendingCard.test.tsx`: rows grouped as on the Jobs page; the pace pill; a level saves on blur and an empty field clears it; the voices line.
  - `StoryContextAdmin.test.tsx`: hidden while there is no run; hiding one card and moving one; "Hide all context" asks first; the run's dropped facts with their reasons.
- **Eval**
  - `gapKeys.test.ts`: every committed key passes, and each rule fails on an inline key, including a key without a `must` `response` need.
  - `contextScore.test.ts`: recall over `must` needs not in the story; wasted searches; the deterministic halves; the spread.
  - `plant.test.ts`: each new field-level kind, and what it must leave alone.
  - The option parser.

## Out of Scope

- The header map, and chart types beyond tiles, bars and a line: waffle, progress, event strip, process diagram, pictograms. A later plan adds them when stories need them.
- Refreshing or expiring the cards of older stories, and re-research on expiry. Module 1 builds a story's context once. Overviews (module 2) refresh.
- Model reviews, automatic demotion and recomputing what a demoted fact touched (module 2, D6, D7).
- Context in the public OpenAPI contract, the newsletter, the podcast, social posts, feeds or preview images.
- Any change to research's prompts, schemas or apply. A fact-check hint channel waits for the eval's verdict on not-found sentences.
- Caps of any kind on a job's spend, and pausing a step on failures (Odin, 16 Nov). Research's own monthly cap and the podcast's character cap stay as they are.
- Counting AI actions started from the admin (bulk re-assessing and the like), which run outside any job. The card says they are not counted.
- Backfilling spend from before the overview ships, and backfilling the archive's context beyond the 3-day lookback.

## Order of work

- **First, the spending overview and warnings** (its own commit). It changes no job's behavior and shows each job's spend from its first run after deploy.
- **Then, all switched off:** records, pipeline and job; the story page and the admin Context section, checked locally on the synthetic story with Playwright; the eval steps.
- **Before the commit:** in both packages, `npm run lint`, `npm run format`, `npm run typecheck`, `npm run test:coverage` (raise floors that rose, never lower them) and `npm run build`. Also `npm run check:migrations --prefix server`, and `npm run test:db --prefix server`, which needs a local test database. If the container has none, say so in the report.
- **After merge:**
  - Draft and check the gap keys.
  - Run `eval:overviews --dry-run`, then `--steps context --limit 3` as a smoke run (check Tavily's dates on `general` results).
  - Run the full gate with `--repeat 3`.
  - Report against the bars. Odin switches the step on.

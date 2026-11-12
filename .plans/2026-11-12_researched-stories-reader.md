---
status: draft
type: feature
complexity: complex
---

# Researched stories reach readers

Design: `/mnt/project-files/multi-source-stories/2026-11-12_multi-source-stories-design.md` (owner-approved 2026-11-12); mockup `citation-variants/2026-11-12_favicons-desktop.png` and `…-phone.png`. Stage 1 (admin-only research runs, publishers' opt-out check) is live: `.context/story-research.md`.

## Open behavior questions (owner)

The design does not answer these. Each has a default the plan builds unless the owner says otherwise.

1. **What the kill switch reaches.** Switching research off stops new research and lets publishing proceed in today's format. Should it also return already-published researched stories to the single-source format, for example after a legal finding? *Default: no. Already-published stories keep their researched version, and an editor reverts one story at a time. A bulk revert is follow-up work.*
2. **Overruling a research rejection.** When an editor publishes a story that research rejected (research rating, stale or contradicted), which format goes live? *Default: today's single-source format. The editor puts the researched version live with "Use this version" on the run, as on any story.*

## Owner decisions (2026-11-12)

- **Header:** follow the mockup ("Initially found on X, <source date> | N sources | label"; our own publish date is dropped). The "Relevance N" chip stays out for now, on both formats.
- **Methodology page:** step 2 drafts the research paragraph for `/methodology`, and it ships only once the owner approves the wording.
- **Favicons:** no per-outlet switch at launch. Only a missing icon falls back to the outlet's initial.

## Problem

Research runs today only when an editor presses a button, and their result never leaves `story_research_runs`. Readers still get one-source stories, with "[Publisher] reports" blurbs and no per-fact citations. The design's reader side does not exist yet: research as a pipeline step with the gate, the researched version stored on the story, the cited story page and its label, and the newsletter and podcast taking the new text.

## Approach

**Three shippable steps. Each one deploys safely from `main`, and nothing changes for readers until an editor or the owner switches it on.**

- **Step 1: the reader format, dormant.** An additive migration adds `stories.research`, `stories.pre_research` and the source favicon table. The public story detail gains a nullable `research` field and a `researched` flag. The story page renders the researched format whenever `research` is set, and no story has it yet. Lands with tests and synthetic data only.
- **Step 2: apply and revert by hand.** The apply/revert service, `storyLifecycle` support for it, the admin buttons, the edit lock on swapped fields, and the podcast reading the researched text. The first real reader exposure is one story an editor chose. The legal check named in the design's Risks (press-publisher right) is the owner's gate before anyone presses "Use this version" in production.
- **Step 3: the pipeline step.** The `research_stories` job is seeded **disabled**. The publish gate, the new rejection reasons and `RESEARCH_PIPELINE_MODE` (`shadow` by default) come with it. The owner enables the job in shadow (runs are stored and the publish waits one cycle, but no verdict is applied). He evaluates as the design's rollout says (blind comparison, fact audit, rating drift with `eval:recalibrate`). Then he sets `apply`.

### Storage: swap with a snapshot (decision)

**Applying a run writes:**
- **The researched texts into today's columns:** `title`, `titleLabel`, `summary` (the draft's short summary), `quote`, `quoteAttribution`, `marketingBlurb`, `relevanceReasons` and `antifactors` (the bullets' plain text, one per line, as assess writes them), plus `relevance` and `relevanceCalculation`.
- **`relevanceSummary` set to null.** Research writes no relevance summary. `StoryCard`, `EmbedPage`, the Mastodon prompt, `socialPostFormat`, `podcastScriptStory` and `aiProvenance` read it. Left in place, it would keep single-source text next to researched text. Nulled, each of them falls back to the researched text (the implementer checks the fallback at each of the six).
- **`stories.research` (jsonb):** the cited structure the page needs.
- **`stories.pre_research` (jsonb):** every value the apply replaced, `relevanceSummary` included.

**Revert** writes the whole snapshot back, `relevanceSummary` included, and clears both columns.

*Why the swap:* about fifteen readers take those columns: cards, homepage, RSS, API lists, embed, widget, newsletter, social, the og image and link previews, carousel, search and embeddings. The design says all of them move to the multi-source short summary and blurb. With the swap they do so with no change at all.

*Alternatives rejected:*
- **An overlay table that readers merge in at read time.** Every one of those readers would need the merge, and one missed reader would show single-source text under a "Researched" label.
- **Pointing readers at `story_research_runs.result`.** That would couple the public API to an internal, large shape (calls, drops, every fact).

*How "today's fields as the fallback" holds:* a story whose research fell back, or that was never researched, keeps them untouched. A researched one keeps them in `pre_research` for revert.

*Snapshot rules:*
- `pre_research` is written only when it is empty, so re-applying a second run keeps the first snapshot and revert always returns to the single-source analysis.
- A full re-assess clears both columns, since it writes a fresh single-source analysis.

**Editor edits on a researched story.** While `research` is set, `updateStory` refuses with 409 "Revert to single-source first" any edit to a swapped field: the columns above and `relevanceSummary`. Otherwise an edit would drift from the cited story or be lost on revert. The edit form shows that note and disables those fields. Edits to other fields, and status moves, work as before.

**The public projection is built once, at apply.** `buildResearchedStory(stored)` turns a run's `StoredResearch` into:
- **Cited text:** paragraphs of sentences, and the Why This Matters and Caveats bullets, each with `citations`. There is one citation per *source*, since fact ids collapse to their source, and it carries that source's first supporting sentence for the tap card.
- **Sources:** only the ones something cites. The original article (`S0`) is always first, marked "initially found here", and our earlier stories come last. The header counts this list for "N sources".
- **`quoteSourceId`.**

At read time, earlier Actually Relevant stories that are no longer published are dropped together with their citations, and each remaining one gets its current slug. This is one query by id in `getPublishedStoryBySlug`.

**A `researched` flag keeps the label honest.** The detail serves `researched: true` whenever `pre_research` is set, independently of the projection. A projection that fails its Zod parse is served as `research: null` with a warning. The page then renders the plain fields (which hold researched text) under the "Researched and written by [AI]." label rather than the single-source one. The label keys on `researched`; the cited layout keys on `research`.

### Lifecycle (decision)

**Field writes** go through `recordAnalysis` with a new stage:

```ts
research: {
  to: selected,
  advance: { pipeline: [], editor: [] },
  refresh: [analyzed, selected, published, rejected],
}
```

`to` is unused, since nothing advances; it is `selected` only because the type requires a value. `trashed` is never written. Each write carries the re-made embedding, and `recordAnalysis` already forgets a refreshed story's related-stories cache.

**What an apply is fenced on:**
- **Editor apply** fences on the status read at apply time. A trashed story gets 409 "restore it first", as assess does.
- **Pipeline apply** fences on the status read before the run (the story was `selected`). A story an editor published or rejected during the run is skipped and keeps the editor's move.

**Revert** is `recordAnalysis('research', 'editor', …)` with the snapshot's fields, `research: null` and `preResearch: null`, and an embedding regenerated from the restored title, label and summary. It is fenced on the status at revert time, and `trashed` gets 409.

**Rejections** go through `transition(ids, { to: 'rejected', reason }, 'pipeline')` with three new `RejectionReason` values: `research_rating`, `stale` and `contradicted`. Each is allowed only from `selected` in `PIPELINE_REJECTION_FROM`.

`storyLifecycle.ts` stays the only status writer.

*Rejected: a separate `recordResearch` writer.* It would duplicate the fenced, lock-ordered write that `recordAnalysis` already does.

### Pipeline step (decision)

`research_stories` is a new job, ordered between `select_stories` and `publish_stories`, hourly (`15 * * * *`), and seeded disabled.

- **Start:** the job marks stale runs: a `running` row older than `config.research.staleRunMinutes` becomes `failed`, as `markInterruptedRuns` does. This is exported from `researchRuns.ts`.
- **Each run** takes up to `RESEARCH_PIPELINE_PER_RUN` (20) `selected` stories that have no applied research and no pipeline run. It works through them one at a time. For each story:
  - **Before starting** it re-reads its own `job_runs.enabled`, the mode, and `researchPipelineOn()`. It stops as soon as any of them is off, as `publish_podcast` re-reads its row.
  - **Then** it reserves a run marked `trigger = 'pipeline'`, researches, applies the verdict, and finishes the run row.
- **Verdicts (in `apply` mode):**
  - `keep` applies the run.
  - `research-rating`, `stale` and `contradicted` reject with the matching reason.
  - `fallback` applies nothing, so the story publishes in today's format.
- **At the cap:** the reservation is refused, and the job records a `failed` pipeline run at $0 ("skipped: monthly cap reached"), so the story is not waited on.
- **An unexpected error** on one story fails that run and moves on to the next.
- **Applying comes before finishing,** so the publish job cannot slip in between.

*Rejected: researching inside `publish_stories`.* It needs no gate, but it ties a slow, paid, failure-prone step to publishing and stretches the publish job's lease for every story.

### Publish gate (decision)

In `pipeline` mode, `publish_stories` leaves out the stories that are awaiting research. A story is awaiting research when all of these hold:
- **The pipeline is on:** the `research_stories` job row is enabled, and research isn't switched off by key or prices.
- **It has no applied research.**
- **It has no settled pipeline run.** A completed or failed run is settled. So is a `running` one older than `staleRunMinutes`, which makes the 60-minute maximum wait hold even when nothing has swept the row yet, for example after a deploy cut a run off.

A run still `running` within that time keeps the story waiting. An editor's publish ignores the gate.

*Rejected: a `research_settled_at` column or a separate wait timer.* The run rows already carry that state.

### Kill switch

Two controls, neither needing code:
- **Disable `research_stories` on the Jobs page.** A run in progress stops before its next story. The next publish run stops waiting. In-flight work is at most the one story being researched.
- **Set `RESEARCH_PIPELINE_MODE=shadow`.** Research keeps running but applies nothing. This takes a Render restart.

Removing `TAVILY_API_KEY` also switches everything off. Already-researched stories stay researched (open question 1).

### Admin controls

These go in the existing Research section of `StoryEditForm`:
- **"Use this version"** on any completed run with a draft whose verdict isn't `fallback`, whether an editor or the pipeline started it.
- **"Revert to single-source"** when the story has `pre_research`.
- **A trigger badge** (Editor or Pipeline) on each run.

An editor's run is never applied automatically. Re-running is today's Research button followed by "Use this version". The story list learns the three new rejection reasons.

### Favicons are stored by us

- **Storage:** a `source_favicons` table keyed by host, holding a 32 px PNG, or null for "looked, none found" so a host isn't refetched for 30 days.
- **Fetching** reuses `favicon.ts`'s search: Tavily's favicon URL first, then the Google API, `<link rel=icon>` and `/favicon.ico`, through the same SSRF guard. That search is extracted as `findIcon(url)`. The fetch runs in the background after apply, and the page shows the initial until the icon is stored.
- **Serving:** `GET /api/source-favicons/:host`.
- **Our own earlier stories** use a static brand icon with the brand ring.

### Story page (researched branch)

- **Header:** "Initially found on [feed name], <source date>" (linking the original), "N sources" (an anchor to `#sources`), and the label "Researched and written by [AI]." with "How it works". No relevance chip. "Also covered by" isn't shown, because the Sources list absorbs it.
- **Body, in order:**
  - the story paragraphs in place of the summary, keeping the drop cap;
  - the key quote, with its source's citation after the attribution;
  - Why This Matters and Caveats as cited bullets;
  - the Sources list (favicon, outlet, country, kind, date, linked headline; "Earlier on Actually Relevant" last);
  - the rest of today's page as it is: report an error, appearances, Related Stories, more links.
- **Citations:** one button per sentence's citation group, with 16 px icons overlapping inside a 24 px target. It is named "Source: X" or "Sources: X, Y". Its Headless UI popover card lists each source's outlet, country, kind, date, supporting sentence and "Read the source".
- **Markers:** `data-ai-generated="research"` on the researched regions.
- **Non-researched stories** render exactly as today.

### Newsletter and podcast

- **Newsletter:** no code change. It reads `summary`, which now carries the researched short summary.
- **Podcast:** `podcastScriptStory` passes the researched story text (paragraphs joined, citations stripped) in place of `summary` when `research` is set, as the design says. With `relevanceSummary` nulled, its "why it matters" falls back to the researched bullets.

Prompts and the rest stay as they are.

### Deviation from the design

The design says the API gains the story text and the source list. This plan serves them only on `GET /api/stories/{slug}` (`research`, `researched`), not on list, homepage, search or related endpoints. Lists stay lean, and their texts change through the swapped columns anyway. Adding the fields to lists later is additive.

### Kept as it is

The research pipeline, its prompts, checks, cap and reservation; selection; how the newsletter and podcast choose stories; social formats; the RSS label.

### Debt named

`researchRuns.ts` grows a second caller, the pipeline. The background body is split into `executeRun` (research and finish), which both paths use. The module still writes only its own row: applying lives in `researchApply.ts` and is passed in as a hook. `researchPipeline.ts` is not touched.

## Changes

### Step 1: reader format, dormant

| File | Change |
|------|--------|
| `server/prisma/schema.prisma`, new migration | `Story.research Json? @map("research")`, `Story.preResearch Json? @map("pre_research")`. New model `SourceFavicon` (`host` id, `png Bytes?`, `sourceUrl String?`, `fetchedAt`). Additive; delete any proposed `DROP INDEX "story_embeddings_embedding_idx"`. |
| `server/src/services/researchedStory.ts` (new) | *Responsibility:* the researched version a reader sees: its shape and Zod schema, how it is built from a run, and how it is trimmed at read time. *Exports:* `ResearchedStory`, `researchedStorySchema`, `buildResearchedStory(stored)`, `forReaders(research, publishedEarlier)`, `researchedStoryText(research)`. Pure. |
| `server/src/services/publicStories.ts` | `getPublishedStoryBySlug` also selects `research` and whether `preResearch` is set. It serves `researched` (that flag) and `research` (parsed and run through `forReaders` with one query for still-published earlier stories; `null` with a warning on a failed parse). List reads are unchanged. |
| `server/src/lib/openapi.ts`, `lib/publicStoryContract.ts`, `lib/openapi.snapshot.json` | The detail response becomes `publicStoryDetailSchema` = `publicStorySchema` plus `research` (nullable, `.openapi()` "AI-generated. …") and `researched` (boolean). Refresh the snapshot with `api:snapshot` (additive, non-breaking). |
| `server/src/routes/public/stories.ts`, `routes/public/stories.db.test.ts` | The detail route answers with the detail shape. The db test checks the detail body strictly, so it switches to `publicStoryDetailSchema`. |
| `server/src/lib/aiProvenance.ts` | `research` joins the marker's fields when it is present (detail only). Keep `analysis.test.ts`'s registry check true. |
| `server/src/services/favicon.ts` | Extract the per-host search from `fetchFavicon` as `findIcon(primaryUrl, firstTry?)`, reused below. `fetchFavicon`'s behavior is unchanged. |
| `server/src/services/sourceFavicons.ts` (new) | *Responsibility:* outlet favicons for research sources: store by host, background fetch with a 30-day negative cache, read for the route. *Exports:* `getSourceFavicon(host)`, `fetchSourceFaviconsInBackground(sources)`. |
| `server/src/routes/public/sourceFavicon.ts` (new), `routes/public/index.ts` | `GET /api/source-favicons/:host`: host validated by pattern; a PNG with long cache headers, or 404. Mirrors `feedFavicon.ts`, and goes in OpenAPI only if the feed favicon route does. |
| `shared/types/index.ts` | `ResearchedStory`, `ResearchedSource`, `Citation`, plus `research` and `researched` on the public story detail type (a hand-written mirror, as research types are today). |
| `client/src/components/ai/aiDisclosureCopy.ts` | `researchedStoryLabel: { lead: 'Researched and written by', tail: '.' }` (owner-approved 2026-11-12, design "AI label"). |
| `client/src/components/research/SourceIcon.tsx` (new) | *Responsibility:* a source's 16 px icon: the stored favicon; the initial in a neutral circle when it's missing or fails to load; our icon with the brand ring for earlier coverage. *Exports:* `SourceIcon`. |
| `client/src/components/research/Citation.tsx` (new) | *Responsibility:* one citation group: a 24 px button of overlapping icons named "Source(s): …", plus a popover card per source. *Exports:* `Citation`. |
| `client/src/components/research/CitedText.tsx` (new) | *Responsibility:* render cited sentences (a paragraph or a bullet) with a `Citation` after each. *Exports:* `CitedParagraphs`, `CitedBullets`. |
| `client/src/components/research/SourcesList.tsx` (new) | *Responsibility:* the `#sources` list, with "initially found here" and "Earlier on Actually Relevant". *Exports:* `SourcesList`. |
| `client/src/pages/StoryPage.tsx` | In `StoryPage`, the label keys on `story.researched`. The cited layout keys on `story.research`: the metadata row (the header line above), the body, the quote's citation, the cited Why This Matters and Caveats, and `SourcesList`. `AlsoCoveredBy` is hidden when researched. The non-researched path is unchanged. |
| the synthetic seed (`db:seed:synthetic`) | Give a few synthetic published stories a `research` projection and a `pre_research` snapshot, so the page can be checked locally with Playwright. |
| `.context/public-website.md`, `.context/story-research.md`, `.context/ai-transparency.md` | Page format, the `researched` flag and the favicon route. Row 15 now says "reader format built, nothing applied". §3 story-page row: the researched label (owner-approved 2026-11-12), implemented and dormant. §7: list the new label. |

### Step 2: apply and revert by hand

| File | Change |
|------|--------|
| `server/src/services/storyLifecycle.ts` | `ANALYSIS.research = { to: selected, advance: { pipeline: [], editor: [] }, refresh: [analyzed, selected, published, rejected] }` (`to` is unused since nothing advances). This makes `recordAnalysis('research', …)` and `analysisFrom('research', …)` work. |
| `server/src/services/researchApply.ts` (new) | *Responsibility:* turning a finished run into the story's state, and back. *Exports:* `applyResearchRun(storyId, runId, actor, expectedStatus?)` and `revertResearch(storyId)`.<br>**Apply:** snapshot if empty (`relevanceSummary` included), the swapped fields with `relevanceSummary: null`, an embedding via `generateEmbeddingForContent`, then `fetchSourceFaviconsInBackground`. An editor fences on the status read now; the pipeline passes the status read before the run.<br>**Revert:** the snapshot's fields, both columns cleared, a regenerated embedding, fenced on the status now.<br>**Refusals** are `ServiceError`s: unknown run 404; run not completed, no draft, a `fallback` verdict or a run of another story 409; trashed 409; revert without a snapshot 409. |
| `server/src/services/analysis.ts` | `assessStory`'s `analysisData` also sets `research: null, preResearch: null`. A fresh single-source analysis replaces the researched one. |
| `server/src/services/storyWrites.ts` (`updateStory`), `client/src/components/admin/StoryEditForm.tsx` | While `research` is set, an edit to a swapped field gets 409 "Revert to single-source first". The form shows the note and disables those fields. |
| `server/src/routes/admin/research.ts` | `POST /api/admin/research/stories/:storyId/runs/:runId/apply` and `POST /api/admin/research/stories/:storyId/revert`, with `failsWith()` texts. Neither costs a model call beyond one embedding. |
| `server/src/services/promptInputs.ts`, `podcastScript.ts` (`storySelect`, line 68) | `podcastScriptStory` takes `research` and uses `researchedStoryText` in place of `summary` when present. `storySelect` adds `research: true`. |
| `client/src/hooks/useResearch.ts`, `client/src/components/admin/StoryResearch.tsx`, `ResearchRunView.tsx` | "Use this version" on each eligible run and "Revert to single-source" when the story is researched, each with a confirm step; both invalidate the story query. |
| `client/src/pages/MethodologyPage.tsx` | The research paragraph, drafted here; it ships only once the owner approves its wording. |
| `.context/story-research.md`, `story-pipeline.md` (fields), `podcast.md`, `newsletter-podcast.md`, `ai-transparency.md` | Rewrite "never applies, nothing reaches a public route" to the apply, revert and edit-lock rules. Add `research`/`preResearch` and the nulled `relevanceSummary` to the field reference. Podcast input. Newsletter: summary may be researched. Rows 1 and 15: research text published, Tavily receives the queries. |

### Step 3: the pipeline step

| File | Change |
|------|--------|
| `server/prisma/schema.prisma`, new migration | `RejectionReason` gains `research_rating`, `stale` and `contradicted` (`ALTER TYPE … ADD VALUE`). New enum `ResearchRunTrigger { editor pipeline }` and `StoryResearchRun.trigger` (default `editor`). The `research_stories` row in `job_runs` (`15 * * * *`, disabled, `ON CONFLICT DO NOTHING`). |
| `server/src/services/storyLifecycle.ts` | `PIPELINE_REJECTION_FROM`: the three reasons, each from `[selected]`. |
| `server/src/config.ts`, `env.example`, `render.yaml` | `config.research.pipeline = { mode: parseOneOf(['shadow','apply']) default 'shadow' (RESEARCH_PIPELINE_MODE), perRun: parseWholeNumber default 20 (RESEARCH_PIPELINE_PER_RUN) }`. `blueprint.test.ts` keeps all three in step. |
| `server/src/services/researchRuns.ts` | Split `runInBackground` into `executeRun(runId, story, beforeFinish?)`, used by the admin task and the pipeline. `reserveRun(storyId, now, trigger)`. Export `markInterruptedRuns`. New export `runPipelineResearch(storyId, beforeFinish)`, which records the $0 `failed` run at the cap. `toView` carries `trigger`. It still writes only its own row. |
| `server/src/services/researchQueue.ts` (new) | *Responsibility:* which selected stories the research step still owes; the job's queue and the publish gate share one definition, stale running runs counted as settled. *Exports:* `researchPipelineOn()`, `nextToResearch(limit)`, `awaitingResearch(ids)`. |
| `server/src/services/researchApply.ts` | New export `applyVerdict(story, expectedStatus, result)`. In `apply` mode, `keep` calls `applyResearchRun(…, 'pipeline', expectedStatus)`, the three rejections call `transition` with their reason, and `fallback` does nothing. In `shadow` mode it does nothing. |
| `server/src/jobs/researchStories.ts` (new) | *Responsibility:* the scheduled research step. *Exports:* `runResearchStories()`. It sweeps stale runs at its start, re-checks its job row, the mode and `researchPipelineOn()` before each story and stops when any is off, and logs what it researched, skipped and refused. |
| `server/src/jobs/publishStories.ts` | Before `transition`, drop the ids `awaitingResearch` returns, and log how many are waiting. |
| `server/src/jobs/handlers.ts`, `jobs/interruptedRuns.ts`, `scripts/seed-jobs.ts`, `shared/types` (`JobName`, `RejectionReason`), `client/src/lib/constants.ts` | Register the job, place it before `publish_stories` in both `JOB_PIPELINE_ORDER`s, and add it to `RESUMABLE_JOBS` (a rerun skips stories that have a pipeline run). Display name. The three rejection reasons wherever the admin names reasons (story list filter and badge). |
| `client/src/components/admin/ResearchRunView.tsx` | Trigger badge (Editor or Pipeline). |
| `.context/story-research.md`, `story-pipeline.md`, `scheduler.md`, `deployment.md`, `ai-transparency.md`, `CLAUDE.md` (the `story-research.md` row) | The pipeline step, gate, verdicts, modes and kill switch. The status diagram, rejection reasons and transition-table rows. The job table and resumable list. The two env vars. Row 15 becomes a pipeline feature (background, no human review). Plus the ADR entries for the swap storage and the run-row gate, written by the implementer through the `adr` skill where it is loaded. |

**Rollout after step 3 deploys (owner steps, no code):**
- Set `TAVILY_API_KEY` if it isn't set.
- Enable `research_stories` (shadow) and watch runs and cost for a week.
- Run the evaluation from the design.
- Set `RESEARCH_PIPELINE_MODE=apply`.
- Kill switch: disable the job.

## Tests

Logic only, in the existing patterns: `vi.hoisted()` mocks, `*.db.test.ts` for lifecycle and queries, route tests with `supertest` and `authHeader()`, RTL with axe for pages.

- **`researchedStory.test.ts`:**
  - fact ids collapse to one citation per source, in first-cited order;
  - unknown ids are dropped;
  - uncited sources are left out, but `S0` is always listed first;
  - earlier stories come last;
  - `quoteSourceId` is kept;
  - `forReaders` drops unpublished earlier stories and their citations, and updates slugs;
  - `researchedStoryText` strips citations and joins paragraphs.
- **`researchApply.db.test.ts`:**
  - Apply writes the fields, `research` and the snapshot; `relevanceSummary` is null after apply and present in the snapshot.
  - A second apply keeps the first snapshot.
  - Revert restores every snapshot field (`relevanceSummary` included), clears both columns, regenerates the embedding and forgets the related-stories cache.
  - A run made while the story was `selected`, applied by an editor after the story was published, is written (fence on the status now).
  - A pipeline apply whose story was published or rejected during the run is skipped.
  - Apply and revert on a trashed story give 409.
  - Every other refusal: fallback run, run of another story, not completed, revert without a snapshot.
  - (step 3) `applyVerdict` maps each of the five verdicts in `apply` mode and does nothing in `shadow`.
- **`storyLifecycle.db.test.ts`.** The three reasons move only `selected` stories. The `research` stage refreshes its four statuses and skips `trashed`.
- **`analysis.test.ts`.** Assess clears `research`/`preResearch`. The provenance registry check still passes.
- **`storyWrites` test.** Editing a swapped field of a researched story gets 409 "Revert to single-source first". Other fields and non-researched stories save as before.
- **`researchQueue.db.test.ts`:**
  - Still awaiting: a selected story with no run, one whose pipeline run is `running` within `staleRunMinutes`, and one researched only by an editor.
  - Not awaiting: a completed or failed pipeline run, a `running` one older than `staleRunMinutes`, or applied research.
  - Nothing is awaiting when the job is disabled or the key is missing.
- **`researchStories.test.ts`:**
  - Stale runs are swept at the start.
  - The per-run limit holds.
  - Disabling the job, switching the mode to `shadow` mid-run, or `researchPipelineOn()` turning false stops it before the next story.
  - A cap refusal records a $0 failed pipeline run and continues.
  - An unexpected error on one story fails its run, and the next story still runs.
  - Apply happens before finish.
  - Shadow applies nothing.
- **`publishStories.test.ts`.** Awaiting ids are left out; editor publishes are unaffected.
- **`researchRuns.db.test.ts`.** `trigger` is stored. The admin path is unchanged, and the existing tests stay green.
- **`sourceFavicons.test.ts`, `sourceFavicon.test.ts` (route).** A negative cache entry isn't refetched within 30 days. Tavily's icon is tried first. A bad host pattern gets 404 without a query.
- **Public story route (`stories.db.test.ts`) and `openapi.test.ts`:**
  - the detail carries `research` and `researched`, and lists don't;
  - a projection that fails to parse gives `research: null` with `researched: true`;
  - the marker names `research` only when it is present;
  - the contract snapshot is additive.
- **`promptInputs.test.ts`.** The podcast material uses the researched text when present, and the summary otherwise.
- **`StoryPage.test.tsx`:**
  - The researched label is announced as "Researched and written by AI.".
  - `researched: true` with `research: null` shows the researched label over the plain layout.
  - The header shows "Initially found on" and "N sources", linking to `#sources`.
  - A citation button is named after its sources, and its card opens.
  - A failed icon load shows the initial.
  - Earlier coverage is marked.
  - `AlsoCoveredBy` is absent.
  - A non-researched story renders today's label and layout.
  - axe passes on both formats.
- **`StoryResearch.test.tsx`, `StoryEditForm` test:**
  - "Use this version" shows only for eligible runs, and "Revert" only when the story is researched.
  - The swapped fields are disabled, with the note, while the story is researched.

## Out of Scope

- Researching stories published before step 3 (no backfill).
- A bulk revert, and the kill switch reaching published stories (open question 1).
- A per-outlet favicon override (owner decision: not at launch).
- The relevance chip (owner decision: not for now).
- Changes to the research prompts, filter, checks, cap or models; the rating recalibration itself, which is an owner step with `eval:recalibrate` before `apply`.
- `research` on list, homepage, search or related endpoints, RSS or the embed widget (the stated deviation). Their texts change through the swapped columns only.
- `NewsArticle` JSON-LD citations.
- Social post formats beyond the blurb text that research already writes.
- Holding stories instead of falling back when research fails (the design's "easy to switch to hold later").
- Generating the client's research types from the server.

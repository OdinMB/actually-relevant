---
status: implemented
type: feature
complexity: complex
---

# Story context before publishing, for every researched story

Odin asked on 17 Nov: "if it's activated, shouldn't this happen before publication, so that we don't first publish one version, then do context research, and then immediately update the story? Also, if activated, this should happen to all published stories, not just a fixed amount." The behavior below was promised to him in reply, so the plan is approved as written; what the promise left open is settled under "Decisions settled here" and listed in the implementer's report. Context: `.context/story-context.md`, `.context/scheduler.md` ("Chains"), `.context/story-research.md` ("The pipeline step", the publish gate), `.context/story-pipeline.md`, ADR-0061 and its amendments of 2026-11-17. The handbook's `plan-decisions` skill was not loaded when this plan was written, so it has no handbook header and no decision stubs; the hard-to-reverse choice is recorded as an amendment of ADR-0061 (below).

## Problem

`build_story_context` is the fourth step of `daily_edition_chain`, after `publish_stories` (ADR-0061), so once it is switched on a story goes live without cards and gains them minutes later. And it takes at most `perRun` (20) stories a run, so a busy night or a backlog leaves stories out.

## Approach

### The chain

- `daily_edition_chain` becomes `select_stories` → `research_stories` → `build_story_context` → `publish_stories` (`jobs/chainDefinitions.ts`; the step lists are code, so no migration). Stories go out with their cards.
- **A failed context step never stops the edition.** A step in `GOES_ON_PAST_FAILURE` (`chainDefinitions.ts`; only `build_story_context`) that fails keeps its own Error and failure notice, and the chain goes on with the next step instead of stopping; a Review on it still pauses as after a success. Every other step still stops its chain when it fails. Placed before publishing, a top-level failure of the step (a database error reading its queue, say) would otherwise hold the day's edition, which ADR-0061 named as the reason to put it last.
- **The review pause** keeps its rule (`nextStepOn`): a Review on `research_stories` now waits for the context step while it is on, else for publishing; a Review on `build_story_context` pauses before publishing; a Review on `publish_stories`, now the last step, has nothing to wait for.
- **The step honors the chain's deadline**, as research does: past it, it starts no other story and no second attempt; the runs in flight finish. A selected story it did not reach publishes without cards; a published one waits for the next night (within the lookback).

### Which stories

`nextForContext` (moved with the gate to a new `services/storyContextQueue.ts`: the step's queue and the publish gate share one definition, as `researchQueue.ts` does for research), in this order, with **no per-run cap** (`perRun` goes; `concurrency` 3 stays):

1. **The selected stories about to be published**: `selected`, unclustered or their cluster's primary (the publish job takes only those), with a completed research run whose sources hold facts and no context run yet; oldest selected first.
2. **Then the published stories still owed**: published within `lookbackDays` (3), same research and no-run rule, oldest published first. These are stories published while the step was off, published by an editor, or left at a deadline.

A story is still settled by its first run, whatever its outcome (and its second attempt in the same run). A run is bounded by the night's stories: a day's selection is about 4 to 11 stories.

`loadContextInput` takes a selected story too; its story day (validity, the search's end date) is the day of the run, as the admin view already uses today for a story not published. On demand stays as it is: an editor's run takes published stories only.

### The publish gate for context

`awaitingContext(ids, now)` (`storyContextQueue.ts`), called by `publish_stories` beside `awaitingResearch`:

- **Holds only while the step works**: its job row is enabled and web search is on (`TAVILY_API_KEY`). Off: nothing waits.
- **Holds a selected story it owes** (unclustered or primary, a completed research run with facts) that has no settled context run: none, or one still `running` within `staleRunMinutes`. A completed, skipped or failed run settles it, and so does a run running past the stale limit.
- **For at most `config.research.pipeline.maxWaitMinutes` (120) after the story was selected**: the publish gate's one bound, research's and context's alike. A story past it publishes without cards.
- **Not past the chain's deadline**: then the step started no other story on purpose, so nothing waits for it.
- In the chain the step has just run, so the gate holds nothing on a normal night; it matters when `publish_stories` is run by hand before the step, after the chain stopped, or while a run of the story is in progress.

### Readers and the admin

- The public route serves only published stories' boxes (`storyContextView.ts`, checked): cards built before publishing appear with the story.
- The admin run line "Built …, after the story was published." becomes "The newest context run built these cards on …", true before and after publishing. The on-demand refusal "Only published stories get context; this one is selected" becomes "Context can be gathered by hand only for a published story; this one is selected", since the step now builds a selected story's cards.

### Jobs page notes

The daily edition's, `publish_stories`' and `build_story_context`'s notes say the new order, the gate for cards, the deadline, that a failed context step does not stop publishing, and drop "up to 20 a run".

### Decisions settled here

- The nightly step also fills published stories still owed within the lookback, after the stories about to be published (recommended in the brief).
- The gate's time limit is research's (one bound for the publish gate), not a new setting.
- The step honors the chain's deadline; past it the context gate holds nothing.
- A failed context step lets the chain go on to publish.
- Selected stories the publish job would not take (a cluster's non-primary) get no context.
- The story day of a run before publishing is the run's day.

### ADRs to write

- **ADR-0061 amendment (2026-11-17, before publishing):** the step runs between research and publishing, with the publish gate holding a story for its cards for at most two hours from its selection, the chain's deadline honored, and the chain going on past a failed context step; no per-run cap.

## Changes

| File | Change |
|---|---|
| `server/src/jobs/chainDefinitions.ts` | New order; `GOES_ON_PAST_FAILURE` |
| `server/src/jobs/chains.ts` | A failed step in `GOES_ON_PAST_FAILURE` does not stop its chain |
| `server/src/services/storyContextQueue.ts` (new) | `nextForContext` (moved, selected first, no limit), `awaitingContext` and the step's state it reads, `STORY_CONTEXT_JOB` (moved from the job, so services no longer import it from `jobs/`) |
| `server/src/services/storyContextInput.ts` | `RUN_WITH_FACTS_SQL` exported; `loadContextInput` takes a selected story, its day the run's |
| `server/src/jobs/buildStoryContext.ts` | No `perRun`; the chain's deadline; "left at the deadline" in the summary |
| `server/src/jobs/publishStories.ts` | `awaitingContext` beside `awaitingResearch` |
| `server/src/jobs/jobNotes.ts` | The three notes |
| `server/src/config.ts` | `perRun` gone; comments |
| `server/src/services/storyContextOnDemand.ts` | Refusal wording |
| `client/src/components/admin/StoryContextAdmin.tsx` | Run line |
| Docs | `.context/story-context.md`, `.context/scheduler.md`, `.context/story-research.md` (the gate), `.context/ai-transparency.md` row 16, `CLAUDE.md` row, ADR-0061 amendment, `server/env.example` comment, `.plans/2026-11-16_story-overviews.md` module-1 line, `.plans/2026-11-16_story-context.md` "Where it runs" (an appended note) |

## Tests

- `storyContextQueue.db.test.ts`: the queue's order and membership (selected first, non-primary out, published within the lookback, no limit); the gate (holds owed and running-within-stale, lets through settled, stale, unresearched, selected long ago; nothing while the job is disabled, the key unset, or past the deadline).
- `storyContextInput.db.test.ts`: a selected story's input, its day the run's.
- `buildStoryContext.test.ts`: no story and no second attempt started past the deadline, the summary says how many were left.
- `publishStories.test.ts`: stories awaiting context are left, with research's.
- `chains.test.ts`: a failed `GOES_ON_PAST_FAILURE` step lets the chain go on; the real daily edition with a failing context step still publishes; review pauses with the new order.
- `jobNotes.test.ts`: the config values the changed notes name.

## Out of Scope

- An editor's run on a selected story (on demand stays published-only).
- Research's gate past the chain's deadline (unchanged: it still holds a story research left at the deadline when it was selected less than two hours earlier).

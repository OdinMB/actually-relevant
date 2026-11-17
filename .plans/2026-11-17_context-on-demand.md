---
status: approved
type: feature
complexity: complex
---

# Story context on demand: "Gather context" for one story, building on its earlier runs

Odin asked on 17 Nov: "How can I trigger context gathering for an existing story? Ideally also gathering additional context (in a way that doesn't duplicate previous searches and documents)." The behavior below was promised to him in reply, so the plan is approved as written; what the promise left open is settled under "Approach" and listed in the implementer's report. Context: `.context/story-context.md`, `.context/story-research.md` (the editor's Research button is the pattern), `.context/scheduler.md` ("Spending"), ADR-0061 and its amendment of 2026-11-17, ADR-0065 and its amendment, `.context/ai-transparency.md` (row 16). The handbook's `plan-decisions` skill was not loaded when this plan was written, so it has no handbook header and no decision stubs; the one hard-to-reverse choice is recorded as an amendment of ADR-0061 (below).

## Problem

A story gets context cards only from the nightly `build_story_context` step, which takes a published story once, within 3 days of publishing, and never again (ADR-0061). The step is switched off, so no story gets cards today, and a story that got poor cards, or was published before the step ran, cannot get better ones. An editor has no way to start a run, and a second run would repeat the first one's searches and read the same pages again.

## Approach

### The action

- **"Gather context"** in the story's Context section (`StoryContextAdmin`), for any published story with a completed research run whose sources hold facts: the nightly step's rule without "no context run yet" and without the 3-day lookback. It works while the step is switched off. The label is "Gather more context" once the story has a context run. The button is a `ReasonButton`: visible but inert with its reason while web search is off (`TAVILY_API_KEY` unset) or while a run of the story is in progress. The section now shows for an eligible story without a run too, with only the button and one line.
- **`POST /api/admin/stories/:id/context/run`** (`routes/admin/storyContext.ts`, `expensiveOpLimiter`), polled as research's run is: it checks, claims the run row and answers `202 { taskId, runId }`; the run goes on in a one-story `context` task (`taskRegistry`), which the client follows with `launchPolledTask` (a progress toast; the outcome or the error as a toast; the section re-read at the end). Refusals are ServiceErrors with `failsWith`: 409 web search off (for any id), 404 unknown story, 409 not published, 409 no research run with facts, 409 a run of the story in progress.
- **`GET /api/admin/stories/:id/context`** gains `gather: { eligible, refusal }`, so the client holds no copy of the rule; it marks interrupted runs first, as research's run list does.

### One run at a time per story

- **Every run row is claimed under one advisory lock** (`CONTEXT_RUN_LOCK`, `pg_advisory_xact_lock` in a transaction, research's reservation pattern): stale runs are marked failed, and the claim is refused while the story has a `running` run. The nightly step claims the same way, so an editor's run and the step never run together on a story: the step skips a story an editor's run holds (nothing recorded, the story is settled by that run). Reopening a failed run for its second attempt is fenced the same way, refused while another run of the story is running.
- **The second attempt applies too** (ADR-0061's amendment): a technical failure that may pass is tried once more at once, on the same row.

### Building on earlier runs

The story's earlier **completed** context runs (never the run's own row: a second attempt does not count its first) are read once (`loadEarlierWork`, `storyContextInput.ts`, SELECT only), and the pipeline takes them as `ContextInput.earlier`. Only production's runs load them; the eval does not, so it still measures first runs.

- **Facts carried over:** every supported fact of those runs that no one demoted, as found (copies of reused facts left out: those come again through step 1's reuse), each once by its content (`factKey`: normalized URL, supporting sentence, statement), newest first. They are offered like reused facts, under new source ids after research's (one id per URL, shared with the reused facts), not checked again, and stored with the new run when a kept box cites them, with `reused_from_id` naming the earlier row. They are judged current on the story's day like every other fact (gap list, tiles, the write's past-value rule).
- **Research facts not structured again:** a research fact an earlier run already judged (supported or rejected, matched by `factKey`) is not structured or checked again; only research facts no earlier run judged (new in a newer research run, left out or unjudged before) go through pass 1. With none, no structure call.
- **Searches not made again:** a query an earlier run made (normalized as the cache key normalizes it, across all earlier runs, not only the 7-day cache) is skipped, and so is a `response` angle (`action`, `elsewhere`) an earlier run searched, whatever its query. Skipped searches take no place among the 3, so searches go only to slots still uncovered; with nothing missing the run makes no search and only writes the cards again. Response searches record their angle (`searches[].angle`); a record from before is read by its `wanted` text.
- **Pages not read again:** a search result whose URL an earlier run picked to read (`searches[].kept`) or cites in a fact is dropped (source drop reason `read`).
- **Response not found** counts an angle skipped as already searched as looked for.
- **The record** gains `facts.carried` and `skippedSearches` (slot and query), and the `read` drops; "What the run did" shows them under "Built on earlier runs".

### The cards and the editor's choices

The write call writes from old and new facts together; the new run's boxes become the newest. Before they are stored, the newest other run's boxes are read in the same transaction, matched by type to the new boxes (a run has one box per type): a hidden one (`demoted`) makes the new box of its type hidden, and one an editor moved (`place_by_editor`) gives the new box its place. A run that keeps no card leaves the earlier cards served, as the view already does. Nothing is deleted.

### Cost

About a nightly story's cost or less (no structure call or fact check for what was judged; only uncovered slots searched). The run happens in a run scope for `build_story_context` with flex off (an editor waits), and its usage is added to that job's `job_month_spend` row (`addMonthSpend`, now exported from `jobLease.ts`) and checked against its warning level; `editor_research` is not touched. No job run row (Jobs page) changes.

### Decisions settled here

- Polled, as research's run (not synchronous): a run takes about a minute.
- The editor's choices carry over by type; a new type is shown even when the editor had hidden every card.
- Carried facts are not re-checked; earlier rejected research facts are not retried.
- Failed and interrupted earlier runs count for nothing (their searches and reads stored no facts).
- No `trigger` column: an editor's run is a run like the step's (a migration for a label was not worth it).
- No cap on carried facts: each run adds at most 5 new sources.

### ADRs to write

- **ADR-0061 amendment (2026-11-17, on demand):** an editor can run context again on any eligible story, building on its earlier runs; the nightly step still settles a story on its first run.

## Changes

| File | Change |
|---|---|
| `server/src/services/storyContextPipeline.ts` | `EarlierWork` and `ContextInput.earlier`; pass 1 skips judged research facts; carried facts; `planSearches` skips made queries and searched angles, records `angle`; `read` URLs to the source filter; record fields |
| `server/src/services/storyContextSources.ts` | `normalizedQuery` exported; `pickNewSources` takes read URLs (drop reason `read`) |
| `server/src/services/storyContextRecords.ts` | `factKey`; `editorChoices` (pure) |
| `server/src/services/storyContextInput.ts` | `loadEarlierWork`; `contextEligibility`; fact columns shared |
| `server/src/services/storyContextRuns.ts` | Claim and reopen under the lock; `executeContextRun`; earlier work loaded; editor choices applied in the store |
| `server/src/services/storyContextOnDemand.ts` (new) | Refusals, eligibility, the start, the task (two attempts, run scope, spend) |
| `server/src/services/storyContextAdmin.ts` | `gather` in the view; interrupted runs marked |
| `server/src/routes/admin/storyContext.ts` | `POST /:id/context/run` |
| `server/src/jobs/buildStoryContext.ts` | A story another run holds is skipped |
| `server/src/jobs/jobLease.ts` | `addMonthSpend` exported |
| `server/src/lib/taskRegistry.ts`, `shared/types/index.ts` | Task type `context`; the admin view's `gather`; record fields |
| `client/src/lib/admin-api.ts`, `client/src/hooks/useStoryContextAdmin.ts` | `storyContext.gather`; `useGatherContext`; the view re-read while a run runs |
| `client/src/components/admin/StoryContextAdmin.tsx`, `ContextRunView.tsx` | The button and its state; the section for an eligible story without a run; "Built on earlier runs" |
| Docs | `.context/story-context.md` ("On demand", "Which stories"), ADR-0061 amendment, `.context/admin-dashboard.md`, `.context/ai-transparency.md` row 16, `.context/scheduler.md` (spending note), `.context/task-queue.md` (task type), `CLAUDE.md` row |

## Tests

- Pipeline (unit): judged research facts not structured; carried facts offered, not checked again and stored when cited; made queries and searched angles skipped and recorded, the 3 going to the rest; nothing missing, no search; read URLs dropped; response not found with skipped angles.
- Records (unit): `editorChoices`; `factKey`.
- Input (db): `loadEarlierWork` reads completed runs only, never the given row, leaves copies and demoted facts out of the carried ones, and collects queries, angles and reads.
- Runs (db): the claim refused while a run is running; the reopen refused while another runs; editor choices carried by type.
- On demand (db and unit): refusals in order; a run builds on the earlier one; spend added to `build_story_context`'s month; a transient failure tried once more.
- Route: 202 and the refusals' statuses.
- Client: the button's label and state, the start through the hook, the section for an eligible story without a run, "Built on earlier runs".

## Out of Scope

- A `trigger` column and an "editor started it" badge.
- Running context in bulk from the stories list.
- Retrying earlier rejected facts, or re-checking carried ones.

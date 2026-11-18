---
status: draft
type: feature
complexity: complex
---

# Overviews and linking (module 2 of story overviews)

Module 2 of `.plans/2026-11-16_story-overviews.md`. Odin approved starting this plan on 2026-11-18. It builds on the research pass (`.context/research-passes.md`, ADR-0067, ADR-0068) and the evals (`.plans/2026-11-16_overview-evals.md`, `.context/model-eval.md`, "Overview evals"). The design is `/mnt/project-files/story-directions/2026-11-16_ebola-lifecycle.md`, and the page follows the mockup `thread-v2-desktop-clean.png`.

The plan is written without the handbook header, because `ashoka-engineering:plan-decisions` was not loaded for the planner. Each decision is recorded in `## Approach`, with who made it. The roadmap's D-decisions are Odin's. Every other choice here is the planner's, made on the plan's own reasoning.

## Problem

Every published story stands on its own. A reader following Ebola in eastern Congo meets about 40 near-identical stories with no shared timeline and no account of where things stand. The site also has no record that ties those stories together. Dedup clusters only group copies of the *same event* within 14 days (`.context/dedup.md`), and related stories are a per-page re-rank with no memory (`.context/embeddings.md`). Modules 3 to 7, and module 5's front page and briefing, all need such a record before they can start.

## What readers get

- **The overview page, `/ongoing/<slug>`**, shown only for an overview whose scope is `ongoing`, that is not hidden, and whose module is switched on. It follows the mockup, without the parts that belong to later modules (figure tiles and charts are module 3, the map is module 3/4, watched-source items are module 4):
  - **Header:** "Ongoing story · since <month year>" (or "Ended <date>" once closed, "No new reporting since <date>" while quiet), the area chip (the overview's issue), the title, "N stories · last change <date>", and the AI label (For Odin 3).
  - **Where this stands:** one to four sentences written from the member stories' checked evidence, shown only once the members' research passes hold at least 3 usable facts (until then the page is the header and the timeline). Each sentence carries citation chips: the outlet, the supporting sentence, and "via our story <title>", linking the story. It uses research's citation components, so it looks like a researched story.
  - **What's being done** (D10): a line under "Where this stands", made of one or two sentences on the responses under way, citing facts the member stories' research found for the `response` slot (or the stories' own reports of the response). **When nothing sourced exists, the line is not shown** (ADR-0065's amendment). Nothing is searched for it, since module 1 already searches `response` from two angles on every story.
  - **Timeline:** every active entry, newest first, grouped by month. A turning point shows its kind ("Turning point · response", "· setback", "· spread", and so on, from the answer keys' kind list), and responses stand beside harms. Routine entries fold under "+ N stories" per month. A filter offers "All" and "Turning points". Under a story, its public research Updates (`publicUpdates`) appear as dated sub-lines ("Updated Nov 18: …"), which adds no model call.
  - **Sources:** the numbered list the citations point to.
- **The "ongoing story" link:**
  - On the story page, a line under the header: "Part of an ongoing story: <title> →".
  - On story cards (`StoryCard`), a small "Ongoing: <title>" chip wherever cards list stories.
  - Both appear only while the overview is public. A story in a `forming` overview shows nothing.
- **Nothing changes for readers while the module is off:**
  - no overview is public;
  - the API's `overview` field is null on every story;
  - the sitemap and link previews list no overview.

## Approach

### Shape: one deep module per responsibility, with injected I/O, as the research pass is built

The steps are pure functions over injected dependencies (the model call, the candidate query, the clock), as `runResearchPass` is (`services/researchPass.ts`). The eval's replay therefore runs the production code in an in-memory sandbox, with no copy of it.

- One lifecycle module, `overviewLifecycle.ts`, writes the overview tables. A fence test holds this, as `researchPassLifecycle.ts`, `storyLifecycle.ts` and `newsletterLifecycle.ts` are held.
- Reads for the page and the admin are SELECT-only view modules.

**Alternatives weighed (planner, inline architecture comparison):**
- **Minimal scope:** hang overviews off `story_clusters` and widen dedup's prompt and window. Rejected for three reasons:
  - clusters mean "same event, one shown, the rest rejected `duplicate`", and electing a primary rewrites story statuses (`storyLifecycle.ts`);
  - a development spans months and keeps every member published;
  - the two meanings would fight in one table.
- **Strongest end-state:** one generic "collection" model now, serving developments and module 5's weekly, monthly and yearly overviews alike. Rejected as speculative: module 5's plan will know what a period overview needs. Below, this plan leaves the seams for it instead.
- **Chosen, pragmatic:** new tables for developments only, additive, with the page and its read model built over "an overview's entries plus its current stands", not over the charter. A period overview can then reuse them.

### Records (additive migration `<ts>_overviews`)

The tables, the enums, two partial unique indexes, the disabled job row and its warning level. Nothing is dropped or altered on existing tables, and no column is added to `stories`, matching ADR-0067's rule.

- **`overviews`**:
  - `id`; `slug` (unique, set when first public, never changed after); `title`; `issue_id` (area, SET NULL);
  - `scope` (`OverviewScope`: `single`, `forming`, `ongoing`); `status` (`OverviewStatus`: `open`, `quiet`, `closing`, `closed`);
  - `charter` (jsonb `{ in, out[], endEvent }`, the answer keys' shape) with `charter_model` and `charter_prompt_version`;
  - `frozen` (automation paused until a review or an editor clears it); `hidden` (an editor's unpublish);
  - `founded_at`, `last_entry_at`, `closing_since`, `closed_at`, `closed_reason` (`end_event`, `faded`, `editor`), `entries_at_last_review`, `reviewed_at`; timestamps.
  - `single` is an overview left with one active entry or none, after a detach, an undo or a member's unpublishing. It is not public. With one entry it can grow again (D1). With none it is never a candidate (it has no members to be near) and only an editor's attach or an undo of an undo revives it. It keeps its slug, if it had one.
- **`overview_entries`**:
  - `overview_id` (cascade); `kind` (`EntryKind`, only `story` for now; modules 4 and 6 add values with `ALTER TYPE … ADD VALUE`); `story_id` (cascade, nullable with a CHECK that a `story` entry has one, so modules 4 and 6 need no constraint change);
  - `role` (`turning_point`, `routine`), `role_kind` (the answer keys' list: setback, response, spread, decision, escalation, deescalation, money, science, people, milestone);
  - `status` (`active`, `detached`), `judgment` (`JudgmentStatus`: `unreviewed`, `reviewed`, `demoted`);
  - `joined_by` (`link`, `founding`, `editor`), `detached_by` and `detach_reason`; `locked` (an editor's attach or detach, which automation never reverses);
  - the judgment record: the `shared` jsonb with cause, place and end each citing both sides, `confidence`, `model`, `prompt_version`, and `decision_id`.
  - **At most one active entry per story** is enforced by a partial unique index `overview_entries_one_active` (raw SQL, which Prisma cannot model). `check:migrations` gets a rule failing on its drop, as it has for `article_versions_one_current`.
- **`overview_stands`** holds the versions of "Where this stands":
  - `number`; `status` (`current`, `superseded`);
  - `sentences` and `doing` (jsonb `[{ text, facts: [poolFactId] }]`);
  - `facts_seen` (the pool facts offered, with their ids, for refresh and audit);
  - `as_of`, `model`, `prompt_version`, `record` (the checks), `written_at`.
  - At most one `current` per overview, enforced by a partial unique index `overview_stands_one_current`, also guarded.
- **`overview_decisions`** is the audit and automation log of the roadmap's records. It holds one row per automated or editor decision:
  - the kind (`link`, `found`, `role`, `stands`, `status`, `close`, `review`, `editor_attach`, `editor_detach`, `editor_role`, `editor_retitle`, `editor_freeze`, `editor_hide`, `undo`);
  - `overview_id` and `story_id` (both SET NULL);
  - the outcome; the inputs (ids, never page text); the answer; model, prompt version and confidence; `cost_usd`; the actor (`pipeline`, `review` or an editor's id); `created_at`, `undone_at` and `undone_by`.
  - A story with a `link` decision is settled for the job. "Undo" works from this table.

Evidence stays where module 1 put it. "Where this stands" cites `pool_facts` by id. Overviews hold **no fact of their own and run no search**:
- a fact is checked once, by its pass;
- a demotion by a later pass flows through, because the served text drops a sentence citing a fact that is no longer usable (`usable`, the cards' `shownFact` rule) and marks the overview for refresh.

**The dependency this creates (verified against the code).** Pools are written only by research passes, which are switched off behind their own eval gate, and a story's legacy runs become its pool only at its first pass (`importLegacyPool`, inside the pass's claim). Even then, a legacy research fact arrives `unjudged` and unstructured unless a context run judged it (`legacyPool.ts`), and story context has been switched off since 2026-11-16. Research runs began about 2026-11-12. So **at switch-on, almost no member story has an offerable fact**: no pool, or a pool whose legacy facts are neither supported nor structured. The backfill's six months of stories almost all have neither.

The plan therefore takes three positions:
- **Order of switches:** module 2 is switched on only after `research_pass` is on (its gate refuses otherwise: `OVERVIEW_EVAL_GATE` stays closed while `PASS_EVAL_GATE` is). Linking, roles, the status machine and the timeline need no pool. They work on every published story, backfill included.
- **Stands are written only from offerable facts, and are absent otherwise.** An ongoing overview with fewer than `overviews.minStandsFacts` (3) offerable facts across its members has no current stands. Its page shows the header and the timeline only, with no "Where this stands" or "What's being done" block, and no placeholder. Stands appear on their own as passes fill members' pools: each new night's story is researched, and an editor's "Research again" on an older member fills its pool.
- **No legacy fallback inside module 2.** The alternative was to have the stands step read members' legacy research runs and fact-check those facts itself. It was rejected because it breaks D-OV3 and ADR-0067's "a fact is checked once, by its pass": the stands step would keep verdicts outside the pool, and the pass would judge the same facts again at the story's first pass. It would also have to state unstructured facts (no `asOf`, no slot) as current or past without the fields that rule needs. Filling older members' pools is For Odin 7's choice: wait, or research the backfill's members once.

The eval measures stands only where evidence exists (below, "Evals and bars").

### How a story is linked

The job takes **published stories that have no live `link` decision** (one not undone), **oldest first by the story's date**:
- the night's, and those an editor published or republished since;
- at the first switch-on, the backfill window (For Odin 1).

**Every window counts from the story's own date (`asOf` = the story's `datePublished`), in production as in the replay.** The candidate query sees only stories published on or before it, and overviews as they stand at that point of the run. The founding window is the 30 days before the story and the member lookback the 180 days before it. Processing oldest first, with the windows anchored there, makes a backfilled development form in date order, as it would have formed live. Ebola's May stories found its overview, and its later stories join it.

**The backfill takes several nights.** At `perRun` 60, about 1,600 stories need about 27 nights. The plan therefore gives the backfill its own allowance: `overviews.backfillPerRun` (300) on top of the night's own stories, so 6 months complete in about 6 nights, each adding about 15–25 minutes after publishing. Each run links its backlog slice first and then the night's stories, all oldest first, so no story is linked before older stories it may belong with. The night's stories are always linked in the same run. An overview reaches the public only once its review at 3 has passed, so a half-finished backfill shows nothing wrong, only less.

Linking runs after publishing, so it never holds the edition. A story's link appears minutes after it goes live.

**Linking is sequential within a run where it matters.** Link calls run at concurrency 3, but every write (join, founding) goes through the lifecycle module one story at a time, in date order. Before writing, the lifecycle re-reads the story's candidates' current memberships. If a founding partner has joined or founded an overview since the call was made (two stories of the same night proposing each other), the story's answer is stale: it is re-queued once, later in the same run, with fresh candidates, so it now sees the partner's overview and can join it. If the `overview_entries_one_active` index still refuses a write (an editor's attach at the same moment), the write is rolled back, logged as a `link` decision with outcome `conflict`, and the story is retried at the next night's run. It is never silently dropped.

1. **Candidates (code).** The query is split into two parts so the replay can run the same code:
   - **The database part, SELECT only (`nearestPublished`):** the story's nearest published stories by exact cosine distance, published on or before `asOf` and within the 180-day lookback, within `overviews.maxDistance` (start 0.45, tuned on the tune half), with their distances. It knows nothing about overviews.
     - This uses dedup's pattern: a `MATERIALIZED` CTE, then exact distances. The rule in `.context/embeddings.md` is that a filtered set uses exact distances or `queryNearest`.
   - **The pure part (`groupCandidates`):** takes those neighbors plus an injected membership map (story → its active overview and that overview's status, scope and last entry). It keeps neighbors that are active members of overviews not `closed` with a last entry within the lookback, and neighbors with no active entry within the 30-day founding window. It ranks each overview by its nearest member and takes up to `candidateOverviews` (5). Production injects memberships read from the tables. The sandbox injects its in-memory overviews.
   - Two more sources add overviews:
     - the overviews of the earlier stories its research linked: the pool's `earlier` sources keyed `story:<id>`, else the legacy run's `earlier`. This is the design's "candidates include overviews of earlier stories research cited";
     - the overviews of its cluster's other published members.
   - **Founding candidates:** up to `foundingCandidates` (3) of those unlinked stories, within the distance.
   - No candidate means no model call, and a `link` decision with outcome `none` is stored.
2. **Link confirmation** (`overview-link`, small tier):
   - **Input:** the story (title, label, summary, date, and up to 10 of its usable pool facts as context); per candidate overview, its charter, its title and its 5 newest entries (titles and dates); per founding candidate, the same fields as the story's.
   - **Output, per candidate:** `belongs` (`yes`, `no`, `unsure`), with the shared cause, place and end, each quoting both sides; for the story, its `role` and `role_kind`; and whether it reports the overview's end event.
   - **Code accepts a join only when all of these hold:**
     - the answer is `yes`;
     - all three shared fields are filled;
     - each quote is found in its side's text (title, summary or charter), with the same normalization the eval's `keyCheck` uses. That function, `normalizeQuote`, moves from the eval scripts into `server/src/lib/quoteMatch.ts`, and both import it from there, since production code never imports from `scripts/`.
   - If several overviews pass, the nearest wins, because a story joins one overview at most (For Odin 4). `unsure` counts as `none` (D2: cosine proposes, a model confirms).
3. **Founding** (only when no overview was joined and a founding candidate got `yes`). These are two independent large-tier calls that must agree (D6, D3 of the design):
   - `overview-found` drafts the development's charter (in, out, end event, which must be named) and title from the two stories.
   - `overview-found-check` sees only the charter and each story, blind to the first call's reasons. It judges whether each story fits and whether the end event is a concrete, observable event.
   - **On agreement**, a `forming` overview with both entries is created. **On disagreement**, nothing is founded, the attempt is logged, and the pair can be proposed again when a third story arrives.
4. **Forming to ongoing:** **every time a `forming` overview reaches 3 active entries**, a review is due (below), also when it climbs back to 3 after a review detached one. The overview becomes `ongoing`, and so public, **only if that review keeps at least 3 entries**. This merges the design's "3rd story or the first review" into the safer of the two. A forming overview that a review cuts back keeps waiting for its next third entry, and is never left forming with 3 or more unreviewed entries.
5. **Anomaly (code):** more than `burstLimit` (5) joins to one overview in a day freezes it and queues a review, catching loose matching (design, "Daily anomaly checks").

**A wrong join's reach is bounded:** a join can never change the charter or the title. It adds a timeline line, and its facts can feed "Where this stands" until a review or an editor detaches it. The next refresh then rewrites without them.

### Where this stands and What's being done

The stands are refreshed in the same job run when an active overview changed in any of these ways:
- it gained or lost an entry;
- a member's pool gained usable facts since `facts_seen` (a later pass, an Update);
- a cited fact became unusable or expired;
- an entry's role changed.

The refresh works in three steps:
1. **Facts offered (code):** the usable, structured pool facts of active, published members, de-duplicated by `fact_key`. Each is offered with a `current` flag judged on **today's date**, not the story's (`isCurrent`; an overview speaks for now).
   - **Current facts may be stated as how things are now. Expired facts may be stated only as a past value with its date** ("As of May 12, 34 cases had been confirmed"), the cards' rule. Code enforces this after the write: a sentence citing an expired fact must carry that fact's date, or it is dropped.
   - They are offered current first, then newest first, up to `overviews.maxStandsFacts` (60). `response`-slot facts are always included, current or expired, under the same rule. A response that has ended is still "being done" only in the past tense, and `doing` takes only current response facts.
   - Our own earlier stories' facts (`E…`) are never offered, by ADR-0067's rule.
   - Fewer than `overviews.minStandsFacts` (3) offered facts: no write, and no current stands (above).
2. **Write** (`overview-stands`, medium tier, as `cards-write` and the later pass's steps start). It writes from the facts and the entries' titles and dates (orientation only, never cited), **never from the previous stands**, which the design gives as the guard against drift. It returns `sentences` (at most 4) and `doing` (at most 2), each citing fact ids.
3. **Checks:**
   - Code first: every sentence cites at least one offered fact, or it is dropped. Then the copying check (`checkCopying`, a 12-word run).
   - Then research's fact-check prompt on every sentence, with no repair round (ADR-0061's rule for cards). The cards' `boxCheckItems` is typed to context facts and a story's day, so the stands get their own adapter, `standsCheckItems(sentences, facts, today)` in `overviewStands.ts`. It converts each cited pool fact with the pool's existing `contextFact` (`researchPool.ts`, which the pass's card step already uses), passes today as the day the validity windows are judged on, and builds the same check items through the evidence helpers `boxCheckItems` uses, which `storyContextChecks.ts` exports for it. No check logic is copied.
   - A failing sentence is dropped. If nothing survives, the previous version stays current. A new version with at least one sentence becomes `current`.

**What's being done** is `doing`. It is empty when no offered fact answers it, and then the page shows no line (ADR-0065).

### When overviews go quiet, close and reopen

Code applies the state machine each run; only closing involves a model:

- `open` → `quiet` after `quietAfterDays` (21) without a new entry. `quiet` → `open` on a new entry.
- **End-event closing:** when a joined story is flagged as reporting the charter's end event, two large-tier calls must agree that the end event has happened: `overview-close` with the charter and the newest entries, and `overview-close-check` with a different framing, the charter's end event against the story alone. On agreement, `closing_since` is set and the status becomes `closing`.
  - A new active entry during the 7 days (`closingDays`) cancels it, back to `open`.
  - Once 7 days pass, the overview is `closed` with reason `end_event`, after the review the design requires "before any closure".
- **Fading** (For Odin 2): a recommended `closed` with reason `faded` after `fadeAfterDays` (120) quiet, in code. Unlike an end-event closure, a faded overview reopens to `open` when a new story is confirmed to belong.
- A `closed` (`end_event`) overview takes no new entry. A new story on the same theme may found a new overview. Module 7 merges.
- Frozen overviews skip every automated change but the served-text filter and the unpublished-member rule.

**A member story that stops being published** (an editor's reject or trash, or a cluster edit that rejects a published non-primary as `duplicate`) leaves its overview:
- **Serving never waits for the job:** every public read (timeline, "via our story" chips, the story field, the stands' citations) joins entries to stories with `status: 'published'`, so the entry disappears from the page the moment the story does. A stands sentence whose only cited facts belong to unpublished members is dropped by `servedStands`, as one citing a demoted fact is.
- **The job's status step then detaches it:** `detach_reason: 'unpublished'`, `detached_by: pipeline`, not locked, logged as a decision. The overview is marked for a stands refresh and its scope recomputed: an ongoing overview falling below 3 active entries stays public until its next review decides (it has had its review at 3), and one falling to 1 or 0 becomes `single`.
- **If the story is published again**, the job finds its link decision undone by that detach and links it afresh, so it may rejoin the same overview or another. The status machine never touches `storyLifecycle.ts`, so no story-status code changes.

### Reviews (large tier, demote-only, D7)

`overview-review` re-reads an overview from its evidence. It is triggered:
- at 3, 6, 12, 25 and 50 entries;
- every 30 days while not closed;
- before a closure;
- on a burst;
- on a reader's "Report an error" from the overview page (the feedback route gets an `overviewId`). Reports queue **at most one review per overview per `overviews.reportReviewEveryDays` (7)**. Further reports in that time are stored with the feedback as today and shown on the admin page, but queue nothing. The feedback route's existing bot gate and rate limit apply unchanged.

It may only take these actions:
- detach an entry (with its reason);
- relabel a role;
- narrow the charter (never widen it);
- retitle;
- clear a freeze.

Code refuses any other change and applies each as a logged decision. A review never restores a detached entry, since restoring adds rather than removes. Detached entries stay rows for the audit and the admin, where an editor can re-attach one. Everything built on a detached entry is recomputed at the next stands refresh.

A **monthly audit** has the large model at high effort review 5 random public overviews from scratch and logs the error rate without acting on it (design, "After launch"). It is cost-gated in For Odin 5.

### Editor overrides and undo (D3: a person steps in but is never needed)

D3 as the roadmap states it lets a person step in only by switching a step off or setting it to review. ADR-0062 widened that for cards, to hiding and moving them. The overrides below widen it further for overviews, and Odin confirmed the full set on 2026-11-18 (For Odin 8); every action is logged and undoable.

The admin can:
- attach a story to an overview (`locked`);
- detach an entry (`locked`, so it is never re-linked automatically);
- set a role;
- retitle (logged; a later review may retitle again unless the overview is frozen);
- freeze or unfreeze;
- hide or unhide (hidden overviews are not public, and their stories show no link);
- close or reopen.

**Undo** acts on one automated decision from the log:
- a link is undone by detaching with reason `undone` and `locked`;
- a founding is undone by detaching both entries, which leaves the overview `single` with no entries, not public (the slug, once given, stays reserved so old links show the not-found view);
- a role is undone by restoring the previous role;
- a close is undone by restoring the previous status.

Each undo is itself a logged decision, and an undo of an undo restores the earlier state.

### The job

`link_overviews` (`jobs/linkOverviews.ts`, "Link Overviews") is a new step of `daily_edition_chain` **after `publish_stories`**. It is seeded **disabled**, with a $10 spending warning level. It is in `MODEL_JOBS` and `RESUMABLE_JOBS`, since a story is settled by its `link` decision.

**It joins `GOES_ON_PAST_FAILURE`** (`chainDefinitions.ts`). Without that, being last would not be enough: the chain's `settleStep` throws on any other failed step before the chain's end parts run, so a failed linking night would fail the chain run, send a chain notice on top of the step's, record the chain as stopped at this step, and skip story context's after-publish part (`runEndParts`). In the set, a failure leaves only the step's own Error and failure notice, and the end parts run.

It is kept off by the same four layers as the research pass:
- an eval gate constant, `OVERVIEW_EVAL_GATE` (`services/overviewGate.ts`), which refuses enabling (422) while set, and also while research passes' own gate is closed or `research_pass` is disabled (the order of switches above);
- the disabled row;
- a handler that does nothing unless the gate is open and the job is enabled;
- public reads that return nothing unless the step is on and the overview is public.

A run does five things in order:
1. it links the owed stories, oldest first (`perRun` 60 plus `backfillPerRun` 300 while a backfill is owed; link calls at concurrency 3, writes one at a time);
2. it runs foundings and the closing checks;
3. it applies the status machine, the unpublished-member rule included;
4. it runs due reviews;
5. it refreshes the stands.

Item counts go to `recordItems`: checked = stands sentences checked plus joins proposed; failed = sentences dropped plus links rejected by code. The failure-share notice fires as for any such job. **A failure never stops anything**: it is in `GOES_ON_PAST_FAILURE` and the chain's last step. Its summary reads: "Linked 9 stories: 4 joined, 1 founded, 4 alone; 3 overviews refreshed, 1 reviewed" (with "; backfill 300 of 1,612" while one is owed).

Linking is not part of the research pass, and it does not sit before publishing, for two reasons: overview links need published stories to be useful, and a failure here must not hold the edition. The cost is a minutes-long gap before a new story's link appears.

### Model steps

| Step | Tier (start) | Cache | Eval |
|---|---|---|---|
| `overview-link` (confirm, role, end-event flag) | small (luna@low) | **On**: fixed rules plus the schema exceed 1,024 tokens, and a night sends 9 to 60 calls within 30 minutes. The story and candidates are data; today's date is in `<REQUEST>` | `link`, `role`, replay |
| `overview-found` (charter, title) | large (gpt-6.1-sol@medium) | **Off**: a handful of calls a day | `found`, replay |
| `overview-found-check` | large | **Off**: as above | `found` |
| `overview-stands` (where this stands, what's being done) | medium (luna@medium) | **On**: rules over the minimum, several refreshes a night | `stands`, replay |
| Fact check of stands sentences | small, research's `buildFactCheckPrompt` (already cached) | On (unchanged) | `stands`; `fact-check --facts stands` |
| `overview-close`, `overview-close-check` | large | **Off**: rare | `closure`, replay |
| `overview-review` (and the monthly audit at high effort) | large | **Off**: rare, long and varied input | `review` (planted errors) |

Every prompt follows the house order (`.context/prompting.md`): rules, examples and the task first; the per-call data after; the values (today's date, the limits) last in `<REQUEST>`. Each builder states `Cache: on` or `Cache: off` with its reason. The cached builders go into `prompts/cachedPrompts.test.ts`. Fetched text never reaches these prompts, only pool facts' stored sentences, which are escaped as research escapes them.

### Costs and how they are measured

**Module 2 itself makes no Tavily call.** Search is the main cost of the whole feature, but it sits in the research pass. From research's figures:
- a first pass targets $0.12–0.20, with a ceiling of $0.40;
- a later pass has a ceiling of $0.25;
- the eval's bar is $0.20 a story at flex;
- Tavily costs $0.008 a credit.

At about 9 stories a day, that is roughly $30–55 a month, under the $60 cap Odin set on 2026-11-18. Module 2 adds model calls only (flex prices):

| Item | Estimate |
|---|---|
| Link confirmation, ~270 stories/month × ~$0.0006 | ~$0.2 |
| Founding, two large calls, ~20–40 attempts/month × ~$0.03 | ~$0.6–1.2 |
| Stands write plus fact check, ~150–250 refreshes × ~$0.003 | ~$0.5–0.8 |
| Closing checks | <$0.2 |
| Reviews, ~40–80/month × ~$0.03–0.05 | ~$1.5–4 |
| Monthly audit, 5 overviews at high effort | ~$1–2 |
| **Total** | **~$4–8 a month** (the design's $6–10 desk figure) |
| Backfill at switch-on (For Odin 1, 6 months) | ~$10–20 once, over about 6 nights |
| Eval-side research of the judged half for the stands bars (`pass-pool`) | ~$10–20 once |

**How it is measured:**
- every call goes through the job's run scope, so the Spending page shows `link_overviews` as its own line;
- `overview_decisions.cost_usd` gives cost per decision kind;
- the replay reports cost per story and per overview before the switch;
- after the first month, a SELECT in the eval's `baseline` step (extended) reports actual cost per linked story, per overview and per decision kind, with founding attempts against agreements and review counts, set beside the replay's estimate.

**The Tavily lever is left to measure, not to build** (see Out of Scope). The baseline also reports how many of the research pass's gap searches on overview members targeted a slot that another member's usable facts already covered. That is the saving that offering an overview's sibling facts to the pass would bring (the design's "7-day reuse within an overview").

### Evals and bars (D8; `eval:overviews`, new steps)

**Halves:** development keys are split by a committed list (`developmentHalves.ts`), **with Ebola in the judged half** as the roadmap requires. They are not split by slug hash.

The answer keys gain **`responses[]`** (D10: date, what is being done, the slug that reports it or null, and the quote). This is `schemaVersion: 2`, optional, so v1 keys stay valid. The keys are drafted by the coordinating session as before.

The **sandbox** (`overviewSandbox.ts`) keeps overviews in memory and feeds each development's stories, its near misses included, in date order through production's pure steps. Candidates come from production's two-part candidate code: `nearestPublished` runs read-only against the database with each story's `asOf`, so only stories published before it are seen, and `groupCandidates` gets the sandbox's in-memory memberships. A story's evidence is what production would offer: its pool's usable, structured facts when it has a pool, and nothing otherwise. Bars are means over 3 runs on the judged half; the first run sets the baseline and the noise.

**Stands are measured only where evidence exists.** The keys step already counts each development's entries that have a research run. The `stands` and `replay` reports add the share of checkpoints with at least `minStandsFacts` offerable facts. The `stands` bars are computed over those checkpoints only, and **need at least 15 such checkpoints on the judged half** to count. Below that, the stands bars report "not enough evidence" and the gate stays closed for stands. Getting there needs the judged half's stories researched by passes, either because passes have run on them since the switch or because the eval researches them first. For that, a new `pass-pool` eval step runs production's first pass in memory on the judged half's stories, with the same injected deps the `update` step's replay uses, and hands the resulting pools to the sandbox. It writes nothing to production, and its searches are bounded by each story's date as the `context` step's are. That eval-side research costs about $0.15 a story, about $10–20 for the judged half, and is listed in the eval plan's budget.

| Step | Measures | Bar |
|---|---|---|
| `link` | Joins right: precision over `must` entries and near misses (`optional` ignored); true joins found (recall of `must`) | ≥97% right; ≥85% found |
| `found` | Wrong foundings (a pair across developments, or with a near miss); the charter's end event matches the key's (strong judge) | none; right end event for every judged development |
| `role` | Turning point or routine agreement with the key | ≥85% |
| `stands` | Over checkpoints with enough offerable facts (at least 15 on the judged half): sentences the strong judge finds unsupported after the fact check; a figure stated at its latest key value as of the checkpoint (at 1/3, 2/3 and the end of each development) when the offered facts hold that value; "What's being done" present where the key has a sourced response by then and an offered fact reports it, and never unsupported | none; ≥90%; ≥70% present, none unsupported |
| `closure` | Premature closures (Uganda's end for Congo's Ebola); closed developments closed within 14 days of the key's end | none; ≥80% |
| `review` | Planted wrong joins (near misses inserted), wrong roles and narrowed charters caught; correct items demoted | ≥80%; ≤3% |
| `replay` | The whole module per development: joins, roles, statuses and closure against the key at three checkpoints; stands support; cost per story and per overview; how often each safeguard fired | all the bars above on the judged half; cost within the table above |

`fact-check --facts stands` runs the planted-error kinds on stands sentences (catch ≥90%, false rejection ≤5%). The anomaly checks and the status machine are code, with ordinary tests.

### Phases, each shippable switched off

1. **Records and keys:**
   - the migration (tables, enums, two partial indexes and their `check:migrations` rules, disabled job row and its warning level);
   - `overviewLifecycle.ts` with its fence test;
   - key schema v2 with `responses[]` and the halves list.
   - Nothing reads the tables yet.
2. **Linking:**
   - candidates, link, founding and roles (pure);
   - the job, closed by its gate, after `publish_stories`;
   - the decisions log;
   - the `link`, `found` and `role` evals in the sandbox.
3. **Stands, status and reviews:**
   - the stands write and its checks;
   - the status machine and closing;
   - reviews and the audit;
   - the `stands`, `closure`, `review` and `replay` evals.
4. **Admin views:**
   - `/admin/overviews`: a list filtered by scope, status, frozen and hidden, with entries, last entry and the public flag;
   - `/admin/overviews/:id`: charter, title, status history, entries with their judgment (shared cause, place, end, confidence, model), stands versions with each sentence's facts and verdicts, and the decision log with Undo;
   - the editor actions above;
   - an "Overview" block on the story page's Source tab (membership, the last link decision and its candidates, "Attach to overview…");
   - a Jobs page note, and the spending line.
   - The pages and buttons show while the step is on or any overview exists, as the research pass's admin does.
5. **Public:**
   - `GET /api/overviews/:slug` (overview, stands with resolved citations, timeline entries with their Updates), not in the OpenAPI contract at first, like `/context`;
   - the `overview: { slug, title } | null` field on public story objects (additive; contract snapshot refreshed), on every path that serves them (below, "The public story field");
   - `OverviewPage`, the story-page line and the card chip;
   - the `/ongoing` index (For Odin 6, decided): `GET /api/overviews` listing public overviews, most recently changed first, with title, area, "since" date and last change; `OverviewsIndexPage`; an "Ongoing" link in the header, mobile menu and footer, shown only while the module is switched on;
   - the sitemap entries for public overviews;
   - the `/ongoing/*` link-preview proxy (`render.yaml`, `linkPreviewPaths.ts`, `pagePreviews.ts`) with a section image;
   - JSON-LD (`CollectionPage` with `ItemList`), `noindex` not-found;
   - the AI transparency row and markers (`aiGenerated`, `data-ai-generated="overview"`);
   - the methodology paragraph held until the switch, as story context's is.
6. **Gate and switch (Odin), after `research_pass` is on:**
   - the replay report on the judged half;
   - Odin opens `OVERVIEW_EVAL_GATE` in its own change;
   - the backfill runs over its first nights, about 6 at `backfillPerRun` 300 (For Odin 1); older members' evidence fills on its own as passes run (For Odin 7, decided);
   - `.context/overviews.md` and the ADR are finalized.

### The public story field

Public stories are served through `PUBLIC_STORY_SELECT` on several paths: `publicStories.ts` (lists, the story page, the homepage's data), `relatedStories.ts` and `storySearch.ts`. `StoryCard` renders them on the homepage and on the Related, Search, Issue, Newsletter-issue and Saved pages. The field is added once, not per route:
- **One decorator, `withOverview(stories)`** in `overviewViews.ts`, reads the public overview of each story in one query (`overviewOfStories`) and adds `overview`. Each of those services calls it where it already adds the `aiGenerated` marker, so every path that serves a public story serves the field.
- **The type-level contract** (`publicStoryContract.ts`) compares `publicStorySchema` with what `PUBLIC_STORY_SELECT` returns plus the marker. A computed field breaks that, so the contract's served type becomes "the select's row, plus the marker, plus the `overview` field" (`ReturnType<typeof withOverview>`), keeping the check exact.
- **Caches:** the homepage copy is rebuilt every `config.homepage.refreshMs`, and the related-stories cache keeps story ids and re-reads the published stories, so it goes through the decorator fresh. Every overview change that removes public visibility (hide, a detach of the story, a scope falling to `single`, the step switched off) calls `clearPublicCaches()` from the lifecycle module, as the admin's "Clear cache" does, so no stale link outlives the change. A change that only adds a link waits for the next refresh, which costs nothing.
- **Clicking a stale link** that some other copy still holds reaches the overview route, which answers 404 for a non-public overview, and the page shows the `noindex` not-found view.

### Left ready for module 5 (out of scope here)

- **A read model module 5 can rank without new queries:**
  - `overviewDigest(since)` lists public overviews with their newest entries, roles and kinds ("2 turning points this week");
  - `last_entry_at`;
  - the current stands with its `doing` line, which module 5's briefing names per development (D10).
- **Weekly, monthly and yearly overviews are expected in module 5:**
  - the page parts (`OverviewStands`, `OverviewTimeline`) take an entries list and a stands record, not a charter, so a period overview reuses them;
  - module 5 adds an `overviews.kind` column (`development` by default) additively;
  - `/ongoing/` stays the developments' namespace, so period pages take their own routes;
  - the stands writer takes its facts as an argument, so a period's selection can feed it.
- **The "ongoing" chip on cards** is the hook the front page uses.
- **No homepage, briefing, "coming up", follow or RSS** is built here.

### Decisions in this plan

- **D-OV1:** linking is a step after publishing, not part of the pass.
- **D-OV2:** a story joins at most one overview (For Odin 4).
- **D-OV3:** overviews own no facts and run no search; they cite pool facts.
- **D-OV4:** `ongoing` only after the review at 3 entries keeps 3.
- **D-OV5:** stands are judged current on today's date.
- **D-OV6:** halves by a committed list.
- **D-OV7:** module 2 switches on only after research passes; stands come only from pool facts and are absent without enough of them; no legacy fallback.
- **D-OV8:** linking failures never stop the chain (`GOES_ON_PAST_FAILURE`); writes are applied one story at a time, oldest first, with windows anchored on each story's date.

Each becomes an ADR (or joins one, "Overviews: linking, records and public pages") when its first code lands. The planner made them; Odin confirms through the For Odin answers and plan approval.

## Changes

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | Models `Overview`, `OverviewEntry`, `OverviewStands`, `OverviewDecision` and enums `OverviewScope`, `OverviewStatus`, `EntryKind`, `EntryRole`, `EntryStatus`, `OverviewDecisionKind`; relations on `Story` and `Issue` (list relations only, no column) |
| `server/prisma/migrations/<ts>_overviews/migration.sql` | Tables, enums, CHECK, partial unique indexes `overview_entries_one_active` and `overview_stands_one_current`, `link_overviews` job row (disabled, `ON CONFLICT DO NOTHING`) and its $10 `spend_warnings` row; any generated `DROP INDEX "story_embeddings_embedding_idx"` deleted |
| `server/src/scripts/check-migrations/rules.ts` | Fail on a drop of the two new partial indexes (same rule as `article_versions_one_current`) |
| `server/src/config.ts` | `overviews` block: `maxDistance`, `candidateOverviews`, `foundingCandidates`, `foundingWindowDays`, `memberLookbackDays`, `perRun`, `backfillPerRun`, `concurrency`, `burstLimit`, `quietAfterDays`, `closingDays`, `fadeAfterDays`, `reviewAt`, `reviewEveryDays`, `reportReviewEveryDays`, `maxStandsFacts`, `minStandsFacts`, `backfillDays`, each through the parsers; tiers per step |
| `env.example`, `render.yaml` | Any env override added (the blueprint test requires it) |
| `server/src/services/overviewGate.ts` | New. *Responsibility:* the eval gate constant that keeps the step off. *Exports:* `OVERVIEW_EVAL_GATE`, `overviewStepOn` |
| `server/src/services/overviewTypes.ts` | New. *Responsibility:* the in-memory overview, entry, stands and decision types shared by steps, sandbox and views. *Exports:* types only |
| `server/src/services/overviewCandidates.ts` | New. *Responsibility:* candidate overviews and founding partners for a story, in two parts: the SELECT-only neighbors (exact distances, `asOf`-bounded, research's earlier stories, cluster members) and the pure grouping over an injected membership map. *Exports:* `nearestPublished`, `groupCandidates`, `membershipsOf` |
| `server/src/lib/quoteMatch.ts` | New, moved: `normalizeQuote` from `scripts/eval/overviews/keyCheck.ts`, which now imports it |
| `server/src/services/storyContextChecks.ts` | Export the evidence helpers `boxCheckItems` uses (`asEvidence`, `sourceDateFacts`), no behavior change |
| `server/src/jobs/chains.test.ts` | "Still stops at any other failed step" skips the set's members, so it holds once the new step is in the set (it would fail otherwise, since the step comes after publishing); a new case: a failed `link_overviews` lets the end parts run and leaves the chain's resume clear |
| `server/src/services/overviewLink.ts` | New. *Responsibility:* one story's linking over injected deps (candidates, link call, the founding pair, roles) and the acceptance rules. *Exports:* `linkStory`, `acceptLink` |
| `server/src/services/overviewStands.ts` | New. *Responsibility:* the facts offered, the stands write, code checks, fact check and the served filter. *Exports:* `refreshStands`, `standsFacts`, `servedStands` |
| `server/src/services/overviewStatus.ts` | New, pure. *Responsibility:* the scope and status machine (forming→ongoing, quiet, closing, closed, fade, reopen) and the anomaly checks. *Exports:* `nextState`, `anomalies`, `reviewDue` |
| `server/src/services/overviewReview.ts` | New. *Responsibility:* a review and the monthly audit over injected deps, with demote-only actions enforced in code. *Exports:* `reviewOverview`, `allowedActions` |
| `server/src/services/overviewLifecycle.ts` | New. *Responsibility:* the only writer of the four overview tables: founding, attach and detach, roles, stands versions, status moves, editor actions and undo, each logged. *Exports:* `applyLink`, `applyFounding`, `applyStands`, `applyStatus`, `applyReview`, `editorAction`, `undoDecision` |
| `server/src/test/overviewWriters.test.ts` | New fence: writes to the overview tables only in `overviewLifecycle.ts` |
| `server/src/services/overviewViews.ts` | New. *Responsibility:* SELECT-only reads for the public page, the story field, the admin and module 5's digest. *Exports:* `publicOverview`, `overviewOfStories`, `adminOverviewList`, `adminOverview`, `overviewDigest` |
| `server/src/prompts/overviews.ts`, `server/src/schemas/overviews.ts` | New: the link, found, found-check, stands, close, close-check and review prompts (house order, cache headers, versioned) and their Zod schemas |
| `server/src/prompts/cachedPrompts.test.ts` | Add `overview-link` and `overview-stands` |
| `server/src/jobs/linkOverviews.ts` | New handler: gate re-check, the five parts, tallies, summary, failure notices |
| `server/src/jobs/handlers.ts`, `chainDefinitions.ts`, `modelJobs.ts`, `interruptedRuns.ts`, `jobNotes.ts`, `jobEnableChecks.ts`, `failureShare.ts` | Register the job, place it after `publish_stories` and add it to `GOES_ON_PAST_FAILURE` (its doc comment widened past story context), Flex and resume, its note, the gate refusal (its own gate, and research passes' gate or switch), its failure-share wording |
| `server/src/scripts/seed-jobs.ts`, `shared/types`, `client/src/lib/constants.ts` | The job's row, name and display name |
| `server/src/routes/admin/overviews.ts` | New admin routes: list, detail, attach, detach, role, retitle, freeze, hide, close or reopen, undo (all through the lifecycle module, `failsWith()`) |
| `server/src/routes/public/overviews.ts` | New `GET /api/overviews/:slug`, and `GET /api/overviews`, the index list (public overviews only) |
| `server/src/services/publicStories.ts`, `relatedStories.ts`, `storySearch.ts`, `homepage.ts`, `routes/public/stories.ts`, `schemas/story.ts`, `lib/openapi.ts`, `lib/publicStoryContract.ts` | Add the `overview` field on every public-story path through one decorator (`withOverview`, one query); the contract's served type gains the field; snapshot refreshed (additive) |
| `server/src/lib/publicCaches.ts` (use only) | The lifecycle module calls `clearPublicCaches()` when a change removes a public link |
| `server/src/routes/public/sitemap.ts` | Public overviews as `/ongoing/<slug>` (weekly, 0.6) |
| `server/src/lib/linkPreviewPaths.ts`, `services/pagePreviews.ts`, `render.yaml` | `ongoing` section and its proxy rewrite (above the catch-all) |
| `server/src/lib/aiProvenance.ts` | Marker for the overview route's AI fields |
| `server/src/routes/public/feedback.ts` (and its schema) | Optional `overviewId` on "Report an error", which queues a review at most once per overview per 7 days |
| `client/src/pages/OverviewPage.tsx` (+ `components/overview/OverviewStands.tsx`, `OverviewTimeline.tsx`) | New page and parts; citations through `components/research/` |
| `client/src/App.tsx` | Routes `/ongoing/:slug` and `/ongoing` (dynamic, not prerendered) |
| `client/src/pages/OverviewsIndexPage.tsx` (+ test) | New. The `/ongoing` index: public overviews, most recently changed first; empty state while none is public |
| `client/src/layouts/public/SiteHeader.tsx`, `MobileMenu.tsx`, `SiteFooter.tsx` | "Ongoing" nav link, shown only while the module is switched on (the public API says so) |
| `client/src/pages/StoryPage.tsx`, `components/StoryCard.tsx` | The ongoing line and chip when `overview` is set |
| `client/src/pages/admin/OverviewsPage.tsx`, `OverviewDetailPage.tsx`, `hooks/useOverviews.ts`, `components/admin/StoryEditorSections.tsx` | Admin views and the story's Overview block |
| `client/src/components/ai/aiDisclosureCopy.ts`, `server/src/lib/aiLabelCopy.ts` | The overview label once Odin approves its wording (For Odin 3) |
| `client/src/lib/structured-data.ts` | `CollectionPage` plus `ItemList` for an overview |
| `server/src/scripts/eval/overviews/keySchema.ts` | `schemaVersion` 2 with optional `responses[]` and its checks |
| `server/src/scripts/eval/overviews/developmentHalves.ts` | New: the committed halves (Ebola judged) |
| `server/src/scripts/eval/overviews/overviewSandbox.ts`, `link.ts`, `linkScore.ts`, `stands.ts`, `standsScore.ts`, `closure.ts`, `review.ts`, `reviewScore.ts`, `replay.ts`, `passPool.ts`, `overviewsReport.ts` | New eval steps, scoring (pure) and report sections; `passPool.ts` researches the judged half's stories in memory for the stands bars; the reports give the share of checkpoints with enough evidence |
| `server/src/scripts/eval/options.ts`, `overviews.ts`, `imports.test.ts`, `baseline.ts` | New `--steps` names; the import guard over the new production modules (pure ones whole, candidates only while SELECT-only); the baseline's post-launch cost and reuse figures |
| `.context/overviews.md` (new), `CLAUDE.md` table, `scheduler.md` (the daily chain no longer ends at `publish_stories`: its step list, the "last step" and Review wording, and `GOES_ON_PAST_FAILURE` now holding two steps), `research-passes.md` ("What reads the pool"), `public-website.md`, `seo.md`, `ai-transparency.md` (new feature row, labels, markers), `prompting.md` (cache list, check table), `model-eval.md`, `admin-dashboard.md`, `decisions.md` plus the ADR | Behavior docs in the same changes as the code |

## Tests

- **`nearestPublished`** (db test): distance cut, the lookback counted from `asOf`, `asOf` hiding later stories, research's earlier stories and cluster members added.
- **`groupCandidates`** (pure): closed overviews and members past the lookback excluded, unlinked neighbors kept only within the founding window before the story's date, ranking by nearest member, the same result from an injected in-memory membership map as from one read from the tables.
- **Ordering and conflicts:** owed stories are linked oldest first, the backfill's slice before the night's stories; two same-night stories proposing each other found one overview, the second joining; an index refusal is logged as `conflict` and retried next night; a backfilled development founded from its earliest stories.
- **`acceptLink`:**
  - `yes` with a missing field or a quote not found is refused;
  - `unsure` counts as none;
  - with several passing overviews, the nearest wins;
  - a closed `end_event` overview is never joined;
  - a faded one reopens;
  - a `locked` detach is never re-linked.
- **Founding:** agreement required; disagreement founds nothing and is logged; a charter without an end event is refused.
- **`nextState`:**
  - forming to ongoing only after the review at 3 keeps 3, and a review due again when a forming overview cut back by one climbs to 3 again;
  - an unpublished member detached as `unpublished` and its overview's scope recomputed (to `single` at 1 or 0), and the story relinked when republished;
  - an overview with no active entries is `single` and never a candidate;
  - open to quiet at 21 days, and back to open on an entry;
  - closing cancelled by an entry within 7 days, closed after 7 with its review;
  - fade at 120 days;
  - frozen skips automation;
  - an overview left with one entry becomes `single`.
- **`anomalies`:** a burst freezes the overview and queues a review. **`reviewDue`:** each trigger.
- **`allowedActions`:** a review answer that adds an entry, restores a detached one, widens the charter or attaches a fact is refused; detach, relabel, narrow and retitle pass.
- **Report trigger:** a second "Report an error" within 7 days queues no second review.
- **Stands:**
  - facts offered (usable and structured only, deduped by key, flagged current on today's date and offered current first, response facts always included, `E` facts never, unpublished members' never);
  - a sentence citing an expired fact without that fact's date dropped; `doing` citing only an expired response fact dropped;
  - fewer than 3 offered facts writes nothing and leaves no current stands;
  - `standsCheckItems` gives the same items as `boxCheckItems` for the same facts converted with `contextFact`;
  - an uncited or copying sentence dropped;
  - a sentence the check fails dropped;
  - an empty result keeps the previous version;
  - `servedStands` drops a sentence whose fact was demoted after writing;
  - the refresh triggers (new entry, new usable pool facts, expiry, role change).
- **Lifecycle** (db tests):
  - the one-active-entry and one-current-stands indexes refuse a second;
  - undo of a link, a founding, a role and a close each restores the state before and logs itself;
  - an undo of an undo;
  - editor actions set `locked`.
- **Fence test** for the writers.
- **Job:** does nothing while the gate is closed or the job is disabled; enabling refused while research passes are off; settles a story by its `link` decision; resumes after a cut-off; the backfill slice; the item tally; the summary line. **`jobRegistry.test.ts`** passes with the new job. **`chains.test.ts`:** a failed `link_overviews` leaves the chain going on, its end parts run.
- **Public:**
  - `overview` is null for forming, single, hidden and closed-but-hidden overviews, and while the step is off;
  - the overview route returns 404 for a non-public overview;
  - the field is set on every public-story path (lists, story, homepage, related, search), and the type-level contract compiles with it;
  - hiding an overview clears the public caches; an unpublished member vanishes from the page before the job runs;
  - the sitemap lists only public ones;
  - the link-preview page tags.
- **Client:**
  - `OverviewPage` folds routine entries per month, filters turning points, and hides "What's being done" when empty;
  - `StoryPage` and `StoryCard` render the link only with `overview` set;
  - the not-found view is `noindex`.
- **Evals:**
  - `validateKey` for v2 `responses[]`;
  - the halves keep Ebola judged;
  - each score function on hand-made sandbox results (precision and recall with optional entries ignored, near-miss joins counted wrong, checkpoint latest-value rule, premature closure);
  - the option parser's new steps.

## Out of Scope

- **Module 3:** figure tiles, charts, figure definitions and values, the map, and the anomaly checks on figures.
- **Module 4:** watched sources and source-item entries.
- **Module 6:** below-bar contributions and keeping rejected stories.
- **Module 7:** merging overviews.
- **Module 5:** the front page, the weekly briefing, "coming up", and the weekly, monthly and yearly overviews (only the seams above). Follow buttons, per-overview RSS and email are also out.
- **Any search by module 2.** "What's being done" uses only what research found.
- **Offering an overview's sibling facts to the research pass** (the design's within-overview reuse lever). It changes the pass's input and needs the pass's evals rerun, so it belongs in its own plan once this plan's baseline measures the saving.
- **A story in several overviews** (For Odin 4).
- **Changing dedup, clusters or related stories.**
- **Backfilling the backend's crawler HTML with `dateModified`.**

## For Odin

Each question is about behavior, scope or cost. Implementation proceeds on the recommendation until Odin answers.

1. **How far back should overviews reach when the module is switched on?** **Decided 2026-11-18: (b), the last 6 months.**
   - (a) **No backfill:** overviews form only from stories published after the switch. It costs nothing extra, but Ebola, Hormuz and the other running developments would take weeks to reach 3 new stories and go public.
   - (b) **The last 6 months (recommended):** about 1,600 stories linked over the first 6 nights or so, about $10–20 once, each of those nights about 15–25 minutes longer, after publishing. Developments running since May, Ebola among them, appear within the first week with their history (timelines at once; "Where this stands" only where research passes have filled the evidence, For Odin 7).
   - (c) **The whole archive:** the most complete history, at about 2–3 times (b)'s cost. It brings in many long-finished developments whose overviews would close or fade at once, adding admin noise for little reader value.
2. **What happens to a development that fades out without a clear ending?** **Decided 2026-11-18: it closes after 120 days quiet.**
   - (a) **It stays "quiet" indefinitely**, marked "No new reporting since <date>". Nothing is closed without an end event, but stale overviews pile up and remain linked from their stories.
   - (b) **It closes as "No longer followed" after 120 days without a new story, and reopens if a new story belongs (recommended).** This keeps the open set to what is live; a closure is visible to readers but reversible.
   - (c) **The same, after 60 days:** tighter, but seasonal developments (El Niño, the Colorado River rules) would close and reopen repeatedly.
3. **What should the overview page's AI label say?** (Label wording is yours, `aiDisclosureCopy.ts`.) **Decided 2026-11-18: the new label, "Summary and timeline by AI, from our stories and their sources."**
   - (a) **"Summary and timeline by AI, from our stories and their sources." (recommended):** one line under the title, covering the title, "Where this stands", "What's being done" and the timeline's labels, as the story label covers its cards.
   - (b) **Reuse "Researched and written by AI."** It is consistent with researched stories, but overstates it: the overview does no research of its own.
   - (c) **A label per section** ("Where this stands" and the timeline each labeled). This is the most explicit, at the cost of visual clutter and three strings to approve.
4. **Can one story belong to more than one ongoing story?** **Decided 2026-11-18: one at most.**
   - (a) **One at most (recommended):** each story shows one clear "ongoing" link. A Lebanon-war story that also moves Hormuz shipping files under the closer development only, and the other overview misses it until module 7's merges or an editor's attach.
   - (b) **Up to two:** more complete timelines, but story pages and cards carry two links, the wrong-join risk doubles, and the eval's precision bar is harder to meet.
5. **How much should be spent on keeping overviews correct?** **Decided 2026-11-18: as designed, about $4–8 a month.**
   - (a) **As designed:** reviews at 3, 6, 12, 25 and 50 entries, every 30 days and before closing, plus a monthly audit of 5 overviews. About $4–8 a month in total for the module (recommended).
   - (b) **Leaner:** reviews only at 3 entries and before closing, and no monthly audit. About $2–4 a month, but drift and wrong joins wait longer for a fix, and nothing measures drift after launch.
   - (c) **Stricter:** as (a), with link confirmation on the large model from the start rather than only if its eval fails. About $9–15 a month; fewer wrong joins on day one, but slower nightly runs.
6. **Should there be a page listing all ongoing stories?** **Decided 2026-11-18: (b), the `/ongoing` index with a nav link.**
   - (a) **No listing in this module:** readers reach overviews only from story pages and cards until module 5's front page. Nothing more is built, but discovery is weaker.
   - (b) **A simple `/ongoing` index (recommended):** public overviews, most recently changed first, with title, area, "since" date and last change, and a header link "Ongoing". Small to build; module 5 can restyle or replace it. It adds a nav item, which you may prefer to introduce with the new homepage instead.
   - (c) **The index, but no nav link until module 5:** reachable from the sitemap and story pages only.
7. **How should older stories get the evidence "Where this stands" is written from?** **Decided 2026-11-18: (a), let it fill on its own; no one-off research.** Only stories researched by the new research passes carry usable evidence, and almost none do before passes are switched on. Overviews therefore come after passes (fixed), and the question is what happens for the backfill's older stories.
   - (a) **Let it fill on its own (recommended):** every new story is researched nightly, and an editor's "Research again" fills any older one. Nothing extra is spent. Running developments get "Where this stands" within a week or two as new stories join. Finished ones may show only their timeline.
   - (b) **Research the members of public overviews once:** an estimated 300–500 stories at about $0.15, so $45–75 once. With the $60 monthly cap this either takes about two months alongside normal research, or needs a one-off raise. Every public overview has "Where this stands" from the start.
   - (c) **Keep an overview off the site until it has "Where this stands":** no page ever shows a timeline without a summary, but fewer pages go public early, and finished developments may never appear.
8. **Which manual corrections may an editor make to an overview?** **Decided 2026-11-18: the full set (attach, detach, role, retitle, freeze, hide, close, reopen), each logged and undoable.** The roadmap's D3 lets a person step in only by switching a step off or setting it to review; story cards were already widened to hiding and moving them.
   - (a) **The full set (recommended):** attach and detach stories, set a role, retitle, freeze, hide, close or reopen, and undo any automated decision. Each is logged and undoable, and fixes a wrong join or title in one click.
   - (b) **Only taking things away:** detach, hide, freeze and undo. An editor can remove a mistake but never adds a story or rewords a title, keeping D3 close to its letter. A missed story waits for a later run or module 7.
   - (c) **None beyond the switches:** as D3 reads. A wrong join stays until a review catches it or the step is switched off.

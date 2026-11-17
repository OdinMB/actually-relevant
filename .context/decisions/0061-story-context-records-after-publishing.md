---
id: ADR-0061
title: "Story context: facts and boxes as records, and the step after publishing"
status: accepted
date: 2026-11-16
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, ai-risk, cost]
tags: ["story-context", "overviews", "scheduler", "fact-check", "records"]
---

# ADR-0061 · Story context: facts and boxes as records, and the step after publishing

## Context

Overviews module 1 (`.plans/2026-11-16_story-overviews.md`; plan `.plans/2026-11-16_story-context.md`,
approved by the owner on 2026-11-16) gives published stories context cards: comparisons, figures
with their sources and charts. Research already gathers many of the facts that would size a story,
but they sit in its run's prose and stored facts, and nothing looks for what research did not find.
The roadmap's later modules (overviews, reviews, threads) will read and judge these facts again, so
how they are kept matters beyond one card. Four choices had to be made: where the step runs, where
its facts come from, which check judges them, and what it reuses while overviews do not exist yet.

## Decision

- **Facts and boxes are records of their own**, not fields of the story or of the research run:
  `story_context_runs` (one per attempt, its costs apart, its `result` the record of what it did),
  `context_facts` (every fact with its evidence, structured fields, verdict and a judgment status
  `unreviewed`/`reviewed`/`demoted`, model and prompt version), `context_boxes` (the cards, citing
  their run's facts by ref, each with its status and place) and `context_search_cache`. Only a
  fact's supporting sentence and a short passage are kept, never a page's text. A demoted box is
  never served; nothing is deleted to hide one.
- **The step runs after publishing**, the fourth step of `daily_edition_chain` (select, research,
  publish, context), so it can never delay or stop the day's edition: a failed step stops its chain,
  and a new module that threw before publishing would hold it. A story is settled by its first
  context run, whatever its outcome.
- **Pass 1 structures research's stored facts; it does not re-extract.** One call returns the
  structured fields (value, unit, what is counted, place, as-of, credited body, validity) of each
  fact research kept. Only what research did not cover is searched for (pass 2, at most 3 searches).
- **Research's fact-check prompt and schema are reused unchanged**, for facts (each rendered from
  its structured fields) and for boxes (with the sources' lines, so copying is judged too), and a
  failing item is dropped with no repair round.
- **Two kinds of reuse instead of overviews:** an exact-query search cache for 7 days, and the
  current, supported context facts of the earlier stories research linked, stored with the new run
  only when a kept box cites them (the agent's placement: copied with `reused_from_id`, so a run's
  boxes always resolve within it).

## Consequences

- Readers see a story without cards for a few minutes after it is published, at about 01:00 UTC.
  Stories past the per-run limit, or published while the step was off, are filled in while still
  within the 3-day lookback; older ones never get context.
- Module 2's reviews can demote a fact or box by its status and recompute what it touched without
  touching the story; a join table for that is module 2's call (citations stay in jsonb).
- The planted-error baseline of research's fact check stays meaningful for the context facts, and
  there is one fact-check prompt to keep tuned; a change to it changes research and context alike.
  Of the design's three hints only number mismatches reach the judge; whether the supporting
  sentence stood word for word in the text is recorded (`support_found`) and measured, not sent.
- A pass-1 fact is only as good as research's extraction of it: a detail research dropped is
  missing unless pass 2 finds it again.
- A cached answer may be reused for a story a few days older than the one that asked, so its
  results can end a few days after that story's day. If the cache's hit rate stays near zero for a
  month it goes (follow-up).
- No repair rounds keeps a story's model calls fixed (about 7), at the price of cards a repair
  could have saved.
- The job is seeded disabled with a spending warning level of $20, the first level seeded (ADR-0060
  seeded none), and nothing caps it: a run is bounded by its size, at most 20 stories of at most
  about $0.10 each.

## Alternatives considered

- **Between research and publish, stopping at the chain's deadline:** holds publishing by up to one
  story's run and makes a top-level failure stop the edition.
- **A separate schedule outside the chain:** breaks the roadmap's rule that each module is a step
  with its own switch and cost line.
- **Re-fetching and re-extracting research's pages:** doubles Tavily and extraction cost.
- **Adding the structured fields to research's extraction prompt:** changes a live step, needs
  research's eval, and would ship module 1's behavior while module 1 is still switched off.
- **A purpose-built fact-check prompt:** a second prompt to calibrate, with no baseline.
- **Research's repair rounds:** a medium-tier call more per story for cards that are optional.
- **Reuse keyed on the overview:** needs module 2.
- **A `context` field on the public story** instead of the site route `GET /api/stories/:slug/context`:
  saves a request, but freezes an unproven shape as public contract.

## Amendment 2026-11-17: one second attempt within the same run

The owner decided on 2026-11-17 that retrying temporary problems belongs to a run: "If it fails,
leave it and notify." This narrows the Decision's second bullet: a story is settled by its first
night's context run, and within that run a technical failure that may pass gets one more attempt.

A failure may pass when a required model call or a search fails on a rate limit, a server error, a
timeout or a lost connection, once the SDK's and `withRetry`'s own retries are spent
(`transientFailure`). Such a story is tried again after every other story of the run, on its own
run row: only the second attempt's outcome, record, facts and boxes are stored, and the row's costs
add both attempts'. A second failure settles the story, as does any other failure (a parse failure,
a refused request, an error of ours, an error outside the run). No later night tries it again.

Every summary line says how many stories failed, and when more than the failure share (20%) of at
least 5 stories failed, the step records one warning notice (`stories-failing:build_story_context`).
Nothing pauses.

Rule: a story gets at most two attempts, both in the run that first took it; whatever the second
ends with stands.

Consequences: a night with a short outage of the model or search service loses fewer stories, at
the cost of at most one more story's calls for each story it hit; the cost bound per story doubles
for those stories only. `story_context_runs` holds one row per story and night, not one per attempt:
the first attempt's record is replaced by the second's, so the admin's "What the run did" shows the
second attempt while the row's cost covers both.

## Amendment 2026-11-17: an editor can run it again

The owner decided on 2026-11-17 that an editor can gather a story's context on demand ("Gather
context" in the admin), and again later ("Gather more context"), whether the step is switched on or
off. This narrows the Decision's second bullet once more: **the step** still settles a story with its
first run, whatever its outcome, and still takes only stories within its lookback that have no run;
an editor's run is not bound by either.

- **Any published story with research facts**, with no lookback and any number of earlier runs.
  Only web search must be on.
- **One run of a story at a time.** Every run row is claimed, and a failed one reopened for its
  second attempt, under one advisory lock, and neither happens while another run of the story is
  running. The editor then gets a refusal, and the step skips the story, which the editor's run
  settles.
- **Each run builds on the story's earlier completed runs.** Their supported facts are carried over
  and not checked again, and their judged research facts are not structured again. Their queries
  and response angles are not searched again, so the two-angle rule holds over all of a story's
  runs, and the pages they read are dropped. With nothing missing, a run makes no search and only
  rewrites the cards. Failed, skipped and running runs count for nothing.
- **The cards are rewritten** from the old facts and the new together, and the new run is the
  newest. Nothing is deleted. The editor's choices carry over by card type: a hidden card stays
  hidden, and a moved card keeps its place.
- **Its spend is the step's**, added to `build_story_context`'s month and checked against that
  step's warning level, not counted as editor research. No cap, as for the step.

Rule: the step runs a story once; an editor may run it again at any time, one run at a time, and
each run starts from what the earlier ones found.

Consequences: `story_context_runs` holds any number of rows per story, and which runs were an
editor's is not recorded. A rerun costs about a nightly run, less when earlier searches and facts
are reused. A carried fact keeps the verdict of the run that judged it, under a check prompt that
may since have changed. A card type the new run does not write disappears from the page with the
earlier run's cards, though its rows stay. The eval loads no earlier work, so it measures first runs
only.

## Amendment 2026-11-17: before publishing, for every researched story

The owner decided on 2026-11-17 that the step runs before publishing: "if it's activated, shouldn't
this happen before publication, so that we don't first publish one version, then do context
research, and then immediately update the story? Also, if activated, this should happen to all
published stories, not just a fixed amount." This **replaces the Decision's second bullet** ("The
step runs after publishing"): what this ADR listed as the first rejected alternative, between
research and publish, stopping at the chain's deadline, is now the decision, with two safeguards
against the cost it named there. The other bullets stand. Plan:
`.plans/completed/2026-11-17_context-before-publish.md`.

- **The chain is select, research, context, publish.** The step takes the selected stories about to
  be published (unclustered or their cluster's primary) first, then the published ones of the
  3-day lookback that have no run (stories published while the step was off, by an editor, or late).
  **No per-run limit**: a run is bounded by the night's stories. A story is still settled by its
  first run.
- **The publish gate waits for the cards** as it waits for research: while the step's job is
  enabled and web search is on, a selected story it owes, with no settled context run, waits at most
  research's bound, two hours from its selection. A failed, skipped or late story publishes without
  cards, and can get them later from the nightly fill or an editor.
- **The chain's deadline** holds for the step as for research: past it, no story and no second
  attempt starts, and the gate holds nothing for context.
- **A failure of the step does not stop the chain** (`GOES_ON_PAST_FAILURE`, the one step with
  that rule): its own Error and failure notice stand, and the chain goes on to publish.

Rule: a story goes out with its cards unless building them failed or would hold it past two hours
from its selection or past the chain's deadline; nothing about the cards ever stops the edition.

Consequences: readers never see a story change minutes after it goes live. The edition publishes
after the step's run, an estimated 5 to 15 minutes later on a normal night, up to about an hour more
on the first night after the step is switched on (it fills the 3 days before), and never later than
the chain's deadline plus the runs in flight. The cost bound per run is now the night's stories
(about $1.10 for 11), not 20 stories. A selected story's cards are judged current on the day of the
run, the day it is about to be published. A story built and then not published (an editor rejects
it before the publish runs) spent its run for nothing. The chain gains an exception to "a failed
step stops the chain", for this step only.

## Amendment 2026-11-17: no gate in the daily edition; the published stories after publishing

A review of the amendment above found that it could hold the edition, against the owner's aim that
context never does: "stories are published with their cards, but context can never hold the edition:
a story whose context fails or is late is published without cards that same night." Inside the chain
the gate kept waiting after a failed step, or behind a person's run of the step that outlasted the
chain's wait, so every selected story went out a day late; a restart left a run `running` for two
hours, which the gate counted as still coming; and publishing waited for the 3-day lookback, with the
selected stories' second attempts queued behind the lookback's first ones. This **replaces the
amendment's first three bullets**; its fourth bullet stands. Plan:
`.plans/completed/2026-11-17_context-before-publish.md`, reviewed the same day.

- **The step works in two parts in the daily edition**, each a run of the same job (one switch, one
  note, one spending line), through the chain's new split steps (`SPLIT_STEPS`, `.context/scheduler.md`,
  "Chains"). At its place it builds only the stories about to be published, then their second
  attempts. Once the chain's last step has run, while the step is on and such a story exists, it
  builds the published stories of the lookback that it still owes. A run on its own (Run now) does both,
  the stories about to be published first. Rejected: a second job for the lookback (a second switch
  and spending line for one owner decision), and the lookback only in runs on their own (no automatic
  fill).
- **The publish gate holds nothing for context in the daily edition.** The step has just had its
  turn, so a card it did not build is not coming that night. The gate remains for a publish run on its
  own (Run now), at most research's two hours from selection.
- **A run a restart cut off counts as interrupted at once** in the scheduling process: one rule
  (`staleBefore`) marks a `running` run started before that process did, besides those past the
  two-hour limit, for the step, an editor's run and the gate alike. A second process with the scheduler
  off keeps the limit, since the scheduling process may still be running the run.
- **The step gives a story its first run only**: its claim refuses a story with any run, so an
  editor's run during the night is not followed by a second one. A second attempt resets the run's
  start, so it is not marked stale for the time of its first attempt.

Rule: a story goes out with its cards unless building them failed or did not finish before publishing
in the same night's run; nothing about the cards ever holds the edition.

Consequences: the edition publishes after research and the step's first part (an estimated 5 to 15
minutes on a normal night), on the first night after the step is switched on too, and never later than
the chain's deadline plus the runs in flight. One exception stays: the chain waits up to two hours for
a step a person is running by hand, so a Run now of the step late in the evening still delays publishing
by its length. A story whose card the first part did not build, because the step failed before it or
the deadline passed, is built by the second part minutes after it goes live, so readers can see that
story change. On a night with a second part, the step's last run on the Jobs page (length, cost,
summary, failure-share warning) is that part's. Research's own gate is unchanged: in the chain it still
holds a story research did not reach for its two hours, which is research's documented rule.

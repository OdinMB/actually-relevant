---
id: ADR-0070
title: "Ongoing-story overviews get their own records, written by one lifecycle module; linking is a step after publishing that never stops the chain, one story at a time, oldest first, and switches on only after research passes"
status: accepted
date: 2026-11-18
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, data-model, ai-risk]
tags: ["overviews", "linking", "scheduler", "eval-gate", "migrations"]
---

# ADR-0070 · Ongoing-story overviews get their own records, written by one lifecycle module; linking is a step after publishing that never stops the chain, one story at a time, oldest first, and switches on only after research passes

## Context

Module 2 of story overviews (`.plans/2026-11-18_overviews-linking.md`, approved by the owner on
2026-11-18) files each published story under the ongoing development it reports on and keeps a
timeline per development. The roadmap's own decisions (D2, D3, D6, D7, D8, D10) are the owner's:
cosine proposes and a model confirms, a person steps in but is never needed, two calls agree before
a development starts, reviews only demote, the gate is read on a judged half, and keys carry what is
being done. This record holds the plan's own choices (D-OV1 to D-OV8) on where the records live,
where linking runs and how it stays off; phases 1 and 2 (records, keys, linking) implement them.

## Decision

- **Records of their own (D-OV3, plan "Records"):** four additive tables, `overviews`,
  `overview_entries`, `overview_stands` and `overview_decisions`, not a widening of dedup's
  clusters. A story joins at most one overview (D-OV2), held by the partial unique index
  `overview_entries_one_active`; an overview has at most one current stands version
  (`overview_stands_one_current`). `check:migrations` fails on a drop of either. Every automated or
  editor decision is a row of `overview_decisions` with its inputs, answer, model, prompt version and
  cost. Overviews own no facts and run no search: they cite pool facts.
- **One writer:** `services/overviewLifecycle.ts` is the only code that writes the four tables (a
  fence test holds it). It writes one story's linking in one transaction, re-reading the memberships
  first; a write the index refuses is rolled back and logged as a `conflict`, retried next run.
- **Linking is a step after publishing (D-OV1):** `link_overviews` is the daily edition's last step,
  not part of the research pass, so it needs published stories and never holds the edition. It is
  in `GOES_ON_PAST_FAILURE` (D-OV8): a failed linking night leaves its own Error and notice, the
  chain run succeeds, and story context's after-publish part still runs.
- **Ordered writes (D-OV8):** link calls run three at once, but writes go one story at a time,
  strictly oldest first, every window counted from the story's own date (the candidate overviews'
  entries and last entry too, as they stood on that day); a result made stale by a write of the
  same run (its founding partner joined since) is asked again once, then logged as a conflict. While
  the backfill's backlog is larger than a run's slice, the night's new stories wait in it rather
  than being linked the same night, so a new story never founds a development before the older
  stories of the same development have had their turn. A backfilled development therefore forms in
  date order, as it would have live.
- **A story is settled by its `link` decision:** joined, founded, none or rejected settle it; held
  (a frozen overview), conflict and failed leave it owed for the next run. The job is resumable.
- **Off until two gates open (D-OV7):** `OVERVIEW_EVAL_GATE` (`services/overviewGate.ts`), a code
  constant, refuses enabling while set and while research passes' own gate is closed; enabling is
  also refused while `research_pass` is disabled; the row is seeded disabled; the handler does
  nothing unless both gates are open and the job is enabled. The owner opens the gate in its own
  change once the replay on the judged half meets the bars.
- **Halves by a committed list (D-OV6):** `developmentHalves.ts`, with Ebola judged; answer keys
  gain an optional `responses[]` at `schemaVersion` 2.

## Consequences

- Nothing changes for readers or the edition while the gates are closed: the step is skipped as a
  disabled chain step, and nothing reads the tables yet (phases 4 and 5 add the admin and public
  reads).
- A wrong join's reach is bounded: a join never changes a charter or a title, and every join and
  founding is a decision row an editor (phase 4) can undo.
- The tables are additive; dropping them later loses only overview data. The two partial indexes
  are guarded like `article_versions_one_current`.
- Linking a 6-month backfill takes about 6 nights at `backfillPerRun` 300, after publishing, and new
  stories wait while the backlog drains: for about 6 nights after the switch-on, a night's stories
  get their links a night or more late.

## Alternatives

- **Hang overviews off `story_clusters`** and widen dedup's prompt and window: dedup's clusters are
  same-event groups with one published primary, and widening them would change dedup's behavior.
- **One generic collection model** for developments and module 5's period overviews: speculative
  until module 5's plan knows what a period overview needs; the read model is built over entries and
  stands so a period overview can reuse them.
- **Link inside the research pass, before publishing:** a linking failure would hold the edition,
  and a story's overview needs other published stories.

## Amendment 2026-11-19: one write model, every write a change set Undo inverts

Every write to the four tables, automated or an editor's, is now a plan of row changes made by pure
code (`services/overviewChanges.ts`, `overviewPlans.ts`, `overviewEdits.ts`) and applied by one
applier in one transaction that locks the overview row: the fields that follow the entries (the last
entry, the scope) settled, each change applied only where its row still holds what the plan read,
and the change set kept on the decision. **Undo of any decision is its change set inverted, whole or
not at all**, and what an entry leaving does (a closing on its story cancelled) is one rule every
writer applies. The one writer stays the lifecycle module, now `services/overviewLifecycle.ts` and its
folder `services/overviewLifecycle/`, which the fence test covers. Decision inputs follow one schema
per kind (`overviewDecisions.ts`), and the facts the upkeep and Undo once folded from the log at each
read are columns on `overviews` (migration `20261119041008_overview_state`, additive). The eval's
sandbox applies the same plans to memory, and a db test holds the two alike. Why: the automated writes
and Undo kept separate rules for the same fields, and the sandbox copied the lifecycle's rules and had
drifted from them (the last entry after a detach, the closing story, the burst's start); one model
leaves one place for each rule. Everything else stands as written.

## Amendment 2026-11-20: charters may be re-centered and may name no end event (ADR-0071)

The owner reversed the roadmap's D7 "never widen" for charters on 2026-11-19
(`.plans/2026-11-19_overview-recentering.md`). The consequence above, "a join never changes a
charter or a title", still holds for joins, but a charter is no longer fixed to what founding drew:
a **re-center**, an editor's or (once built) two agreeing automated calls, may rewrite the title, IN
and END_EVENT, held to the overview's anchor and, for automation, to a limit of 2. And a charter may
name no end event, so founding no longer requires one. Both are ADR-0071's; everything else here
stands as written.

## Amendment 2026-11-22: no end-event closing (ADR-0072)

Written down on 2026-11-24; the index named it from 2026-11-22. The 2026-11-19 amendment's "what an
entry leaving does (a closing on its story cancelled) is one rule every writer applies" no longer
holds: an overview closes only by fading or an editor's Close, so there is no closing to cancel. The
cancel rule, the `closing` status, the `close` decision kind and their columns were dropped
(migration `20261122015800_overview_no_end_event_closing`). The one write model and Undo stand as
written.

## Amendment 2026-11-24: founding and the ordered writes (ADR-0075, ADR-0077, ADR-0078, ADR-0079)

Four later decisions change the Decision's linking bullets; the records, the one writer and the
gates stand.

- **Founding** needs more than two agreeing calls (ADR-0075, the owner's rule of 2026-11-23): the
  founding check also judges whether each story reports an occurrence, and only two stories that
  each do found a development.
- **Ordered writes:** a result made stale by a write of the same run is asked again at once, before
  the next story is written, not after the whole run (ADR-0077); stale again, it is a conflict, as
  before. A founding whose partner comes later in the run's order waits for that partner's own
  result and is then asked again once (ADR-0079). A story that points past an established open
  overview (at least 3 active entries) waits for that overview's re-center instead of founding
  (ADR-0078).
- **Settled or owed:** `waiting` joins held, conflict and failed among the outcomes that leave a
  story owed; it is owed with no call while its wait is in force, and is no founding partner
  meanwhile (ADR-0078). A story whose yes to an overview code refused settles `rejected` and
  considers no founding partner (ADR-0077).

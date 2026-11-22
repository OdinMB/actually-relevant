---
plan-id: 2026-11-22_overviews-no-end-event-closing
title: Overviews close only by fading or an editor's Close; a reported end event marks a turning point
status: implemented
created: 2026-11-22
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [architecture, ai-risk]
decisions:
  - ref: .context/decisions/0072-overviews-close-only-by-fading-or-editor.md
type: feature
complexity: complex
---

# Overviews: no formal closing at an end event

Archived on 2026-11-22. ADR-0072 promoted from this plan's stub (`.context/decisions/0072-overviews-close-only-by-fading-or-editor.md`), recording the owner's change of 2026-11-22 too: the closing records are dropped rather than kept empty.

**An AI plan**, written on 2026-11-22 on branch `claude/project-thread-egeer5` from the owner's decisions of 2026-11-22 (points 1 to 5 of the request), then revised after three plan reviews (simplicity, architecture, a cold correctness read). ADR-0072's decision is the owner's: the removal of end-event closing, the END_EVENT kept as a marker, no end quote in linking (the prompt change approved), the reader copy rule and the kept `found` bar. The choices under "Choices this plan makes" are the planner's, and the owner confirms them by approving the plan.

## Problem

An overview whose charter names an END_EVENT closes formally when two large-tier calls agree that a joined story reports it, and linking refuses any yes for such an overview or a founding partner unless the model quotes a shared end on both sides. In the paid linking eval that end-quote rule refused about half of the missed must entries: routine stories (case counts, funding gaps) never say how the development ends, so yeses at 0.9–0.99 were refused with "no end on both sides". The closing path also carries two prompts, a fourth status, a closure review, a cancel rule threaded through every writer, and an eval step whose 14-day bar has no sample in any key.

## Approach

**What changes (owner's decisions, ADR-0072).**

1. **No closing at an end event.** An overview closes only by fading (`quiet` after 21 days, `faded` after 120, a join reopens it) or by an editor's Close. Removed: `services/overviewClose.ts` with its two calls and prompts (`overview-close`, `overview-close-check`); the upkeep's closing part (`closings`, `applyClosing`, `pendingClosings`, `closeCasesOf`, `planClosing`); the `closing` status and its moves (`closing_cancelled`, `cancel_closing`, `end_event` as a reason); the closure review trigger (`closure`); `config.overviews.closingDays` and the `close`/`closeCheck` tiers; the cancel rule `leaving` and `CLOSING_CANCELLED` with every caller (an editor's detach, a review's and a re-center's detaches, the unpublished-member rule, the editor's re-center with a changed END_EVENT, D-RC10); Undo of a `close` decision; the `closure` eval step and its bars. The job keeps its place in `GOES_ON_PAST_FAILURE`; a run has **four parts** now: (1) linking; then the upkeep: (2) the status machine and the burst check, (3) the automated re-centers, the reviews due and the monthly audit, (4) the stands.
2. **The END_EVENT stays a marker.** Foundings and re-centers still name one when concrete (their prompts, checks and `acceptRecenter`'s `end_event` rule unchanged). The link call's `reportsEndEvent` stays and is still recorded on the `link` decision. A joined story that reports the END_EVENT of an overview that names one becomes a turning point on the timeline.
3. **Linking needs no end quote.** For every candidate, overview or founding partner, a yes passes on the cause and the place, each filled on both sides and found in its side's text. Each end quote the model does give must be found in its side's text, or the yes is refused. The link prompt says the end is optional (wording under "Changes").
4. **Reader copy.** A faded overview reads "No new reporting since <last entry day>" (the quiet line); an editor's Close reads "Ended <day>". The methodology's two sentences that describe end-event closing and the shared end are rewritten as drafts, flagged for the owner at runbook step 7 (wording under "Changes").
5. **The `found` step's "wrong end events" bar stays**, since the marker is reader-visible.

**Choices this plan makes (planner's).**

- **The closing records are dropped (the owner's change of 2026-11-22, during the implementation).** The owner replaced the choice below: there is no stored data (the overviews step never ran anywhere, and none of its migrations reached production), so one migration drops the columns `closing_since`, `closing_story_id` (with its foreign key and the `stories` relation) and `closure_reviewed_at`, recreates the `OverviewStatus` enum without `closing` and `OverviewDecisionKind` without `close` (dropping and recreating the partial index `overview_decisions_link_signals` around the change), and marks each destructive statement reviewed; `end_event` was a value of the plain-text `closed_reason`, so only code changes for it. No `///` note is written. The superseded choice, as the plan first had it: ~~**Records stay; no migration.**~~ The `closing` value of the `OverviewStatus` enum, the `close` value of `OverviewDecisionKind` and the columns `closing_since`, `closing_story_id` (with its `stories` relation) and `closure_reviewed_at` stay in the database, empty and unused, with a `///` note in `schema.prisma` naming ADR-0072. Code stops reading and writing them: they leave `OverviewFields`, `OVERVIEW_FIELDS`, `OverviewState` and the TS lists (`OVERVIEW_STATUSES`, `DECISION_KINDS`, `REVIEW_TRIGGERS`). Alternatives: a migration dropping the columns (destructive, needs `-- reviewed-destructive`, gains nothing while nothing writes them) or dropping the enum values (PostgreSQL cannot drop an enum value; the type would be recreated and both columns rewritten). Nothing ever ran in production, so the columns are null there; keeping them is the only additive-safe option and the least risky, and follows the keep-unused-history precedent of ADR-0067's old run tables. A later cleanup can drop them in one migration (Out of Scope). Only `///` comments change in `schema.prisma`, so no `db:generate` is needed. A local or test database that holds `close` decisions or `closing` rows from manual runs keeps them as unreadable history: `oneOf` reads a stray `closing` as `open`, a `close` decision shows its raw kind in the admin log and cannot be undone. That is accepted; `db:restore-snapshot` or a fresh local DB clears it.
- **The turning point's kind is the existing `milestone`** ("a threshold crossed or a formal stage reached"), and only a `routine` answer is promoted: when the model already called the story a turning point, its kind stays (a ceasefire signed may be `deescalation`). Alternative: a new kind `end`, which would touch `ROLE_KINDS`, the link, found, review and re-center schemas, the answer keys' kind list, the role eval, both client label tables and the shared union; `milestone` needs no schema, client or key change. A later review may still relabel the entry: reviews judge roles, and the marker does not lock it.
- **The promotion and the END_EVENT condition live in `linkStory`** (`overviewLink.ts`), beside `roleOf`, not in `planJoin`. Reason: the link eval's `role` bar and the replay score `result.role` (`scripts/eval/overviews/overviewSandbox.ts:187`, `link.ts:194`, `replay.ts:258`), so only a promotion in `linkStory` is scored; `planJoin` writes `result.role` (`overviewPlans.ts:176`) and so gets it too. `linkStory` computes `reportsEndEvent` once, from the joined candidate's charter **as the link call was shown it**, the charter the model's flag refers to (today `planJoin` reads the row's charter at the write, `overviewPlans.ts:160-168`). An editor's re-center that changes the END_EVENT between the call and the write would leave a turning point that the old charter's end marked; that is accepted (an editor sets the role in one click) and documented. `linkRecord`/`linkDecision` lose the positional `endEventNamed` parameter.
- **The `role` bar scores the role readers get**, the model's answer with code's promotion. A wrong `reportsEndEvent` then shows as a role miss, which is what readers would see. `model-eval.md` and runbook step 2 say so.
- **One end-quote rule for every candidate.** The required sides are `cause` and `place` for all; each non-empty end quote is checked on its side (a half-filled end passes when its filled side is found). Today an end quoted on an overview with no END_EVENT is ignored; under the one rule an unfound one refuses. The prompt keeps asking for it empty there, so this only bites a made-up quote. Alternative: keep ignoring it on overviews with none (two rules); rejected, as the owner's point 3 says "for any candidate".
- **Key-draft stops drafting ends.** After the `closure` step goes, nothing reads a key's `closed`: the `found` and `recenter` steps read `charter.endEvent`, and the recenter's end checkpoints are the last must entry's day. So the drafter's `end` half, the key schema's `closed` field (base and centers), its validation and `awaitingReview('closed')` go; the `responses` drafting stays (the stands' "What's being done present" bar). All ten committed keys hold `"closed": null`, so no data is lost.
- **The replay's tail is `config.overviews.quietAfterDays`** (21, the value `closingDays + 14` gave), so the end state still shows the status machine one quiet period past the last story, with the same cost. Alternative: no tail; rejected, since the status machine and reviews after the last story are part of what the replay judges.
- **`closedReason === 'faded'` is the one test for "it faded"** in every new reader site: `statusLine` reads "No new reporting since <last entry>" only for `faded` (with a last entry), and any other closed overview, an editor's Close, reads "Ended <closedAt>"; `lastChange` counts `closedAt` for every closed overview but a faded one (the index shows "last change <day>", which beside "No new reporting since" must not be the fade day). An unknown reason so reads as closed for good, as `takesStories` and `planJoin` already treat it (`closedReason !== 'faded'`, `overviewCandidates.ts:198`, `overviewPlans.ts:165`), whose code stays and whose comments now say "an editor closed it".
- **Status unions derive from `OverviewStatus`** where the plan edits a hand-copied `'open' | 'quiet' | 'closing' | 'closed'` (`overviewViews.ts` filter, `overviewPublic.ts` head) and the admin's filter list from `STATUS_LABELS`, so the next status change is one edit.
- **Admin label:** `NO_END_EVENT` in `overviewLabels.ts` becomes "No end event" (today "No end event: it closes only by fading", which now reads as if others close another way). Admin copy, not reader copy.

**Alternatives for the whole shape, weighed inline.** Keeping the closing path but switching it off by config was rejected: it keeps two prompts, a status and a cancel rule in every writer alive for a behavior the owner removed. The architecture comparison was done inline (step 2's architects not spawned): the owner's decisions fix the design, and the open choices above are local.

**What stays the same.** Fading and reopening, an editor's Close and Reopen (and their Undo), the founding and re-center END_EVENT drafting and checks, the charter limits, reviews (demote-only, brake), bursts, re-centering, the stands, the public rule, the switch layers.

**Prompt versions and evals.** The link prompt and schema change, so `OVERVIEW_PROMPT_VERSIONS.link` changes and the linking eval's cached link calls miss: runbook step 2 (`link,found,role` on the judged half, about $3) is paid again, and step 6 replays on the new prompt. The key-draft prompt loses its end, so its cache misses too (only if key-draft runs again). The implementation makes no paid run; `--dry-run` shows the estimate.

## Changes

### Server: linking

| File | Change |
|---|---|
| `server/src/services/overviewLink.ts` | `acceptLink`/`refusalOf`: one rule for every candidate, required sides `cause` and `place` (the `SIDES`/`NO_END_SIDES` choice by charter goes); each non-empty `end` quote is checked against its side's texts. `linkStory`, joined branch: `reportsEndEvent` = the answer's flag and the shown charter names an END_EVENT; a private `endEventRole(role, reports)` turns `routine` into `{ turning_point, milestone }` when it holds, a turning point unchanged. Doc comments. |
| `server/src/services/overviewPlans.ts` | `linkRecord`/`linkDecision`: drop `endEventNamed` (the flag arrives settled); `planJoin`'s doc comment loses "as its row holds it at the write". Delete `planClosing`. `planStatus`: drop the `cancel_closing` branch. `planReview`: drop the closure trigger's `closingSince` and `closureReviewedAt`, the `left` array, `cancels` and its `status` record. Re-center plan: drop its `left` array and `...leaving(o, left)`. Header and doc comments. |
| `server/src/prompts/overviews.ts` | Delete the closing section (`CloseInput`, `buildClosePrompt`, `CloseCheckInput`, `buildCloseCheckPrompt`) and `close`/`closeCheck` in `OVERVIEW_PROMPT_VERSIONS`. Link rules, exact wording below. Header comment. |
| `server/src/schemas/overviews.ts` | Delete `closeSchema`, `closeCheckSchema` and their types. The link candidate's `end`: `quotePair('how both would end: the same outcome would end the one and the other', ' Optional: fill both sides only when both state it, else leave both empty, and always for an overview whose END_EVENT is none. An empty end never stands in the way of yes.')`. Header comment. |
| `server/src/services/overviewSteps.ts` | Drop the `close` and `closeCheck` steps and `close` in `OverviewCalls`. |
| `server/src/config.ts` | Drop `overviews.closingDays` and the `close`/`closeCheck` tiers (no env override exists). |

**The link prompt's new wording** (`LINK_RULES`; nothing else in it changes):

- `<GOAL>`: "For each candidate in <OVERVIEWS> and in <STORIES>, judge whether the story in <STORY> belongs to the same development, quoting for the shared cause and place the words of each side that state them, and for the shared end too when both sides state one; for each overview, say where the story stands against its charter; and give the story's role in the development it belongs to."
- `<SAME_DEVELOPMENT>`: "Two texts are the same development when both hold:" then the cause and place lines as they are (the place line ends with a period); the line "- the same end: …" and the line "For an overview whose END_EVENT is none, the cause and the place decide: …" are replaced by: "The end does not decide: most developments have no end a report could date. When both sides state how the development would end, quote that shared end too; otherwise leave the end's quotes empty, and always for an overview whose END_EVENT is none." The months-apart line stays.
- The quote bullet (today line 142): its first two sentences as they are; its last sentence becomes "When a side states no cause or no place, that quote is empty and the answer cannot be yes; an empty end never stands in the way of yes."
- The `reportsEndEvent` bullet stays word for word.

### Server: upkeep, status, writes

| File | Change |
|---|---|
| `server/src/services/overviewClose.ts`, `overviewClose.test.ts` | Delete. |
| `server/src/services/overviewUpkeep.ts` | Drop the closing part: `closeOne`, `UpkeepDeps.closings`/`close`/`applyClosing`, the tally's `closingsChecked`/`closingsBegun`, `'closing'` in `UpkeepPart`; parts renumbered in comments. |
| `server/src/services/overviewStatus.ts` | `statusAfter`: drop the `closing` branch; delete `newerThanClosing`, `closingOver`, the `cancel_closing` move, the `end_event`/`closing_cancelled` reasons, `closingDays` in `StatusOptions`; `reviewDue` without `closure`. Comments. |
| `server/src/services/overviewTypes.ts` | `OVERVIEW_STATUSES` without `closing`; `REVIEW_TRIGGERS` without `closure`; delete `ClosingCharter` and `namesEndEvent`; `OverviewState` without `closingSince`, `closingStoryId`, `closureReviewed`; `Membership.closedReason` comment (`faded` or `editor`). |
| `server/src/services/overviewState.ts` | Drop the closing fields from the state it builds. |
| `server/src/services/overviewChanges.ts` | `OverviewFields` without the three closing fields; `OPEN` without them; delete `CLOSING_CANCELLED` and `leaving`; prune the field and never-put-back lists; `'close'` out of `DECISION_KINDS` (it stays in the DB enum). Header comment. |
| `server/src/services/overviewRow.ts` | `OVERVIEW_FIELDS` without the three columns. |
| `server/src/services/overviewCases.ts` | Delete `closeCasesOf`, `CloseRows`, `UNSETTLED_CLOSE_OUTCOMES`; `CaseOverview` and `reviewCaseOf` without `closingStoryId`; header. |
| `server/src/services/overviewUpkeepInput.ts` | Delete `pendingClosings` and its imports; header ("parts 2 to 4"). |
| `server/src/services/overviewReview.ts` | `ReviewCase` without `closingStoryId`; `ReviewResult` without `cancelsClosing`. |
| `server/src/services/overviewDecisions.ts` | Delete `closeInputs` and its `kind === 'close'` mapping, `REPORTS_END_EVENT`, `statusInputs.by`; `reviewInputs` without `closingSince`; `linkInputs` comment (the flag marks a turning point; nothing reads it in SQL). |
| `server/src/services/overviewEdits.ts` | Editor's detach without `leaving`; `editorRecenter` returns `Change[]` without the closing cancel (D-RC10 superseded) and `planEdit` calls `decide('recentered', null, editorRecenter(o, action, ctx))`; `AUTOMATED` without `close`; `what()` without the closing words; comments. |
| `server/src/services/overviewLifecycle.ts`, `overviewLifecycle/upkeep.ts` | Delete `applyClosing` and its export. |
| `server/src/services/overviewCandidates.ts` | `takesStories` unchanged; comment: a closed overview takes no story unless it faded (an editor closed it). |
| `server/src/services/overviewViews.ts` | `STATUS_KINDS` without `close`; detail select without `closingSince`; the filter's status typed `OverviewStatus`; each Prisma status read the shared types receive (the list, detail and story-block reads) narrowed with `oneOf(…, OVERVIEW_STATUSES, 'open')`. |
| `server/src/services/overviewPublic.ts` | The head's `status` typed `OverviewStatus` and narrowed in `head()` with `oneOf`; `closedReason` comment; `lastChange` counts `closedAt` unless `closedReason === 'faded'`. |
| `server/src/services/overviewRecenter.ts` | Comments only ("never starts a closing" goes). |
| `server/src/jobs/linkOverviews.ts` | Drop `closings`, `close`, `applyClosing` from the deps; the summary's "N closing"; the upkeep-failing notice's kinds without end-event checks; header comment (four parts). |
| `server/prisma/schema.prisma`, a new migration | The owner's change of 2026-11-22: `closing` out of `OverviewStatus`, `close` out of `OverviewDecisionKind`, the columns `closing_since`, `closing_story_id` (and `Story.closingOverviews`) and `closure_reviewed_at` dropped; `closedReason` "faded or editor". The migration authored with `db:migrate:create`, each destructive statement marked `-- reviewed-destructive`. (First planned: `///` notes only, no migration.) |

### Eval (`server/src/scripts/eval/`)

| File | Change |
|---|---|
| `options.ts`, `overviews.ts` | `closure` out of `OVERVIEW_STEPS` and `CALLING_STEPS`; delete `REPLAY_STEPS` and use `runs('replay')` at its two uses; usage text; the replay's console lines print its link bars in place of the closure bars; key-draft's "and the end" goes. |
| `overviews/replay.ts` | `TAIL_DAYS = config.overviews.quietAfterDays` with its reason; drop closure detection, `closures`, the `closed` part of `lastDay`; refuse on `awaitingReview(keys, 'centers')` only; header. |
| `overviews/replayScore.ts`, `upkeepReport.ts`, `report.ts` | Delete `Closure`, `ClosureRunScore`, `scoreClosures`, `CLOSED_*`, `dayAfter`, `closure`/`closureRuns` in the score and their report rows; `replayLines` loses its `steps` parameter; the section heading; the key table's "Closed" column; the refusal text. |
| `overviews/upkeepSandbox.ts`, `overviewSandbox.ts`, `upkeepCalls.ts` | Drop `closings`, `applyClosing`, the `close` calls, the closing safeguards (`close` outcomes, `closing_cancelled`). |
| `overviews/keySchema.ts`, `keyDraft.ts`, `keyDraftReport.ts`, `prompts.ts`, `keyCheck.ts` | Delete the key's `closed` (base and centers), its validation and `'closed'` in `unreviewed`/`awaitingReview`; the drafter's `end` (schema, the GOAL's second half, the `<END_EVENT>` block and its rule, `CheckedDraft.closed`/`noEnd`, `isDay`); key-check's end quote and summary column. |
| `overviews/keys/*.json` (10 files) | Delete the `"closed": null` line. |
| `overviews/review.ts`, `recenter.ts` | Drop `closingStoryId` from hand-built cases. |

### Client and shared

| File | Change |
|---|---|
| `client/src/components/overview/overviewCopy.ts` | `statusLine`: closed with `closedReason === 'faded'` and a last entry → "No new reporting since <lastEntryAt>"; any other closed → "Ended <closedAt>"; `Pick` adds `closedReason`; comment. |
| `client/src/components/overview/OngoingStoriesMethod.tsx` | Drafts for the owner (runbook step 7). Lines 22–23: "…for a shared cause and place, and code finds each quote in their text." Lines 32–33: "…and an editor can undo it. When three weeks pass without a new story, the page shows the date of the last one, and a new story that belongs picks the development up again." The END_EVENT drafting sentence stays. |
| `client/src/components/admin/overviewLabels.ts` | `NO_END_EVENT` "No end event"; `STATUS_LABELS` without `closing`; `close` out of the decision kind labels and `STATUS_KINDS`; comments. |
| `client/src/components/admin/OverviewCharter.tsx`, `OverviewCharterForm.tsx`, `OverviewDecisionLog.tsx`, `client/src/pages/admin/OverviewsPage.tsx` | Drop `CLOSED_REASONS.end_event`, the "Closing since" row, the form's closing note, `UNDO_WHAT.close`; the filter's status list from `STATUS_LABELS`' keys. |
| `client/src/lib/structured-data.ts` | Comment at line 133 ("or its closing came"). |
| `shared/types/index.ts` | `PublicOverviewStatus` and `OverviewStatus` without `closing`; `AdminOverviewDetail` without `closingSince`; comments on `closedReason`, `lastChange`, `statusHistory`, the decision kinds, `OverviewCharter.endEvent`. |

### Docs and decisions

| File | Change |
|---|---|
| `.context/decisions/0072-…md`, `.context/decisions.md` | ADR-0072 via `ashoka-engineering:adr` (deciders: the owner for the decision, the planner for the choices above); the index lines of ADR-0070 and ADR-0071 get "amended 2026-11-22 by ADR-0072" (0070's one write model no longer has a closing to cancel; 0071's D-RC10 and "the end-event closing passes it by"), the files themselves untouched, as the log's earlier amendments did. |
| `.context/overviews.md` | Every section that names closing: "What is built" (part numbers), Records (the unused columns and enum values, ADR-0072), Writes (no `leaving` rule), candidates (an editor-closed overview), steps 2–3 (end optional; the flag follows the charter the call was shown and makes a turning point), "Status, closing and reviews" → "Status and reviews" with an "End events" paragraph in place of the closing bullet, reviews due, The job (four parts, notices, summary), Undo, Re-centering (D-RC10, D-RC12, `closing` among the editor's states), Admin, Switching on (key-draft drafts responses only; the `closure` row and its cost go; step 2: the link prompt changed after the paid run), Evals (the role bar scores the promoted role), Files. |
| `.context/ai-transparency.md` | The overviews row: the end-event closing and its two calls leave the inventory and the models list; one sentence that code marks a story reporting the END_EVENT as a turning point. |
| `.context/model-eval.md` | The `closure` step, its bars and safeguards, key-draft's ends, the commands and the gate block (as of 2026-11-22 at lines 162, 183–197, 286, 292, 297, 302, 323, 330–331, 350, 355); the `role` bar scores the role with code's promotion. |
| `.context/prompting.md` | The closing call out of the cache note (line 32) and the eval table (line 49). |
| `.context/admin-notices.md` (line 45), `.context/scheduler.md` (line 75), `.context/public-website.md` (line 79), `.context/admin-dashboard.md` (line 70) | The upkeep-failing notice's items without end-event checks; the job's parts; the status line rule; the "No end event" box label. |
| `CLAUDE.md` | The `overviews.md` row: no end-event closing; the job's four parts. |
| `.plans/2026-11-19_overviews-eval-runbook.md`, `.plans/2026-11-19_overviews-key-review.md` | Table row 1 and step 1 draft responses only; step 2 notes the link prompt changed after the paid run, so it is paid again, and that the role bar includes code's promotion; step 6 `--steps pass-pool,replay`, its closing bar and the closing parts of "Rests on" and "Fails" go; step 7 lists the changed reader wording (the two methodology drafts and the faded status line) for approval; the key-review plan's ends section goes. |

## Tests

Logic tests to add or rewrite (patterns of `overviewLink.test.ts`, `overviewStatus.test.ts`, `overviewCopy.test.ts` and the public reads' tests):

- `acceptLink`: a yes with cause and place on both sides and an empty end passes for an overview naming an END_EVENT and for a founding partner; an end quote not found on its side refuses; a half-filled end whose filled side is found passes; an overview with no END_EVENT and an unfound end quote refuses.
- `linkStory`: a join flagged `reportsEndEvent` on an overview naming one turns a `routine` answer into `turning_point`/`milestone` and records the flag; a turning point keeps its kind; on an overview naming none the flag is false and the role unchanged (this replaces `overviewPlans.test.ts`'s "planJoin drops the flag" case and `overviewLifecycle.db.test.ts`'s per-charter flag case).
- `statusLine`: editor-closed reads "Ended …"; faded reads "No new reporting since <last entry>" (`overviewCopy.test.ts`'s closed fixture gains `closedReason`; its `closing` case goes).
- `lastChange`: a faded overview's is its last entry or stands, not `closedAt`; an editor-closed one's includes `closedAt`.
- `upkeepSteps.test.ts`: "a closing begun, cancelled by the review" becomes review plus stands only.
- Removed or trimmed with the code: `overviewClose.test.ts`; the closing cases in `overviewStatus`, `overviewCases`, `overviewPlans`, `overviewUpkeep` (+ db), `overviewEdits` (+ db), `overviewChanges`, `overviewLifecycle.db`, `overviewState`, `overviewRow`, `overviewReview`, `overviewRecenter`, `overviewNight` (`closings` dep), `overviewSteps` (`calls.close`), `linkOverviews` (+ db), `prompts/overviews.test.ts`; the eval's closure and key-end tests (`upkeepScore`, `upkeepRuns`, `options`, `keys`, `keyDraft`, `keyCheck`, `report`) and the `imports.test.ts` allowlist entry for `overviewClose.js`; fixtures lose `closed: null`, `closingStoryId` (`test/db/overviewFixtures.ts` too), `closingSince` (`OverviewDetailPage.test.tsx`), `closureReviewed`, `cancelsClosing`; `end_event` fixtures (`overviewCandidates.test.ts`, `overviewLink.test.ts`) become `editor`.

No tests for the prompt wording, the copy strings or the admin labels.

## Out of Scope

- ~~Dropping the unused columns and enum values (a later migration, if ever wanted).~~ In scope since the owner's change of 2026-11-22 (Approach, "The closing records are dropped").
- The review prompt's "the same end" criterion and any prompt beyond the link prompt and key-draft's end.
- Showing the END_EVENT marker to editors beyond the entry's turning-point role, or locking the promoted role against a review's relabel.
- Any paid eval run; the owner reruns runbook steps 2 and 6.

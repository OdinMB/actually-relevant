---
status: draft
type: feature
complexity: complex
---

# Re-centering ongoing-story overviews

**An AI plan.** An AI planner wrote it on 2026-11-19 on branch `claude/project-thread-egeer5` (at 4a940ec), from Odin's request of the same day. The same day it was revised after a cold review, after Odin's answers ("For Odin", all decided 2026-11-19), and after his decision on cumulative drift (D-RC14, decided 2026-11-19). It has no handbook header, because `ashoka-engineering:plan-decisions` was not loaded for the planner. Decisions are recorded in the format of `.plans/2026-11-18_overviews-linking.md`: D-RC1 to D-RC14 in "Decisions in this plan", with their alternatives in `## Approach`. The For Odin answers and D-RC14's two guards are Odin's. Every other choice is the planner's, and Odin confirms them through plan approval.

The request reverses two rules: "narrow the charter, never widen it" (`.plans/2026-11-18_overviews-linking.md`, "Reviews"; `allowedActions` in `services/overviewReview.ts`) and "A review only demotes" (`.context/overviews.md`, "Reviews"). Both come from the roadmap's **D7** ("Automatic corrections only remove or downgrade … never add", `.plans/2026-11-16_story-overviews.md`). D7 is Odin's own decision, and this request amends it. Odin's answer to For Odin 2 also amends founding: an end event is no longer required (D-RC13). The BACKLOG entry he mentions is not on this branch yet, so his messages are the spec.

## Problem

A development's center can move while it runs, but today an overview's charter can only shrink. Take the Colorado River key: it is centered on the rules fight, but the broader story is the water shortage. Under that center, the renegotiation and Interior's Lake Powell hydropower intervention are responses to the shortage. Today the link step turns such stories away, a review can only add to OUT, and an editor can retitle but cannot rewrite IN or END_EVENT. So an overview stays drawn around the two stories that founded it.

## Approach

### The shape: a re-center is its own charter write, beside founding and the editor's actions

A **re-center** rewrites an overview's IN, END_EVENT (which may now be none) and title in one decision, and may add OUT entries. It has two writers:

- **Automation**, through a new pure module `services/overviewRecenter.ts`, built like founding: a draft call and a blind check call that must agree, with code rules on top.
- **An editor**, through a new admin action.

Both are change sets in the one write model (ADR-0070's amendment), so Undo applies whole or not at all, as today.

The review call keeps its job and its prompt rules. It judges entries against the charter in force, may still add to OUT and retitle, and `allowedActions` still refuses a rewritten IN or END_EVENT in a review answer. Widening has one way in, the re-center.

What starts an automated re-center is **what incoming stories say**, not time. The link confirmation, which already reads every story beside each candidate overview, also records whether the story belongs to the same broader development but outside the charter's IN, and whether it reports that the development's center itself has moved (point 1).

Each re-center is judged against the charter before it, so a chain of them could wander or widen without bound. Two guards stop that (D-RC14, Odin's):

- an **anchor**: every re-center must still cover the founding stories and most turning points;
- a **limit**: two applied automated re-centers per overview, then only an editor can re-center.

**Alternatives weighed (planner, architecture comparison done inline):**

- **Let the review's answer rewrite the charter.** Rejected:
  - it puts two opposite jobs in one prompt;
  - every review would carry the turned-away stories;
  - it fires on the review's own triggers, not on evidence.
- **A charter history table.** Rejected: the decision log's change sets already hold every earlier charter, which the admin's history and Undo need. Only the eval keys need dated charters (point 6).
- **Chosen:** a separate step, signaled by the link call, with four additive columns, two decision kinds and one index.

### 1. The signal, and what guards a re-center

**The signal comes from the link call.** `overview-link` gains two fields per candidate overview:

- **`scope`**:
  - `inside`: the story is what IN covers, the same as `belongs: yes`;
  - `wider`: the story is part of the same broader development but outside IN. Examples: the water shortage the rules fight responds to, or a response to the development that IN leaves out;
  - `unrelated`: a neighbor that only shares place, vocabulary or theme. Colorado's near misses on Western drought, the Sacramento aquifer and the marine heatwave are `unrelated`.
- **`centerMoved`** (boolean): the story itself reports that this development has become part of, or a response to, a larger development, so that a reader would now name it differently.

Each of `wider` and `centerMoved` must quote the story's words that show it. Code finds the quote in the story's title, label or summary with `normalizeQuote`, as for the shared fields; a flag without a found quote does not count. A flag counts only from a story that is active in no overview after its link (a story that joined X and is wider for Y is the merge question, module 7). A story that joins may still carry `centerMoved` for the overview it joins.

The accepted flags go into the `link` decision's inputs (`linkInputs.signals: [{ overviewId, kind: 'wider' | 'center_moved', quote }]`), under a GIN index.

**An attempt fires** when an overview has either:

- at least `recenterWiderSignal` (2) `wider` flags, or
- one `centerMoved` flag,

**from stories linked after its last attempt** (`recenter_tried_at`). That is the only guard against repeats. After a refused or kept attempt, nothing is tried again until a new signal story arrives; then it is weighed with the earlier ones still within the 90 days (D-RC3). There is no calendar spacing and no window on the count.

The fixed limits are the case filter:

- the overview is `ongoing`, `open` or `quiet`, and not frozen;
- it has fewer than `maxAutomatedRecenters` (2) applied automated re-centers (`automated_recenters`, D-RC14);
- no editor's or Undo's re-center within `editorRecenterLockDays` (180). Odin asked for that lock in his request (point 2), and it is the one time-based rule left.

A `failed` or `stale` attempt leaves `recenter_tried_at` unchanged, so the same signal fires again the next run.

**Why the link call and not a separate check (D-RC3).** The weighed alternative was a new small-tier call, run only on stories that were shown an overview and turned away.

- It costs about the same in production.
- It needs its own eval.
- It reads the same story and charter the link call has just read.

The link call already makes that comparison, so asking it costs a few output tokens a candidate. Its risk is to linking's ≥97% precision bar; a `wider` answer gives the model a place to put "related, not IN" other than `yes`, which should help it rather than hurt it. Its cost is a link-eval run:

- **no paid run of `link`, `found` and `role` has been made yet** (`.context/overviews.md`, "Evals"), so landing this before the gate's run costs nothing extra;
- if Odin's session has paid for one meanwhile, the re-run is about $3.

The link prompt is cached, and its version changes.

**Which stories a re-center may take in** (For Odin 3, decided: the last 90 days). The pure function `turnedAway` in `overviewRecenter.ts` runs over rows that production's SELECT and the sandbox both supply. It takes published stories whose publication date is within 90 days before the development clock `clock`, that are active in no overview, and that either:

- carry an accepted `wider` or `centerMoved` flag for this overview; or
- were detached from it by a review without a lock.

The draft sees at most `maxRecenterStories` (10), newest first.

**The two calls** (large tier, cache off, as founding):

1. **`overview-recenter` (draft).** It sees the title and charter, the active published entries (title, label, summary, day, role, and whether each is an **anchor**, below), and those stories with their flags' quotes. It answers either `keep`, or a new title, IN, END_EVENT (or none, point 3) and OUT additions, judging each entry and story under the new charter and giving a role to each story that joins.
   - Its rules say the new charter must still cover the anchor entries: a center may move outward from where the development began, never away from it.
2. **`overview-recenter-check` (blind).** It sees the proposed charter (with the old OUT plus additions), the same entries and stories (without the anchor marks, so its judgment of them is independent), and the IN of each **neighboring open overview**: those `groupCandidates` returns at `clock` for the 3 newest entries and the stories, excluding this one. It never sees the draft's reasons or the old IN. It judges each entry and story, whether a named END_EVENT is concrete and observable, and whether the new IN covers a neighbor.

**Code accepts (`acceptRecenter`)** only when all of these hold:

- the draft proposes;
- a named END_EVENT is judged concrete. An empty one is allowed (point 3), but a vague named one is refused;
- **the old OUT list is kept whole**, within `maxOutEntries` and `maxOutChars`, with no `locked_out` entry re-added (D-RC2);
- **the anchor holds** (D-RC14, below);
- at least `recenterKeepShare` (0.75) of active published entries are judged to belong by both calls; locked entries count and are never detached;
- at least `recenterMinJoins` (2) of the stories are judged to belong by both calls;
- no neighbor is covered (merging stays module 7's);
- the detach brake (`braked`) holds on the planned detaches. It is checked explicitly, because with many locked entries the 0.75 share does not imply it.

**Outcomes**, each one `recenter` decision:

| Outcome | When | What it writes |
|---|---|---|
| `recentered` | every rule holds | point 4's changes, `automated_recenters` + 1, `recenter_tried_at` = now |
| `kept` | the draft says keep | `recenter_tried_at` only |
| `refused` | a rule fails; the rule is named (`anchor` among them) | `recenter_tried_at` only |
| `failed` | a call gave nothing | nothing, retried next run |
| `stale` | rows or stories changed during the calls | nothing, retried next run |

### Cumulative drift: the anchor and the limit (D-RC14, decided by Odin 2026-11-19)

Each re-center is judged only against the charter just before it. Three steps of "a little wider" could therefore carry an Ebola-in-Ituri overview to "health crises in Central Africa". Two guards hold the chain to where the development began.

**1. The anchor: every re-center must still cover the founding stories and most turning points.**

`anchorOf(rows)`, pure, in `overviewRecenter.ts`, picks the **anchor entries** among the active entries of published stories:

- **the founding entries:** the entries made by the overview's `found` decision (`decision_id` equal to it);
- **the turning points:** the entries with role `turning_point`.

The code check (`anchorHolds`, part of `acceptRecenter`) passes only when:

- **every** founding anchor entry is judged to belong by **both** calls;
- at least `anchorTurningShare` (2/3) of the turning-point anchor entries, rounded up, are judged to belong by both calls. "Most" is a fixed share, so one or two misreads do not block every re-center of a long overview. 2/3 of 3 turning points is 2.

A failure is `refused` with rule `anchor`, naming the entries that failed. No anchor entry is ever detached by a re-center, so a re-center can keep its anchor only by covering it, never by shedding it.

**A founding entry that is gone.** A founding entry that was detached (by a review, an editor or an Undo) or whose story is no longer published is not part of the anchor. Its removal already said it does not belong, and an unpublished story cannot be judged. The anchor then rests on what remains:

- the founding entries still active, plus the turning-point rule;
- when **no** founding entry remains, the **2 oldest active entries** stand in for them, so the anchor always holds the development's start;
- when there are **fewer than 3 turning points**, all of them must pass (2/3 rounded up of 1 or 2 is all).

An overview with no active entry is never a re-center case (it is `single`).

Odin's alternative, both calls judging every founding and turning-point entry with no share for turning points, was weighed. It was rejected for turning points, because a long overview's one misread turning point would block every later re-center. It is kept as stated for the founding entries.

**The editor may override the anchor, with a warning.** An editor's re-center makes no model call, so nothing can judge coverage for it. The form instead shows the anchor entries (founding stories first, then turning points) under the heading "This overview's anchor: a new charter should still cover these stories". Saving needs a confirmation box: "The new charter still covers them, or I mean to move the anchor". The server records the confirmation in the `editor_recenter` decision (`inputs.anchorConfirmed`) but does not judge coverage.

The queued review then reads every entry under the new charter, demote-only and with the brake, so an editor's re-center that left founding stories behind gets them detached by review evidence, not silently. The alternative, binding the editor to the anchor, would need a model call on an editor's action and would block the person D3 lets step in.

**2. The limit: after 2 applied automated re-centers, only an editor can re-center.**

- **The count** is a new column, `automated_recenters` (integer, default 0), raised by 1 in an applied automated re-center's change set.
- **Undone ones do not count.** The column is in the change set and not one-way, so Undo of a re-center puts the count back, and an undo of that undo raises it again. A `kept`, `refused`, `failed` or `stale` attempt never counts.
- **An editor's re-center neither raises nor resets it.** The count is lifetime: an overview that automation has moved twice stays in a person's hands, whoever moved it since.
- **At the limit,** the case filter skips the overview. Signals are still recorded on link decisions, so the admin shows that stories are pointing past the charter.
- **The admin page** shows "Automatic re-centers: 1 of 2" beside the charter. At 2 it reads "Automatic re-centers: 2 of 2: only an editor can re-center it now", with the count of `wider` and `centerMoved` signals since the last re-center.

### 2. The editor's re-center

- **The action.** `PUT /api/admin/overviews/:id/charter` takes `{ title, in, out[], endEvent: string | null, anchorConfirmed: boolean }`. `planEdit` handles it as `recenter`, logged as `editor_recenter`. On the admin page, the "Edit charter" form has:
  - title, IN and OUT lines;
  - END_EVENT, with a box, **"No end event: it closes only by fading"**, which empties and disables the field;
  - the anchor list and its confirmation box (D-RC14).

  The page also shows a charter history from the re-center decisions and the automatic re-center count.
- **What only an editor may do:**
  - drop OUT entries;
  - re-add a locked-out entry, which takes it out of `locked_out`;
  - re-center a forming, quiet, closing or frozen overview;
  - re-center past the limit;
  - move the anchor (with the confirmation).

  It is refused on a closed overview ("reopen it first"), when nothing changed, without `anchorConfirmed` ("Confirm the anchor first"), and past the limits: title of 1 to `maxTitleChars` characters, non-empty IN, a named END_EVENT not blank, and the OUT caps.
- **A closing is cancelled when END_EVENT changes**, including to none (D-RC10). The closure review never re-judges the end event, and `pendingClosings` never re-judges a judged pair, so a closing begun on the old event would close on it. The overview goes back to `open`, and `closing_since`, `closing_story_id` and `closure_reviewed_at` are cleared. This is logged as an `open` status decision with reason `recentered`, as `leaving` does. The rejected alternative was re-running the closing check against the new end event: one more call and state for a rare case.
- **The queued review.** `reviewDue` gives a new trigger, `recenter`, while `recentered_by` is `editor` and `recentered_at` is later than `reviewed_at`. Its priority is after `report` and before `entries`. A frozen overview gets it once unfrozen; a single overview never gets one. It is demote-only, with the brake, and never touches locked entries. An Undo's lock (`recentered_by` `undo`) queues none.
- **The lock.** No automated re-center for 180 days after an editor's or an Undo's (D-RC7). The review's OUT additions and retitles carry on.
- **The title's provenance in the AI marker (D-RC11).** The public marker names `charter_model` as the title's model. An editor's re-center leaves `charter_model` and `charter_prompt_version` as they are, as an editor's retitle does today, so an editor-written title stays marked AI-written (the cautious side). An automated re-center writes its draft's model. Both fields join `OverviewFields`, so Undo restores them. `.context/ai-transparency.md` (row 17) says so.
- **Undo** inverts the change set whole, including `recentered_at` and `recentered_by`, which lifts the lock. It is refused when anything it changed has changed since, including the queued review's OUT addition or retitle ("Undo the review first").

**Undo of an automated re-center:**

- charter, title and model fields go back;
- joined stories are detached;
- detached entries are restored;
- `automated_recenters` goes back down by 1;
- as `stamped` does for other automated decisions, moved entries are locked;
- OUT additions are locked out (`recenterInputs.outAdded`, read by `planUndo` as it reads a review's narrowing);
- `recentered_at` is set to now and `recentered_by` to `undo`.

`recentered_at`, `recentered_by`, `automated_recenters`, `charter_model` and `charter_prompt_version` are restored by Undo. `recenter_tried_at` is one-way (`ONE_WAY`), so a later attempt never blocks an Undo. Both new dates join `DATE_FIELDS`.

### 3. A charter may have no end event (For Odin 2, decided: such overviews close by fading)

Odin, 2026-11-19: "I would expect most overviews never to be clearly over but instead to fade. Would be similar for condition-shaped stories." So **END_EVENT is optional in every charter: founding's, a re-center's and an editor's** (D-RC13).

Founding is settled the same way, because his answer is about overviews generally and not only re-centered ones. It is not a separate question for him: a rule that only re-centers may drop the end event would make the founding draft invent end events that his answer says most developments lack.

- **Records and types.** `Charter.endEvent` becomes `string | null`, and the charter Zod schemas in `overviewDecisions.ts` and `overviewInput.ts` read `z.string().nullable()`. Stored charters keep their strings, so no data migration is needed. The model-facing schemas (found, re-center) keep a string, where empty means none, as founding's draft already does ("Leave it empty only when no such event can be named"). Code normalizes an empty string to null.
- **Prompts.**
  - **Founding draft:** "Name the end event only when the development has one a report could date: a declaration, a signature, a ruling. Most do not; then leave it empty, and the development ends by fading." It no longer says the development is then not started.
  - **Founding check:** it judges `endEventConcrete` only when one is named, and answers `none` otherwise.
  - **Re-center prompts:** they follow the same rule.
  - **`charterBlock`** renders a missing end event as `END_EVENT: none (this development ends when reporting stops)` for the link, review and closing prompts.
  - **Review:** it copies a missing end event as none.
  - These are prompt-version changes to found, found-check, link (already changing) and review. Review's rules are otherwise untouched.
- **Code rules.**
  - `acceptFounding` no longer refuses a draft with no end event; it still refuses a named one the check calls not concrete.
  - The link step's quote sides are the title and IN when there is no end event.
  - A `reportsEndEvent` flag on an overview with no end event is ignored, so it never starts a closing.
  - Re-center joins never start a closing (D-RC12).
- **Closing and the status machine.** Nothing new is built:
  - an overview with no end event never enters `closing`;
  - it goes quiet after 21 days and closes `faded` after 120 quiet days, reopening on a join, as today;
  - a re-center to "no end event" on a closing overview cancels the closing (point 2);
  - one that names an end event on a faded overview changes nothing until a story reports it.
- **The `closure` bars.**
  - An overview with no end event cannot close at an end event, so it is never premature. It is counted under a new report line, "developments with no end event", given per run.
  - For "closed within 14 days", a development whose key end our stories report but whose overview has no end event counts as **not closed in time**. That makes the bar stay honest about what fading misses. (None of the nine keys has such an end today.)
  - Fading itself is not evaluated: the replay's tail is `closingDays + 14` and fading needs 120 quiet days. It stays code with tests.
- **The `found` bar** "the key's end event for every development" becomes: **no wrong end event**, judged only where one is named (the strong judge, `buildEndEventJudgePrompt`). Developments founded with none are counted and listed for the owner. The keys all name an end event, so a founding with none is no error.
- **The key schema.** `charter.endEvent` becomes nullable for a center's charter, and for the base too. It is an additive widening: no key file changes, so Odin's `responses[]` edits do not conflict.

### 4. What happens to entries after a re-center

- **Re-check.** An unlocked entry both calls reject is detached (`detached_by` `recenter`, reason `recenter`). Its link decision stays live. An entry only one call rejects stays. Anchor entries are never detached: a re-center that would detach one fails the anchor first.
- **Retroactive joins** (For Odin 3, decided). The point 1 stories both calls accept join in the same decision:
  - A story a review detached **reuses its row** (as an editor's attach does): active, the draft's role, unlocked, and its old judgment record kept.
  - Any other story gets a **new row**: `joined_by` `recenter`; `shared` and `confidence` null; `model` and `prompt_version` from the draft; `decision_id` the re-center.
  - Their link decisions stay live, so each story stays settled. This reverses D7's "never add" for this one logged, undoable, two-call path. Reviews still never add.
- **What the link step then sees:** the new charter and the 5 newest entries, joined stories among them. Their flags count only toward a later attempt.
- **Fields that follow:**
  - scope and last entry are settled as for any write;
  - a removing detach empties the link caches (`removesLink`);
  - `joins_counted_from` is untouched, because the burst count counts only `pipeline` joins;
  - **the slug never changes** (D-RC8).
- **Concurrency.** `recenterStale`, under the overview lock, compares the case with the rows: title, charter, scope, status, frozen, `locked_out`, `automated_recenters`, and the active published entries with their locks. It also re-reads the memberships of the stories to join; one now active elsewhere makes the attempt stale. If the one-active-entry index still refuses a join, the transaction rolls back and a `stale` decision is written in its own transaction. Nothing is dropped silently.

### 5. "Where this stands" and "What's being done" under the charter in force

- **Production.** The stands signature (`standsSignature` and `standsCases`' SQL marker) gains the **title**, which the stands prompt reads. A re-center or a retitle therefore forces a fresh write, never seeded from the old version. The charter is not added, because the stands prompt never reads it.
- **The stands prompt is unchanged.** If the eval shows responses missed under a moved center, adding IN to its input is the first lever (re-running the stands bars costs about $1–1.50).
- **The eval.** At each checkpoint, `stands` uses the key's center in force that day: its title, its members (base must entries plus that center's entries published by then) and its responses.

### 6. Evals (For Odin 4, decided: planted cases plus the real Colorado center)

**Key schema, additive.** A new optional top-level `centers[]`, valid at any `schemaVersion`. Each center has:

- `from`, `title`, `charter` (`endEvent` may be null; `out` keeps every base OUT entry) and `why`;
- `entries[]` (the entry schema): stories that belong only under this center, at any date;
- `nearMisses[]`, `responses[]`, `closed` and `reviewed`.

`validateKey` adds:

- centers in date order, each `from` after the first base entry;
- center entries are neither base entries nor the center's own near misses (a base near miss may become a center entry);
- the base OUT is kept;
- center responses are validated by the center's rules at any version;
- a center's `closed.slug` is an entry;
- at most 2 centers, matching the limit.

The `keys` step checks center slugs, dates and quotes against the database. `awaitingReview('centers')` makes `recenter`, `link`, `stands`, `closure` and `replay` refuse a half holding an unreviewed center.

**The Colorado center is Odin's to draft from his database copy**, the only place the story texts are (`.context/model-eval.md`, "key-draft"). It is "Colorado River water shortage":

- its `from` is the first shortage story he finds, which must come after 2026-08-18 (Colorado's end checkpoint) or the checkpoints collide;
- its entries are the shortage stories (the hydropower intervention among them);
- its near misses are drought stories outside the basin;
- its end event may be none.

If the archive holds fewer than 3 center entries on or after `from`, the real case is too thin to build (a re-center needs 2 joins and the signal), and the step reports it as not run. The planted cases still stand. The center keeps Colorado's founding stories (its first two entries) and turning points inside its IN, as the anchor requires.

**Planted positives** (`recenterPlants.ts`, eval code, no key edits). For each judged development there is a hand-written narrowed charter: a plausible early, too-narrow center (for example, Ebola as "the Bunia vaccination campaign"). Each case is built at the development's two-thirds checkpoint:

- the members are the must entries the plant lists, its first two marked as founding entries;
- the stories are the other must entries of the 90 days before, plus that period's near misses;
- the expected outcome is a re-center to the key's charter, joining must entries and no near miss.

**One planted anchor breach** (D-RC14, cheap). It is the Colorado key at its two-thirds checkpoint:

- **members:** its must entries;
- **stories offered:** the "fossil firms tied to half of Western water losses" and "Sacramento Valley sinks" near misses, plus two general-drought near misses. The only charter that takes them all in ("Western US water loss") leaves the rules fight behind;
- **expected outcome:** not re-centered (`kept`, or `refused` with rule `anchor` or `out`). The report says which rule held.

It runs 3 times.

**The link step measures the new flags.** Its replay adds Colorado's center entries and near misses, read only while that center is reviewed. It reports:

- `wider` or `centerMoved` on Colorado's center entries beside the Colorado overview (the recall of the signal; for the owner);
- the share of base near misses flagged `wider` (no bar; it sets how often attempts fire, and so their cost);
- `centerMoved` on stories of developments whose key has no center (false shift signals; for the owner).

Linking's existing bars skip center entries as `optional`. `keyIndex` gives base entries precedence.

**New step `recenter`** (`recenter.ts`, `recenterScore.ts`) runs production's `recenterOverview` directly, bypassing the signal:

| Case | Runs | Expected |
|---|---|---|
| Planted narrowed charter, per judged development (5) | 3 | re-centered, must entries joined, no near miss joined, the anchor held |
| Colorado's real center (1), on the day its third center entry on or after `from` is published | 3 | re-centered to the key's center |
| Planted anchor breach (1, Colorado) | 3 | not re-centered |
| Each judged development at its end checkpoint (Colorado's taken before `from`), its near misses as the stories (5) | 1 | not re-centered |

| Bar | Target | Rests on |
|---|---|---|
| Re-centered where expected | ≥80% | 18 judgments: for the owner, under 20 |
| A named END_EVENT matching the expected center's | every one | strong judge; none named is counted, not wrong |
| False re-centers, the anchor breach included | none | count, any sample |
| Near misses joined | none | count, any sample |
| An applied re-center whose anchor entries a call judged not to belong | none | count; code makes it impossible, kept as a regression check |

**`replay`** adds Colorado's center stories and runs the whole module, the signal included. It reports:

- the day of each re-center against the key's `from`;
- re-centers per overview (never more than 2 automated, a count);
- false re-centers and near misses joined (counts: none);
- splits: an overview founded by two center entries of one key, counted for the owner and not as a right founding;
- attempts, by what fired them;
- refusals by rule, `anchor` and `limit` among them.

Checkpoints after `from` judge members against the center in force. `checkpointsOf` keeps using base must entries, so no checkpoint moves. `checkpointStories` picks the newest 3 among base and in-force center entries, which adds at most 3 first passes for Colorado.

**Eval cost** (desk figures at the ledger's prices; the runbook is about $15 today; a re-center attempt is about $0.05–0.08 a call, so $0.10–0.16 when the check runs):

| Item | Added |
|---|---|
| `link`, `found`, `role` with the changed link, found and found-check prompts | none if their gate run is still to come, as the docs say; about $3 if one was paid meanwhile |
| Colorado's center stories in linking's 3 runs (small tier) | under $0.05 |
| `recenter`: 5 planted × 3 runs, both calls | about $1.50–2.40 |
| `recenter`: Colorado × 3 runs, both calls | about $0.30–0.50 |
| `recenter`: anchor breach × 3 runs, mostly the draft alone | about $0.20–0.40 |
| `recenter`: 5 negatives × 1 run, mostly the draft alone | about $0.30–0.50 |
| End-event judge on positives | about $0.10 |
| `replay`: signal-driven attempts, one run (a few on Colorado and wherever near misses are flagged `wider`) | about $0.20–0.60 |
| `pass-pool` up to 3 Colorado center stories, and the stands rewrite | about $0.25–0.55 |
| **Total** | **about $2.90–5.10, so the runbook goes from about $15 to about $18–20 (about $21–23 if linking's run was already paid)** |

`recenter` runs in the review folder (`--budget` from 2 to 6). The upkeep folder's $18 cap holds.

**Production cost:**

- The link call's new fields add a few output tokens per candidate, under $0.05 a month.
- Attempts now depend on what stories say, not on time. Each `centerMoved` story, or each second `wider` story since the last attempt, buys one at $0.10–0.16. At an assumed 1–6 a month, that is about $0.10–1 a month.
- The real rate is the link eval's `wider` share of near misses times the stories turned away: 270 stories a month at about 1–2 candidates each.
- The limit caps applied re-centers at 2 per overview, not attempts. Attempts stop once an overview reaches the limit.
- An editor's re-center adds one review, about $0.04.
- The module stays within its $4–8 a month.

### Records (additive migration `<ts>_overview_recenter`)

- `OverviewDecisionKind` gains `recenter` and `editor_recenter`.
- `overviews` gains:
  - `recentered_at` (timestamp, null);
  - `recentered_by` (text, null: `recenter`, `editor` or `undo`);
  - `recenter_tried_at` (timestamp, null: signals after it count);
  - `automated_recenters` (integer, default 0: applied automated re-centers, not undone).
- A GIN index `jsonb_path_ops` on `overview_decisions ((inputs -> 'signals')) WHERE kind = 'link'`.
- No drop.
- `joined_by` and `detached_by` are text.
- `REVIEW_TRIGGERS` gains `recenter`.
- A charter's `endEvent` may be null in the jsonb; existing rows keep strings.

### The job's summary and notices

The summary adds ", 1 re-centered". An applied automated re-center raises an admin notice (`overview-recentered:<id>`, old and new title, and "1 of 2" or "2 of 2: only an editor can re-center it now"), because it changes what readers see with no person. A re-center attempt is an upkeep item, counted as failed only when a call gave nothing.

### Phases, each shippable switched off

1. **Records and rules, no model:**
   - the migration;
   - `Charter.endEvent` nullable across types, schemas, `charterBlock`, the link quote sides and the closing flag rule;
   - `acceptFounding` without a required end event;
   - `recenterInputs`;
   - the new fields in `OverviewFields` (with `charterModel`, `charterPromptVersion` and `automatedRecenters`), `ONE_WAY` and `DATE_FIELDS`, `overviewStateOf`, `overviewStates` and the sandbox;
   - the `recenter` trigger;
   - the title in the stands signature;
   - Undo's stamp.
2. **Prompts and the signal:**
   - the link schema's `scope`, `centerMoved` and quote, and `acceptLink` keeping accepted signals in `linkInputs.signals`;
   - the founding draft, founding check and review prompts on a missing end event.

   These are prompt-version changes for the coming linking gate run.
3. **The editor's re-center:**
   - `planEdit` `recenter`, with the closing cancel and the anchor confirmation;
   - the route, the form (with "No end event" and the anchor list), the history and the count;
   - the queued review;
   - the docs, `ai-transparency.md` included.
4. **Automated re-center:**
   - `overviewRecenter.ts` (with `anchorOf` and `anchorHolds`);
   - its two prompts and schemas, declared in `overviewSteps.ts`, with a `recenter` member on `OverviewCalls`;
   - `recenterCases` (the index, the limit, neighbors through `groupCandidates`);
   - `planRecenter`, `recenterStale` and `applyRecenter`;
   - part 4, the tally, the summary and the notice;
   - the sandbox, and the job-against-sandbox db test with a scripted re-center.
5. **Evals:**
   - `centers[]` and the nullable end event in the key schema;
   - `recenterPlants.ts`, with the anchor breach;
   - the link step's signal report;
   - the `recenter` step;
   - the replay's bars, splits and per-overview count;
   - the stands' center in force;
   - `checkpointStories`;
   - the `found` and `closure` bars on a missing end event;
   - the runbook and gate table;
   - Odin's Colorado center, once he has drafted and reviewed it.

### Decisions in this plan

- **D-RC1:** widening has one way in, the re-center: two agreeing calls plus code rules. The review call stays demote-only. This amends D7 (Odin's).
- **D-RC2:** an automated re-center keeps the old OUT list whole; only an editor drops an entry or re-admits a locked-out one.
- **D-RC3:** the trigger is content-driven. The link call flags `wider` and `centerMoved` with a quote, and an attempt fires on 2 `wider` flags or 1 `centerMoved` since the last attempt. That is the only repeat guard; there is no calendar spacing. The alternative, a separate small-tier check on turned-away stories, was rejected in its favor (point 1).
- **D-RC4:** 75% of entries kept by both calls, at least 2 joins, no neighbor covered (neighbors from `groupCandidates`), and the detach brake checked explicitly.
- **D-RC5:** superseded by D-RC13.
- **D-RC6:** retroactive joins of the 90-day flagged or review-detached stories (For Odin 3, Odin's); detach only when both calls reject; a review-detached row is reused.
- **D-RC7:** an editor's re-center locks automation out for 180 days and queues a review (priority after `report`). Undo of an automated re-center locks it out the same way, without a review. Alternatives: 90 days (a seasonal story could flip back against the editor), no expiry (a later real shift would wait for a person).
- **D-RC8:** the slug never changes.
- **D-RC9:** keys gain additive `centers[]`. Planted narrowed charters plus Odin's Colorado center are the positives (For Odin 4, Odin's). Linking's bars skip center entries. A separate `recenter` step holds the bars.
- **D-RC10:** a change of END_EVENT, to none included, cancels a closing.
- **D-RC11:** an editor's re-center keeps the AI marker's model fields, as a retitle does; an automated one writes its own; Undo restores both.
- **D-RC12:** re-center joins never start a closing.
- **D-RC13:** END_EVENT is optional in every charter, founding's included. An overview with none closes only by fading (For Odin 2, Odin's; founding settled the same way by the planner, from his reasoning).
- **D-RC14, decided by Odin 2026-11-19: two guards against cumulative drift.** The guards are his; the details below are the planner's, following the coordinator's suggestions.
  - **The anchor:** every re-center must still cover the overview's founding stories and most of its turning points. Code checks it on both calls' judgments:
    - every active founding entry must pass;
    - at least 2/3 of turning points, rounded up, must pass;
    - detached or unpublished founding entries leave the anchor;
    - with none left, the 2 oldest active entries stand in;
    - anchor entries are never detached by a re-center.

    An editor may override the anchor, with the anchor list shown in the form and a required confirmation.
  - **The limit:** after 2 applied automated re-centers per overview, only an editor can re-center it. Undone ones do not count (Undo puts the count back). An editor's re-center neither raises nor resets it: it is a lifetime count. The admin page shows it.

They become one ADR, "Overviews may be re-centered, within an anchor and a limit, and a charter may have no end event", when the first code lands, in a session where the `adr` skill loads. It amends ADR-0070's consequence "a join never changes a charter", and the founding rule in `.context/overviews.md` ("an end event, which must be named").

## Changes

| File | Change |
|------|--------|
| `server/prisma/schema.prisma`, `server/prisma/migrations/<ts>_overview_recenter/migration.sql` | Decision kinds, four columns, the GIN index on `inputs -> 'signals'`; any generated `DROP INDEX "story_embeddings_embedding_idx"` deleted |
| `server/src/config.ts` (`overviews`) | `recenterWiderSignal` 2, `recenterLookbackDays` 90, `editorRecenterLockDays` 180, `maxRecenterStories` 10, `recenterKeepShare` 0.75, `recenterMinJoins` 2, `anchorTurningShare` 2/3, `maxAutomatedRecenters` 2; the two calls' tier (large). Code constants |
| `server/src/services/overviewTypes.ts`, `shared/types` | `Charter.endEvent: string \| null`; `REVIEW_TRIGGERS` gains `recenter`; decision kinds and admin labels |
| `server/src/services/overviewDecisions.ts`, `overviewInput.ts` | Nullable `endEvent` in the charter schemas; `linkInputs.signals`; `closeInputs.endEvent` stays a string (closing runs only with one); `recenterInputs` (with the anchor's verdicts) and `editor_recenter`'s `anchorConfirmed`, with their `storedChanges` |
| `server/src/schemas/overviews.ts`, `server/src/prompts/overviews.ts` | Link schema: per candidate `scope`, `centerMoved` and `signalQuote`; found and found-check schemas take an empty end event and answer `none` for its concreteness; `charterBlock` renders a missing end event; the founding draft, founding check, link and review prompts on it; new `buildRecenterPrompt` (anchor marks and the rule to cover them) and `buildRecenterCheckPrompt` (no anchor marks; cache off, versioned) and their schemas |
| `server/src/services/overviewLink.ts` | `acceptLink` keeps accepted signals (quote found, story active nowhere after its link) for the decision; `overviewTexts` without a missing end event; `acceptFounding` and its draft check allow none and refuse only a named end event judged not concrete |
| `server/src/services/overviewPlans.ts` | The link decision's `signals`; the `reportsEndEvent` flag ignored on an overview with no end event; new `planRecenter(rows, case, result, ctx)` per outcome, raising `automatedRecenters` on `recentered` |
| `server/src/services/overviewRecenter.ts` | New. *Responsibility:* one overview's re-center: whether its signal fires, the stories it may take in, the anchor, the draft, the blind check, the acceptance rules and the staleness test. Pure. *Exports:* `signalFires`, `turnedAway`, `anchorOf`, `recenterOverview`, `acceptRecenter`, `recenterStale` |
| `server/src/services/overviewSteps.ts` | `recenter` and `recenterCheck` in `OVERVIEW_STEPS`; a `recenter` member on `OverviewCalls` |
| `server/src/services/overviewUpkeepInput.ts` | `recenterCases(clock, now)` (SELECT only): overviews under the limit with signals after `recenter_tried_at` (through the index), their entries with the founding decision's mark, the rows for `turnedAway`, and neighbors through `nearestPublished` and `groupCandidates`. `overviewStates` reads the new columns. `standsCases`' marker gains the title |
| `server/src/services/overviewStatus.ts` (`reviewDue`), `overviewState.ts` | The `recenter` trigger; the new columns in the state |
| `server/src/services/overviewChanges.ts` | `OverviewFields` gains `recenteredAt`, `recenteredBy`, `recenterTriedAt`, `automatedRecenters`, `charterModel`, `charterPromptVersion`; `ONE_WAY` gains `recenterTriedAt`; `DATE_FIELDS` gains both dates; `DECISION_KINDS` gains the two kinds |
| `server/src/services/overviewEdits.ts` | `EditorAction` `recenter` (end event nullable, `anchorConfirmed`); `planEdit` validates it, refuses without the confirmation, cancels a closing on a changed END_EVENT, handles locked-out entries, and leaves `automatedRecenters` alone; `AUTOMATED` gains `recenter: ['recentered']`; `stamped` sets `recentered_by` `undo`; `planUndo` reads `outAdded`; `what()` names the new fields |
| `server/src/services/overviewUpkeep.ts` (`runUpkeep`) | Part 4 starts with the re-center cases; an overview re-centered in the run skips its review that run; tally `recentered`, `recenterAttempts` |
| `server/src/services/overviewLifecycle.ts`, `overviewLifecycle/upkeep.ts` | `applyRecenter`: lock, `recenterStale`, apply, a `stale` decision after an index refusal, link caches emptied on a removing detach. No new file in the fenced folder |
| `server/src/services/overviewStands.ts` | The title in `standsSignature` |
| `server/src/jobs/linkOverviews.ts` | Production deps, the summary, the `overview-recentered` notice with the count |
| `server/src/routes/admin/overviews.ts` | `PUT /:id/charter` (`failsWith()`) |
| `server/src/services/overviewViews.ts` (`adminOverview`, `storyOverview`) | The charter history and attempts, the automatic re-center count and the signals since the last re-center, the anchor entries; the story block shows a link decision's signals |
| `client/src/pages/admin/OverviewDetailPage.tsx`, `client/src/components/admin/OverviewCharterForm.tsx` (new), `overviewLabels.ts`, `hooks/useOverviews.ts`, `StoryOverview.tsx` | The form with "No end event: it closes only by fading", the anchor list and its confirmation, the history, "Automatic re-centers: N of 2", the signal labels. New file: *Responsibility:* the charter form, its limits and the anchor confirmation. *Exports:* `OverviewCharterForm` |
| `client/src/components/overview/OngoingStoriesMethod.tsx` | The draft methodology copy: a development may be re-centered when new stories show its center moved, at most twice by AI and always still covering where it began, and most end when reporting stops rather than at a named event (copy for Odin, "Switching on" step 3) |
| `server/src/scripts/eval/overviews/keySchema.ts`, `keyCheck.ts` | `centers[]` (at most 2), nullable `endEvent`, the center rules, `awaitingReview('centers')`, the database checks |
| `server/src/scripts/eval/overviews/recenterPlants.ts` | New, eval only. *Responsibility:* each judged development's hand-written narrowed charter and its member slugs (founding marked), and the Colorado anchor-breach case. *Exports:* `RECENTER_PLANTS`, `ANCHOR_BREACH` |
| `server/src/scripts/eval/overviews/recenter.ts`, `recenterScore.ts` | New step and its pure score. *Responsibility:* build planted, real, anchor-breach and negative cases, run production's re-center, score the bars. *Exports:* `runRecenterStep`, `recenterStepCases`; `scoreRecenters` |
| `server/src/scripts/eval/overviews/link.ts`, `linkScore.ts`, `linkReport.ts` | Center stories replayed; base precedence and center entries `optional`; the signal report; `found`'s "no wrong end event", with nones listed |
| `server/src/scripts/eval/overviews/replay.ts`, `replayScore.ts`, `upkeepSandbox.ts`, `overviewSandbox.ts`, `stands.ts`, `passPool.ts` (`checkpointStories`) | Re-centers in the replay, splits, re-centers per overview, the closure line for no end event, the sandbox's rows and `applyRecenter`, the stands' center in force |
| `server/src/scripts/eval/options.ts`, `overviews.ts`, `upkeepCalls.ts`, `upkeepReport.ts`, `imports.test.ts` | The step's name and order, its calls, its report section, the import guard over `overviewRecenter.ts` |
| `.context/overviews.md`, `model-eval.md`, `admin-dashboard.md`, `ai-transparency.md`, `prompting.md` (the changed prompts), `CLAUDE.md` (the overviews row), `decisions.md` plus the ADR | "How a story is linked" (the signal, founding without a required end event), "Status, closing and reviews" (no end event, fading), "Reviews" pointing to a new "Re-centering" section (with the anchor and the limit), the gate table and costs |

## Tests

- **`acceptLink` signals:** a `wider` or `centerMoved` flag counts only with its quote found in the story and the story active nowhere after its link. `centerMoved` on the joined overview counts; `scope: inside` adds nothing.
- **`signalFires`:**
  - 2 `wider` flags, or 1 `centerMoved`, after `recenter_tried_at` fire;
  - flags before it do not;
  - after a `kept` or `refused` attempt, nothing fires until a new flag arrives;
  - after `failed` or `stale`, the same signal fires again.
- **`turnedAway`:**
  - flagged and unlocked review-detached stories within 90 days by publication date;
  - excludes stories active anywhere and editor-detached ones;
  - gives the same result from production's rows and the sandbox's.
- **Case filter:**
  - frozen, closing, closed, forming and single overviews are skipped;
  - the editor's and Undo's locks hold;
  - an overview at 2 automated re-centers is skipped.
- **`anchorOf` and the anchor rule:**
  - founding entries come from the `found` decision;
  - a detached or unpublished founding entry leaves the anchor;
  - with no founding entry left, the 2 oldest active entries stand in;
  - every founding entry must pass both calls;
  - 2/3 of turning points, rounded up, must pass: 3 of 4, 2 of 3, all of 1 or 2;
  - a failure is `refused` with rule `anchor`, naming the entries;
  - an anchor entry is never planned for detach.
- **`acceptRecenter`:**
  - refused on:
    - a named but not concrete end event;
    - a dropped OUT entry;
    - a re-added locked-out entry;
    - a failed anchor;
    - less than 75% of entries kept;
    - fewer than 2 joins;
    - a covered neighbor;
    - a tripped brake when many entries are locked;
  - accepts an empty end event;
  - joins only stories both calls accept;
  - keeps an entry only one call rejects;
  - counts a locked entry in the share and never detaches it.
- **`recenterStale`:** stale on any of the compared fields (`automated_recenters` included), or a story to join now active elsewhere; an index refusal is written as `stale` and retried.
- **`planRecenter`:**
  - `recentered` raises `automated_recenters` by 1;
  - reuses a review-detached row, with its record;
  - fills a new row's fields;
  - `kept` and `refused` write only `recenter_tried_at`;
  - the re-center's joins are absent from the burst count.
- **Upkeep:** an overview re-centered in a run is not reviewed that run.
- **No end event:**
  - a founding with none is founded;
  - one with a named end event the check finds vague is refused;
  - a `reportsEndEvent` flag on such an overview starts no closing;
  - the link quote sides leave it out;
  - the status machine fades it at 120 days and reopens it on a join;
  - old charters with strings parse.
- **`reviewDue`:**
  - gives `recenter` after `report` and before `entries`;
  - gives none while frozen, then gives it once unfrozen;
  - gives none for an Undo's lock.
- **The editor's action:**
  - refused when closed, unchanged, past the limits, or without `anchorConfirmed`;
  - allowed past the automated limit;
  - may drop OUT entries, re-admit locked-out ones, and set no end event;
  - a changed END_EVENT, to none included, cancels a closing and logs it;
  - an IN-only change does not;
  - the model fields and `automated_recenters` are untouched.
- **Undo:**
  - an editor's re-center is undone whole and its lock lifted;
  - it is refused after its queued review narrowed or retitled;
  - an automated one is undone whole: joins detached and locked, detaches restored and locked, OUT additions locked out, `recentered_by` `undo`, model fields back, `automated_recenters` down by 1, so an overview at 2 is under the limit again;
  - an undo of that undo raises the count again;
  - an Undo still applies after a later attempt.
- **Stands:** a retitle or re-center changes the signature and the SQL marker.
- **db tests:**
  - the job-against-sandbox run with a scripted re-center leaves the same rows and change sets;
  - `recenterCases` finds signals through the index and skips an overview at the limit.
- **Client:**
  - the charter form shows the anchor entries and needs the confirmation;
  - it allows "No end event" and refuses an empty IN and the limits;
  - it sends the whole charter.
- **Evals:**
  - `validateKey`'s center rules (at most 2) and the nullable end event;
  - `awaitingReview('centers')`;
  - `keyIndex` precedence;
  - the signal report's counts;
  - a split counted;
  - `found`'s "no wrong end event", with a none counted and not wrong;
  - `closure` counting a development with no end event as never premature and, where its key end is reported, not closed in time;
  - `checkpointStories` with and without a center;
  - `recenterScore` on hand-made results, the anchor breach scored as a false re-center when applied;
  - the planted case builder, with founding marks.

## Out of Scope

- **Merging overviews** (module 7). A shortage overview founded separately beside Colorado stays separate, and a story in another overview raises no signal.
- **Slug changes or redirects.**
- **A charter history table.**
- **The stands prompt reading the charter**, unless the eval shows a need.
- **Re-centering a forming overview automatically.**
- **The review call widening anything.**
- **Evaluating fading** (120 quiet days) in the replay; it stays code with tests.
- **A model check of an editor's re-center against the anchor**: the editor overrides it with a confirmation, and the queued review reads the entries.

## For Odin

All four questions were answered on 2026-11-19, and D-RC14's two guards were decided by Odin on 2026-11-19. Nothing is left open for him. Founding's end event was settled from his answer to question 2 (D-RC13).

1. **What starts an automated re-center?** **Decided 2026-11-19: what incoming stories say, not time passed.** Odin rejected the three time-based options: "How often a story center can shift shouldn't depend on time passed, but on the nature of the stories that are added." The plan now triggers on the link call's `wider` and `centerMoved` flags (D-RC3).
2. **How does a condition-shaped center end?** **Decided 2026-11-19: it may have no end event, and then closes by fading after 120 quiet days.** Odin: "I would expect most overviews never to be clearly over but instead to fade. Would be similar for condition-shaped stories." This applies to every charter, founding's included (D-RC13).
3. **Which past stories join when it re-centers?** **Decided 2026-11-19: those turned away in the last 90 days** (the recommendation), when both calls accept them (D-RC6).
4. **What should prove that re-centering works?** **Decided 2026-11-19: the planted cases plus the real Colorado center**, which Odin drafts from his database copy and reviews (the recommendation; D-RC9).
5. **How is cumulative drift guarded?** **Decided 2026-11-19: an anchor and a limit** (D-RC14). Every re-center must still cover the founding stories and most turning points. After 2 applied automated re-centers, only an editor can re-center.

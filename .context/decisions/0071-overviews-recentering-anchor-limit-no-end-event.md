---
id: ADR-0071
title: "Overviews may be re-centered, within an anchor and a limit, and a charter may have no end event"
status: accepted
date: 2026-11-20
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, data-model, ai-risk]
tags: ["overviews", "re-centering", "charter", "undo", "migrations"]
---

# ADR-0071 · Overviews may be re-centered, within an anchor and a limit, and a charter may have no end event

## Context

An overview's charter is drawn from the two stories that founded it, and until now it could only
shrink: a join never changed a charter (ADR-0070, "Consequences"), a review could only add to OUT,
and an editor could retitle but not rewrite IN or END_EVENT. Both rules came from the roadmap's
**D7**, the owner's: "Automatic corrections only remove or downgrade … never add"
(`.plans/2026-11-16_story-overviews.md`), which the linking plan applied to charters as "narrow the
charter, never widen it" (`.plans/2026-11-18_overviews-linking.md`, "Reviews"). A development's
center moves while it runs, though (the Colorado River key: the rules fight inside a water
shortage), and an overview held to its founding pair turns its later stories away.

**On 2026-11-19 the owner reversed D7's "never widen" for charters** and approved the plan
`.plans/2026-11-19_overview-recentering.md` (D-RC1 to D-RC14). His answers settled three points
this record holds: the trigger is what incoming stories say, not time passed (For Odin 1, D-RC3);
an end event is optional, since "I would expect most overviews never to be clearly over but instead
to fade" (For Odin 2, D-RC13); and two guards against cumulative drift, an anchor and a limit
(D-RC14). The plan's other choices are the planner's, which the owner confirmed by approving it.
The records, the charter with no end event (prompts included), the anchor and limit rules and the
editor's re-center land with this record; the automated re-center, its link signal and its evals
come later (plan phases 2 to 5).

## Decision

- **D7's "never widen" is reversed for charters, by two paths only (D-RC1).** A **re-center**
  rewrites an overview's title, IN and END_EVENT in one decision and may add OUT entries. Its
  writers are an editor (`editor_recenter`, `PUT /api/admin/overviews/:id/charter`) and, once built,
  automation: two agreeing large-tier calls with code rules on top, fired by the link call's `wider`
  and `centerMoved` flags (D-RC3). **Reviews stay demote-only**, and a join still never changes a
  charter. Both paths are change sets in ADR-0070's one write model, so Undo applies whole or not at
  all.
- **A charter may name no end event (D-RC13),** founding's included: `Charter.endEvent` is nullable
  (older rows keep their strings), the founding draft names one only when a report could date it,
  the founding check judges it only when named, and the prompts show a missing one as
  `none (this development ends when reporting stops)`. An overview with none closes only by fading;
  the end-event closing passes it by.
- **The anchor (D-RC14):** a re-center must still cover the entries the founding created that are
  still active and published (with none left, the 2 oldest active entries stand in) and at least
  2/3 of the other turning points, rounded up, each judged to belong by both calls; anchor entries
  are never detached by a re-center. An editor may move the anchor, with the anchor listed in the
  form and a confirmation the server records but does not judge.
- **The limit (D-RC14):** after 2 applied automated re-centers, only an editor re-centers the
  overview (`automated_recenters`, put back by Undo; an editor's re-center neither raises nor resets
  it).
- **An editor's re-center** may drop OUT entries, re-admit a locked-out one, and work on a forming,
  quiet, closing or frozen overview and past the limit; it is refused on a closed one. It locks
  automation out for 180 days and queues a review of every entry under the new charter (D-RC7). A
  changed END_EVENT, to none included, cancels a closing (D-RC10). It keeps the AI marker's model
  fields, so an editor-written title stays marked AI-written (D-RC11).
- **Undo of an automated re-center** makes what it restores the editor's, as for other automated
  decisions: moved entries locked, OUT additions locked out, the count put back, and the same
  180-day lock without a review.
- **Records:** migration `20261120000620_overview_recenter`, additive: the decision kinds
  `recenter` and `editor_recenter`; on `overviews`, `recentered_at`, `recentered_by`,
  `recenter_tried_at` (one-way for Undo) and `automated_recenters`; and a GIN index on `link`
  decisions' `inputs -> 'signals'` for the automated trigger.

## Consequences

- What an overview covers can now move in production, which D7 had ruled out. The anchor and the
  limit bound how far automation can carry it from where the development began, and every move is
  one logged, undoable decision. An editor can move it anywhere, with the queued review reading
  every entry under the new charter, so stories left behind are detached on review evidence rather
  than silently.
- A founding no longer fails for want of an end event, so developments that fade (most, by the
  owner's reading) are founded; the `found` eval's bar counts an end event wrong only where a
  founding names one.
- The prompt versions of the link, founding, founding check and review calls change, so the linking
  eval's cached calls are made again.
- Nothing changes for readers or the edition while `link_overviews` is switched off.

## Alternatives

- **Keep "never widen"** and leave a moved development to a new overview: the old one stays drawn
  around its first two stories and turns its later stories away (the plan's "Problem").
- **Let reviews widen:** reviews fire on their own triggers, not on evidence that the center moved,
  and a demote-only review is what keeps a misreading review from growing an overview.
- **A time-based trigger** for automated re-centers: rejected by the owner (For Odin 1), since how
  often a center can shift depends on the stories added, not on time passed.
- **Bind the editor to the anchor:** it would need a model call on an editor's action and would
  block the person D3 lets step in; the confirmation and the queued review take its place.
- **Require an end event** and let founding refuse a development without one: most developments
  have none, so the draft would invent end events.

## Amendment 2026-11-20: the Undo's lock in a column of its own

A review of the branch found that the lock written into `recentered_at` and `recentered_by` (`undo`,
now) blocked the next Undo down a chain: after an Undo of a later automated re-center, an Undo of
the one before it, or of an editor's re-center before it, was refused, since that decision's change
set names those two fields as it left them. The Undo's lock now has its own column,
`recenter_undone_at` (migration `20261120130000_overview_recenter_undo_lock`, additive), and an Undo
puts `recentered_at` and `recentered_by` back to the re-center before.

Rule: an Undo of an automated re-center keeps automation off the overview for 180 days, as before,
and the re-centers under it can be undone newest first; the lock holds after an editor's re-center
in force or after an Undo, whichever is later, and an undo of that Undo lifts its own.

Consequences: `recentered_by` is only `recenter` or `editor`; the admin names whose lock holds
(`lockedBy`). Nothing in production holds overview rows yet, so no data moves.

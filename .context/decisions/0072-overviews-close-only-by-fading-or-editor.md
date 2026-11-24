---
id: ADR-0072
title: "Overviews close only by fading or an editor's Close, and a story reporting the END_EVENT becomes a turning point"
status: accepted
date: 2026-11-22
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["overviews", "closing", "linking", "migrations"]
---

# ADR-0072 · Overviews close only by fading or an editor's Close, and a story reporting the END_EVENT becomes a turning point

## Context

An overview whose charter named an END_EVENT closed formally when two large-tier calls agreed that a
joined story reported it (`overview-close`, `overview-close-check`): the overview moved to a
`closing` status, a closure review ran after `closingDays`, and the next run closed it with reason
`end_event`. A cancel rule (`leaving`) ran through every writer, so a closing ended when its story
left by an editor's detach, a review, a re-center or an unpublishing, and an editor's re-center with
a changed END_EVENT cancelled it too (ADR-0071, D-RC10). Linking refused any yes for an overview
naming an END_EVENT, or for a founding partner, unless the model quoted a shared end on both sides.

In the paid linking eval on the judged half (runbook step 2), that end-quote rule refused about half
of the missed must entries: routine stories (case counts, funding gaps) never say how the
development ends, so yeses at 0.9 to 0.99 were refused with "no end on both sides". The closure
eval's "closed within 14 days" bar had no sample in any answer key, since none of the judged
developments has ended in our stories. The overviews step had never run anywhere: none of its
migrations had reached production, and the local and test databases held no rows of its records.

## Decision

An overview closes only by fading (`quiet` after 21 days without a new story, closed as `faded`
after 120, reopened by a join) or by an editor's Close. The end-event closing is removed whole: the
two calls and their prompts, the `closing` status, the `close` decision kind, the `end_event` closed
reason, the closure review trigger, the cancel rule and every caller of it, `closingDays` and the
two tiers, Undo of a `close` decision, and the `closure` eval step and its bars. The records only it
used are dropped in one migration (the columns `closing_since`, `closing_story_id` and
`closure_reviewed_at`; the enum values `closing` and `close`), since they held no data. The END_EVENT
stays a charter field and becomes a marker: foundings and re-centers still name one when concrete,
the link call's `reportsEndEvent` stays and is recorded on the `link` decision, and a story joined
to an overview whose charter, as the link call was shown it, names an END_EVENT that the story
reports becomes a turning point (`milestone` when the model called it routine; a turning point keeps
its kind). Linking needs no end quote: for every candidate a yes passes on the cause and the place,
each filled on both sides and found in its side's text, and each end quote the model does give must
be found on its side, or the yes is refused. A faded overview reads "No new reporting since <its
last story's day>" to readers, an editor's Close "Ended <day>". The founding eval's "no wrong end
event" bar stays, since the marker is visible to readers.

## Consequences

- Linking no longer refuses a story for leaving the end unstated, which was about half of the
  misses measured; whether the bars now hold is the next paid run's to show. The link prompt and
  schema changed, so their prompt version changed and the cached linking eval misses: runbook step 2
  (about $3) and the replay are paid again.
- Two prompts, a status, a review trigger, a decision kind and a cancel rule threaded through every
  writer are gone; the status machine has one way in and one way out of `closed` that automation
  takes.
- A development that does end at a datable event (a ceasefire signed, an outbreak declared over)
  stays "Ongoing" until three weeks pass without a story, unless an editor closes it. Readers learn
  that it ended only from the turning point on its timeline.
- The marker's turning point is code's promotion of the model's flag, and a later review may still
  relabel it; a wrong `reportsEndEvent` now shows to readers as a wrong turning point, and the
  linking eval's `role` bar counts it that way.
- An end quote the model makes up now refuses a yes on an overview that names no END_EVENT, where
  before it was ignored.
- The migration drops columns and recreates two enum types (with the partial GIN index on link
  decisions' signals dropped and created again around the change); it is safe only because no row
  of these tables exists anywhere.
- Revisit if the owner or readers need an ended state for developments that end at a datable event,
  or if an eval shows the promotion marking routine stories as turning points often.

## Alternatives considered

- **Keep the end-event closing, switched off by configuration** — it would keep two prompts, a
  status and a cancel rule alive in every writer for a behavior the owner removed.
- **Keep the closing records in the schema, empty and unused** — the plan's first choice, as the
  additive-safe option; replaced by the owner's decision of 2026-11-22 to drop them, since there was
  no data to keep.
- **A new role kind `end` for the marker** — it would touch the role lists, five schemas, the answer
  keys, the role eval and both clients' label tables; `milestone` ("a threshold crossed or a formal
  stage reached") fits.
- **Require the end quote only where the overview names an END_EVENT, as before** — that is the rule
  that refused about half of the missed stories.
- **Ignore an end quote on an overview with no END_EVENT** — two rules for one field; the owner asked
  for one rule for every candidate.

## Amendment 2026-11-23: an end quote not found drops the end (ADR-0077)

The Decision's "each end quote the model does give must be found on its side, or the yes is refused"
and the consequence "An end quote the model makes up now refuses a yes on an overview that names no
END_EVENT" no longer hold. Since 2026-11-23 an end quote that is not found is cleared from the stored
judgment and its end-event flag is not counted, and the yes passes on the cause and the place, still
one rule for every candidate. Quotes are found exactly or by a near match that allows only letters
dropped from long words. The marker, the closing rules and the dropped records stand.

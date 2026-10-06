---
id: ADR-0008
title: Pause interactive episodes for review through a per-row mode, a selected stage and explicit admin rewinds
status: accepted
date: 2026-10-06
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: ["ai-risk", "cost"]
---

# ADR-0008 · Pause interactive episodes for review through a per-row mode, a selected stage and explicit admin rewinds

## Context

After producing a 6:04 episode end to end in production (plan
`.plans/autonomous-two-speaker-podcast.md`, phases 1 and 2), the owner asked on 2026-10-06 that
"Start this week's episode" no longer run the whole process at once. The episode screen was to
offer an interactive mode, where a person can change things after each step (choose the stories,
edit the script), and a fully automated mode, which is what already ran. The weekly cron job, still
to come in phase 4, has to keep producing an episode without anyone present.

The stage machine of ADR-0003 ran `created → scripted → voiced → ready` and selected the stories
inside the script stage, so there was no point at which a person could see the selection before
the script was written. It only ever moved forward; the one way back was a reset to `created`.
Voicing spends ElevenLabs credits against a monthly cap, so a re-voice after a person's change has
a cost the person should see first.

## Decision

The `Podcast` row gains a `mode` (`automated` or `interactive`, null until a person or the cron
chooses) and the stage list gains `selected` between `created` and `scripted`: selection writes the
story snapshot, `storyIds` and `storiesSelectedAt`, and the script stage reads the snapshot.
`advanceEpisode` re-reads the row after every stage and stops when the mode is `interactive` and the
stage is `selected` or `scripted`; `voiced` never stops and `ready` ends production in both modes.
Whether an episode awaits review is derived (interactive, at rest, no error, not blocked, at a
review stop), never stored. A person changes an episode only at rest and under its lease: the
stories at `selected`, the turn text and summary at `scripted` (speakers and structure fixed), the
title and an "edited by a person" flag. Going back is `rewindEpisode(id, to)`, an explicit admin
action to `created`, `selected` or `scripted`, which clears that stage's successors' output (to
`scripted` with a fresh TTS seed, so a regenerated take differs); no pipeline step ever moves a
stage backwards. A person's rewind makes the episode interactive. The cron runs automated and skips
an interactive episode.

## Consequences

A person can steer each episode step by step, or not at all, and the machine keeps one stage per
production step: every "is it at least scripted" check reads one value, and a resume after a
failure or a restart lands at the same point it would have without the review. Nothing stored can
disagree with the stage about whether a review is pending. A mode switch ("Finish automatically")
takes effect at the next stage boundary. Making a rewound episode interactive means a person who
regenerates the script or starts over always sees the result before credits are spent on voicing.

What got worse: `Podcast` gains four more operational columns (`mode`, `humanEdited`, `ttsSeed`,
`storiesSelectedAt`), the debt ADR-0003 already names. The rewind's clearing rules (which fields
each target resets) are a second place, beside the stage runners, that has to change when a stage
gains output. A title edited after `ready` no longer matches the ID3 title inside the MP3. An
interactive episode a person forgets waits indefinitely, since the cron skips it.

Revisit when a stage gains a third review stop or a second show arrives (then the review points
may belong in configuration per show), or if forgotten interactive episodes start missing weeks
(then the cron could take an episode over after a deadline).

## Alternatives considered

- **Extra stage values for each pause (`selected_awaiting_review`, `scripted_awaiting_review`)** —
  doubles the stage list and makes every comparison of stages list two values per step.
- **A stored `awaitingReview` flag** — can drift from the stage after a failure, a restart or a
  rewind, and then shows a pause that is not there or hides one that is.
- **Rewinds as pipeline steps, or a general "set stage" endpoint** — breaks the forward-only
  machine that the resume logic and the lease fencing rely on.
- **Keeping the configured TTS seed on "Regenerate audio"** — with a fixed seed a re-voice of the
  same text would sound the same, so the action would buy nothing for its credits.
- **Anchoring the story pool on the row's `createdAt`** (the plan's first design) — "Start this
  week's episode" now only creates the row, so a run started days later would choose from a stale
  week; the moment of selection is stored instead.

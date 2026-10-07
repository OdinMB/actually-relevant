---
id: ADR-0015
title: A person performs the selection stage of a standalone episode; the AI suggestion is advisory and writes nothing
status: accepted
date: 2026-10-07
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, cost]
tags: ["podcast"]
---

# ADR-0015 · A person performs the selection stage of a standalone episode; the AI suggestion is advisory and writes nothing

## Context

Every podcast episode moved from `created` to `selected` through the selection stage: a large-tier
LLM call that picked 4-5 stories from the week's pool (the 7 days before selection). On 2026-10-07
the owner asked for standalone episodes, not tied to a week, built from any published stories that a
person picks with filters (date range, topic, text search), with an optional "Suggest stories" in
which the AI proposes 4-5 from the filtered set. After the stories are set, script and audio were to
run as usual, interactive with "Finish automatically" allowed.

The stage machine, the lease and the admin runs (ADR-0003, ADR-0008, ADR-0009) assume that a run
reaching `created` performs the selection. The weekly pool rule and the model's selection did not
fit a person's hand-picked set, and a suggestion that wrote to the episode would have needed a run,
a lease round-trip and a failure mode of its own.

## Decision

For a standalone episode, saving its stories at `created` is the selection stage: under the
episode's lease, `saveStandaloneStories` writes the frozen snapshot (refs 1..n in the person's
order), `storyIds` and `storiesSelectedAt`, and moves the episode to `selected` with
`mode = interactive`. Every id must be a published story of any date. No run starts a standalone
episode from `created`: `startAdminRun` refuses when the effective stage (`rewindTo ?? stage`) is
`created`, before claiming the lease, and `selectStage` throws for a standalone row as a backstop.
"Suggest stories" (`POST /:id/suggest-stories`) is a stateless, synchronous call of the same
selection model over the most relevant published stories matching the finder's filters (at most
`config.podcast.suggestPoolMax`, 60); it returns ids for the finder's draft and writes nothing. A
weekly episode's selection is unchanged.

## Consequences

The person's choice is the episode's record of what it covers, and the standalone AI line can say
the stories were selected by a person; that first save does not tick "Edited by a person". The model
cannot override the choice: a suggestion only fills an unsaved draft. The stage machine keeps one
path for every stage after `selected`. The costs: a second way into `selected` exists beside the
runner, with its own guard in `startAdminRun` and a backstop in `selectStage`, and Start over for a
standalone episode rewinds to `created` without continuing, unlike the weekly one. A suggestion is a
large-tier call per click, not counted against any budget beyond the shared rate limiter. Revisit if
standalone episodes should ever be produced unattended (a schedule or a theme run), which would need
a selection runner again.

## Alternatives considered

- **Let the `created` runner copy hand-picked ids** — a run, a lease round-trip and a failure mode
  for what is a plain write.
- **A kind branch inside `replaceEpisodeStories`** — allowed stages, membership, a stage transition
  and the mode write would all depend on kind, a second operation inside an edit function.
- **Suggest stories as a run that writes the selection** — the suggestion would become the
  episode's state before the person saw it, and it would need the lease and the progress toast.

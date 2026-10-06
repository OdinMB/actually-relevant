---
id: ADR-0012
title: Keep publication (status) separate from production (stage) and make automatic publishing a job toggle
status: superseded
superseded-by: ADR-0013
date: 2026-10-06
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: ["ai-risk"]
---

# ADR-0012 · Keep publication (status) separate from production (stage) and make automatic publishing a job toggle

## Context

The podcast produces one episode a week through a stage machine (`created` to `ready`, ADR-0003).
The owner wanted to listen to the first episodes and publish them by hand, then switch to automatic
publishing later without a code change. The `Podcast` row already had a `status` column
(`ContentStatus`, shared with newsletters). Once an episode is in the feed, podcast apps key it by its
GUID and enclosure URL, so a published episode must never be regenerated, and a takedown by the owner
must stay a takedown.

## Decision

`stage` says how far production got; `status` says whether the episode is listed. `status =
published` means listed in the feed and on `/podcast`, and requires `stage = ready` on a row that is
not a dry run. One service, `server/src/services/podcastPublish.ts`, changes it; the admin Publish
button and the `publish_podcast` job both call `publishEpisode`. The job is seeded disabled
(`0 7 * * 1`, Monday 07:00 UTC); enabling it in the admin Jobs page is how publishing goes automatic.
It publishes only the newest ready, live episode of the current or previous ISO week that was never
published or taken down and has been ready for at least `config.podcast.autoPublishMinAgeHours`
(24), and it re-reads its own row's `enabled` flag right before publishing. Separating publication
from production and switching to automatic by a toggle is the owner's decision; mapping the toggle
onto the job row's `enabled` flag and the candidate rule are the agent's.

## Consequences

Production and publication fail and recover independently: an episode can be ready and unlisted for
as long as the owner likes, and the feed keeps serving when both podcast jobs are off. Going
automatic is a click, with no deploy. The automatic job can never undo a takedown, never publish an
episode the owner had less than a day to hear, and never reach back more than a week.

What got worse: once the job is enabled, an AI-written, AI-voiced episode goes public with no person
having listened to it, and the record of the project's AI transparency cannot rely on human review.
A refusal (for example an episode marked "Edited by a person" while that disclosure line awaits the
owner's confirmation) fails the job's run and alerts rather than publishing. Two places hold the
publish rule, the button and the job, both through the same service.

Revisit if the show needs scheduled publication at a set time other than Monday morning, a second
show or feed, or a review step that automatic publishing must wait for.

## Alternatives considered

- **One status axis** (adding `ready` and `published` to the production stages) — a takedown would
  have to move production backwards, and the newsletter's shared `ContentStatus` would split.
- **An environment variable to switch automatic publishing on** — needs a deploy for each change; the
  job rows' `enabled` flags are already the podcast's on/off switch.
- **Publishing at the end of the generate run** — no time for the owner to listen, and no way to keep
  generation automatic while publication stays manual.

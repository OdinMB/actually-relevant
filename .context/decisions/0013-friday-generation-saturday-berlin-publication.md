---
id: ADR-0013
title: Generate the weekly episode at guarded Friday slots and auto-publish it Saturday 07:00 Berlin, apart from production
status: accepted
date: 2026-10-06
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
supersedes: ["ADR-0011", "ADR-0012"]
themes: ["ai-risk", "cost"]
---

# ADR-0013 · Generate the weekly episode at guarded Friday slots and auto-publish it Saturday 07:00 Berlin, apart from production

## Context

ADR-0011 generated the weekly episode at weekend cron slots (`0 6,10,14,18 * * 6,0`, UTC) behind a
UTC weekend window in podcast code, with retries capped per ISO week and a single alert, and left the
shared scheduler unchanged. ADR-0012 kept publication (`status`) separate from production (`stage`)
and made automatic publishing a job toggle: `publish_podcast`, seeded disabled, ran at Monday 07:00
UTC and took only an episode that had been ready for 24 hours. Both jobs were built and seeded
disabled the same day; neither had been enabled or deployed.

On 2026-10-06 the owner asked that new episodes be published on Saturday morning, European time, by
default. The listeners the show expects are in Europe, where a fixed UTC hour moves by an hour
twice a year. The shared scheduler reads every cron expression on the server's clock (UTC on
Render), and the admin Jobs page shows that one zone for every job. node-cron 3, which the
scheduler uses, accepts a `timezone` option per task. The newsletter is generated on Saturday at
04:00 UTC, and the podcast's story pool is the stories published in the 7 days before selection,
not the newsletter's issue.

## Decision

Episodes are published on Saturday morning, Berlin time; that is the owner's decision. The rest is
the agent's settlement of it.

`publish_podcast` runs at `0 7 * * 6` read on Europe/Berlin's clock: `jobs/jobTimeZones.ts` maps the
job to `config.podcast.publishTimeZone`, and the scheduler registers it with node-cron's `timezone`
option, so it fires at 07:00 local in summer and winter time. Every other job stays on the server's
clock, and the jobs API returns each job's zone so the admin page can show it. The handler does
nothing on a day that is not a Saturday by the Berlin calendar, so a boot catch-up or a manual Run
on another day never publishes. It takes the newest ready, never-published, never-unpublished,
non-dry-run episode of the current or previous ISO week that has been ready for at least
`config.podcast.autoPublishMinAgeHours`, now 8, and re-reads its own row's `enabled` flag right
before publishing.

`generate_podcast` moves to Friday: `0 2,6,10,14,18 * * 5` on the server's clock, with a handler
window computed in UTC from Friday 00:00 until `config.podcast.generateWindowEndHourUtc` (20:00).
Retries, the attempt cap of 3 per ISO week, the block and its single alert, and the lease are as
ADR-0011 set them, in podcast code. The reminder about an interactive episode still waiting for its
person moves from Sunday to Friday from 18:00 UTC, the last slot, still at most once per episode.

Publication stays separate from production as ADR-0012 set it: `stage` says how far production got,
`status = published` means listed in the feed and on `/podcast` and requires a ready, non-dry-run
episode, one service (`podcastPublish.ts`) changes it for both the admin button and the job, and
enabling `publish_podcast` in the admin Jobs page is how publishing goes automatic.

## Consequences

The episode goes out at the same local hour all year, and the owner has Friday evening to listen
before it does: an episode finished at the last slot is ready about eleven hours before it is
published. Friday and the Saturday after it share an ISO week, so the week key, the candidate rule
and the attempt counter work as before. The shared scheduler gains one generic, opt-in capability
(a per-job zone in code) and no other behavior changes for the other jobs; the cron expressions
moved on the existing rows by a data migration.

What got worse: the owner's listening window shrinks from a day to an evening, and an episode that
is ready only late on Friday night (a manual run after the window) is not published automatically
that Saturday and waits for a manual publish. A person working on an interactive
episode at 18:00 UTC gets no reminder that week, since there is no later slot. One job is now read
on a different clock from all the others, and the zone lives in code, not in the job row, so
editing that job's cron expression in the admin page still reads it in Berlin time. Generation on
Friday draws on a week of stories that ends a day earlier than the Saturday newsletter's.

Revisit if the show needs a second publication slot or zone, if the owner wants more than an
evening to listen, or if the scheduler gains a database claim, retries or per-row time zones for
all jobs.

## Alternatives considered

- **Publish at a fixed 05:00 UTC Saturday** (07:00 CEST, 06:00 CET) — no change to the scheduler,
  but the local hour shifts with summer and winter time, and node-cron already offers a zone per
  task.
- **A time zone column on `job_runs`** — editable in the admin page, but a schema change and an
  editor for one job, out of proportion while only one job needs a zone.
- **Keep generation on the weekend and publish on Saturday morning** — the Saturday slots before
  07:00 would leave no time to listen or retry.
- **Keep the 24-hour minimum** — an episode finished on Friday afternoon or evening would miss
  Saturday morning.
- **Publishing at the end of the generate run** — no time for the owner to listen, and no way to
  keep generation automatic while publication stays manual (as in ADR-0012).

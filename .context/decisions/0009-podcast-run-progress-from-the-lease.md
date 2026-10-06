---
id: ADR-0009
title: Track podcast runs from the episode lease in an app-level admin provider that drives a persistent, clickable toast
status: accepted
date: 2026-10-06
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
---

# ADR-0009 · Track podcast runs from the episode lease in an app-level admin provider that drives a persistent, clickable toast

## Context

A podcast step runs for seconds to minutes on the server (selection, the script, voicing several
TTS chunks, assembly and upload), started by an admin route that answers 202. On 2026-10-06 the
owner asked for spinners while something runs, a toast that stays until the work is done or has
failed, work that continues while he navigates to other admin pages, and a toast that takes him
back to the episode when clicked (plan `.plans/autonomous-two-speaker-podcast.md`, phase 2b).

Until then the background run claimed the episode's lease (ADR-0003) a moment after the 202, so the
client guessed: it marked the episode as in progress itself and polled only on the episode page.
The admin's existing background-task toasts track work the client itself awaits or polls by task
id, and are lost on a reload. A run can also be started where no page is watching: by the weekly
cron in phase 4, or in another tab.

## Decision

The admin routes that start work (`resume`, and `rewind` with `advance`) claim the episode's lease
before they answer 202 and hand it to the background run, which releases it when it ends; a route
that cannot claim answers 409. `GET /api/admin/podcasts/active` lists every episode with a live
lease and what it is doing (the step, and the chunk count while voicing). A
`PodcastProgressProvider` mounted once in the admin layout asks that endpoint on mount and on
window focus, polls it while it follows any episode, and keeps one toast per episode that never
fades while the run lasts, links to the episode page, and turns into the outcome once the episode
leaves the list (a failure stays until dismissed). The episode page calls `track(id)` after each
202. The toast component gains an optional link target and a sticky outcome.

## Consequences

"In progress" is true from the first answer on, so the page never shows a run that has not
started, and a double click gets a 409 instead of a second run. Because the server is the only
source of truth, a reload, another tab or a cron run reattaches the toast without client state,
and navigating within the admin keeps it. A person's edits use the same lease, so an edit cannot
race a run.

What got worse: the admin polls the server every 3 seconds while anything runs, from every open
admin tab. The lease now also serves as the progress signal, so a process that dies without
releasing it shows a run for up to the lease's 30 minutes. The toast is announced in a polite live
region each time its text changes, which is chatty for screen-reader users during a long voicing.
Progress is coarse (one step, or chunks while voicing); nothing reports progress inside a step.

Revisit if more long server-side runs need the same treatment (then the endpoint and provider
generalize beyond podcasts), or if polling load matters (then server-sent events).

## Alternatives considered

- **Client-side timers that guess when a run starts and ends** — wrong after a reload, in a second
  tab and for any run the client did not start, which is exactly when the owner needs the toast.
- **Reusing the background-task provider with a task id per run** — its tasks live in client memory
  and in an in-process task store, so they are lost on a reload or a server restart, and a cron run
  has no task id.
- **Server-sent events or a websocket** — real-time, but a new transport for a single admin user,
  where a 3-second poll is enough.

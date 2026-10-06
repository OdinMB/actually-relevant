---
id: ADR-0011
title: Retry the weekly episode at repeated weekend cron slots guarded in podcast code, not in the shared scheduler
status: accepted
date: 2026-10-06
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: ["cost"]
---

# ADR-0011 · Retry the weekly episode at repeated weekend cron slots guarded in podcast code, not in the shared scheduler

## Context

The weekly podcast episode is generated automatically on Saturday morning, after the newsletter, and
the owner wanted automatic retries within the weekend, capped per week, then an alert. Every
automatic step spends money: LLM calls for the script and ElevenLabs credits for the voice.

The in-process scheduler (`server/src/jobs/scheduler.ts`) runs every job of the site. It never
retries a failed run. At boot it runs a job at once when the job never completed, or when more than
twice its estimated interval has passed since its last completion, which for a weekend-only cron is
about 42 hours, so a boot on a Wednesday would start a run. Its overlap guard is an in-memory set,
so it holds within one process only, and during a deploy two processes can run. It writes
`lastCompletedAt` on failure as well as on success. Changing any of this changes the boot behaviour
of every other job. The episode itself already had a cross-process lease and an attempts counter
(ADR-0003).

## Decision

`generate_podcast` fires at several weekend slots, `0 6,10,14,18 * * 6,0` (UTC on Render). Its
handler does nothing outside a weekend window computed in UTC, Saturday 05:00 through Sunday 23:59
(`config.podcast.weekendWindowStartHourUtc`), whatever the server's zone or how the scheduler
reached it. Inside the window it runs `runWeeklyEpisode({ trigger: 'cron' })`, which resumes the
current ISO week's episode from its stage. Automatic failures are counted on the episode; at
`config.podcast.maxAttemptsPerWeek` (3), or at once on an error a retry cannot fix (credits, the
monthly cap, missing configuration, a dialogue still invalid after its one regeneration), the
episode is blocked and the handler throws, so the scheduler alerts exactly once; later slots see the
block and skip. The migration seeds the job rows with `last_completed_at` set to the time it runs,
so neither runs at boot just because it never completed. The shared scheduler is not changed.

## Consequences

Retries, the weekly cap, the single alert and the weekday guard live in podcast code and change
nothing for other jobs. A deploy on any day cannot start an episode, and a second process during a
deploy is harmless because the episode's lease, not the scheduler, decides who works on it. The
admin "Run" button for the job does nothing outside the weekend window; the admin's own "Start this
week's episode" is the way to run it on another day.

What got worse: the retry policy is spread over three places (the cron expression in the job row,
the window constant and the attempts counter), and someone who edits the cron expression in the
admin Jobs page to a weekday will see the job do nothing. A failure that is neither retryable nor
blocking only retries at the next slot, up to four hours later. The scheduler's own weaknesses stay
for every other job.

Revisit when the scheduler gains a database claim, retries or a no-boot-run rule for all jobs
(recorded as follow-up work), or when the episode moves off the weekend.

## Alternatives considered

- **Fix the scheduler for all jobs** (a database claim in `runJob`, retries, no boot run for a job
  that never completed) — the stronger end state, but it changes the boot behaviour of every job,
  out of proportion to one weekly job whose own lease and ledger already make it safe.
- **A separate hourly retry job** — a second schedule for the same work, where repeated slots of one
  job need none.
- **Dropping the weekend window** and relying on the weekend-only cron — a boot catch-up on a
  weekday would produce a midweek episode, possibly for the next ISO week.

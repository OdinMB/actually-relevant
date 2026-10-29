---
id: ADR-0049
title: Queue signups over the hourly confirmation limit on their pending_subscriptions row, waiting while sent_at is null, and send them from a scheduled job within that limit
status: accepted
date: 2026-10-29
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [personal-data, data]
tags: ["subscription", "scheduler"]
---

# ADR-0049 · Queue signups over the hourly confirmation limit on their pending_subscriptions row, waiting while sent_at is null, and send them from a scheduled job within that limit

## Context

ADR-0022 derived both confirmation-email limits from `pending_subscriptions` rows: the global
limit counted rows created in the last hour against `globalHourlyMax` (default 30), and a signup
above it was refused with "try again later". The limit protects the email provider's complaint
rate and stays; refusing meant a person who signed up during a burst got no email and had to come
back. Accepting such a signup and emailing it later needs somewhere to hold it that survives a
deploy, that both instances of a zero-downtime deploy see, and that lets the hourly count keep
counting sent emails only, not accepted signups.

The owner decided on 2026-10-29 that signups over the limit are accepted and queued; the agent chose where the queue lives.

## Decision

We keep the queue on the row the signup already writes. `pending_subscriptions` gains `sent_at`:
null while the signup waits, set when its confirmation email goes out. The hourly limit counts rows
whose `sent_at` falls in the last hour; the per-address window counts any unconfirmed row for the
address created or sent within it, so a waiting signup still blocks its address. `subscribe()`
queues a signup (a row without `sent_at`, and the same success reply as a sent one) when the hour
is full or earlier signups still wait, after every gate has run; joining behind waiting signups
keeps emails in signup order.

The `send_queued_confirmations` job (`server/src/jobs/sendQueuedConfirmations.ts`, every ten
minutes, seeded enabled, idle while `SUBSCRIPTIONS_ENABLED` is off) deletes waiting rows past their
expiry and records a `signup-queue-expired` owner notice with their count, reads the room left in
the rolling hour, and takes that many waiting rows oldest first; among the rows it takes, it
deletes unsent those whose address has confirmed meanwhile. It claims each remaining row with a
conditional update (`sent_at`, a fresh link expiry, only where `sent_at` is still null) before
calling Plunk. A 400 or 422 from Plunk refuses that one request as invalid, so the row is deleted
unsent and the run carries on; any other 4xx or no connection proves nothing was sent and puts the
row back; any other failure (timeout, reset, 5xx) keeps it as sent. Those two stop the run; any
failure fails it, so the scheduler raises a job-failure notice. When a signup queues behind waiting
ones with room in the hour, only the job can be holding it up: `checkSendAllowance` then reads the
job's `job_runs` row and, when it is missing, disabled or has completed no run within
`queueStalledAfterMinutes` (30), records a `signup-queue-stalled` owner notice, at most hourly per
process and naming no address.

This replaces two parts of ADR-0022: refusing a signup at the cap, and counting the hourly limit
over rows by `created_at`.

`sent_at` defaults to `CURRENT_TIMESTAMP`, and migration `20261029120000_signup_queue` is written by
hand: it adds the column without a default, backfills it from `created_at`, then sets the default.
Existing rows, and rows the previous release writes during a deploy, count as sent and are never
sent again. ADR-0022's other rules stand: the limits come from rows, and a failed direct send
deletes its row.

## Consequences

The queue survives deploys and is one queue across instances, with no second record per signup to
keep in step: re-subscribe, confirm and the cleanup scripts already act on this row. Direct and
queued sends share one rolling count, and a steady stream of new signups cannot starve the queue.
The job claim makes a retry, an overlapping run or a crash send nothing twice.

What got worse: a success reply no longer means an email has gone out, so the signup form says the
link may take a while to arrive. A signup waits at most `confirmTokenExpiryHours` (24) from signing
up and is then removed unsent, with nothing telling the visitor (only the owner gets a notice);
they can sign up again at once. A queued send that ends in a crash, timeout or 5xx after its claim
is kept as sent and may never have arrived; that address
can sign up again only after the per-address window. Paused signups stop the job entirely, so
expired rows are only removed once signups reopen. The admin Subscribers page shows a waiting
signup as pending like a sent one; only the cap and stalled-queue alerts report how many wait. The hourly count and
the queue reads have no index on `sent_at` (only `email` is indexed); add a partial index if the
job's queries ever show up as slow. A later Prisma-generated migration touching this
column must not re-add it with its default in one statement.

## Alternatives considered

- **An in-memory queue in the web process**: lost on every deploy, and held per instance, so the two
  instances of a zero-downtime deploy would each send up to the limit.
- **A separate queue table**: a second row per signup whose token, expiry and deletion have to stay
  in step with the pending row through re-subscribe, confirm and cleanup.
- **Keep refusing at the cap (ADR-0022)**: no new job or column, but a signup during a burst still
  gets an error instead of an email.
- **Add `sent_at` with its default in one statement**, as Prisma generates it: every existing row
  would be stamped with the migration's time, and the hourly limit would count them all as sent in
  the last hour.

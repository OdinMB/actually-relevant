---
id: ADR-0022
title: Derive the per-address and global confirmation-email limits from pending_subscriptions rows
status: accepted
date: 2026-10-08
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [personal-data]
tags: ["subscription"]
---

# ADR-0022 · Derive the per-address and global confirmation-email limits from pending_subscriptions rows

## Context

Every signup that cleared the bot gate sent a fresh confirmation email, so a bot rotating IP
addresses could flood one victim's inbox, and nothing capped the total number of confirmation
emails, each of which counts toward the email provider's complaint rate. The brief asked for at
most one confirmation email per normalized address per 24 hours, answered with the same generic
success as a real signup, and at most a configurable number per hour across all addresses (default
30), above which signups are refused and the owner is alerted once per hour.

The existing per-IP limits used express-rate-limit's in-memory store, which a deploy resets and
which each instance keeps separately. Every confirmation email already had a row in
`pending_subscriptions` with a `created_at` timestamp, but a row survived a failed send, so rows
did not quite equal sent emails.

## Decision

We count `pending_subscriptions` rows in Postgres for both limits (`checkSendAllowance` in
`server/src/services/subscribeLimits.ts`): an unconfirmed row for the normalized address newer
than `perAddressWindowHours` means this address is throttled, and the number of rows created in
the last hour, against `globalHourlyMax`, decides the global cap. `subscribe()` now deletes the
row it created when the send fails, so each row stands for exactly one sent email. The cap alert
goes through the existing `notifyEvent` webhook, throttled to once per hour by a timestamp held in
the process, and carries no address.

## Consequences

The limits hold across deploys and instances, need no new table or column, and stay exact because
the re-subscribe cleanup can only remove unconfirmed rows older than the per-address window (a
newer one would have stopped the request first).

What got worse: two simultaneous requests for one address can both pass the per-address check
before either row exists, costing at most one extra email; the per-IP burst limit makes this rare.
The alert throttle lives in memory, so a deploy can cause one extra alert in an hour. A send that
fails now also leaves no row behind for later diagnosis; the log line remains. If the per-address
window is ever configured below one hour, the re-subscribe cleanup could remove rows the hourly
count needs. Revisit if signups ever need more than one instance writing at high volume, where the
race matters, or if the send history needs to outlive the pending row.

## Alternatives considered

- **In-memory counters, like the per-IP limiters** — reset on every deploy and per instance, the
  weakness the audit named.
- **A new table or columns recording send attempts** — duplicates what the pending row already is
  once failed sends are rolled back, and needs a schema change.
- **Count rows without deleting them on a failed send** — a provider outage would then use up the
  hourly cap and lock addresses out for 24 hours without any email having gone out.

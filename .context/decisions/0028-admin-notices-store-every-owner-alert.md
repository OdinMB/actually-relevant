---
id: ADR-0028
title: Record every owner alert as a row in admin_notices, shown in the admin, with WEBHOOK_URL only an optional forward
status: accepted
date: 2026-10-08
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [personal-data, vendor]
tags: ["admin", "scheduler", "podcast", "newsletter"]
---

# ADR-0028 · Record every owner alert as a row in admin_notices, shown in the admin, with WEBHOOK_URL only an optional forward

## Context

Job failures (`notifyJobFailure`, two callers in the scheduler) and events (`notifyEvent`: podcast
ready, published, waiting, missed week, configuration incomplete, and the newsletter signup cap)
were posted to `WEBHOOK_URL` and dropped when it was unset. Production ran without it, so these
alerts reached nobody. The owner wanted no chat channel and looks only at the admin. Several
workarounds stood in for the missing channel: a warning on the Jobs page, an endpoint reporting
whether a channel was set, a boot warning, and a Friday podcast slot that failed again so the Jobs
page kept showing a block. Plunk spam complaints, which can disable the Plunk project, had no way
in at all.

The admin is used by one owner and, rarely, editors. Alerts are a handful a week; some recur every
run (a failing crawl every six hours).

## Decision

Every owner alert goes through one `notify(input)`, which records a row in `admin_notices` (source,
severity, title, message of at most 2,000 characters, relative admin link, optional dedupe key,
count, first and last occurrence, one global `seenAt`) and then, when `WEBHOOK_URL` is set,
forwards it there. The two steps fail independently and neither throws. A notice with a dedupe key
is one row: a repeat raises its count, replaces its message and severity and makes it unseen again,
in a single `INSERT … ON CONFLICT (dedupe_key) DO UPDATE`; an insert-only mode (`DO NOTHING`)
records an event once and never reopens it. Seen state is global, not per admin. Seen notices are
pruned 90 days after their last occurrence, on each write; unseen ones are kept. Source and severity
are text checked in code, not Postgres enums. The admin shows a Notices page, a sidebar badge (red
while a critical notice is unseen) and a Dashboard card, and the no-channel workarounds are removed.
No caller puts a person's data in a notice.

## Consequences

- Every alert now has somewhere to go without any external service, and a recurring problem stays
  one row that comes back as unseen.
- The database is the store, so an alert raised while the database is down (the scheduler's boot
  alert) cannot be recorded; it reaches only a webhook, if one is set. The scheduler records a
  notice once it starts after such an alert, to cover that gap.
- Seen state is shared: an editor who marks a notice seen hides it from the owner too. Revisit with
  a per-admin join table if several people come to rely on the notices.
- Nothing pushes a notice to the owner: he has to open the admin. A critical notice (a Plunk spam
  complaint) can sit unseen for days. Revisit if that happens, with email or push delivery.
- A new source needs a code change on both sides (the server's list and the admin's labels), though
  no migration.
- Pruning on write means nothing is pruned while no notices arrive; harmless, since nothing grows
  then either.

## Alternatives considered

- **Keep the webhook as the only channel and set one up** — the owner wants no chat channel, and it
  would leave the admin, where he looks, without the alerts.
- **Email alerts through Plunk** — cannot report that Plunk itself is disabled, and the emails count
  toward the sending reputation they would guard.
- **A new row for every occurrence** — a job failing every six hours would fill the list.
- **Collapse repeats only while the notice is unseen** — needs a partial unique index and gives two
  rules to explain, for little gain over reopening.
- **Per-admin seen state** — a join table for a case that does not occur today.

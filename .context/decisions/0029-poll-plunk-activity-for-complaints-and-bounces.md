---
id: ADR-0029
title: Learn of Plunk spam complaints and permanent bounces by polling Plunk's activity API hourly, not through a Plunk webhook
status: accepted
date: 2026-10-08
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [personal-data, vendor]
tags: ["plunk", "subscription", "scheduler"]
---

# ADR-0029 · Learn of Plunk spam complaints and permanent bounces by polling Plunk's activity API hourly, not through a Plunk webhook

## Context

Plunk disabled the project in June 2026 after spam complaints; until about 5,800 total sends, one
more complaint disables it again (`DOCS/2026-10-08_plunk-suspension-review.md`). Nothing on our
side heard of a complaint or a bounce. Plunk's webhooks are steps in dashboard workflows: they are
not retried, and they stop once the project is disabled, which is exactly when they would matter.
They would also need a public endpoint with its own secret.

Plunk's open-source code lists activity through `GET /activity` with a `types` filter, a
`startDate` and cursor paging, each item carrying the recipient's address and contact id and, in its
metadata, the email's subject, campaign name, body and (for a bounce) the mail server's diagnostic.
The hosted API allows GET while a project is disabled. The hosted response shape had not been
checked against the open-source one when this was decided. The account's whole history holds 26
complaint and bounce events. The data concerns newsletter subscribers and people who signed up but
never confirmed.

## Decision

A scheduled job, `poll_plunk_activity`, runs hourly and on every run reads
`GET /activity?types=email.complaint,email.bounced` over a fixed trailing 30-day window, paging by
cursor up to 20 pages. It records each activity as an admin notice (ADR-0028), insert-only, keyed by
its activity id, so an event fetched again is skipped and a seen notice is never reopened. A
complaint is `critical`, a bounce `warning`. It keeps the activity id (in the key), type, timestamp
and the email's campaign name, or source type and subject; it drops the address, the contact id,
the body and the bounce diagnostic. A response with no recognizable list fails the run, so a changed
shape shows up as a job-failure notice. The job is seeded enabled and does nothing without
`PLUNK_SECRET_KEY`.

## Consequences

- A complaint shows up in the admin within about an hour, including while the project is disabled,
  and a missed run, a disabled week or a late event is caught by the next run without a high-water
  mark to keep.
- Every run re-fetches up to 30 days of events and their email bodies (a few pages today); the cost
  grows with the account's complaint and bounce volume. Revisit the window or the page cap if a run
  hits the 20-page limit (it logs a warning).
- Events older than 30 days never appear, so the May 2026 complaints are not in the admin.
- The activity id is Plunk's reference to one recipient's email, so the stored dedupe key is
  pseudonymous personal data; it stays in the table and goes with the row under the 90-day
  retention of seen notices.
- The response shape and whether `startDate` filters on the event's time or the send time are
  unconfirmed until a live run; the job logs the key names it receives until then, and fails rather
  than passing silently on a shape it cannot read.
- Unsubscribes, opens and the running complaint rate are not tracked.

## Alternatives considered

- **A Plunk webhook workflow** — not retried, cancelled once the project is disabled, and needs a
  public endpoint with its own secret.
- **Email alerts through Plunk** — cannot report that Plunk is disabled, and count toward the
  reputation they would guard.
- **Polling `/campaigns/:id/stats`** — counts per campaign only; transactional confirmation emails
  have no campaign.
- **A window starting at the job's last success minus a day** — `last_succeeded_at` also advances on
  a run that returned early without a key, and after a long pause the window would reach past the
  retention and recreate pruned notices.

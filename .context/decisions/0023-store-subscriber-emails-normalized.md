---
id: ADR-0023
title: Store subscriber email addresses trimmed and lowercased, and lowercase existing rows by migration
status: accepted
date: 2026-10-08
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [personal-data]
tags: ["subscription"]
---

# ADR-0023 · Store subscriber email addresses trimmed and lowercased, and lowercase existing rows by migration

## Context

The signup stored addresses as typed, so `Victim@example.com` and `victim@example.com` counted as
different addresses for the already-confirmed check, the re-subscribe cleanup and, from this
change on, the per-address send limit (ADR-0022). The brief asked for trim plus lowercase before
any lookup or storage, without Gmail dot or plus folding, and allowed a migration lowercasing
existing rows if it was safe.

`pending_subscriptions.email` has a plain index and no unique constraint. The admin reconciliation
view (`server/src/services/subscribers.ts`) already compared addresses lowercased. Confirmation
links already sent carry the address as it was typed.

## Decision

We normalize with `normalizeEmail` (trim, then lowercase, nothing else) at the top of `subscribe()`
and `confirmSubscription()` in `server/src/services/subscribe.ts`, so every lookup, write, send and
confirm link uses one form, and the route schemas trim before validating. A data-only migration,
`20261008120000_lowercase_pending_subscription_emails`, runs
`UPDATE "pending_subscriptions" SET "email" = lower(btrim("email"))` on the rows that differ.

## Consequences

Every check sees one address per mailbox spelling, queries stay plain equality on the existing
index, and future code needs no special query mode. Links sent before the change still confirm,
because `confirmSubscription` normalizes its input before matching the now-lowercased row.

What got worse: the migration rewrites stored data and cannot be undone, so the original spelling
of an address is lost. Two rows that differed only by case now share an address; the
already-confirmed check returns early on either, and the re-subscribe cleanup removes stale
unconfirmed ones, but the admin view may show both rows until then. A mailbox provider that treats
the local part as case-sensitive, which the standard allows and almost none do, would have two of
its addresses merged. Revisit if that ever happens, or if a unique constraint on `email` is added,
which would first need the duplicate rows merged.

## Alternatives considered

- **Case-insensitive queries (`mode: 'insensitive'`) without a migration** — leaves two spellings
  stored, has to be remembered on every future query, and cannot use the plain email index.
- **Normalize new rows only** — existing mixed-case rows would escape the already-confirmed check
  and the per-address limit.
- **Also fold Gmail dots and plus suffixes** — the brief ruled it out; it is provider-specific and
  would merge addresses other providers treat as distinct.

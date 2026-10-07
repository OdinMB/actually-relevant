---
id: ADR-0014
title: Accept a just-rotated refresh token for 60 seconds instead of revoking its session, and rotate atomically
status: accepted
date: 2026-10-07
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
tags: ["authentication"]
---

# ADR-0014 · Accept a just-rotated refresh token for 60 seconds instead of revoking its session, and rotate atomically

## Context

The admin keeps its session in a refresh token stored in an httpOnly cookie on the API host. Every
refresh rotated the token: it marked the presented row `rotatedAt` and issued a successor in the same
family. Any rotated token presented again was treated as theft, and every token of the family was
deleted, which logged the person out.

The owner reported being logged out of the admin at unclear moments. A browser check on 2026-10-07
reproduced one cause: when the refresh response never reaches the browser (a reload or tab close
while the refresh is in flight, a laptop going to sleep, a network drop, the API restarting during a
deploy), the browser keeps the old cookie, presents it on the next load, and the server revokes the
session. The read of the token and its rotation were also two separate steps, so two simultaneous
refreshes with the same cookie (two admin tabs) could both succeed and create two live successors.
Logout deleted only the presented token, leaving its rotated predecessors in the table.

## Decision

A refresh token presented again within 60 seconds of its rotation (`AUTH_REFRESH_REUSE_GRACE_MS`,
default 60000) is treated as a lost response or a second tab: the server issues a new token in the
same family and revokes nothing. Presented later, it still revokes the whole family. Rotation claims
the row atomically (`updateMany where rotatedAt IS NULL`); a request that loses that race re-reads the
row and is served only if it is still there and inside the window, so a session revoked in between
is not revived. Logout deletes the whole family of the presented token, not just that token. A
refresh that fails for a server reason (500) no longer clears the cookie; only a rejected token does.

## Consequences

Reloading mid-refresh, two tabs refreshing together, and short network losses no longer log the
person out. In exchange, a stolen refresh token that is used within 60 seconds of its rotation gets
a working session instead of triggering revocation; the family can fork into two live branches for
that minute, each still bounded by the 24-hour token lifetime and ended together by logout or a
password change. Longer outages (a laptop asleep mid-refresh for more than a minute) still end the
session. Revisit if the admin gains more users or roles with higher stakes, or if the logs show
`Refresh token reuse detected` outside deploys and reloads, which would point at real theft rather
than lost responses.

## Alternatives considered

- **Return the already-issued successor token on a repeat within the window** — the same user
  experience without a fork, but it needs the successor stored in recoverable form (the table holds
  only the token itself, keyed by value), which means a schema change and keeping a usable secret
  for longer.
- **No grace window, only a client-side cross-tab lock** — fixes two tabs but not a response lost to
  a reload, sleep or network drop, which was the reproduced cause.
- **Drop reuse detection** — removes the logouts and the protection against a replayed stolen token
  with them.

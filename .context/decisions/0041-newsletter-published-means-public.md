---
id: ADR-0041
title: Make a newsletter issue public on the website exactly while its admin status is published
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [newsletter, public-website]
---

# ADR-0041 · Make a newsletter issue public on the website exactly while its admin status is published

## Context

Weekly issues are built every Saturday but reach nobody while live sending stays paused (Plunk complaint risk). The find-opps report of 2026-10-18 (item 3) proposed a web edition and left two questions to the owner: whether issues should be public at all, and whether the existing admin `published` status, until then bookkeeping only, should be the switch. The owner asked for item 3 to be built; the run's coordinator picked "published is the switch" as the default.

## Decision

An issue is public (archive, issue page, public API, sitemap) exactly while its status is `published`; there is no separate field. Publishing assigns a permanent slug (also assigned when the HTML is built, for the email's "View in browser" link) and records the first publication date. The admin's publish control states that publishing makes the issue public on the website.

## Consequences

Every issue published before this change became public with the deploy that added it (the migration backfilled their slugs). One click both records and publishes, so the status can no longer mean "sent" without also meaning "public". An email sent live before its issue is published carries a "View in browser" link that shows "Issue Not Found" until it is. Revisit with a separate `webPublic` flag if the two meanings need to part.

## Alternatives considered

- **A separate "public on the web" switch**: keeps the old meaning of `published`, but adds a second control to the same screen and a state (published, not public) nobody asked for.
- **Public once built (HTML exists)**: no click at all, but an unreviewed Saturday draft would go public automatically.

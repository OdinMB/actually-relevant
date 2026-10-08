---
id: ADR-0032
title: Give each feed a paywall setting, automatic detection on or off plus an optional title marker that forces locked
status: accepted
date: 2026-10-08
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
tags: ["feeds", "crawler", "paywall"]
---

# ADR-0032 · Give each feed a paywall setting, automatic detection on or off plus an optional title marker that forces locked

## Context

The markup rule of ADR-0030 misclassifies some feeds and cannot see others. Metered sites can flag
every article as not free while serving the full text, and some publishers mark subscriber articles
only in the title: SPIEGEL's `og:title` starts "(S+) ". Bot-blocked publishers reach us only
through the extraction API, with no HTML to read. The owner decided on 2026-10-08 to build a
per-feed setting in the same change and left its shape to the agent.

## Decision

Each feed has two fields, shown in the feed create dialog and edit panel. `paywallDetection`
(default on) lets the markup rule produce `locked`; off, what would be locked is stored as
`metered`. `paywallTitleMarker`, an optional regex, is tested on the page's `og:title` (else
`<title>`, else the title the winning extraction tier returned); a match forces `locked` whatever
the markup, the length or the checkbox say. Zod refuses a marker that does not compile or is over
200 characters; at crawl time a marker that still fails to compile is logged and ignored. There is
no "always locked" mode, since that is deactivating the feed. Changes apply to future crawls only.

## Consequences

- Misclassified feeds are fixed by an editor in the admin, without a code change or a deploy.
- A title marker is brittle: a publisher's redesign or a changed prefix silently stops it, and the
  API tier may drop the prefix for bot-blocked feeds.
- A regex in an admin field can be written wrongly; the validation catches only syntax, not a
  pattern that matches every title and rejects a whole feed.
- Stories already rejected stay rejected when a setting changes; re-queuing them is a manual,
  filtered bulk action.
- Revisit if markers multiply across feeds (a sign the markup rule needs another signal) or a
  marker rejects free articles in the four-week review.

## Alternatives considered

- **A three-way mode per feed (auto, never, always)** — "always" equals deactivating the feed, and
  a mode cannot express a title convention.
- **Hard-coded publisher markers in code** — every new publisher or prefix change would need a
  deploy.
- **No feed setting, markup only** — leaves metered feeds rejected and title-only publishers
  through, with no way to correct either.

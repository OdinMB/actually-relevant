---
id: ADR-0055
title: Check each article against its publisher's machine-readable reservations in the crawler, by URL, and use the extraction API only for technical failures, never to get past a publisher's no
status: accepted
date: 2026-11-12
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data, ai-risk]
tags: ["crawler", "source-policy", "robots-txt", "tdmrep", "diffbot"]
---

# ADR-0055 · Check each article against its publisher's machine-readable reservations in the crawler, by URL, and use the extraction API only for technical failures, never to get past a publisher's no

## Context

ADR-0050 set the source policy (honor general machine-readable reservations, not blocks of named AI crawlers) but left it to review: the crawler read neither robots.txt nor TDM markers, so a publisher that added a reservation after its feed was added stayed crawled until someone checked. The API tier (Diffbot, PipFeed) fetched pages itself, so a page that refused our crawler with a 403 was still read through the extraction service. A research feature is planned that will read articles found outside any feed and needs the same check. The owner approved the enforcement plan on 2026-11-12, including the rule for the API tier.

## Decision

- **The crawler checks each article before it reads it**, on every crawl, from the article URL alone (`checkOptOut(url, { fetchesPage })` in `server/src/services/publisherOptOut.ts`), so any caller can use it, feeds or not. It honors what ADR-0050 honors in machine-readable form: a robots.txt rule (RFC 9309) disallowing the path for `ActuallyRelevant` or, without a group of ours, for `*`; a `Content-Signal` with `ai-input=no`; a TDMRep reservation in `/.well-known/tdmrep.json`, or in a fetched page's `tdm-reservation` header or meta tag. A reserved article is skipped, never stored and never counted as a failure, and is looked at again on the next crawl. Each host's two files are read once and kept in memory per origin.
- **An unreadable robots.txt** (5xx, timeout, network error) skips the article until a later read, as RFC 9309 treats an unreachable file. robots.txt path rules apply only where we fetch the page; a feed that takes its text from RSS is held to Content-Signal and TDMRep.
- **The API tier runs for technical failures only:** a timeout, a network error, a 5xx, a page over `maxParseBytes`, or local extraction that failed or came out too short. It never runs for a page whose fetch was refused with 401, 403, 429 or 451, or that carries a page-level reservation, and once one such page is met it runs for no other article of that feed's crawl.

## Consequences

- A publisher that adds a reservation is honored from the next crawl, within the 24-hour cache, without anyone reviewing the feed; one that lifts it is seen within the same 24 hours.
- Articles from sites that block every bot are lost, even where Diffbot could have read them (the trade-off the owner accepted). On a host that refuses or reserves some pages, a technical failure on another page of the same crawl also goes without the API tier.
- Every crawl makes up to two extra small requests per new host per day (robots.txt, tdmrep.json); a host whose files can't be read costs seconds of retries once an hour and skips its articles meanwhile.
- Terms of use stay a human check at review (ADR-0050). A page-level marker on an article fetched only through the API tier (after skip-local is set) goes unseen; the host files are still checked.

## Alternatives considered

- **Keep enforcement in review only (ADR-0050 as it stood):** no code, but a reservation added later is ignored until someone looks, which can be months.
- **Check, but keep the API tier as a fallback for refused pages:** keeps the articles of sites that block every bot, but uses a third party's crawler to fetch what the publisher refused to ours.
- **Check per feed when it is added or edited:** cheaper, but misses reservations added later and does not serve the research feature, which has no feed.

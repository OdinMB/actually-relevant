---
id: ADR-0050
title: Crawl a source only when its publisher has made no general reservation against automated or AI use; treat blocks of named AI crawlers and training-only bans as not applying to us
status: accepted
date: 2026-11-01
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data, ai-risk]
tags: ["feeds", "crawler", "source-policy"]
---

# ADR-0050 · Crawl a source only when its publisher has made no general reservation against automated or AI use; treat blocks of named AI crawlers and training-only bans as not applying to us

## Context

The crawler fetches one article page per RSS item and hands the text to a language model, which rates and summarizes it; every story links to the original. Until now no rule said which publishers' AI preferences we honor, and the crawler reads neither robots.txt nor text-and-data-mining (TDM) markers. A 2026-11-01 survey of 53 working sources and about 90 candidates (`/mnt/project-files/feed-coverage/2026-11-01_feed-coverage-and-replacements.md`) found publishers signal at three strengths: robots.txt rules blocking named AI-company crawlers (GPTBot, ClaudeBot, CCBot, …; about a third of current sources, BBC, Guardian, SPIEGEL and Heise among them); general machine-readable reservations that bind anyone (TDMRep `tdm-reservation: 1`, a `Content-Signal` with `ai-input=no`); and terms of use that ban AI processing outright. Under Art. 4 of the EU DSM Directive, text-and-data mining is permitted unless the rightsholder reserved it in machine-readable form.

The owner chose the middle line on 2026-11-01, applied to existing sources as well as new ones, and asked for it to be stated on the public site.

## Decision

A source is admissible unless its publisher has made a reservation that applies to us:

- **Honored:** a general machine-readable reservation (TDMRep in `/.well-known/tdmrep.json` or HTTP headers; `Content-Signal: ai-input=no`; a robots.txt rule disallowing `*` or `ActuallyRelevant`), and terms of use that forbid AI processing, summarizing or text-and-data mining of the content.
- **Not treated as applying to us:** robots.txt rules naming specific AI-company crawlers, and terms that forbid only AI training. We do not train models, the crawler identifies itself, and every story links to the source.
- A publisher whose terms forbid fetching pages but whose RSS items carry the full article (Substack) is admissible with `contentSource: 'rss'`: the story is built from the feed and the page is never fetched.

The policy is applied when a source is added or reviewed (by hand or through a feed changeset); the crawler does not check it. Stated in `.context/feed-management.md` ("Source Policy: Publishers' AI Opt-Outs") and on the Methodology page.

## Consequences

- Three working sources leave under the rule (Science News: `ai-input=no`; RFI and UNESCO: TDM reservations), and The Lancet (Elsevier TDM reservation) is not restored.
- Compliance depends on review, not code: a publisher that adds a reservation later stays crawled until someone checks. Crawler-side enforcement (robots.txt, TDMRep, Content-Signal) is a BACKLOG item.
- The Diffbot fallback can still fetch pages of publishers that block Diffbot by name; under this rule that is a named-crawler block, but it is the extraction service's own crawler, so the backlog item covers skipping Diffbot for those publishers.
- The public statement about EU law is ours, not legal advice; revisit it if a reservation format or the law changes.

## Alternatives considered

- **Leave it (crawl anything not blocked to our own name).** Keeps every source, but ignores general reservations that plausibly bind a Berlin-run service.
- **Strict line (also honor named-crawler blocks).** Loses about a third of current sources, most of Science & Technology's best feeds among them.

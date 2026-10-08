---
id: ADR-0030
title: Classify a story's access tier at extraction from publisher markup and store it on the story
status: accepted
date: 2026-10-08
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["crawler", "extraction", "paywall"]
---

# ADR-0030 · Classify a story's access tier at extraction from publisher markup and store it on the story

## Context

A SPIEGEL+ article reached the newsletter's top stories in October 2026 although its analysis said
only the headline was accessible. Extraction's only quality gate was a 300-character minimum, which
a paywall teaser passes. The fetched HTML, which says whether the publisher restricts the article,
was discarded after extraction; only the text and the extraction method were stored. The assess
prompt tells the model to fill gaps from its own knowledge without mentioning them, so a teaser got
a confident rating built on the headline.

A probe of publisher pages on 2026-10-08 found schema.org `isAccessibleForFree` on SPIEGEL, ZEIT,
SZ, FT, STAT and The Diplomat, as a boolean or the strings "True"/"False", at top level, in
`@graph` or in `hasPart`. Metered sites (The Diplomat, STAT) mark every article false but serve the
full text. `article:content_tier` and a JSON-LD `wordCount` appear on a few publishers. CSS class
names and URL patterns carried no signal. Bot-blocked publishers serve no HTML at all, and about
70% of SPIEGEL's feed is free.

## Decision

`classifyAccess()` in `server/src/lib/paywall.ts` reads the fetched HTML with cheerio whenever a
page was fetched and is under `maxParseBytes`, against whichever extraction tier's text won, the
API tier included, and the result is stored as `Story.accessTier`: `free`, `metered`, `locked` or
`unknown`. No access flag means `unknown`, never paid. A false flag means `locked` only with
evidence of truncation (`content_tier` locked, extracted words below 0.3 × `wordCount`, or text
shorter than 1,500 characters); otherwise `metered`. Both thresholds are in `config.paywall` with
env overrides. When every tier fails on a locked page, the extractor returns a `teaser` result (page
title and description) instead of `null`, so the crawler stores it and does not count it toward its
skip-local and skip-all thresholds. The feed's paywall setting (ADR-0032) applies on top. Stored
stories crawled before this have `accessTier = null`; there is no backfill.

## Consequences

- The paywall question is answered once, deterministically, before any model sees the story, and
  the data to judge the rule (four weeks of `accessTier`) accumulates on its own.
- Each fetched page is parsed by cheerio once more, which adds to the crawler's memory per article
  within the same `maxParseBytes` bound.
- A publisher's subscribe offer extracted with the teaser can push it over 1,500 characters: a
  SPIEGEL international S+ teaser came to about 3,100 characters on 2026-10-08 and would be
  `metered` by markup alone. Such feeds need the title marker of ADR-0032.
- Bot-blocked publishers and pages over `maxParseBytes` yield `unknown`; only a title marker can
  classify them, and only if the API tier keeps the title prefix.
- Classification is a snapshot: an article the publisher later unlocks stays as classified.
- Revisit when the four-week review shows teasers among `unknown` or `metered` stories, or a
  metered feed rejected as locked.

## Alternatives considered

- **Refuse locked pages at crawl and store no row** — no override, no data for the review, and the
  `null` result would trip the crawler's skip-local threshold.
- **A completeness field in the assess model's output** — needs a prompt recalibration, is not
  deterministic, and conflicts with the prompt's rule against talking about gaps.
- **A per-feed paywall setting alone** — would drop the free articles of mixed feeds, about 70% of
  SPIEGEL's.
- **The `isAccessibleForFree` flag alone** — would remove metered feeds that serve full text.

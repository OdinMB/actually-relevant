---
id: ADR-0031
title: Store locked stories as rejected at crawl, before pre-assessment, so no model call or automated stage ever sees them
status: accepted
date: 2026-10-08
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [cost, ai-risk]
tags: ["crawler", "story-pipeline", "paywall"]
---

# ADR-0031 · Store locked stories as rejected at crawl, before pre-assessment, so no model call or automated stage ever sees them

## Context

Once a story's access tier is known at extraction (ADR-0030), something has to keep `locked`
stories out of what readers see. Every reader-facing surface (site, RSS, search, related stories,
newsletter, podcast, social auto-post) reads only `published` stories, and selection and publishing
run automatically. A story we will not publish should cost no model call. The owner chose, on
2026-10-08, to remove locked stories everywhere with no reader-facing label, and not to analyze
them at all; the agent placed the rule.

## Decision

`createStory()` creates a story whose `accessTier` is `locked` with status `rejected` instead of
`fetched`, keeping its row and teaser text. Both crawl paths (scheduled crawl and the admin's
crawl-url) go through it; the admin's manual story creation passes no access tier and is
unaffected. Pre-assess and assess pick only `fetched` and `pre_analyzed` stories, so no model call
is made for it; it gets no issue, no embedding and never joins a dedup cluster. Any later editor
action on the story (re-assess, re-queue, publish) is the override; there is no second gate later
in the pipeline.

## Consequences

- One rule before the pipeline covers every surface, and locked stories cost nothing beyond the
  crawl.
- An editor who re-assesses a locked story to look at its analysis puts it back into the automated
  pipeline: it can be selected and published unless rejected again, and it enters dedup with a
  rating built on the headline, where it can win a cluster over a free duplicate.
- Publishing straight from `rejected` publishes a story with no AI title, summary or rating; no
  guard stops it, by design.
- A free article misclassified as locked is silently rejected until an editor finds it with the
  story list's Paywall filter; feed quality metrics count it in `totalCrawled`.
- Revisit if editors re-queue locked stories often, or if the four-week review shows the rejections
  removing articles readers could read.

## Alternatives considered

- **Keep locked stories on the site with a "Subscriber-only source" label and off the distribution
  channels** — leaves a headline-based rating competing for homepage slots.
- **Gate at site selection after a full assessment** — spends an assess call per locked story on
  something that will not be published.
- **A second gate at selection or in the consumer queries as well** — would also re-reject stories
  an editor re-queued on purpose, for example after switching a misclassified feed's detection off.
- **A newsletter short-content filter now** — deferred to the four-week review, since the crawler
  receives SPIEGEL's markup.

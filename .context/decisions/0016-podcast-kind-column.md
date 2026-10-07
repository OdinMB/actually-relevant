---
id: ADR-0016
title: Mark an episode's kind in an explicit kind column, weekly or standalone, with standalone rows never carrying a week key
status: accepted
date: 2026-10-07
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["podcast"]
---

# ADR-0016 · Mark an episode's kind in an explicit kind column, weekly or standalone, with standalone rows never carrying a week key

## Context

Every two-speaker episode was "this week's": the row was found by its unique ISO week key
(`week_key`), the generate job created or advanced the current week's row, and the publish job took
the newest ready episode of the current or previous week. Rows from before the pipeline (`stage =
legacy`) already had a null week key.

On 2026-10-07 the owner asked for standalone episodes: not tied to a week, built from stories a
person picks, published by hand only and never touched by the weekly jobs. Their prompts, spoken
opener and sign-off, AI lines and validation differ from the weekly ones, so the code that words
things needs to know which kind an episode is.

## Decision

The `podcasts` table has a `kind` column of the enum `PodcastKind { weekly, standalone }`, `NOT NULL`
with default `weekly`; every existing row, legacy ones included, is `weekly`. The CHECK
`podcasts_standalone_without_week_key` (`kind <> 'standalone' OR week_key IS NULL`) keeps a
standalone row out of the week key, so `findOrCreateWeekEpisode` can never return one and the
generate job is weekly by construction. `pickAutoPublishCandidate` also filters `kind = weekly`.
`kind` is threaded as a required parameter through the functions that word an episode (prompts,
dialogue schema, validation, spoken segments, show notes, AI lines). It is not exposed in the public
JSON or the feed.

## Consequences

Kind is explicit and enforced by the database, so a standalone row cannot be mistaken for a legacy
one or for this week's episode, and the type-checker finds every place that words an episode. The
costs: a migration and an enum to keep in step with the shared client type, about ten function
signatures and their tests changed to take `kind`, and every new caller of those functions must pass
it. Legacy rows read as `weekly` although no job touches them; `stage = legacy` still marks them.
Revisit if a third kind appears (a theme series, a special), which would add an enum value and a
record entry rather than a new column.

## Alternatives considered

- **A null week key means standalone** — legacy rows already have a null week key, and the owner
  asked not to confuse the two.
- **A synthetic week key for standalone rows** — every reader of `weekKey` would have to learn to
  ignore it, and `pickAutoPublishCandidate` compares week keys.
- **A variant object resolved once instead of a `kind` parameter** — moves the same parameter around
  under another name.

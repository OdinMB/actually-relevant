---
id: ADR-0046
title: Record why a story is rejected in a nullable rejection_reason column, backfilled by a guess, and restore only duplicate rejections
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data]
---

# ADR-0046 · Record why a story is rejected in a nullable rejection_reason column, backfilled by a guess, and restore only duplicate rejections

## Context

A story reaches `rejected` for six different reasons: paywall-locked at crawl (ADR-0031), below the assessment or selection threshold, not picked by the selection model, a non-primary member of a duplicate cluster, or an editor's decision. The status alone did not say which, so dissolving a cluster or removing a member restored every rejected member to `analyzed`, editor rejections and threshold rejections included, and demoted a published duplicate to `analyzed` instead of putting it back on the site. The story lifecycle module (ADR-0045) needs to know which rejections a cluster edit may undo. The approaches document of 2026-10-19 suggested a column over a heuristic (rejected after the cluster was created); the owner approved the plan's defaults on 2026-10-19.

## Decision

`stories.rejection_reason` is a nullable enum `RejectionReason` with the values `paywall`, `assess_threshold`, `select_threshold`, `selection`, `duplicate` and `editor`. Every move into `rejected` sets it, and every move out clears it, both in `services/storyLifecycle.ts`; a CHECK constraint, `stories_rejection_reason_only_when_rejected`, refuses a reason on any other status. Dissolving a cluster or removing a member restores only `duplicate` rejections: to `published` when the story has a `datePublished`, else to `analyzed`. Election of a cluster primary never picks a member rejected for any reason but `duplicate`. The migration (`20261019120000_story_rejection_reason`) backfills a guess: rejected stories with `access_tier = 'locked'` become `paywall`, rejected non-primary cluster members become `duplicate`, and every other existing rejection stays null. Null means "reason unknown" and is never restored automatically.

## Consequences

Cluster edits no longer bring back stories an editor or a threshold rejected. Rejections older than the column whose reason the backfill could not infer (threshold, selection and editor rejections, and duplicates of clusters already dissolved) stay null; dissolving their cluster leaves them rejected, which is stricter than before, and an editor re-queues one by hand if wanted. A guess can be wrong in one direction: a rejected non-primary that an editor had rejected for another reason is marked `duplicate` and can come back on dissolve. The admin UI does not show the reason yet. Any code that writes `status = 'rejected'` outside the lifecycle module would now violate nothing in the database but leave the reason null; the source-scan test `statusWriters.test.ts` keeps such writes out.

## Alternatives considered

- **No column, infer duplicates from timing** (rejected after the cluster's `created_at`): no migration, but editor rejections after clustering are indistinguishable from auto-rejections.
- **A free-text reason**: more detail, but nothing for code to branch on, and no constraint.
- **A non-null column with an `unknown` value**: avoids nulls on rejected rows, but then every non-rejected row needs a value too, or the constraint becomes more complex for no behavioral gain.

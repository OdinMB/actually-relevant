---
id: ADR-0045
title: Make one module, storyLifecycle.ts, the only writer of story status, with conditional moves, a transition table and transactional cluster edits
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data, architecture]
---

# ADR-0045 · Make one module, storyLifecycle.ts, the only writer of story status, with conditional moves, a transition table and transactional cluster edits

## Context

Sixteen places in six modules wrote `stories.status`, almost all by id with no condition on the current status, and the state machine existed only as prose in `.context/story-pipeline.md`. That caused real defects: a story trashed or rejected while a model or embedding call ran was moved to `selected`, `analyzed` or `published` anyway; a bulk re-assess took published stories off the site; dissolving a cluster restored editor rejections and demoted published duplicates; publishing never re-elected the cluster primary, so a cluster could publish twice; cluster edits ran as several separate statements. The architecture review of 2026-10-18 (item 1) and the approaches document of 2026-10-19 (approach 1B) proposed a single owner. The owner approved the plan, its re-assess rule and its defaults on 2026-10-19.

## Decision

`server/src/services/storyLifecycle.ts` is the only code that writes `stories.status` and `stories.rejection_reason`; a source-scan test (`server/src/test/statusWriters.test.ts`) fails on any other writer. It holds the transition table: for each move, the statuses it may start from, per actor (`pipeline` for jobs and bulk analysis, `editor` for explicit admin actions). Each move is one conditional statement (`updateManyAndReturn ... WHERE status IN (allowed)`) and returns `{ moved, skipped }`, so callers learn what actually happened and a story whose status changed meanwhile is left alone. Analysis results never move a story backward: re-assessing or re-screening a `selected` or `published` story refreshes its fields and keeps its status, only an editor's analysis re-queues a `rejected` story, and a `trashed` story is skipped. The module owns each move's side effects: publishing (embeddings outside the transaction, then slugs, dates and the flip under the slug advisory lock, publishing only unclustered stories or primaries from the job), primary election with auto-rejection of duplicates in three modes, restoring duplicates, and the cluster edits (dissolve, remove member, merge) as single transactions. Every publish re-elects the primary of the clusters it touched. Lock order in every such transaction: slug lock (publish only), then cluster rows by id, then story rows by id.

## Consequences

Races between the pipeline and editors end with the editor's status, and the skipped ids are logged and, on bulk routes, returned. Single-story editor actions to the status a story already has are no-ops. A new status writer has to go through the module, so the table is the one place to read and change the rules; it also means a field-only edit and a status move are two steps (`PUT /stories/:id` writes the fields, then moves the status). Some moves now take row locks on the stories and clusters they touch, which serializes concurrent edits of one cluster; transactions are short and set-based, so contention is brief. Cluster primaries can change on publish, not only on cluster edits.

## Alternatives considered

- **Add `status IN (...)` to each of the sixteen writes**: nearly as many edits, and the rules stay scattered for the next writer to miss.
- **The module without a rejection reason column**: dissolve would have to guess which rejections were duplicates (ADR-0046).
- **A state-machine library**: adds a dependency for what is a small table plus SQL conditions; the conditions have to be in SQL anyway to survive races.

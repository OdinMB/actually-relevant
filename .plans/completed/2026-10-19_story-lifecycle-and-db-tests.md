---
status: implemented
type: refactor
complexity: complex
---

# One owner for story status changes, tested on a real database

> Written by a planning subagent: the handbook's `plan-decisions` skill is not loaded here, so the header has this workflow's keys only and the decisions live in `## Approach`; the explorer, architect and reviewer agents and the user-question step were skipped (no agents or questions allowed in this run).

Sources: `.plans/2026-10-18_arch-issues.md` items 1 and 2, `/mnt/project-files/codebase-scans/2026-10-19_arch-approaches.md` (approaches 1B and 2A). Status writers re-verified on branch `claude/project-thread-3ls8z3` (2026-10-19). Functions are named, never line numbers: `services/story.ts` is about to be split into modules after the typed-errors/retries/config branch merges, so "`publishChunk`" means that function wherever the split puts it.

## Problem

Sixteen places in six modules write `stories.status` directly, almost all by id with no condition on the current status, and the state machine exists only in `.context/story-pipeline.md`. That produces real defects: a story trashed or rejected while an LLM or embedding call runs is moved to `selected`/`analyzed`/`published` anyway; bulk re-assess of a published story takes it off the site; dissolving a cluster restores every rejected member (editor rejections included) to `analyzed` and demotes published duplicates; publishing never re-elects the cluster primary; cluster edits are several non-transactional statements. None of this can be tested today, because the DB tests are opt-in, skipped unless someone sets `TEST_DATABASE_URL`, and there is no CI.

## Approach

Two parts, in this order, because issue 1's bugs are races, conditional updates and transactions that only a real database shows.

**Part A (approach 2A): make the existing Postgres harness a habit.** The harness already exists (`server/src/test/db/`: `guard.ts`, `globalSetup.ts` running `prisma migrate deploy`, `harness.ts` with `truncateAllTables`/`useTestDatabase`/fixtures, vitest project `db`, `npm run test:db`). Changes: the guard requires a database name ending in `_test` (so `actually_relevant_test`) on a local host and different from the shell's `DATABASE_URL` database; `npm run test` runs the `unit` project only; `npm run test:db` fails, not skips, when `TEST_DATABASE_URL` is missing; fixtures for lifecycle tests; a GitHub Actions workflow with a `pgvector/pgvector` service running typecheck, unit and DB tests. Render's `autoDeployTrigger: commit` is not touched, so CI is advisory.

**Part B (approach 1B): `server/src/services/storyLifecycle.ts`, the only writer of `stories.status`.** It holds the transition table, issues one conditional statement per move (`prisma.story.updateManyAndReturn({ where: { id: { in }, status: { in: allowedFrom } } })`, available in the locked Prisma 6.19 on PostgreSQL), returns `{ moved, skipped }` so callers learn what actually happened, and owns each edge's side effects: publish prep (embeddings outside the transaction, then slug lock, conditional flip, slug batch, `datePublished`), primary re-election and auto-reject, duplicate restore, and the cluster edits (dissolve, remove member, merge) as single transactions. Then a nullable `rejection_reason` column, set by every move into `rejected` and cleared by every move out, so dissolve can restore only duplicate rejections. Callers move over one at a time, each step deleting the mock-sequence tests its DB boundary tests replace.

**Alternatives considered.** 1A (module without the column) leaves dissolve guessing which rejections are duplicates (`updatedAt` after cluster creation is a heuristic). 1C (add `status IN (...)` to each of the sixteen writes) costs nearly as many edits and leaves the table in a context file for the next writer to miss. 2B (per-worker databases from a template) and 2C (Testcontainers) add harness code or Docker everywhere for parallelism nobody needs yet; 2A can become 2B later without touching a test. PGlite is out: advisory locks and `FOR UPDATE` behavior are exactly the slug-lock and lease cases.

**Placement.** The module's responsibility is "how a story changes status and what each change implies for its cluster". Slug generation (`withSlugLock`, `generateUniqueSlug`, `generateUniqueSlugs`, `preparePublishData`) is used only by publish paths, so it moves into the module as private helpers rather than a new file. Cluster read and validation functions (`getAllClusters`, `getClusterById`, `searchStoriesForCluster`, the argument checks of `createManualCluster`/`setClusterPrimary`) stay in `services/cluster.ts`; candidate finding and LLM confirmation stay in `services/dedup.ts`. `services/clusterRepair.ts` keeps membership repair after deletions and calls the module for re-election.

### Decisions

Owner-approved (2026-10-19):
1. **Re-assess and pre-assess never move a story backward.** `selected` and `published` stories get their fields refreshed and keep their status (a published one is re-embedded); a `rejected` story is re-queued (the documented paywall override); a `trashed` story is skipped and reported as skipped, so the editor restores it first.
2. **Tests may migrate only the guarded test database**, with `prisma migrate deploy` once per run and `TRUNCATE ... RESTART IDENTITY CASCADE` between tests; never `migrate reset`/`migrate dev`. Recorded as an ADR (it designates the test database the unattended-run rules require).

Defaults taken, owner can overrule (the approaches doc's suggested answers):
3. **Dissolve and remove-member restore only `duplicate` rejections**: to `published` if `datePublished` is set, else `analyzed`. Editor, threshold, selection, paywall and null reasons stay rejected.
4. **Publish re-elects the cluster primary and auto-rejects the previous one**, with published members kept (pipeline mode). This stops a cluster publishing twice.
5. **Add the nullable `rejection_reason` column** (enum `paywall`, `assess_threshold`, `select_threshold`, `selection`, `duplicate`, `editor`), backfilled in the same migration: `access_tier = 'locked'` rejected rows to `paywall`, rejected non-primary cluster members to `duplicate`, the rest null. Null means "never auto-restored", stricter than today.
6. **Add a GitHub Actions workflow** with a pgvector service running unit and DB tests. Do not change `autoDeployTrigger`; whether Render waits for checks is a separate owner decision.

Defaults taken by this plan where the docs left a detail open, owner can overrule:
7. **The publish job publishes only unclustered stories or cluster primaries** among `selected`. A selected non-primary in the same chunk is then auto-rejected as `duplicate` by the re-election. Without this, two members of one cluster selected in the same run both go live, which decision 4 is meant to stop.
8. **Election never picks a `trashed` member or one rejected for a reason other than `duplicate`.** Ranking otherwise stays as `updatePrimary` has it: published first (earliest `datePublished`), then highest `relevance`, then first crawled, with `duplicate` rejections ranked last. Only editor-triggered elections (editor reject, trash or re-queue of a primary; set primary; remove member; merge) restore an elected `duplicate` member by decision 3's rule. Pipeline paths (dedup formation, publish, deletion repair) never move a story out of `rejected`, matching "no automated job moves a story out of a terminal status". If no member qualifies, the primary pointer is left as it is.
9. **Editor bulk-select only acts on `analyzed` stories** (the approaches doc's table); other ids come back as `skipped` from `POST /bulk-select`.
10. **A single-story editor action to the status the story already has is a no-op returning 200** with the story (publish a published story, reject a rejected one, trash a trashed one). `POST /:id/assess` on a trashed story returns 409. Bulk routes list skipped ids in the response, as they already do for ids being processed.
11. **A database CHECK constraint** `stories_rejection_reason_only_when_rejected` (`status = 'rejected' OR rejection_reason IS NULL`) backs the "cleared on every move out" rule, as `podcasts_standalone_without_week_key` does for podcasts.
12. **`npm run test` becomes the unit project only**, and the guard tightens from "name contains `test`" to "name ends in `_test`". CI's service runs `pgvector/pgvector:pg17`, matching the Docker dev database; the dev container's local Postgres is 16; production's major version is not recorded in the repo and should be confirmed.
13. **`PUT /:id` with a `status` writes the fields first, then the status move** (two transactions, not one). A failed move after a saved edit returns the error with the fields kept. This keeps the edit form working through the lifecycle without the module taking arbitrary field updates.
14. **Rejecting a story through the status endpoints (`PUT /:id/status`, `POST /bulk-status`, `PUT /:id`) records reason `editor`**; moving a story to `fetched`, `pre_analyzed`, `analyzed` or `selected` by hand is an editor re-queue, allowed from any status other than the target.

### Status writers today (verified on this branch)

All in `server/src/`. "By id" means no condition on the current status.

| # | Function | Writes | Called from | Guarded? |
|---|---|---|---|---|
| 1 | `story.ts` `createStory` | insert `fetched`, or `rejected` if `accessTier = 'locked'` | `crawler.ts` (feed crawl and `crawlUrl`), `POST /stories` | insert |
| 2 | `story.ts` `updateStory` | any status from `updateStorySchema.status`, publish prep and embedding if `published` | `PUT /stories/:id` | by id |
| 3 | `story.ts` `updateStoryStatus` | any status, publish prep if `published` | `PUT /stories/:id/status` | by id |
| 4 | `story.ts` `publishChunk` via `bulkUpdateStatus` | `published`, slug, `datePublished` (two `updateMany` by id) | `runPublishStories`, `POST /stories/bulk-status` | by id |
| 5 | `story.ts` `bulkUpdateStatus` (non-publish branch) | any status | `POST /stories/bulk-status` | by id |
| 6 | `story.ts` `publishStory` | `published` + publish prep | `POST /stories/:id/publish` | by id |
| 7 | `story.ts` `rejectStory` | `rejected` | `POST /stories/:id/reject` | by id |
| 8 | `story.ts` `dissolveCluster(storyId)` | every `rejected` member to `analyzed`, unlink, delete cluster | `POST /stories/:id/dissolve-cluster` | status only, 3 statements |
| 9 | `analysis.ts` `preAssessStories` via `runBatchClassification` (`buildUpdate` adds `status: 'pre_analyzed'`) | `pre_analyzed` + issue, `relevancePre`, emotion | `runPreassessStories`, `POST /stories/preassess`, `POST /bulk-preassess` (task) | by id |
| 10 | `analysis.ts` `assessStory` | `analyzed` + analysis fields, embedding in the same tx | `runAssessStories`, `POST /stories/:id/assess`, `POST /bulk-assess` (task) | by id |
| 11 | `analysis.ts` `selectStories` (3 writes) | safety-net `rejected`, `selected`, LLM `rejected` | `selectStoriesInGroups` (job, `POST /bulk-select`), `POST /stories/select` | by id |
| 12 | `jobs/assessStories.ts` `runAssessStories` | `pre_analyzed` below threshold to `rejected` | job | yes |
| 13 | `jobs/selectStories.ts` `runSelectStories` | `analyzed` below minimum to `rejected` | job | yes |
| 14 | `dedup.ts` `autoRejectNonPrimary` | non-primaries to `rejected` | `detectAndCluster` (x2), `cluster.ts` `createManualCluster`, `setClusterPrimary`, `removeFromCluster`, `mergeClusters` | filtered on an earlier read, by id in the write |
| 15 | `cluster.ts` `removeFromCluster` | removed member `rejected` to `analyzed`; at dissolve all `rejected` to `analyzed` | `POST /clusters/:id/remove-member` | status only, up to 4 statements |
| 16 | `cluster.ts` `dissolveCluster(clusterId)` | every `rejected` member to `analyzed`, unlink, delete | `DELETE /clusters/:id` | status only, 3 statements |

Changed since the approaches doc: `deleteStory` no longer holds a dissolve copy; it calls `repairClusters()` (`services/clusterRepair.ts`, shared with the retention job), which writes membership and the primary pointer but no status. `storyRetention.ts` deletes rows and clears embeddings, no status. `reclassifyStories`/`tagEmotionOnly`, `lib/vectors.ts` and `scripts/migrations/*` write fields only. So: three dissolve copies (8, 15, 16), one repair path.

### Transition table the module enforces

`pipeline` = jobs and the bulk analysis/selection actions; `editor` = explicit admin status and cluster actions. A move from a status not listed is skipped and reported, never forced. Every move into `rejected` sets `rejection_reason`; every move out clears it. Moving back from `published` never clears `slug` or `datePublished`.

| Move | Actor | Allowed from | Result and side effects |
|---|---|---|---|
| create | crawler | new row | `fetched`; `accessTier = 'locked'` gives `rejected`/`paywall` (`initialStatus`) |
| pre-assess result | pipeline | advance: `fetched`, `rejected` → `pre_analyzed`; refresh: `pre_analyzed`, `analyzed`, `selected`, `published` (fields only, status kept) | issue, `relevancePre`, emotion written; `trashed` skipped, and filtered out before the LLM call |
| assess result | pipeline | advance: `fetched`, `pre_analyzed`, `rejected` → `analyzed`; refresh: `analyzed`, `selected`, `published` | fields + embedding in one tx; a refreshed published story is re-embedded and its related-stories cache entry forgotten; dedup after commit; `trashed` skipped before the LLM call and again at the write |
| assess threshold | pipeline | `pre_analyzed` | `rejected`/`assess_threshold` |
| select threshold | pipeline | `analyzed` | `rejected`/`select_threshold` |
| select | pipeline (job, `/select`, `/bulk-select`) | `analyzed` | `selected`, or `rejected`/`selection`; pool read is `analyzed` only, other ids skipped |
| selection safety net | pipeline | `analyzed` | non-primary members `rejected`/`duplicate` |
| auto-reject non-primary | pipeline mode | `fetched`, `pre_analyzed`, `analyzed`, `selected` | `rejected`/`duplicate`; `published` kept |
| auto-reject non-primary | editor-cluster mode | the above plus `published` | `rejected`/`duplicate` |
| publish | pipeline (job) | `selected`, unclustered or cluster primary | slug, `datePublished`, embedding (ensured outside the tx); re-elect, pipeline mode |
| publish | editor | any but `published` (`trashed` included: the documented override) | as above |
| reject | editor | any but `rejected` | `rejected`/`editor`; re-elect (editor-story mode) if it was published or the primary |
| trash | editor | any but `trashed` | `trashed`; re-elect as for reject |
| re-queue (`fetched`, `pre_analyzed`, `analyzed`, `selected`) | editor | any but the target | reason cleared; re-elect as for reject |
| set status (edit form, `PUT /:id/status`, `/bulk-status`) | editor | per target | routed to the publish, reject, trash or re-queue row |
| dissolve, remove member | editor | `rejected` with reason `duplicate` | to `published` if `datePublished` set, else `analyzed`; one transaction |
| set primary, merge, manual cluster | editor | per member | chosen or elected primary restored if `duplicate`; others auto-rejected in editor-cluster mode; one transaction |
| repair after deletion (`repairClusters`) | pipeline | n/a | unlinks/deletes or re-elects in pipeline mode; never restores |

Re-election modes (`reelectPrimary(clusterId, mode, tx, chosenPrimaryId?)`): `pipeline` (auto-reject keeps published, never restores), `editor-story` (keeps published, restores an elected duplicate), `editor-cluster` (rejects published non-primaries, restores the chosen or elected primary if duplicate).

**Lock order** in every transaction that touches status and clusters: slug advisory lock (publish only), then the affected `story_clusters` rows `FOR UPDATE` ordered by id, then story rows. Publish locks the clusters of its chunk before the flip, so a concurrent cluster edit cannot deadlock against it.

### Defect fixes this delivers

| Defect | Fix |
|---|---|
| Select, assess, pre-assess move a story trashed/rejected during the LLM call | conditional writes; skipped ids returned and logged |
| Selection revives trashed stories (safety net and LLM select write by id; pool read has no status filter) | pool read is `analyzed` only; safety net and select move only from `analyzed` |
| Bulk re-assess/pre-assess of a published story drops it from the site | refresh rows of the table (decision 1) |
| Publish job publishes a story trashed or rejected during `ensureEmbeddings` | the flip is `updateManyAndReturn ... WHERE status = 'selected'` inside the slug-locked tx; only moved ids get slugs and dates; count reports moved rows |
| Publish never re-elects the primary | re-election inside the publish tx (decision 4) |
| Dissolve restores editor/threshold rejections and demotes published duplicates to `analyzed` | one dissolve, restoring `duplicate` only, to `published` when `datePublished` is set (decision 3) |
| Three dissolve copies, cluster edits non-transactional | one implementation each, one transaction with the cluster row lock |
| Election can pick a trashed or editor-rejected member | decision 8 |
| `relevancePre` documented "immutable after set", rewritten by every pre-assess | doc corrected: set by each pre-assessment, rewritten by a bulk re-screen |

## Changes

### Step 1: harden the DB test tier (Part A)

| File | Change |
|---|---|
| `server/src/test/db/guard.ts` | `testDatabaseRefusal(url, devUrl?)`: local host (unchanged), database name matches `/_test$/`, and, when `devUrl` is given, a database name different from `devUrl`'s. Only `globalSetup` passes `devUrl` (the shell's `DATABASE_URL`, read before the db project overrides it); the truncate check in `harness.ts` keeps calling it with the URL alone, since inside the workers `DATABASE_URL` is the test URL by design. |
| `server/src/test/db/guard.test.ts` | Cases: `actually_relevant_test` accepted; `test_db` and `actually_relevant_dev` refused; remote host refused; same database as `DATABASE_URL` refused. |
| `server/src/test/db/globalSetup.ts` | Throw when `TEST_DATABASE_URL` is unset (message names the variable and `.context/database-migrations.md`), instead of returning. Pass the shell's `DATABASE_URL` to the guard as `devUrl`. Rest unchanged (`migrate deploy` via the project's CLI). |
| `server/src/test/db/harness.ts` | `describeDb` stops skipping (alias of `describe`, kept so the six existing `*.db.test.ts` files need no edit); drop `hasTestDatabase`. Fixtures: `createStory` takes `rejectionReason` (after step 3), `accessTier`, `clusterId`; new `createCluster(memberIds, primaryId)`; `statusesOf(ids)` returning `{ id, status, rejectionReason, slug, datePublished }` rows. |
| `server/vitest.config.ts` | Comment: the db project needs `TEST_DATABASE_URL` and fails without it. |
| `server/package.json` | `test` → `vitest run --project unit`; `test:watch` → `vitest --project unit`; `test:db` unchanged. |
| `.github/workflows/ci.yml` (new) | On `push` and `pull_request`. Job `server`: service `pgvector/pgvector:pg17` (`POSTGRES_DB=actually_relevant_test`), `actions/setup-node` with `node-version-file: .node-version`, `npm ci --prefix server`, `npm run db:generate --prefix server`, `npm run typecheck --prefix server`, `npm run test --prefix server`, `npm run test:db --prefix server` with `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/actually_relevant_test`. Job `client`: `npm ci`, `typecheck`, `test -- --run`. No secrets; `DATABASE_URL` unset. *Responsibility:* run the checks on every push. |
| `.context/database-migrations.md` | "Integration tests": no longer opt-in; `test` vs `test:db`; guard rule (`_test` suffix, local, not the dev database); the variable comes from the shell, not `.env`; creating `actually_relevant_test` on Docker (`localhost:5433`, pg17) and on the dev container's local pg16; CI; link to the new ADR. |
| `CLAUDE.md` | Commands block: add `npm run test:db --prefix server  # PostgreSQL integration tests (needs TEST_DATABASE_URL)`. |
| `.context/decisions/00NN-guarded-test-database.md` + index line in `.context/decisions.md` | ADR (next free number, 0043 today): tests migrate only the guarded test database with `migrate deploy` and TRUNCATE; the guard rules; CI service database; never `reset`/`dev`. Deciders: owner (approved 2026-10-19). |

### Step 2: lifecycle boundary tests on the real DB, before the module

| File | Change |
|---|---|
| `server/src/services/storyLifecycle.db.test.ts` (new) | The behaviors in `## Tests`, written against today's public entry points (`runPublishStories`, `selectStories`, `assessStory`, `preAssessStories`, `dissolveCluster`, `removeFromCluster`, `mergeClusters`, `rejectStory`, ...) with the LLM and embedding modules mocked as in `storyUpdate.db.test.ts`. Cases already correct pass; known-defect cases are `it.fails` with a comment naming the step that fixes them, and that step turns them into `it`. Later steps re-point the imports at the module where the entry point moves. |

### Step 3: migration

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `enum RejectionReason { paywall assess_threshold select_threshold selection duplicate editor }`; `Story.rejectionReason RejectionReason? @map("rejection_reason")`. |
| `server/prisma/migrations/<timestamp>_story_rejection_reason/migration.sql` (new, via `npm run db:migrate:create --prefix server -- --name story_rejection_reason`) | `CREATE TYPE "RejectionReason"`; `ALTER TABLE "stories" ADD COLUMN "rejection_reason" "RejectionReason"`; backfill `UPDATE stories SET rejection_reason = 'paywall' WHERE status = 'rejected' AND access_tier = 'locked'`; then `UPDATE stories s SET rejection_reason = 'duplicate' FROM story_clusters c WHERE s.status = 'rejected' AND s.rejection_reason IS NULL AND s.cluster_id = c.id AND c.primary_story_id IS DISTINCT FROM s.id`; then `ALTER TABLE stories ADD CONSTRAINT stories_rejection_reason_only_when_rejected CHECK (status = 'rejected' OR rejection_reason IS NULL)`. Delete the generated `DROP INDEX "stories_embedding_idx";`. Additive, cannot fail on existing data. Regenerating the client needs the dev server stopped (CLAUDE.md). |
| `shared/types/index.ts` | `RejectionReason` type; `rejectionReason: RejectionReason \| null` on the admin `Story` type. No UI change. |

### Step 4: the module

| File | Change |
|---|---|
| `server/src/services/storyLifecycle.ts` (new) | *Responsibility:* the only code that writes `stories.status` (and `rejection_reason`): the transition table, conditional moves, publish prep, primary election/auto-reject/restore, and cluster edits as transactions. *Exports:* `transition(ids, move, actor, opts?) → { moved, skipped: { id, status }[] }`; `partition(ids, move, actor) → { eligible, skipped }` (read-only, for bulk routes before they queue a task); `initialStatus(accessTier) → { status, rejectionReason }`; `recordAnalysis(stage, rows, embedding?) → per id 'advanced' \| 'refreshed' \| 'skipped'` (two conditional `updateMany` per row in one tx; embedding saved only for moved/refreshed rows); `reelectPrimary(clusterId, mode, tx, chosenPrimaryId?)`; `dissolveCluster(clusterId)`, `removeFromCluster(clusterId, storyId)`, `mergeClusters(targetId, sourceId)`; types `Move`, `Actor`, `MoveResult`. Private: the from-lists, `publishIds` (chunking by `config.publish.chunkSize`, `ensureEmbeddings` outside, then slug lock, cluster locks, conditional flip, slug batch `UPDATE ... FROM (VALUES ...)`, `datePublished` for moved rows without one, re-election), `withSlugLock`, `generateUniqueSlug(s)`, `preparePublishData`, restore-duplicates, the election ranking (moved from `dedup.ts` `updatePrimary`), calls to `forgetRelatedStories` for moves out of `published` and refreshed published stories. Logs each move with `createLogger('story-lifecycle')`, reason and skipped ids. |

### Step 5: move callers over, one per commit, deleting the tests each replaces

| Sub-step | Files | Change |
|---|---|---|
| 5a | `jobs/assessStories.ts`, `jobs/selectStories.ts`, `services/story.ts` `createStory` | threshold rejections via `transition(..., { to: 'rejected', reason: 'assess_threshold' \| 'select_threshold' }, 'pipeline')`; `createStory` spreads `initialStatus(accessTier)`. Delete the threshold-write assertions in `assessStories.test.ts`, `selectStories.test.ts`. |
| 5b | `services/analysis.ts` `selectStories`, `selectStoriesInGroups`; `routes/admin/stories.ts` `/select`, `/bulk-select` | pool read `status: 'analyzed'`, others returned as `skipped`; safety net and results via `transition`; `selectStories` returns `{ selected, rejected, skipped }` with only moved ids; bulk-select adds `partition` skipped ids to the existing `skipped` list (decision 9). Delete the selection write-sequence cases in `analysis.test.ts`. |
| 5c | `services/analysis.ts` `assessStory`, `preAssessStories`, `runBatchClassification`; routes `/:id/assess`, `/preassess`, `/bulk-assess`, `/bulk-preassess` | `assessStory` reads status first and skips `trashed` without an LLM call, then `recordAnalysis('assess', ...)`, dedup only for advanced/refreshed. `runBatchClassification` gains an optional `persist(rows)` parameter (default: today's plain field updates, still used by `reclassifyStories`/`tagEmotionOnly`); `preAssessStories` filters trashed ids before batching and persists via `recordAnalysis('preassess', ...)`. Single assess on trashed → 409 (with the typed conflict error from the errors branch if merged, else in the route); bulk routes add trashed ids to `skipped`. Delete the status cases in `analysis.test.ts`. |
| 5d | `services/story.ts` `bulkUpdateStatus`, `publishChunk`, `publishStory`, `updateStoryStatus`, `rejectStory`, `updateStory`; `jobs/publishStories.ts`; routes `/:id/status`, `/bulk-status`, `/:id/publish`, `/:id/reject`, `PUT /:id` | all go through `transition` (publish job as `pipeline`, routes as `editor`); `publishChunk`, slug helpers and `preparePublishData` leave `story.ts`; `updateStory` strips `status`, writes fields (keeping its content-edit embedding rule for published stories), then calls `transition` (decision 13); `/bulk-status` responds `{ updated, skipped }`; single routes return the story, 200 on a no-op (decision 10). `client/src/lib/admin-api.ts` bulk-status type gains `skipped`. Update `storyUpdate.db.test.ts` publish cases to the new path; delete the status/publish cases in `story.test.ts` and the publish-call assertions in `publishStories.test.ts`. |
| 5e | `services/dedup.ts` `detectAndCluster`, `updatePrimary`, `autoRejectNonPrimary`; `services/clusterRepair.ts` | cluster formation writes (`createCluster`, `addToCluster` loop) and `reelectPrimary(..., 'pipeline', tx)` in one transaction after the LLM confirmation; `updatePrimary` and `autoRejectNonPrimary` are deleted (their logic is the module's election); `repairClusters` calls `reelectPrimary` in pipeline mode inside a per-cluster transaction. Delete the `updatePrimary`/`autoRejectNonPrimary` cases and write-sequence assertions in `dedup.test.ts`; keep candidate and LLM-confirmation tests. |
| 5f | `services/cluster.ts` `createManualCluster`, `setClusterPrimary`, `removeFromCluster`, `mergeClusters`, `dissolveCluster`; `services/story.ts` `dissolveCluster(storyId)`; `routes/admin/clusters.ts`, `routes/admin/stories.ts` `/:id/dissolve-cluster` | `cluster.ts` keeps validation and reads; mutations run in one transaction with the cluster row locked, calling `reelectPrimary(..., 'editor-cluster', tx, chosen)`; `removeFromCluster`, `mergeClusters`, `dissolveCluster` delegate to the module; `story.ts` `dissolveCluster(storyId)` looks up the cluster id and calls the module's `dissolveCluster` (one implementation). Delete the mutation cases in `cluster.test.ts` and the dissolve call-sequence case in `routes/admin/stories.test.ts` (the "findUnique, updateMany x2, storyCluster.delete" one). |

### Step 6: fence and docs

| File | Change |
|---|---|
| `server/src/test/statusWriters.test.ts` (new) | Source scan in the style of `migrations.test.ts`/`blueprint.test.ts`: in non-test files under `src/` other than `services/storyLifecycle.ts` and `scripts/`, no `story.(create\|update\|updateMany\|updateManyAndReturn\|upsert)(` call whose argument contains a `status:` or `rejectionReason:` key, and no raw `UPDATE "stories" ... SET ... status`. *Responsibility:* keep the module the only writer. |
| `.context/story-pipeline.md` | Rewrite "Status Flow", "Status Definitions", "Transition Rules" around the table above and `storyLifecycle.ts`; restate "Terminal statuses" (no automated job moves a story out of `published`, `rejected`, `trashed`; editor-triggered analysis re-queues `rejected`, refreshes `selected`/`published`, skips `trashed`); paywall section: pre-assess also re-queues; "Where slugs are set" → the module's publish; Manual Admin Endpoints: skipped responses, 409 on trashed assess; Key Files: add the module; Story Fields: `relevancePre` drift fix, add `rejectionReason`. |
| `.context/dedup.md` | "Auto-Rejection and Admin Operations", "Remove member", "Dissolve", "Deleting members", "Cluster Formation", "Modifying the Dedup Logic", Key Files: election and auto-reject live in the module with three modes; dissolve/remove restore only `duplicate`; publish re-elects; all edits transactional; election excludes trashed and non-duplicate rejections. |
| `.context/story-retention.md` | One line: the repair re-elects through the module in pipeline mode and never restores. |
| `.context/decisions/00NN-story-lifecycle-owner.md` + index | ADR: one module writes story status, conditional moves returning moved/skipped, the transition table and the re-assess rule (owner-approved), re-election on publish, lock order. |
| `.context/decisions/00NN-story-rejection-reason.md` + index | ADR: the column, enum values, backfill guess, null never restored, CHECK constraint. |

## Tests

All in `storyLifecycle.db.test.ts` unless noted, against PostgreSQL, with OpenAI-backed modules mocked. Race cases make the mocked LLM or `ensureEmbeddings` change the row mid-call (e.g. trash the story), which only a real database turns into a test.

- **Select race:** a story trashed during the select LLM call stays `trashed`, is reported skipped, and is not published by the next publish run. A rejected-by-editor story likewise.
- **Selection never revives trashed:** a trashed non-primary passed to `selectStories` stays `trashed` (safety net) and a trashed id is never in the LLM pool.
- **Assess/pre-assess matrix (decision 1):** `published` keeps status, fields and embedding replaced, still served by slug; `selected` keeps status; `rejected` (paywall) → `analyzed`/`pre_analyzed` with reason null; `trashed` → skipped with no LLM call; trashed during the call → skipped, embedding not written; `relevancePre` rewritten on re-screen.
- **Publish-job race:** a story trashed during `ensureEmbeddings` stays `trashed`, gets no slug or date, and is not counted.
- **Publish and clusters (decisions 4, 7):** job publishes the selected primary, not a selected non-primary (which ends `rejected`/`duplicate`); after an editor publishes a non-primary, it becomes primary, the unpublished former primary is `rejected`/`duplicate`, published members are kept.
- **Editor publish override:** publishing a `trashed` or `rejected` story works and clears the reason; publishing a published story is a no-op.
- **Reasons:** paywall create, both thresholds, selection, duplicate and editor reject store the right reason; any move out clears it; the CHECK constraint rejects a reason on a non-rejected row.
- **Dissolve/remove (decision 3):** a published duplicate goes back to `published` with slug and date unchanged; a never-published duplicate to `analyzed`; `editor`, `assess_threshold`, `selection` and null rejections stay rejected; removing to one member dissolves with the same rule; the per-story `/dissolve-cluster` path behaves identically.
- **Election (decision 8):** never elects a trashed or editor-rejected member; editor reject of the primary elects the next member and restores it if it was a duplicate; pipeline re-election never restores.
- **Merge and set primary:** one transaction; published non-primaries rejected in editor-cluster mode; a chosen duplicate primary is restored.
- **Concurrency:** a publish and a trash of the same story run concurrently; the returned `moved`/`skipped` agree with the final row, and no deadlock with a concurrent dissolve of its cluster.
- **Repair:** `repairClusters` after deleting a primary re-elects without restoring (extend the existing case in `storyRetention.db.test.ts`).
- `guard.test.ts`: the rules in step 1. A unit test that `globalSetup` throws without `TEST_DATABASE_URL`.
- `routes/admin/stories.test.ts` (service mocked, existing pattern): `/bulk-status` returns `skipped`; `/:id/assess` on a trashed story returns 409; bulk routes merge trashed ids into `skipped`.
- `statusWriters.test.ts`: the fence (step 6) passes on the tree and fails on a planted `status:` write in a fixture string.

No new tests for docs, the CI file or the enum values.

## Out of Scope

- Mastodon/Bluesky picker drift and every other arch-issues candidate (3 story references, 4 social channel, 5 LLM call wrapper, 6 wire types, 7 job definitions, 8 podcast facade), including the `deleteStory` referrer defects.
- Splitting `services/story.ts` (the separate pending refactor) and the typed-errors/retries/config branch; this plan uses that branch's conflict error only if it has merged.
- Render `autoDeployTrigger: checksPass`, and branch protection on `main`.
- Approaches 2B (per-worker databases) and 2C (Testcontainers).
- Admin UI for the rejection reason (badge or filter) and any client display of skipped ids beyond the type.
- Concurrency of two `detectAndCluster` runs forming overlapping clusters; `lib/taskRegistry.ts` in-memory progress.
- Replacing route tests that mock the service layer: only Prisma call-sequence tests are deleted.

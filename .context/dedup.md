# Story Deduplication

Detects and clusters stories that cover the same event across different feeds. Prevents duplicate coverage from reaching the public site and shows "Also covered by" source attribution.

## How It Works

Two-stage detection triggered after story assessment:

1. **Embedding pre-filter:** Find the top `maxCandidates` (default 6) nearest stories by cosine distance (pgvector `<=>`). The search is limited to stories crawled within `timeWindowDays` (default 14). Only stories in `analyzed`, `selected` or `published` that have an embedding qualify. Each candidate must be either unclustered or the primary of its cluster, so non-primary members are never matched. There is no similarity threshold, just the closest N. Candidates without a title or summary are dropped. If no candidates remain, the LLM is not called (`findNearestCandidates()` in `server/src/services/dedup.ts`).
2. **LLM confirmation:** The small-tier model (`gpt-6-luna` at low effort by default; gpt-5-nano until the 2026-09-24 switch) evaluates whether candidates cover the *same specific event* (not just the same broad topic, nor a different development of the same ongoing story). Returns structured assessments per candidate.

## Cluster Model

Stories are grouped into clusters via `story_clusters` table:

- Each cluster has a designated **primary story** (the one shown to users)
- Non-primary members are auto-rejected with reason `duplicate`
- Election and auto-rejection live in the lifecycle module (`reelectPrimary()` in `server/src/services/storyLifecycle.ts`, ADR-0045), the only code that writes story status. A member is **electable** unless it is `trashed` or rejected for a reason other than `duplicate`. Electable members are ordered as follows:
  1. `duplicate` rejections come last.
  2. Published stories win, because readers have already seen them.
  3. Among published stories, the earliest `datePublished` wins.
  4. Among unpublished stories, the highest `relevance` wins.
  5. The tie-breaker is the earliest `dateCrawled`.

  If no member is electable, the primary pointer is left as it is (cleared only when it names a story no longer in the cluster). An admin can set the primary explicitly, either when creating a cluster or with set-primary. Any later re-election runs this ordering again and can override the admin's choice: after a new duplicate joins, after a member is removed, after a merge, after a publish, or after an editor rejects, trashes or re-queues a primary or published member.

  The election runs in one of three modes:
  - `pipeline` (dedup formation, publishing, repair after deletion): auto-rejects `fetched`, `pre_analyzed`, `analyzed` and `selected` non-primaries; published members are kept; nothing is moved out of `rejected`, so an elected duplicate stays rejected.
  - `editor-story` (an editor's status move of a primary or published member): as pipeline, but an elected `duplicate` is restored.
  - `editor-cluster` (create, set primary, remove member, merge): published non-primaries are rejected too, and the chosen or elected primary is restored if it was a `duplicate`.

  **Restoring** a `duplicate` rejection moves it to `published` if it has a `datePublished` (slug and date unchanged; its embedding is ensured after the commit), else to `analyzed`. An editor rejecting a `duplicate` turns its reason into `editor`, so no later dissolve restores it. Other rejection reasons, and rejections from before the reason existed (null), are never restored.
- A story can belong to at most one cluster

### Auto-Rejection and Admin Operations

**Auto-rejection** sets the non-primary members in the mode's from-list to `rejected`/`duplicate` (above). Members already `rejected` or `trashed` are left alone.

Admin operations (`server/src/services/cluster.ts` checks the arguments and reads; the writes are the module's). Each runs in **one transaction holding the cluster's row lock** (`withClusterLocks`), so a concurrent dedup, publish or second edit waits rather than interleaving:

- **Create** (`createManualCluster`): needs at least 2 stories, the designated primary must be one of them, and none may already be in a cluster (otherwise `StoriesAlreadyClusteredError`, a 409 listing the ids). Only stories still unclustered join; if any was clustered meanwhile, the whole creation rolls back with the same 409. The admin's primary is used as given (editor-cluster mode).
- **Set primary** (`setClusterPrimary`): the story must already be a member of the cluster; it is elected in editor-cluster mode.
- **Remove member** (`removeFromCluster`): the story must be a member. It leaves the cluster and is restored if it was a `duplicate`. If one member or none remains, the cluster is dissolved by the dissolve rule (the route answers `{ dissolved: true }`). Otherwise the primary is re-elected (editor-cluster mode).
- **Merge** (`mergeClusters`): a cluster cannot be merged with itself. All source members move to the target, the source cluster is deleted, and the target's primary is re-elected (editor-cluster mode).
- **Dissolve** (`dissolveCluster`, both `DELETE /clusters/:id` and the per-story `POST /stories/:id/dissolve-cluster`, one implementation): every `duplicate` member is restored, all members are unlinked, and the cluster record is deleted.

**Deleting members** (`repairClusters()` in `server/src/services/clusterRepair.ts`): deleting a story (`deleteStory()`) and the monthly retention cleanup (`story-retention.md`) repair each cluster they took members from in the same way, one transaction per cluster under its lock. A cluster left with one member or none is dissolved (the member is unlinked, the cluster row deleted; its status is left as it is). A cluster that keeps two or more members but lost its primary (`primary_story_id` is `ON DELETE SET NULL`) gets one by the election in pipeline mode, which never restores: an elected `duplicate` stays rejected.

## Pipeline Position

```
fetched -> pre_analyzed -> analyzed -> [embedding + dedup] -> selected -> published
```

After `assessStories()` completes, each newly analyzed story:
1. Gets its embedding generated (via `generateStoryEmbedding`)
2. Runs through `detectAndCluster()` which finds candidates, confirms duplicates via LLM, and creates/joins clusters

Dedup runs fire-and-forget after the assessment transaction commits (`assessStory()` in `server/src/services/analysis.ts`), so the embedding always exists by then. At most `config.concurrency.dedup` (2) run at once, queued behind a semaphore, so a large assess run never opens a cluster-locking transaction per story at the same time. A dedup failure never rolls back or blocks the assessment. `DEDUP_ENABLED=false` skips it entirely. A cluster is formed or joined only when the LLM confirms at least one candidate as `isDuplicate`. Out-of-range candidate numbers in the LLM response are ignored.

## Cluster Formation

If no confirmed duplicate is in a cluster yet, a new cluster is created with the source story and every confirmed duplicate as members. If any is clustered, the source joins the existing cluster as described below. Membership, election and auto-rejection run in one transaction after the LLM confirmation, holding the existing cluster's row lock (`formCluster()` in `dedup.ts`, calling `reelectPrimary(..., 'pipeline', tx)`): only stories still unclustered join, and if the existing cluster was dissolved meanwhile a new one is created. A formation that would leave fewer than two members (the stories joined other clusters during the model call) rolls back and forms nothing. Published members are preserved.

**Multi-cluster collisions:** when confirmed duplicates belong to different existing clusters, the source story joins the cluster of the **newest duplicate** (by `dateCrawled`). Other clusters are not auto-merged — merging requires explicit admin action via the clusters page. A warning is logged when this occurs. Duplicates already in a different cluster stay where they are; only unclustered duplicates are added to the target cluster.

## Selection Safety Net

In `selectStories()` (`server/src/services/analysis.ts`), before passing candidates to the LLM, non-primary cluster members are removed from the pool and set back to `rejected`/`duplicate` (only from `analyzed`). Publishing likewise re-elects the cluster of every story it publishes, and the publish job publishes only unclustered stories and cluster primaries, so one cluster never goes live twice. A story is eligible for selection only if it is unclustered or is its cluster's primary. This catches edge cases where dedup hasn't run or a story was manually un-rejected.

## Admin UI

Stories that belong to a cluster show indicators in the admin panel:

- **Story table:** A "Primary" (green) or "Cluster" (purple) badge appears next to the story title
- **Edit panel:** A read-only "Cluster" section shows role (Primary/Member), member count, other members, and a "Manage cluster" link to the clusters page. Includes "Dissolve cluster" button (with confirmation). Stories not in a cluster show a "Create cluster with this story" link.
- **Clusters page** (`/admin/clusters`): Dedicated admin page listing all clusters with primary story, member count, and creation date. "New Cluster" button opens a side panel with story search to create clusters manually. Side panel supports: changing primary, removing members, merging two clusters, and dissolving. Accessible via sidebar nav. Supports `?create=storyId` URL parameter for pre-selection from edit panel.
- **Bulk actions bar:** The stories page bulk actions bar includes a "Create Cluster" button (enabled when 2+ stories selected). Opens a dialog where the admin picks the primary story, with conflict warnings for already-clustered stories.
- Cluster data is included in both list queries (`ADMIN_LIST_SELECT` includes `clusterId` + `cluster.primaryStoryId`) and detail queries (full cluster with member list)

## Manual Cluster Creation

Admins can manually create clusters from three entry points:

1. **Bulk action bar** (Stories page): Select 2+ stories, click "Create Cluster", pick primary in dialog
2. **New Cluster button** (Clusters page): Opens a side panel with story search
3. **Create cluster link** (Story edit panel): Navigates to Clusters page with story pre-selected

Manual clusters work identically to automatic clusters: non-primary members are auto-rejected, primary selection can be changed later, and all the same management actions apply. Stories already in a cluster cannot be added (returns a 409 conflict).

## "Also Covered By" (Public)

Published stories that belong to a cluster show other cluster members as source attribution:

- **API:** `GET /api/stories/:slug/cluster` returns `{ sources: [{ feedTitle, sourceUrl }] }`
- **Component:** `AlsoCoveredBy` renders below the story header metadata
- Cached for 5 minutes (HTTP and TanStack Query)

## Configuration

In `server/src/config.ts` under `dedup`:

| Key | Default | Env Var | Description |
|-----|---------|---------|-------------|
| `maxCandidates` | 6 | `DEDUP_MAX_CANDIDATES` | Number of nearest stories to fetch |
| `timeWindowDays` | 14 | `DEDUP_TIME_WINDOW_DAYS` | Only check stories from last N days |
| `enabled` | true | `DEDUP_ENABLED` | Set to `false` to disable |
| `modelTier` | small | - | LLM tier for confirmation (`OPENAI_MODEL_SMALL` / `OPENAI_EFFORT_SMALL`) |

## Key Files

| File | Purpose |
|------|---------|
| `server/src/services/dedup.ts` | Core service: candidate finding, LLM confirmation, cluster formation |
| `server/src/services/storyLifecycle.ts` | Primary election, auto-reject, restore, and the dissolve, remove and merge writes (the only status writer) |
| `server/src/prompts/dedup.ts` | LLM prompt for duplicate confirmation |
| `server/src/schemas/llm.ts` | `dedupConfirmationSchema` Zod schema |
| `server/src/services/embedding.ts` | `generateStoryEmbedding()` for pre-selection embedding |
| `server/src/jobs/assessStories.ts` | Post-assessment dedup trigger |
| `server/src/services/analysis.ts` | Selection diversity safety net |
| `server/src/routes/public/stories.ts` | `/:slug/cluster` endpoint |
| `server/src/services/cluster.ts` | Cluster management: list, detail, create, search, set primary, remove member, merge, dissolve |
| `server/src/routes/admin/clusters.ts` | Admin cluster API endpoints (includes search-stories and create) |
| `server/src/schemas/cluster.ts` | Zod schemas for cluster creation and story search |
| `server/src/services/publicStories.ts` | `getClusterMembers()`, `getClusterRedirectSlug()` |
| `server/src/services/storyWrites.ts` | `dissolveCluster()` (per-story: looks up the cluster, calls the module) |
| `server/src/services/clusterRepair.ts` | `repairClusters()`: dissolve or re-elect (pipeline mode) after member deletion (`deleteStory()`, retention) |
| `server/src/routes/admin/stories.ts` | `POST /:id/dissolve-cluster` endpoint |
| `client/src/pages/admin/ClustersPage.tsx` | Admin clusters list page |
| `client/src/components/admin/ClusterTable.tsx` | Clusters list table |
| `client/src/components/admin/ClusterDetail.tsx` | Cluster detail side panel |
| `client/src/components/admin/CreateClusterPanel.tsx` | Create cluster side panel (search + select stories) |
| `client/src/components/admin/CreateClusterDialog.tsx` | Create cluster dialog (from bulk actions) |
| `client/src/hooks/useClusters.ts` | React Query hooks for cluster CRUD |
| `client/src/components/AlsoCoveredBy.tsx` | "Also covered by" UI component |
| `client/src/components/admin/StoryTable.tsx` | `ClusterBadge` in admin story table |
| `client/src/components/admin/StoryEditForm.tsx` | Cluster section in edit panel + "Manage cluster" / "Create cluster" links |
| `client/src/hooks/usePublicStories.ts` | `useClusterMembers()` hook |
| `server/prisma/schema.prisma` | `StoryCluster` model |

## Modifying the Dedup Logic

- **Change candidate selection:** Edit `findNearestCandidates()` in `dedup.ts` -- adjust the SQL query, time window, or add distance thresholds
- **Change LLM confirmation:** Edit prompt in `prompts/dedup.ts` and schema in `schemas/llm.ts`
- **Change primary selection:** Edit `electable` and `byElectionRank` in `storyLifecycle.ts`
- **Change auto-reject or restore behavior:** Edit `reelectPrimary()` and its modes in `storyLifecycle.ts` (`DUPLICATE_FROM`, `restoreDuplicates`). Keep the lock order (clusters by id, then stories) and run the change against PostgreSQL: `storyLifecycle.db.test.ts` (`npm run test:db`) covers the modes, dissolve, remove, merge and the races.
- **Dissolve a cluster:** `dissolveCluster()` in `storyLifecycle.ts` -- restores `duplicate` members, removes all `clusterId` references, deletes the cluster record

## Public URL Redirect

When a published story becomes a non-primary cluster member (e.g. after manual clustering), its public URL redirects (302, temporary) to the primary story's URL instead of returning 404. A temporary redirect is used because cluster primaries can change via admin actions (re-clustering, merge, set-primary).

- **Server:** `GET /api/stories/:slug` calls `getClusterRedirectSlug()` when the story is not found as published. Returns 302 redirect to `/api/stories/<primary-slug>` if the slug belongs to a non-primary cluster member whose primary is published.
- **Client:** `StoryPage` detects when the returned story's slug differs from the URL param and does a `navigate(replace: true)` to update the browser URL.
- **Service:** `getClusterRedirectSlug()` in `publicStories.ts` looks up the story by slug (any status), checks if it's a non-primary cluster member, and returns the primary's slug if the primary is published.

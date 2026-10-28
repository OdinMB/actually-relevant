# Story Pipeline

Stories are the core entity. They flow through a status pipeline from crawling to publication, driven by scheduled jobs and manual admin actions.

## Status Flow

Every automated stage transition is driven by a scheduled polling job, not by events. Each job queries for the stories eligible for its stage (by status and threshold) and processes them in bulk, so a story waits in its status until the next run of that stage's job. The one chained step is dedup, which runs right after a story's assessment commits (see `dedup.md`). The crawler creates stories in `fetched` status, and this pipeline only consumes them. A paywall-locked story is created `rejected` instead (below).

```
(crawl) → fetched → pre_analyzed → analyzed → selected → published
        ↘ rejected              ↘ rejected  ↘ rejected
          (paywall)               (assess)    (select)

rejected / trashed: from any status by an editor
```

**One module writes status.** `server/src/services/storyLifecycle.ts` is the only code that writes `stories.status` and `stories.rejection_reason` (ADR-0045); `server/src/test/statusWriters.test.ts` fails when any other source file does. Every move is conditional: it names the statuses it may move from and writes with `WHERE status IN (...)`, so a story an editor trashed or rejected while an LLM call or embedding pass was running is **skipped**, never forced. Every move returns `{ moved, skipped: { id, status }[] }` and logs both. Two actors: `pipeline` (the jobs and the bulk analysis and selection actions) and `editor` (explicit admin status and cluster actions).

**Rejection reasons.** Every move into `rejected` records why, in `rejection_reason` (ADR-0046): `paywall`, `assess_threshold`, `select_threshold`, `selection`, `duplicate` (a non-primary cluster member) or `editor`. Every move out clears it, and a database CHECK (`stories_rejection_reason_only_when_rejected`) refuses a reason on any other status. Rows rejected before the column existed have a reason only where the migration could tell (`paywall` for locked stories, `duplicate` for non-primary cluster members that were never published); the rest are null, and null is never automatically restored.

### Paywall-Locked Stories

A story whose access tier is `locked` (`content-extraction.md`, "Access Classification") is created `rejected` with reason `paywall` by `createStory()` (`initialStatus()` in the module, ADR-0031), keeping its row and teaser text. The pre-assess and assess jobs pick only `fetched`/`pre_analyzed` stories, so no model call is ever made for it; it gets no issue (`issueId` stays null), no embedding, never joins a cluster, and no selection, publish, newsletter, podcast or social stage ever sees it. Editors find these stories with the story list's "Paywall" filter (`?status=rejected&accessTier=locked`; picking "Paywall: Locked" while Status is the default "Published" switches Status to "Rejected", since a locked story is never published by the crawl) and the Paywall badge.

**Any editor action on it is the override.** There is deliberately no second gate later in the pipeline, so that an editor can re-queue stories on purpose, for example after switching a misclassified feed's detection off:
- **Re-assess** gives it a full analysis and sets it `analyzed`; **pre-assess** re-queues it to `pre_analyzed`. From there the jobs treat it like any other story, so it can publish automatically unless the editor rejects it again. It also enters dedup with its (headline-based) rating and can win a cluster over a free duplicate.
- **Publish straight from `rejected`** publishes a story with no AI title, summary or rating; the slug falls back to `sourceTitle`. No guard stops this.

### Status Definitions

| Status | Set By | Meaning |
|--------|--------|---------|
| `fetched` | Crawler, or an editor re-queue | Content extracted from RSS feed. Ready for LLM screening. |
| `pre_analyzed` | Pre-assess (job or editor) | Batch LLM screening assigned a screening rating (1-10) and emotion tag. |
| `analyzed` | Assess (job or editor), or a restored duplicate | Full LLM analysis complete: detailed factors, ratings, summary, blurb, etc. |
| `selected` | Select job or editor selection | LLM chose this story for publication from the analyzed pool. |
| `published` | Publish job or admin action | Live on the public site. |
| `rejected` | Crawler (paywall-locked), assess job, select job, dedup, or admin | Reason in `rejectionReason` (above). |
| `trashed` | Admin action | Soft-deleted. |

**Terminal statuses:** `published`, `rejected` and `trashed`. No automated job moves a story out of these; only an editor action does. Editor-triggered analysis (single or bulk pre-assess and re-assess) re-queues a `rejected` story, refreshes the fields of a `selected` or `published` one while keeping its status (a published one is re-embedded and its related-stories cache entry forgotten), and skips a `trashed` one: single re-assess answers 409 ("restore it first"), the bulk routes list it under `skipped`. Re-assess and pre-assess never move a story backward.

**Archive behavior:** Rejected and trashed stories stay available to review, re-assess or republish for 6 months (`config.storyRetention.maxAgeMonths`). After that the monthly `cleanup_old_stories` job deletes them (and `fetched`/`pre_analyzed` stories that old), keeping their counts for lifetime totals, unless a social post, newsletter, podcast or a published cluster member keeps them; old unpublished stories it keeps lose their embedding until published or re-assessed. See `story-retention.md`.

### Transition Rules

The table `storyLifecycle.ts` enforces. A move from a status not listed is skipped and reported. Moving back from `published` never clears `slug` or `datePublished`.

| Move | Actor | Allowed from | Result and side effects |
|---|---|---|---|
| create | crawler | new row | `fetched`; `accessTier = 'locked'` gives `rejected`/`paywall` |
| pre-assess result | pipeline | advance `fetched` → `pre_analyzed` | issue, `relevancePre`, emotion; trashed ids filtered out before the LLM call |
| pre-assess result | editor | advance `fetched`, `rejected`; refresh `pre_analyzed`, `analyzed`, `selected`, `published` (status kept) | as above |
| assess result | pipeline | advance `fetched`, `pre_analyzed` → `analyzed`; refresh `analyzed`, `selected`, `published` | fields and embedding in one transaction; dedup after commit |
| assess result | editor | as pipeline, plus advance `rejected` | a refreshed published story is re-embedded; `trashed` skipped before the LLM call and again at the write |
| assess threshold | pipeline | `pre_analyzed` | `rejected`/`assess_threshold` |
| select threshold | pipeline | `analyzed` | `rejected`/`select_threshold` |
| select | pipeline (job, `/select`, `/bulk-select`) | `analyzed` | `selected`, or `rejected`/`selection`; the pool read is `analyzed` only, other ids skipped |
| selection safety net | pipeline | `analyzed` | non-primary cluster members `rejected`/`duplicate` |
| publish | pipeline (job) | `selected`, unclustered or cluster primary | slug, `datePublished` where unset, embedding ensured outside the transaction; re-elects every cluster the chunk touches (pipeline mode), so a `selected` non-primary it left alone ends `rejected`/`duplicate` (reported as skipped with that status) |
| publish | editor | any but `published` (`trashed` included: the override) | as above; clears the reason |
| reject | editor | any but `rejected`/`editor` (a story rejected for another reason, a `duplicate` say, gets reason `editor`, so no dissolve brings it back) | `rejected`/`editor`; re-elects (editor-story mode) if it was published or the primary |
| trash | editor | any but `trashed` | `trashed`; re-elects as for reject |
| re-queue (`fetched`, `pre_analyzed`, `analyzed`, `selected`) | editor | any but the target | reason cleared; re-elects as for reject |
| set status (edit form, `PUT /:id/status`, `/bulk-status`) | editor | per target | routed to the publish, reject, trash or re-queue row |
| cluster edits | editor / pipeline | see `dedup.md` | election, auto-reject and restore of duplicates |

An editor move to the status the story already has is a no-op that answers 200 with the story. `PUT /:id` with a `status` writes the fields first, then the move, in two transactions: a failed move after a saved edit returns the error with the fields kept.

**Moves run in bounded chunks.** Every move but publishing (below) takes its ids in chunks of `config.database.moveChunkSize` (100), one transaction each. A status write re-indexes each row it touches, the pgvector index included, so a single transaction over a large backlog outlasted the transaction timeout: the selection job's `select_threshold` rejection of the whole below-threshold `analyzed` backlog failed with P2028 after 18.8s, which aborted the job before any selection ran. Each chunk commits on its own; a failure on a later chunk leaves earlier chunks moved, and because moves are conditional a re-run moves only what is left.

**Analysis results are written against the status read before the model call** (`recordAnalysis(stage, actor, rows, expected)`): a story an editor moved during the call (trashed, rejected) is skipped, so the editor's move stands.

**Lock order** in every transaction that writes status (moves, analysis results, publishing, cluster edits): the slug advisory lock (publish only), then the affected `story_clusters` rows `FOR UPDATE` ordered by id, then the story rows ordered by id; an election then locks its cluster's member rows in id order before writing. Publish locks the clusters of its chunk before the flip, so a concurrent cluster edit cannot deadlock against it. A move reads its stories' cluster ids before it can lock them, so a story can join a cluster (a manual cluster, a dedup formation, a merge) in between: after locking the story rows, the move compares their cluster ids with the clusters it locked, and when a new one appeared it rolls back and runs the whole transaction again, which then locks that cluster first. At most three attempts, then the move fails with "gave up moving stories after 3 attempts: their clusters kept changing" (`lockForMove`, `retryOnClusterChange`; `storyLifecycle.db.test.ts` reproduces the race).

**Restored stories get their embedding back.** A cluster edit or editor election that restores a published `duplicate` puts it back on the site; its embedding is ensured after the commit, outside the transaction (the retention job may have cleared it), and a failure is logged and leaves it published without one, as for every publish path.

**Publishing.** The publish job and editor publishes go through the module's `transition(ids, { to: 'published' }, actor)`. Ids are processed in **bounded chunks** of `config.publish.chunkSize` (default 100, env `PUBLISH_CHUNK_SIZE`): for each chunk the embeddings of the still-eligible ids are ensured first, outside any transaction (a failure is logged and the publish goes ahead without one), then one slug-locked interactive transaction locks the chunk's clusters and story rows, reads which locked rows are still eligible, generates slugs for those without one, and writes status, slug (where unset) and `datePublished` (where unset) in **one** `UPDATE … FROM (VALUES …)` statement, then re-elects the moved stories' clusters. One statement matters: every write to these indexed columns adds an entry to each of the table's indexes, the pgvector one included, so the earlier three separate writes (status, slug, date) tripled the work under the slug lock, and before that a per-story slug loop exceeded the transaction timeout (P2028). Only moved ids get slugs and dates, and the job counts moved rows. Each chunk **commits independently**: a failure on a later chunk leaves earlier chunks published, and the next run resumes from the remaining `selected` stories. Chunking bounds the embedding pass and the transaction within Render's memory limit and the transaction timeout (`DB_TRANSACTION_TIMEOUT_MS`, default 15000ms, `config.database.transactionTimeoutMs`).

Slug generation is a read-modify-write over the global slug namespace, so it runs under `withSlugLock` (`server/src/services/storySlugs.ts`): a transaction holding a shared `pg_advisory_xact_lock` that spans both the existing-slug read and the write. **The lock is acquired with `$executeRaw`, not `$queryRaw`**: `pg_advisory_xact_lock()` returns Postgres `void`, and `$queryRaw` tries to deserialize the result column and throws P2010; `$executeRaw` deserializes nothing. The lock is always acquired before any row lock (no advisory⇄row lock cycle) and auto-releases on commit.

### Slugs

Stories get a URL slug (e.g. `ai-breakthrough-in-protein-folding`) when they are first published. Slugs are **immutable by default** — changing the title of a published story does not regenerate the slug, preserving existing URLs, and unpublishing keeps it. Admins can manually edit a slug via the story edit form.

**Generation rules:**
- Created from `title` (falls back to `sourceTitle`) using `server/src/utils/slugify.ts`
- Lowercase, hyphens only, max 80 chars (truncated at word boundary)
- Duplicates resolved by appending `-2`, `-3`, etc. (`generateUniqueSlugs()` in `storySlugs.ts`)
- Stored as `slug String? @unique` — nullable because unpublished stories don't have one

**Where slugs are set:** only the module's publish, for moved stories without a slug.

**Public routing:** `/stories/:slug` — the public API and client both use slug-based URLs exclusively.

### Automated Jobs

| Job | Schedule | What It Does |
|-----|----------|--------------|
| `crawl_feeds` | Every 6 hours | Fetches RSS feeds, extracts content, creates stories as `fetched` (paywall-locked ones as `rejected`/`paywall`) |
| `preassess_stories` | Configurable | Batch pre-screens all `fetched` stories |
| `assess_stories` | Configurable | Full analysis on `pre_analyzed` stories with `relevancePre >= threshold` (per-issue `minPreRating`, else `fullAssessmentThreshold`, default 5); rejects the rest (`assess_threshold`) |
| `select_stories` | Configurable | Selects top ~50% of `analyzed` stories with `relevance >= 5` (both configurable via `config.selection.*`), batched into groups of ≤20; rejects the rest (`select_threshold`, `selection`) |
| `publish_stories` | Configurable | Publishes the `selected` stories that are unclustered or their cluster's primary (in bounded chunks of `config.publish.chunkSize`); a selected non-primary is rejected as `duplicate` by the re-election |

Selection: candidates go through LLM selection (~`config.selection.ratio`, default 50%, rounded up); when there are more than `config.selection.maxGroupSize` (default 20), they are split into roughly equal groups (e.g. 25 stories → 13 + 12). Only unclustered stories and cluster primaries are eligible; before the LLM call `selectStories()` rejects any non-primary member in the pool as `duplicate` (`dedup.md`, "Selection Safety Net").

### Manual Admin Endpoints

| Endpoint | Effect |
|----------|--------|
| `POST /api/admin/stories/preassess` | Trigger pre-assessment (optional story IDs), as an editor |
| `POST /api/admin/stories/:id/assess` | Full assessment for one story, as an editor; 409 on a trashed story |
| `POST /api/admin/stories/bulk-preassess`, `/bulk-assess` | Queue a task for the ids an editor's analysis may write; trashed and processing ids come back under `skipped`; 409 when none is left |
| `POST /api/admin/stories/select`, `/bulk-select` | Selection on given ids; only `analyzed` ids are used, the rest come back under `skipped` (`/bulk-select` needs two) |
| `POST /api/admin/stories/:id/publish` | Publish (no-op if already published) |
| `POST /api/admin/stories/:id/reject` | Reject with reason `editor` (no-op if already rejected) |
| `PUT /api/admin/stories/:id/status`, `PUT /:id` with `status` | Editor move to that status |
| `POST /api/admin/stories/bulk-status` | Editor move for many ids; answers `{ updated, skipped }` |
| `POST /api/admin/stories/bulk-tag-emotions` | Backfill emotion tags only (no issue reassignment, no status) |

## Key Files

| File | Role |
|------|------|
| `server/src/services/storyLifecycle.ts` | The only status writer: transition table, conditional moves, analysis results, publishing, primary election, cluster edits |
| `server/src/services/storySlugs.ts` | Slug lock, unique slug generation, batched slug write (used by the module's publish) |
| `server/src/services/story.ts` | Barrel re-exporting the story service modules below (the import path routes, jobs and test mocks use) |
| `server/src/services/storyQueries.ts` | Admin list and filters, by-id reads, status counts, `getStoryIdsByStatus` |
| `server/src/services/storyWrites.ts` | Create, admin edit, editor status actions (through the module), delete, per-story cluster dissolve |
| `server/src/services/publicStories.ts` | Public listing, story by slug, cluster redirect and sources, homepage buckets |
| `server/src/services/storySearch.ts` | Public hybrid (semantic + text) search, `hybridSearch()` (`.context/embeddings.md`) |
| `server/src/services/relatedStories.ts` | Related stories, their LLM re-rank and cache (`forgetRelatedStories()` clears entries) |
| `server/src/services/storySelect.ts` | `PUBLIC_STORY_SELECT`, the field selection every public story read uses |
| `server/src/services/clusterRepair.ts` | `repairClusters()`: dissolves or re-elects clusters after member deletes, shared by `deleteStory()` and the retention cleanup |
| `server/src/services/analysis.ts` | LLM orchestration (preassess, assess, select); results written through the module |
| `server/src/jobs/preassessStories.ts` | Scheduled pre-assessment |
| `server/src/jobs/assessStories.ts` | Scheduled full assessment |
| `server/src/jobs/selectStories.ts` | Scheduled selection |
| `server/src/jobs/publishStories.ts` | Scheduled publishing |
| `server/src/routes/admin/stories.ts` | Admin API endpoints |
| `server/src/routes/public/stories.ts` | Public API (published stories only) |
| `server/src/services/storyLifecycle.db.test.ts` | PostgreSQL tests of the table, the races and the cluster rules (`npm run test:db`) |

## Story Fields

Stories carry both crawled data and AI-generated analysis:

**Source data** (set during crawl, never modified afterwards): `sourceUrl`, `sourceTitle`, `sourceContent`, `sourceDatePublished`, `dateCrawled`, `feedId`, `crawlMethod`, `accessTier` (`free`, `metered`, `locked`, `unknown`; null on stories crawled before it existed)

**Issue assignment** (set during pre-assessment): `issueId` — the LLM-assigned issue for this story. Set by `assignIssuesToStories()` as the first step of pre-assessment. Falls back to `feed.issueId` if the LLM returns an invalid slug. Downstream code uses `story.issue ?? story.feed.issue` for issue lookup.

**Platform data**: `title` (AI-generated, nullable), `slug` (generated on publish), `datePublished` (set on first publish), `rejectionReason` (set on every move into `rejected`, cleared on every move out; above)

**Pre-assessment fields** (set during batch LLM screening):
- `relevancePre` — screening rating (1-10) on the generic impact scale; rewritten when an editor pre-assesses the story again
- `emotionTag` — one of: uplifting, frustrating, scary, calm

**Full assessment fields** (set during in-depth LLM analysis):
- `title` — AI-generated headline (also listed under Platform data)
- `titleLabel` — short AI-generated label shown above the title. Together with `title` and `summary`, it is the embedding input; the embedding is generated and saved atomically with the analysis (`embeddings.md`).
- `relevance` — single relevance rating (1-10)
- `summary` — 40-70 word summary
- `quote` — key quote with attribution
- `quoteAttribution` — speaker name/title, organization name, or "Original article" for non-quotes
- `marketingBlurb` — up to 230 chars, starts with publisher name
- `relevanceReasons` — detailed factor bullet points (newline-separated)
- `antifactors` — limiting factor bullet points (newline-separated)
- `relevanceCalculation` — rating calculation steps (newline-separated)

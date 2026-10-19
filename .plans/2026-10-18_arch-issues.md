# Architectural friction: deepening candidates (2026-10-18)

Produced by `/find-arch-issues`, full-codebase scope (server, client, shared). This is a findings
report, not a plan: nothing here is approved work. Pick a candidate and feed it to `/plan`.

**Defaults taken, since no one was available to ask:**
- Scope: whole repository except `pm/`, `server/src/scripts/` (one-off operator scripts) and the eval
  harness, which were only consulted where application code mirrors them.
- No Explore sub-agent was available in this run, so the exploration was done directly in one context.
- Severity uses the `/find-tasks` scale (critical / important / moderate). Candidates that need an owner
  decision are listed first, then the rest by severity.
- Concrete defects found along the way are named as evidence for a candidate, not filed separately.
  Each is worth confirming against a real database before fixing (see candidate 2 for why that is hard
  today).

## Summary

| # | Candidate | Severity | Owner judgment needed |
|---|-----------|----------|-----------------------|
| 1 | Story status transitions have no owner | critical | Yes: what re-assess, dissolve and publish should do to status |
| 2 | Database behavior is untestable: every test mocks Prisma | critical | Yes: which test database |
| 3 | What references a story is known in three places, and they disagree | important | Yes: foreign keys or join tables (migration) |
| 4 | Bluesky and Mastodon are two copies of one social channel | important | Yes: third channel planned? unify tables? picker drift intended? |
| 5 | Every structured LLM call is hand-rolled | important | Partly: recording the model id per story (AI Act record) |
| 6 | Server and client wire types are not connected | moderate | Yes: build and deploy change (`shared/` outside the server root) |
| 7 | A job's definition is spread over about ten places | moderate | No |
| 8 | Podcast: twenty modules, no single episode interface | moderate | No (leave it is a fair answer) |

---

## 1. Story status transitions have no owner (critical)

**Cluster:** `services/story.ts` (`updateStory`, `updateStoryStatus`, `publishStory`, `rejectStory`,
`bulkUpdateStatus`/`publishChunk`, `deleteStory`, `dissolveCluster`), `services/analysis.ts`
(`preAssessStories` via `runBatchClassification`, `assessStory`, `selectStories`),
`services/dedup.ts` (`autoRejectNonPrimary`), `services/cluster.ts` (`removeFromCluster`,
`mergeClusters`, `dissolveCluster`, set primary), `jobs/assessStories.ts`, `jobs/selectStories.ts`,
`crawler.ts` via `createStory`.

**Why they're coupled:** they share the `stories.status` column and the cluster membership/primary
invariant, but each writes `status` directly with its own `prisma.story.update(Many)`. About 20 write
sites in 6 modules. No function knows the allowed transitions, and only the threshold rejections in the
two jobs condition the write on the current status.

**Evidence of drift** (`.context/story-pipeline.md` states rules the code does not enforce):
- "Terminal statuses: no automated job moves a story out of these." `selectStories()` writes
  `selected`/`rejected` by id with no status condition, after an LLM call that takes seconds; a story an
  editor trashes or rejects during that call is moved to `selected`, and the publish job then publishes it.
  `assessStory()` and pre-assessment do the same with `analyzed`/`pre_analyzed`.
- Bulk re-assess or bulk pre-assess of a **published** story silently sets it to `analyzed` or
  `pre_analyzed`: it drops off the site, keeps its slug and `datePublished`, and its social posts and
  newsletter entries point at a 404. No route restricts which statuses those bulk actions accept.
- Dissolving a cluster restores **every** `rejected` member to `analyzed` (three copies of that logic:
  `story.dissolveCluster`, `cluster.dissolveCluster`, inline in `removeFromCluster`), including members
  an editor rejected by hand or the assess threshold rejected. The fourth copy, inside `deleteStory`,
  does not restore at all. There is no record of *why* a story was rejected, so the code cannot tell.
- Publishing a story (any of the four publish paths) never re-elects its cluster's primary, though
  `updatePrimary` ranks published members first. The selection safety net and auto-reject then work from
  a stale primary.
- Cluster mutations (dissolve, merge, remove) run as several non-transactional statements.

**Cost of leaving it:** every new stage, bulk action or admin button adds another unguarded write, and
the races above are only caught in production. Changes to the pipeline need a reader to hold all twenty
sites in their head; the context file is the only place the state machine exists.

**Options:**
- **A. One story-lifecycle module** (`transition(ids, { from, to, reason })`) that issues a conditional
  `updateMany ... WHERE status IN (from)` and returns what actually moved, and owns the side effects of
  each edge: publish prep (slug lock, `datePublished`, embedding), cluster re-election after a publish or
  reject, and dissolve/restore. Analysis, dedup, cluster, jobs and routes call it instead of Prisma.
  Medium effort; touches ~6 modules; replaces the per-module "updateMany called with" assertions.
- **B. A + a rejection reason column** (`rejected_by`: threshold / selection / duplicate / paywall /
  editor) so dissolve restores only duplicate rejections. Adds a migration and a backfill decision for
  existing rows.
- **C. Leave the writes where they are, add `status` conditions** to each. Small, but the knowledge stays
  spread out and the next write site will miss it.

**Owner questions:** What should re-assess (and pre-assess) do to a published, trashed or rejected
story: keep the status and only refresh fields, or re-queue it? Should dissolving a cluster restore
stories an editor rejected by hand? Should a publish re-elect the cluster primary (and auto-reject the
previous primary)?

**Dependency category:** local-substitutable (Postgres). Only deepenable with confidence once candidate 2
gives a real database in tests: the bugs are in conditional updates, races and transactions.

**Test impact:** the status-related cases in `analysis.test.ts`, `story.test.ts`, `cluster.test.ts`,
`dedup.test.ts`, `selectStories.test.ts`, `assessStories.test.ts` and the dissolve case in
`routes/admin/stories.test.ts` (which asserts the exact Prisma call sequence) would be replaced by
boundary tests of the lifecycle module: "a trashed story is not selected", "re-assess keeps published".

---

## 2. Database behavior is untestable: every test mocks Prisma (critical)

**Cluster:** all 57 server test files that `vi.mock` `lib/prisma`, and the code whose correctness lives
in SQL: `services/storyRetention.ts` (monthly delete of production rows in one data-modifying CTE),
`jobs/jobLease.ts`, `services/podcastPipeline.ts` and `podcastGuards.ts` (episode lease, TTS spend
reservation), `services/adminNotices.ts` (dedupe and reopen), `lib/vectors.ts` (pgvector search),
`services/feed.ts`, `services/story.ts` (slug advisory lock, batched slug `UPDATE ... FROM VALUES`).
62 raw-SQL sites in 15 files.

**Why they're coupled:** the tests are coupled to Prisma's call shape rather than to outcomes. A test
asserts "`updateMany` was called with X" or scripts `mockResolvedValueOnce` per call (e.g. the dissolve
test in `routes/admin/stories.test.ts` lists "findUnique, updateMany x2, storyCluster.delete").

**Evidence:** `storyRetention.ts` has no test of its own; `cleanupOldStories.test.ts` mocks the whole
module, so the SQL that decides which production stories are deleted has never run under test. The same
holds for every lease, the spend cap and the notice dedupe: the interesting part is the `WHERE` clause,
and a mock accepts any `WHERE` clause. `migrations.test.ts` only reads migration files as text.

**Cost of leaving it:** the riskiest code (deletes, leases, money caps) is the least tested; refactors
like candidate 1 or 3 cannot be verified; mock-sequence tests break on harmless reorderings and pass on
real bugs.

**Options:**
- **A. A dedicated Postgres test database** (the Docker instance on `localhost:5433`, a separate
  database such as `actually_relevant_test`), migrated once per run, truncated per test file. Closest to
  production, pgvector included. Needs a guard so tests can only reach a database whose name marks it as
  the test database. Medium effort.
- **B. PGlite in-process** with its pgvector extension. No Docker; fast; but advisory locks,
  `FOR UPDATE SKIP LOCKED` and connection-pool behavior differ or are absent, which are exactly the lease
  and slug-lock cases.
- **C. Integration tests only for the raw-SQL modules** (retention, leases, notices, vectors) against
  option A, leaving the mocked unit tests elsewhere. Smallest step that covers the highest risk.

**Owner question:** which test database (A, B, or C as a first step), and may tests migrate it on their
own? No database is designated as the test database today, and migrations must touch only a designated
one.

**Dependency category:** local-substitutable.

**Test impact:** per *replace, don't layer*, once boundary tests exist the mock-sequence tests for these
modules (and the Prisma-shape assertions in route tests) should be deleted, not kept beside them.

---

## 3. What references a story is known in three places, and they disagree (important)

**Cluster:** `services/story.ts deleteStory`, `services/storyRetention.ts deleteOldStoriesBatch`,
the dissolve logic (candidate 1), and the schema: `newsletters.story_ids`,
`newsletters.selected_story_ids` and `podcasts.story_ids` are text arrays with no foreign key, while
`bluesky_posts.story_id` and `mastodon_posts.story_id` are real foreign keys with the default
(restrict) delete rule.

**Why they're coupled:** each module that deletes or keeps stories re-derives "who points at this
story" on its own.

**Evidence:**
- `deleteStory()` removes the id from `newsletters.story_ids` and `podcasts.story_ids` but not from
  `newsletters.selected_story_ids`, which the retention SQL does check. A deleted story stays in a
  newsletter's selection.
- `deleteStory()` on a story with a social post fails on the foreign key (P2003), which the global error
  handler does not map (it handles P2025/P2002), so the admin gets a 500.
- Retention lists five referrers in SQL; `deleteStory` knows two; neither is shared, so the next table
  that names a story (the backlog's feedback or newsletter freshness ideas) has to be added to both by
  memory.

**Cost of leaving it:** dangling ids in newsletters and podcasts, failing deletes, and a retention rule
that silently stops protecting a new referrer.

**Options:**
- **A. One "story references" module**: a single query (SQL fragment) used by both the retention CTE and
  `deleteStory`, plus one cleanup function for the array columns. Small effort, no schema change.
- **B. Join tables with foreign keys** (`newsletter_stories`, `podcast_stories`, with position) so
  Postgres enforces it and `ON DELETE` decides. Migration with backfill, touches newsletter and podcast
  code that reads the arrays (about 40 sites); hard to reverse.
- **C. Leave the arrays, fix the two defects.** Smallest; the knowledge stays duplicated.

**Owner question:** is B worth a migration on the newsletter and podcast tables, or is A enough? And
should deleting a story that has a social post be refused (409), or delete the post record too?

**Dependency category:** local-substitutable.

**Test impact:** the `deleteStory` cleanup tests in `story.test.ts` and `routes/admin/stories.test.ts`
become one boundary test per referrer ("a story named by X is kept by retention and cleaned by delete").

---

## 4. Bluesky and Mastodon are two copies of one social channel (important)

**Cluster:** `services/bluesky.ts` and `services/mastodon.ts` (same 12 exports), `lib/bluesky.ts` and
`lib/mastodon.ts`, `routes/admin/bluesky.ts` and `routes/admin/mastodon.ts` (152 lines each, 70 lines
differ), `prompts/bluesky.ts` and `prompts/mastodon.ts`, `schemas/bluesky.ts` and `schemas/mastodon.ts`,
the `BlueskyPost`/`MastodonPost` tables and shared types, `client/src/pages/admin/BlueskyPage.tsx` and
`MastodonPage.tsx` (98 lines differ of ~380), the two metrics jobs, plus `services/socialMedia.ts` and
`jobs/socialAutoPost.ts`, which switch on the channel name.

**Why they're coupled:** one concept (draft, edit, publish, delete, metrics for a story on a channel)
implemented twice; only the transport, the length rule (300 graphemes vs `charLimit` characters) and the
link handling differ.

**Evidence of drift:** there are two "pick the best story" implementations. `bluesky.pickBestStory` skips
stories that already have a Bluesky post and uses `config.bluesky.pickModelTier`;
`socialMedia.pickBestStoryForSocial` (used by Mastodon's `pickAndDraft` and the auto-post job) does not
filter and uses `config.socialAutoPost.pickModelTier`. Mastodon's "pick and draft" can therefore pick a
story that already has a Mastodon post, and `generateDraft` then throws.

**Cost of leaving it:** every social fix is made twice or drifts; a third channel (Threads, LinkedIn) is
a third copy across about 10 files and a new table that retention and `findAutoPostCandidates` must also
learn about.

**Options:**
- **A. A `SocialChannel` port** (limit and counting rule, `buildPost`, `publish`, `delete`,
  `fetchMetrics`, `fetchFeed`) with Bluesky and Mastodon adapters, and one social-post service, one
  router parameterized by channel, one admin page. Medium effort; the two service test files collapse into
  one suite run against an in-memory adapter.
- **B. A + one `social_posts` table** with a `channel` column and per-channel JSON for ids and metrics.
  Simplifies retention and candidates; migration with data copy; hard to reverse.
- **C. Leave the duplication, fold the two pickers into one.** Small; fixes the drift only.

**Owner questions:** is a third channel planned (that decides between A and C)? Is the different pick
behavior and model tier intended? Any change to the pick or post prompts needs an `eval:recalibrate`
check of the social suite.

**Dependency category:** true external (mock at the port).

**Test impact:** `bluesky.test.ts`, `mastodon.test.ts` and most of `socialMedia.test.ts` replaced by one
channel-agnostic suite plus small adapter tests for each transport.

---

## 5. Every structured LLM call is hand-rolled (important)

**Cluster:** `services/llm.ts` (model factory and `rateLimitDelay`) and its 12 callers: `analysis.ts`
(3), `dedup.ts`, `story.ts` (related stories), `bluesky.ts` (2), `mastodon.ts`, `socialMedia.ts`,
`newsletter.ts` (2), `podcastScript.ts`; `lib/aiProvenance.ts`; the eval harness, which mirrors the
calls (`scripts/eval/models.ts`).

**Why they're coupled:** each caller repeats `rateLimitDelay()`, `getLLMByTier()`,
`withStructuredOutput()`, `invoke([new HumanMessage(prompt)])` and its own logging.

**Evidence:** the retry policy is inconsistent. `createChatModel` sets LangChain's `maxRetries: 3` for
every call; `newsletter.ts` and `podcastScript.ts` also wrap in `withRetry`, so one call can be attempted
up to 16 times, while the rest rely on LangChain alone (CLAUDE.md says LLM calls go through `withRetry`).
Only `podcastScript.invokeStructured` logs token usage and the model id. `aiProvenance.ts` marks stories
with the model *currently configured*, because "per-story ids are not recorded".

**Cost of leaving it:** no single place for cost and usage, retry, timeouts or provenance; each test file
mocks LangChain its own way (8 service test files); a model or SDK change touches every caller.

**Options:**
- **A. One `invokeStructured({ call, tier, schema, prompt })`** in `llm.ts` (generalize the podcast's
  version) returning `{ parsed, modelId, usage }`, owning rate limit, one retry policy and the usage log.
  Small to medium; mechanical at each caller; tests mock one function.
- **B. A + persist the model id** on each model-written story (and episode, post), so the
  machine-readable AI marker names the model that actually wrote the text. Adds a column and a decision in
  `.context/ai-transparency.md`.
- **C. Leave it, align the retry policy only.**

**Owner question (B only):** should the AI Act record carry the per-story model id instead of the
configured one? That is an open-decision change in `ai-transparency.md`.

**Dependency category:** true external (OpenAI; mock at `invokeStructured`).

**Test impact:** per-file LangChain mocks replaced by one mock of the call function; one test of the
function itself for retry and usage.

---

## 6. Server and client wire types are not connected (moderate)

**Cluster:** `shared/types/index.ts` (706 lines), `shared/constants`, `client/src/lib/admin-api.ts`
(its own response types: `AdminNotice`, `SubscriberRow`, `FeedQualityMetrics`, ...), server route
handlers returning Prisma rows, `server/src/lib/openapi.ts` (public API only), `server/tsconfig.json`
(`rootDir: src`, so the server cannot import `shared/`).

**Why they're coupled:** the client is typed against hand-written mirrors of Prisma models and route
shapes; the server never sees those types. Constants are duplicated too (`NOTICE_SOURCES` in
`adminNotices.ts` vs `ADMIN_NOTICE_SOURCES` in `admin-api.ts`; story statuses and job names in Prisma,
`shared/` and the client).

**Cost of leaving it:** a renamed or removed field on the server compiles on both sides and breaks the
admin at runtime; there is no test that holds them together.

**Options:**
- **A. Let the server import `shared/`** (tsconfig `rootDir`/paths, build output layout) and annotate
  route responses with the shared types. Requires the Render services to build with `shared/` available,
  which ties into the backlog's `buildFilter.paths` item.
- **B. Derive client types from the server's Zod schemas / OpenAPI spec** (extend `openapi.ts` to the
  admin API and generate types). More tooling, single source.
- **C. Leave it**, and add a few contract tests on the most-used responses.

**Owner question:** is a build and deploy change for `shared/` acceptable (A), or is generated types
from the spec (B) preferred?

**Dependency category:** in-process (types only).

**Test impact:** none removed; compile-time checking replaces runtime surprises.

---

## 7. A job's definition is spread over about ten places (moderate)

**Cluster:** `jobs/handlers.ts` (`JOB_HANDLERS`, `JOB_PIPELINE_ORDER`), `jobs/jobTimeZones.ts`,
`jobs/jobSettings.ts`, `jobs/jobEnableChecks.ts`, `lib/notify.ts` (`jobFailureNotice` category and
link), `scripts/seed-jobs.ts` plus a migration row, `shared/types` (`JobName`), `shared/constants`
(`JOB_NAMES`), `client/src/lib/constants.ts` (`JOB_DISPLAY_NAMES` and a second `JOB_PIPELINE_ORDER`).
`.context/scheduler.md` "Adding a job" lists four steps across these.

**Why they're coupled:** each file holds one attribute of the same thing, keyed by the job name string.

**Cost of leaving it:** adding a job means editing about ten files in three packages; a missed one fails
quietly (no display name, wrong catch-up order, wrong notice category). The two pipeline orders can
diverge.

**Options:**
- **A. One `JOB_DEFINITIONS` record per job** on the server (handler, pipeline position, time zone,
  setting, enable check, notice category, display name, default cron), from which the maps derive;
  `GET /api/admin/jobs` already returns `timeZone` and `setting`, so it can return display name and order
  too and the client copies go away. Small to medium.
- **B. A only on the server**, keeping the client constants. Smaller.
- **C. Leave it**, and add a test that every name appears in every map.

**Dependency category:** in-process.

**Test impact:** `jobSettings.test.ts`, `jobEnableChecks.test.ts` and the handler-map checks become one
table test over the definitions.

---

## 8. Podcast: twenty modules, no single episode interface (moderate)

**Cluster:** `services/podcast*.ts` (20 modules, about 4,000 lines), `routes/admin/podcasts.ts`
(imports from 8 of them), `jobs/generatePodcast.ts`, `publishPodcast.ts`, `podcastBootCheck.ts`.

**Why they're coupled:** the episode lease (`withEpisodeLease` in `podcastPipeline.ts`) and the
refusal rules (`podcastGuards.ts`) are called from `podcast.ts`, `podcastEditing.ts`,
`podcastPublish.ts` and `podcastStandalone.ts`; `GENERATE_PODCAST_JOB` lives in `podcastAudioStages.ts`
and is imported by jobs and the week slot. Understanding "may a person change this episode now" means
reading Guards, Pipeline and the module of the action.

**Cost of leaving it:** moderate. The design is recorded in ADR-0003 to ADR-0016, the lease and guards
are real seams, and the modules are cohesive. The cost is navigation, and each new admin action has to
remember to take the lease and run the right guard.

**Options:**
- **A. An `episodes` facade** (the operations the router and jobs call: create, advance, rewind, edit,
  replace stories, publish, unpublish, delete) that takes the lease and runs the guards once; the current
  modules become its internals. Medium effort, no behavior change.
- **B. Leave it.** A fair answer given the ADRs and test coverage.

**Dependency category:** remote but owned for the lease (Postgres), true external for ElevenLabs and
Bunny (already behind thin clients).

**Test impact:** route tests could mock the facade instead of eight modules; service tests unchanged.

---

## Not raised

- `client/src/layouts/PublicLayout.tsx` (789 lines) and the larger admin pages are long but not
  structurally coupled; that is decomposition for `/find-tasks`.
- `server/src/config.ts` (494 lines) is large by design (all tunables in one place).
- `lib/taskRegistry.ts` keeps bulk-task progress in memory, so it is lost on restart and invisible to a
  second instance; acceptable at one instance, worth revisiting only with candidate 1.

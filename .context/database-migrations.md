# Database Migrations

## Local Database

Local development runs PostgreSQL + pgvector in Docker (`docker-compose.yml` at the repo root): image `pgvector/pgvector:pg17`, `localhost:5433`, database `actually_relevant_dev`, credentials in the compose file. Start it with `docker compose up -d`. The container's user is a superuser, so Prisma can create its temporary shadow database for `migrate dev --create-only`. It is a disposable dev database, but never reset it without the user's go-ahead: it holds their local test data.

**Seed.** `npm run db:seed --prefix server` (also Prisma's `migrations.seed` in `prisma.config.ts`) upserts the issue taxonomy and five disabled job runs into whatever `DATABASE_URL` points at; it has no local-only guard, so run it only against the local database, or once against a new, empty production database (README, "Fresh Install"). A second run overwrites the seeded issues' fields and leaves existing job runs alone. The writes live in `prisma/seedDatabase.ts` (`prisma/seed.ts` is the entry), and two checks keep it in step with the schema: `npm run typecheck` checks `prisma/` against the generated client, and `src/test/db/seed.db.test.ts` runs the seed against the test database. A migration that drops or renames a column the seed writes fails both until the seed follows.

**Job rows.** The scheduler runs only jobs that have a `job_runs` row, and the migrations create rows only for `social_auto_post`, `bluesky_update_metrics`, `mastodon_update_metrics`, `publish_newsletter`, `generate_podcast`, `publish_podcast` (all disabled), `poll_plunk_activity`, `cleanup_old_stories` and `send_queued_confirmations` (all three enabled); `crawl_feeds`, the four story jobs and `generate_newsletter` get theirs from a seed. `npm run db:seed:jobs --prefix server` (`src/scripts/seed-jobs.ts`) creates every job's row that does not exist yet, disabled except `research_stories` (enabled; owner decision 2026-11-14), and never changes an existing one (`update: {}`), so it is safe to rerun on any database. Like `db:seed`, it writes to whatever `DATABASE_URL` points at, with no guard.

## How Migrations Reach the Local Database

**Automatically, on server dev start.** `npm run dev --prefix server` first runs `db:prepare` (wired as `predev`), which:

1. Loads `server/.env` the way `prisma.config.ts` does (values already in the environment win).
2. **Checks that `DATABASE_URL` is local** — host `localhost`, `127.0.0.1` or `::1`, or a Unix socket path in a `host=` query parameter. Anything else, including `host.docker.internal`, several `host=` parameters or a `hostaddr=`, an unparseable URL, or a non-postgres scheme, counts as remote: it prints a warning, skips everything and exits 0, so the server still starts. A missing `DATABASE_URL` also warns and exits 0. This guard is what stops a dev start pointed at a remote or production database from migrating it; it cannot detect an SSH tunnel that maps a remote database onto `localhost`.
3. Runs `prisma migrate deploy` with the project's own Prisma CLI (`server/node_modules/prisma`, never fetched by `npx`). This applies committed migrations only: no shadow database, no generate, no prompts, and it is a no-op when nothing is pending.
4. Regenerates the Prisma client only when `prisma/schema.prisma` changed since the last generate. Prisma 6 writes a reformatted copy of the schema into the client, so that copy cannot be compared with the source; instead `db:prepare` stores a SHA-256 of the source schema (line endings normalized) in `server/node_modules/.prisma/client/.db-prepare-schema.sha256` after each successful generate. No stamp or no client means it generates, so the first run after a fresh install (or after a `db:generate` run by hand) regenerates once.

Run it on its own with `npm run db:prepare --prefix server`. Skip it entirely with `SKIP_DB_PREPARE=1` (also `true`/`yes`), in the shell or in `server/.env`.

**A failed migration or generate stops the dev server from starting** (non-zero exit fails `predev`). That is deliberate: a server running against a half-migrated database or a stale client fails in more confusing ways later. The script prints a one-line cause and Prisma's last lines:

| Message | Cause | Fix |
|---|---|---|
| Cannot reach the database | Docker container not running (P1001) | `docker compose up -d` |
| A migration failed | The SQL errored (P3018) or an earlier failure is recorded (P3009) | See "Migration Marked as Failed" below |
| Cannot replace the Prisma client | Another process (usually a server still running in another terminal) holds the query-engine DLL (`EPERM`/`EBUSY`) | Stop that process and retry |

Code: `server/src/scripts/db-prepare/` (`index.ts` orchestrates; `gate.ts` and `localDatabase.ts` hold the local-only guard; `schemaStamp.ts` the regenerate check; `prismaCli.ts` runs the project's own CLI, also for the eval copy's import; `prismaOutput.ts` reads Prisma's output; `scratchDatabase.ts` holds the rule for the scratch databases a command empties, `*_synthetic` and `*_eval`).

## Run Locally with Synthetic Data

A separate local database filled with made-up content, for development, demos or a new maintainer: the app runs against it without touching the development or production data, and without a paid API call. `npm run db:seed:synthetic --prefix server` (`server/src/scripts/synthetic-data/`: `dataset.ts` the data, `seed.ts` the writes, `guard.ts` the database rule, `index.ts` the command) writes:

- the live site's issue taxonomy (its slugs and names, with made-up descriptions) and 15 feeds, three per top-level issue, one of them switched off and one failing;
- 45 stories in every status the pipeline uses: 26 published (every homepage section has uplifting, calm and negative ones), the rest fetched, pre-analyzed, analyzed, selected, trashed, and rejected with each reason; one dedup cluster, a published primary with two `duplicate` reports from other feeds; the two newest published stories researched (`research.ts`: a researched version built by the real projection, citing two invented outlets and the oldest published story, with the single-source snapshot), so the story page's researched format shows locally (`.context/story-research.md`, "Reader format");
- one of them, the free school lunches story, with story context (`context.ts`: a finished run, its facts and four cards written by hand, no model: a bar chart beside paragraph 1, a single figure beside paragraph 2, a line chart beside Why This Matters 1 and, under More context, a card whose one tile gives two sources' disagreeing figures; `.context/story-context.md`), so the cards and the admin's Context section show locally; the seed's last line names its page;
- two published newsletter issues (`/newsletter/week-NN-YYYY`) and this week's draft; two published podcast episodes with transcripts, whose audio URL points nowhere (the player lists them but cannot play them), and this week's episode stopped after story selection, as a dry run (silent stub voice);
- an admin login, `admin@example.org` with the password `synthetic-admin`: a throwaway that exists only in this local database.

Every place, organization and event is invented, and the only email address is on `example.org`. Every URL is on `synthetic.example.org` except the newsletter issues' "relevance analysis" links, which the seed builds from `SITE_URL` in its shell as the real newsletter does: unset, they point at the live site, where these stories don't exist, so the seed line below points them at the local client. The ids and the stories' text are fixed. The dates count back from the day the seed runs, so the site looks current, and the newsletter titles and slugs and the podcast week keys follow them.

**No embeddings.** The stories have none, and nothing calls OpenAI to make them. Related stories stay empty and search finds stories by text only (its semantic leg finds nothing). Publishing or re-assessing a story from the admin asks OpenAI for an embedding with whatever `OPENAI_API_KEY` the server has, which the run line below makes a placeholder that OpenAI refuses.

**Guarded.** `SYNTHETIC_DATABASE_URL` comes from the shell, never from `server/.env`, and must name a local database (the `db:prepare` host rule) whose name ends in `_synthetic` (`guard.ts`); anything else is refused before a connection, so neither `actually_relevant_dev`, a `*_test` database nor production qualifies. The seed replaces everything in the database except the migration history and `job_runs`, in one transaction. It refuses, and changes nothing, when the database holds a feed or story whose URL is not on `synthetic.example.org` or a user whose email is not on `example.org`, unless given `--reset`; a rerun over an unchanged data set needs no flag and writes the same rows again. It switches off every job in `job_runs`, so a server started against the database schedules no crawl, model call or send.

Against the Docker database: create the database once, apply the migrations (a shell value wins over `server/.env`), seed, then start the server against it:

```bash
docker exec actually-relevant-db psql -U ardev -d actually_relevant_dev -c "CREATE DATABASE actually_relevant_synthetic"
DATABASE_URL=postgresql://ardev:ardev_local@localhost:5433/actually_relevant_synthetic npm run db:prepare --prefix server
SYNTHETIC_DATABASE_URL=postgresql://ardev:ardev_local@localhost:5433/actually_relevant_synthetic SITE_URL=http://localhost:5173 npm run db:seed:synthetic --prefix server
DATABASE_URL=postgresql://ardev:ardev_local@localhost:5433/actually_relevant_synthetic NODE_ENV=development OPENAI_API_KEY=sk-none \
  DIFFBOT_TOKEN=none PIPFEED_API_KEY=none \
  PLUNK_SECRET_KEY=none PLUNK_PUBLIC_KEY=none PLUNK_FROM_EMAIL=none@example.org PLUNK_TEST_SEGMENT_ID=none SUBSCRIPTIONS_ENABLED=false \
  BLUESKY_AUTO_POST_ENABLED=false BLUESKY_SERVICE_URL=http://localhost:9 BLUESKY_HANDLE=none.invalid BLUESKY_APP_PASSWORD=none \
  MASTODON_AUTO_POST_ENABLED=false MASTODON_URL=http://localhost:9 MASTODON_TOKEN=none \
  ELEVENLABS_API_KEY=none BUNNY_STORAGE_ZONE=none BUNNY_STORAGE_PASSWORD=none TAVILY_API_KEY=none WEBHOOK_URL=http://localhost:9 \
  npm run dev --prefix server
```

**Keep the placeholders on the server line.** The server also loads `server/.env`, so without them its Plunk, Bluesky, Mastodon, ElevenLabs, Bunny, Tavily, extraction and webhook credentials would be live, and a send, post or publish clicked in the admin of this made-up database could email real subscribers or post to the real accounts. A value set in the shell wins over `server/.env`. The placeholders are non-empty on purpose: on Windows an empty variable can be dropped on its way to the server, and the real value from `server/.env` would then load. Each one disarms its service:

- the switches read `false`, so auto-posting and signups are off;
- the Bluesky, Mastodon and webhook URLs point at `localhost:9`, where nothing listens, so those calls fail on the machine;
- Plunk, ElevenLabs, Bunny, Diffbot and PipFeed have fixed hosts in the code, and each rejects its placeholder key, so a newsletter send, a subscriber listing or an upload is refused there. Under `NODE_ENV=development` the podcast episodes the server makes or rewinds are dry runs, like the seeded draft, and their silent stub voice never calls ElevenLabs;
- `TAVILY_API_KEY=none` keeps the real Tavily key from loading. It switches story research on, but a run started there fails its queries call on `sk-none` before any search, so it ends as `fallback` and spends nothing (a failed model call counts $0; a search would get Tavily's 401).

A credential added to `env.example` later belongs on this line too.

The server still sends its model calls to OpenAI, which refuses the placeholder key: what needs a model (assessing, search's semantic leg, newsletter and podcast generation, the embedding made on publish) fails or falls back instead. Without a migrated schema the seed stops with Prisma's missing-table error and the `db:prepare` line to run. `seed.db.test.ts` runs the seed against the test database (`npm run test:db`).

## A Stories-Only Copy for Cloud Evals

The evals (`model-eval.md`) read stored stories, and a cloud session has only an empty local PostgreSQL. So the owner exports a copy of his local database that holds only what the evals read, six months of stories unless he asks for more, with every value that could name a person replaced, and the cloud session imports it into a local `*_eval` database. Code: `server/src/scripts/eval-db/` (`tables.ts` the classification and each table's row rule, `scrub.ts` the scrub, `window.ts` the window, `selection.ts` which rows a window holds, `references.ts` the foreign keys and their guard, `copyFile.ts` the file format, `exportCopy.ts` and `importCopy.ts` the two directions, `guard.ts` the database rule, `export.ts` and `import.ts` the commands).

**What it holds.** An allowlist, `EXPORTED_TABLES` in `tables.ts`, in load order: `issues`, `feeds`, `stories`, `story_embeddings`, `story_clusters`; the research and context runs (`story_research_runs`, `story_context_runs`, `context_facts`, `context_boxes`, `context_search_cache`); research passes and their evidence pool (`research_passes`, `article_versions`, `evidence_searches`, `evidence_sources`, `pool_facts`, `pass_boxes`); and the overviews (`overviews`, `overview_decisions`, `overview_entries`, `overview_stands`). Every column of each is classified there as kept or scrubbed.

**What it never holds.** Every other table, each listed in `EXCLUDED_TABLES` with its reason: `users`, `refresh_tokens`, `pending_subscriptions`, `edition_switches`, `feedback`, `admin_notices`, `newsletters`, `newsletter_sends`, the four podcast tables, `job_runs`, `job_month_spend`, `spend_warnings`, `bluesky_posts`, `mastodon_posts`, and the favicons and `story_archive_counts`, which no eval reads. No exported table has a foreign key into one of them. Two parts of `eval:models` read an excluded table and see less: the newsletter suite finds no newsletters and reports the shortfall (`newsletters: 0 of 4`), and the social pick, finding no stored posts, scans synthetic 11:30 UTC windows instead. No other query in `scripts/eval/` reads an excluded table.

**The window (owner decision, 2026-11-26).** The whole database is several GB, so the copy holds six months of stories by default, a file small enough to upload through a chat. `--months <n>` names another number of calendar months back from the export time (a day the earlier month lacks becomes its last day), and `--all` holds every row of every exported table, as the copy did before the window. A story is in the window by `stories.date_crawled`, when the pipeline first saw it (the evals' own date floors read the same column). The export then closes the copy until every foreign key in it points at a row in it, inside its snapshot with SELECTs only (`selection.ts`): the read-only session allows no temporary table, so the ids travel as array parameters (`= ANY`), round after round until no row joins. Each table's rule is its `rows` in `tables.ts`:

- **Stories:** those in the window, plus every older story a row of the copy points at: a cluster's primary and all its members (the dedup eval compares a story with its cluster), every story with an entry in an overview of the copy and every story one of its decisions names, and the story of any row a story-owned row links to (a pool fact's source, a context fact's run, a card's pass, a pass's version; the same story by construction, which the closure makes sure of). The closure is transitive: an older story it adds brings its own cluster and overviews.
- **Story-owned tables** (`story_embeddings`, `story_research_runs`, `story_context_runs`, `context_facts`, `context_boxes`, `research_passes`, `article_versions`, `evidence_searches`, `evidence_sources`, `pool_facts`, `pass_boxes`): the rows of the copy's stories. A run or pass whose story is gone (a null `story_id`) is left out.
- **`story_clusters`:** the clusters of the copy's stories. **`overviews`:** those with an entry of a story in the copy (in the window or added for a reference), with all their `overview_entries` and `overview_stands`. **`overview_decisions`:** those of these overviews, and a decision that names no overview (a link that found none) with its story; a decision about a story of the copy that names an overview outside it is left out.
- **`context_search_cache`:** the rows created in the window. **`issues`, `feeds`:** every row.
- **What no closure reaches.** A reference to a row with no owner, such as a context run's research run whose story is gone, is written as null where the column allows it, and the export prints how many per column; where the column is required the export refuses, writing no file (`ReferenceGuard` in `references.ts`). The foreign keys come from the database's own catalog, so one a migration adds is followed and guarded with no code change; `tables.test.ts` fails a table without a rule, or with a rule whose column is no foreign key to its owner.
- **Not followed:** references without a foreign key (`evidence_sources.earlier_story_id`, the facts' `reused_from_id`, the fact ids inside JSON). The code already reads them as possibly gone.

`eval:overviews`' answer keys name stories from early 2026, before a six-month window that starts in late May: for it, export with `--months` reaching back to its oldest key story, or `--all`. The eval lists each key story the copy lacks as "not published in this database".

**The scrub.** An editor's action stores his user id where automation stores a marker: `overviews.frozen_by` and `recentered_by`, `overview_entries.joined_by` and `detached_by`, `overview_decisions.actor` and `undone_by`, and the change set the action keeps in `overview_decisions.inputs` (`detachedBy` and the like). These columns keep null and the system markers (`pipeline`, `review`, `recenter`, `burst`, `editor`), because code branches on them, and carry anything else as `editor`, the marker an editor's action already writes where it names no one. In `inputs` the same rule applies to the value of every actor key at any depth. Every other column is carried as it is. The export prints how many values each scrubbed column replaced.

**The fence.** `tables.test.ts` holds the classification against `prisma/schema.prisma` (read by `src/test/prismaSchema.ts`). A table the schema gains fails it until it is exported or left out with a reason, and a column an exported table gains fails it until it is kept or scrubbed. A column whose name reads like a person's (`*_by`, `actor`, `email`, `user_id`) cannot be kept without a reviewed entry in the test (`pool_facts.contradicted_by` holds fact refs). The never list above cannot be exported, and the load order must follow the foreign keys. The export runs the same check against the database itself: a column the classification does not name refuses the export before anything is written, so a database migrated ahead of the code cannot leak a new column either.

**Export, on the owner's machine.** From the repository root, with the Docker database running:

```bash
npm run db:export:eval --prefix server -- --out ../DOCS/2026-11-26_eval-db.jsonl.gz              # six months
npm run db:export:eval --prefix server -- --out ../DOCS/2026-11-26_eval-db.jsonl.gz --months 12  # or --all
```

It reads `DATABASE_URL` as the evals do (`server/.env`, a value in the shell winning) and prints only `local` or `remote` for it. It reads through the eval's read-only session (`model-eval.md`, "How it stays safe"), inside one `REPEATABLE READ, READ ONLY` transaction (`readOnlyDb.ts`'s `snapshot`, two hours at most), so tables read one after another agree, the window's selection included. The path is relative to `server/`, so the file lands in the gitignored `DOCS/`; it is written as `<file>.partial` and renamed once complete. The command prints the window (its cutoff, the stories first seen in it and the older ones kept for references), the rows per table, the values scrubbed, any references written as null, the tables left out, the database's newest migration and the size. The file is gzip JSONL: a header line (format, version, export time, migration, and the window: its months and cutoff, or `all`; a copy made before the window existed has none and held every story), one line per row in load order, and an end line with the counts. **Never commit it**: it lives outside the repository wherever it goes.

**Size.** Measured on the synthetic data set (45 stories) with a random 1,536-dimension embedding per story: about 7.8 MB per 1,000 stories, nearly all of it the embeddings (about 7.3 KB each, compressed; 0.44 MB per 1,000 stories without them). Real stories carry longer source text and research, so a production copy is somewhat larger per story.

**Import, in the cloud session.** The owner adds the file to the cloud project's files, where a session finds it at `/mnt/project-files/eval-db/`, outside the repository. Create the database once, then import:

```bash
psql -h localhost -U postgres -c "CREATE DATABASE actually_relevant_eval"
EVAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/actually_relevant_eval npm run db:import:eval --prefix server -- --in /mnt/project-files/eval-db/2026-11-26_eval-db.jsonl.gz
```

- **Guarded.** `EVAL_DATABASE_URL` comes from the shell, never from `server/.env`, and must name a local database (the `db:prepare` host rule) whose name ends in `_eval` (`guard.ts`, which shares `db-prepare/scratchDatabase.ts` with the synthetic seed's guard); anything else is refused before a connection.
- **Migrates, then replaces everything.** It applies the repository's migrations to that database (`prisma migrate deploy` with the project's own CLI). Then, in one transaction, it empties every table but the migration history and loads the copy in load order, with every foreign key enforced. The three foreign keys that close a cycle (`issues.parent_id`, `stories.cluster_id`, `research_passes.version_id`) are set once every table is in. It checks the counts against the end line and runs `ANALYZE`. Vectors round-trip exactly. It prints the copy's window from its header, then the rows per table.
- **Refuses** a file that is not a copy, is of another version, is cut short or disagrees with its counts, holds a table off the allowlist, or has a column the database lacks (a copy made at a newer migration than the checkout: update the checkout). A refusal leaves the rows as they were; migrations it applied stay. A copy older than the checkout loads, and a column added since holds its default in every row; the command says when the two migrations differ.

Then run an eval with `DATABASE_URL` set to the same URL, e.g. `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/actually_relevant_eval npm run eval:models --prefix server -- --out ../DOCS/<folder> --dry-run`. `evalCopy.db.test.ts` (`npm run test:db`) exports a filled test database with `--all` and imports it back: the file holds no excluded table and none of the editor's ids, emails or secrets, every scrubbed value is `editor`, every other row and vector comes back unchanged, an older story included, and a refused copy leaves the database as it was. A six-month export there holds none of an older story's rows but those of the older stories its rows point at (a cluster's primary and member, an overview's member and a story its decision turned away, a pool fact's source), writes the link to a run whose story is gone as null, refuses a required one, and imports with the foreign keys enforced; the catalog's foreign keys are held against the schema's.

## Authoring a Migration

1. Edit `server/prisma/schema.prisma`.
2. Generate the migration SQL without applying it:

   ```bash
   npm run db:migrate:create --prefix server -- --name migration_name
   ```

   This is `prisma migrate dev --create-only`: it replays the migrations into a shadow database to diff against the schema, writes `server/prisma/migrations/<timestamp>_migration_name/migration.sql`, and does **not** apply it or regenerate the client. If it fails, print the SQL instead and create the folder and file by hand with the file tools. Since `db:prepare` keeps the local database at the last committed migration, diffing it against the schema gives the new migration's SQL, with no shadow database (read-only):

   ```bash
   npm run db:migrate:diff --prefix server
   ```

3. **Review the generated SQL before committing it, and delete `DROP INDEX "story_embeddings_embedding_idx";`.** Both `db:migrate:create` and `db:migrate:diff` always emit that line, even with no schema change: the pgvector HNSW index on `story_embeddings` was created by raw SQL in `20261102120000_story_embeddings_table` (it replaced `stories_embedding_idx` from `20260206120000_add_embedding_fields` when the vectors left `stories`, ADR-0051), and Prisma 6 cannot represent an index on an `Unsupported("vector(1536)")` column, so it treats it as unknown and proposes dropping it. Committing it would turn every vector search into a sequential scan. `server/src/test/migrations.test.ts` and `npm run check:migrations` (below) fail if any migration drops the index without re-creating it in the same migration (comments are ignored, so a migration may mention it). Apart from that line, a migrate diff from a fully migrated database is empty: the earlier drift (newsletter_sends defaults, two missing indexes, the `feeds_url_key` rename) was reconciled by `20261005120000_reconcile_schema_drift`. Anything else in a fresh diff is drift, and belongs in its own migration, not hidden in an unrelated one.
4. Restart the dev server (or run `npm run db:prepare --prefix server`): the migration is applied and the client regenerated. If a dev server is already running, stop it first, or the regenerate hits the DLL lock.
5. Run `npm run check:migrations --prefix server` (below), then commit the migration folder with the schema change. Production applies it on the next green deploy.

## Migration check

`npm run check:migrations --prefix server` (`server/src/scripts/check-migrations/`, rules in `rules.ts`) runs in CI before anything else in the `server` job, so a failure keeps the commit from deploying (`deployment.md`, "CI gate"). It fails on:

- **`story_embeddings_embedding_idx` dropped and not re-created (as an HNSW index on `story_embeddings`), in any migration**, old or new. No marker excuses it. Its predecessor `stories_embedding_idx` is not guarded: `20261102120000_story_embeddings_table` dropped it on purpose.
- **`article_versions_one_current` dropped and not re-created on `article_versions`, in any migration**: the partial unique index that keeps one `current` article version per story (`20261117230407_research_passes`, `.context/research-passes.md`). Prisma cannot model a partial index either, but unlike the embedding index it leaves it out of its diffs, so a generated migration does not propose the drop; the guard catches a hand-written one. Both indexes are `UNMODELED_INDEXES` in `rules.ts`.
- **`overview_entries_one_active` or `overview_stands_one_current` dropped and not re-created on its table, in any migration**: the partial unique indexes that keep one active overview entry per story and one current stands version per overview (`20261118203742_overviews`, `.context/overviews.md`), guarded as `article_versions_one_current` is and listed beside it in `UNMODELED_INDEXES`.
- **Destructive statements in a migration the branch adds**: `DROP TABLE`, `TRUNCATE`, and any `ALTER ...` statement containing `DROP` (`DROP COLUMN`, `DROP CONSTRAINT`, `DROP DEFAULT`, `DROP NOT NULL`, ...). Migrations already on the base branch are not re-checked, so the historical drops (`drop_source_names`, `drop_email_events`, the schema restructure and the drift reconcile) pass.

A destructive migration passes once a person has reviewed it and it carries the marker on its own comment line, with a reason:

```sql
-- reviewed-destructive: column unused since 2026-10-01 (code stopped reading it in the previous deploy)
ALTER TABLE "stories" DROP COLUMN "legacy_field";
```

The marker covers the whole file. Before adding it, check the two-phase rule under "Production Migrations": the code that read the dropped object must already be deployed without it. A Prisma-generated `DROP CONSTRAINT`/`ADD CONSTRAINT` pair for a foreign-key change counts too: review it and mark it.

"Added" means added (or renamed) since the merge base with `--base <ref>` (default `origin/main`), including uncommitted and untracked files. CI passes the pull request's target branch, on `main` the commit before the push, and `origin/main` when the push names no previous commit; it checks out full history for this. A base git cannot resolve (a force-pushed-away commit, a shallow clone) fails the check rather than passing it; rerun locally with an explicit `--base`. The matching is textual, per statement with comments stripped: a drop inside a `DO` block or an `EXECUTE` string is not caught, and a string literal that reads like a drop is (mark it).

## Critical Rules

1. **Never use `npx prisma` directly.** Use the `npm run db:*` scripts with `--prefix server` (or the local CLI as above). `npx` can fetch `prisma@latest` from the registry instead of the lockfile's version.
2. **Never use `--no-engine` with `prisma generate`.** It generates a client that requires Prisma Accelerate (`prisma://` protocol) and breaks all database queries with error P6001.
3. **Never apply migrations with `prisma migrate dev` / `npm run db:migrate`.** On Windows it holds the query-engine DLL and can leave advisory locks, and it may prompt to reset the database on drift. Author with `--create-only`, apply with `db:prepare` / `migrate deploy`.
4. **Don't run `db:generate` while the dev server is running.** `prisma generate` replaces the query-engine DLL, which the running server locks (`EPERM`). Agents ask the user to stop their dev server first; usually just restarting the dev server is simpler, since `db:prepare` regenerates when needed.
5. **Never point `db:prepare` at a non-local database by widening the guard.** To migrate a remote database deliberately, run `npm run db:migrate:deploy --prefix server` against it on purpose.

## Integration Tests (PostgreSQL)

Most server tests mock Prisma. Logic whose guarantee lives in SQL (story status moves and cluster edits, retention keep rules and cluster repair, the job lease, pgvector queries (`lib/vectors.ts`), the issue filter, the signup send limits and the queued-signup job, the closed-editions guard's latest known edition per subscriber, slug assignment, the admin-notice dedupe and reopen, the podcast TTS spend cap, the podcast's per-show week key, standalone CHECK and per-show missed-week claim, the development seed, the eval copy's export and import) has `*.db.test.ts` files that run against a real database, as does the check of real public story responses against the documented schema (`ci.md`, "Public API contract"). They are the `db` project in `server/vitest.config.ts`; every other test is the `unit` project.

- **Three commands.** `npm run test --prefix server` runs the `unit` project only and needs no database. `npm run test:db --prefix server` runs the `db` project and **fails** when `TEST_DATABASE_URL` is unset (it used to skip). `npm run test:coverage --prefix server` runs both projects in one run with the coverage floor, which counts the db tests (`ci.md`, "Coverage floor"), and fails the same way without the variable; it is what CI runs. Run it, or `test` and `test:db`, before committing a change to anything a db test covers.
- **Replace, don't layer.** A module whose guarantee lives in SQL (raw queries, `ON CONFLICT`, advisory locks, row locks) is tested in a `*.db.test.ts`, and a mock test that only replays its SQL against a fake is deleted, not kept beside it. Keep a unit test for logic that does not need the database (input shaping, error mapping, decisions made in TypeScript).
- **The variable comes from the shell**, never from `server/.env`: the global setup reads the shell's environment, and `DATABASE_URL` there is still the development database.
- **Guarded (ADR-0044).** The URL must be local (the `db:prepare` host rule), its database name must end in `_test`, and it must not name the same database as the shell's `DATABASE_URL`; anything else fails the run before a query (`src/test/db/guard.ts`). The db project hands that URL to Prisma as `DATABASE_URL`, and the truncate refuses to run unless the two match.
- **Migrated once per run, and only this database.** The project's global setup runs `prisma migrate deploy` on the test database with the project's own CLI (`src/test/db/globalSetup.ts`). Tests never run `migrate reset` or `migrate dev`, and migrate no other database. pgvector must be available to the database (the Docker image has it).
- **Empty before each test.** `useTestDatabase()` truncates every table except `_prisma_migrations` before each test, seeded `job_runs` rows included, so tests insert what they need with the fixtures in `src/test/db/harness.ts`. Db test files run one at a time (`fileParallelism: false`).
- **No external calls.** Mock the OpenAI-backed modules (`services/embedding.js`, `services/llm.js`) as the unit tests do; `harness.ts` has unit vectors (`axisVector`, `setEmbedding`) for pgvector queries.
- **The type-check never sees a test file.** `tsconfig.json` leaves `*.test.ts` out and lint uses the untyped presets, so a result object built inside a db test, or deps missing a member the code has since gained, fails only when the `db` project runs. Build overview link results from `src/test/db/overviewFixtures.ts` (not a test file, so type-checked, and shared with the unit tests). The story context runs' fake, `src/test/contextDeps.ts`, answers each step from a map typed by the step's schema, so a step a run gains fails the type-check there until it is answered; the pipeline's unit fake, inside its test file, has no such check.

Against the Docker database (pg17, as production), create a test database once and point the variable at it:

```bash
docker exec actually-relevant-db psql -U ardev -d actually_relevant_dev -c "CREATE DATABASE actually_relevant_test"
TEST_DATABASE_URL=postgresql://ardev:ardev_local@localhost:5433/actually_relevant_test npm run test:db --prefix server
```

In a cloud dev container with a local PostgreSQL 16 and pgvector on `localhost:5432`, the same works with `psql -h localhost -U postgres -c "CREATE DATABASE actually_relevant_test"` and `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/actually_relevant_test`. The migrations use nothing that differs between 16 and 17.

**CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`: a `pgvector/pgvector:pg17` service with the database `actually_relevant_test`, then the server's migration check, type-check, `test:coverage` (unit and db projects in one run, with `TEST_DATABASE_URL` set to that database) and build, and the client's type-check, tests and build. It needs no secrets and leaves `DATABASE_URL` unset except for `db:generate`, which only wants a value. Render deploys a commit on `main` only once CI passes on it (`deployment.md`, "CI gate").

## Production Migrations

On Render (Linux), none of the Windows DLL-locking issues apply. Migrations run automatically during the build step:

```
npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build
```

The command lives in `render.yaml`; the blueprint sync of 2026-10-13 removed a leftover `migrate resolve --applied 20260209120000_add_feed_region` step from it (see `deployment.md`). Never add a `migrate resolve` to the build command: it runs on every deploy, and on a fresh database it marks a migration applied without running it.

Keep `--include=dev`: the service runs with `NODE_ENV=production`, and the Prisma CLI is a devDependency, which `npx prisma` must find locally rather than fetch as `prisma@latest` (see `deployment.md`). The build does not run `predev`, so `db:prepare` never runs on Render.

`prisma migrate deploy` applies pending migrations from `server/prisma/migrations/` without generating new ones or prompting. It's a no-op when nothing is pending. If a migration fails, the build fails and Render does not start the new version.

**Considerations:**

- **A migration is atomic, but a failure still blocks deploys.** Prisma 6 sends the whole `migration.sql` as one simple query, which PostgreSQL runs as one implicit transaction, so a failing statement rolls back the entire file (and `CREATE INDEX CONCURRENTLY` cannot be used). Don't add explicit `BEGIN;`/`COMMIT;`: a failure inside one hides the real error behind "current transaction is aborted" (prisma/prisma#15295). Prisma records the migration as started in a separate statement first, so even a fully rolled-back failure leaves a failed row and the next deploy stops with P3009 until `migrate resolve --rolled-back <name>`. Write migrations that cannot fail on existing data (backfill before `SET NOT NULL`, check uniqueness before a unique index). Prisma 7 sends statements one at a time, so re-check this before upgrading.
- **No automatic rollback.** Prisma doesn't generate down migrations. Destructive DDL (drop column/table) should be deployed in two phases: remove code references first, drop the column in a later deploy.
- **Advisory lock contention.** Overlapping deploys will compete for a Postgres advisory lock. One will wait — shouldn't deadlock, but avoid triggering manual deploys while an auto-deploy is in progress.
- **Migration ordering.** Concurrent branches adding migrations will apply in timestamp order. Avoid touching the same table in conflicting ways across branches.

## Command Reference

| Command | Purpose |
|---|---|
| `docker compose up -d` | Start the local database |
| `npm run db:prepare --prefix server` | Apply pending migrations and regenerate the client if the schema changed (local DB only; runs automatically before `dev`) |
| `SYNTHETIC_DATABASE_URL=… npm run db:seed:synthetic --prefix server [-- --reset]` | Fill a local `*_synthetic` database with the synthetic data set ("Run Locally with Synthetic Data") |
| `npm run db:export:eval --prefix server -- --out <file> [--months <n> \| --all]` | Write the stories-only, scrubbed copy of `DATABASE_URL` for cloud evals, six months of stories unless `--months` or `--all` says otherwise, through the read-only session ("A Stories-Only Copy for Cloud Evals") |
| `EVAL_DATABASE_URL=… npm run db:import:eval --prefix server -- --in <file>` | Migrate a local `*_eval` database and replace everything in it with that copy |
| `npm run db:migrate:create --prefix server -- --name <name>` | Generate migration SQL without applying |
| `npm run db:migrate:status --prefix server` | Check which migrations are pending/applied |
| `npm run db:migrate:diff --prefix server` | Print the SQL from the database to the schema, read-only (expected: only the `story_embeddings_embedding_idx` drop) |
| `npm run check:migrations --prefix server [-- --base <ref>]` | Fail on the embedding-index drop anywhere, or an unmarked destructive statement in a new migration (runs in CI) |
| `npm run db:migrate:resolve --prefix server -- --rolled-back <name>` | Mark a failed migration as rolled back |
| `npm run db:migrate:deploy --prefix server` | Apply pending migrations to whatever `DATABASE_URL` points at (no local guard) |
| `npm run db:generate --prefix server` | Regenerate the Prisma client (**dev server stopped**) |
| `npm run db:seed --prefix server` | Upsert the issue taxonomy and five disabled job runs (local DB, or once on a new empty one; no guard) |
| `npm run db:seed:jobs --prefix server` | Create every missing job run, disabled except `research_stories` (enabled); never changes an existing one, safe to rerun (no guard) |

**Never use:**

| Command | Why |
|---|---|
| `npx prisma …` | May fetch a different Prisma version from the registry |
| `prisma generate --no-engine` | Accelerate-only client, breaks all queries |
| `npm run db:migrate --prefix server` / `prisma migrate dev` (without `--create-only`) | DLL locks, may prompt for a reset on drift |

## Troubleshooting

### Stuck Advisory Lock

If a previous migration attempt left Prisma's advisory lock (key `72707369`) held by a lingering connection, migration commands hang. An advisory lock can only be released by the session holding it, so end that session:

```bash
docker exec actually-relevant-db psql -U ardev -d actually_relevant_dev -c "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = 72707369;"
```

Restarting the container (`docker compose restart db`) also drops it.

### Migration Marked as Failed

If a migration is recorded as failed in `_prisma_migrations` (P3009), fix or delete the migration's SQL, undo any part of it that did apply, then:

```bash
npm run db:migrate:resolve --prefix server -- --rolled-back <migration_name>
```

and start the dev server again.

### Schema Drift

To see what SQL would bring the database in line with the current schema (read-only):

```bash
npm run db:migrate:diff --prefix server
```

On a fully migrated database the only expected output is `DROP INDEX "story_embeddings_embedding_idx";` (see "Authoring a Migration", step 3). Never apply that line; anything else is real drift.

### Server Starts Against the Wrong Database

If `db:prepare` reports "not local", `DATABASE_URL` points away from the Docker database: either a value in the shell environment overrides `server/.env`, or `.env` itself names a remote host. Nothing was migrated.

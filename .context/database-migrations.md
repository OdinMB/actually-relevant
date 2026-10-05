# Database Migrations

## Local Database

Local development runs PostgreSQL + pgvector in Docker (`docker-compose.yml` at the repo root): image `pgvector/pgvector:pg17`, `localhost:5433`, database `actually_relevant_dev`, credentials in the compose file. Start it with `docker compose up -d`. The container's user is a superuser, so Prisma can create its temporary shadow database for `migrate dev --create-only`. It is a disposable dev database, but never reset it without the user's go-ahead: it holds their local test data.

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

Code: `server/src/scripts/db-prepare/` (`index.ts` orchestrates; `gate.ts` and `localDatabase.ts` hold the local-only guard; `schemaStamp.ts` the regenerate check; `prismaOutput.ts` reads Prisma's output).

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

3. **Review the generated SQL before committing it, and delete `DROP INDEX "stories_embedding_idx";`.** Both `db:migrate:create` and `db:migrate:diff` always emit that line, even with no schema change: the pgvector HNSW index was created by raw SQL in `20260206120000_add_embedding_fields`, and Prisma 6 cannot represent an index on an `Unsupported("vector(1536)")` column, so it treats it as unknown and proposes dropping it. Committing it would turn every vector search into a sequential scan. `server/src/test/migrations.test.ts` fails if any migration drops the index without re-creating it in the same migration (comments are ignored, so a migration may mention it). Apart from that line, a migrate diff from a fully migrated database is empty: the earlier drift (newsletter_sends defaults, two missing indexes, the `feeds_url_key` rename) was reconciled by `20261005120000_reconcile_schema_drift`. Anything else in a fresh diff is drift, and belongs in its own migration, not hidden in an unrelated one.
4. Restart the dev server (or run `npm run db:prepare --prefix server`): the migration is applied and the client regenerated. If a dev server is already running, stop it first, or the regenerate hits the DLL lock.
5. Commit the migration folder with the schema change. Production applies it on the next deploy.

## Critical Rules

1. **Never use `npx prisma` directly.** Use the `npm run db:*` scripts with `--prefix server` (or the local CLI as above). `npx` can fetch `prisma@latest` from the registry instead of the lockfile's version.
2. **Never use `--no-engine` with `prisma generate`.** It generates a client that requires Prisma Accelerate (`prisma://` protocol) and breaks all database queries with error P6001.
3. **Never apply migrations with `prisma migrate dev` / `npm run db:migrate`.** On Windows it holds the query-engine DLL and can leave advisory locks, and it may prompt to reset the database on drift. Author with `--create-only`, apply with `db:prepare` / `migrate deploy`.
4. **Don't run `db:generate` while the dev server is running.** `prisma generate` replaces the query-engine DLL, which the running server locks (`EPERM`). Agents ask the user to stop their dev server first; usually just restarting the dev server is simpler, since `db:prepare` regenerates when needed.
5. **Never point `db:prepare` at a non-local database by widening the guard.** To migrate a remote database deliberately, run `npm run db:migrate:deploy --prefix server` against it on purpose.

## Production Migrations

On Render (Linux), none of the Windows DLL-locking issues apply. Migrations run automatically during the build step:

```
npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build
```

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
| `npm run db:migrate:create --prefix server -- --name <name>` | Generate migration SQL without applying |
| `npm run db:migrate:status --prefix server` | Check which migrations are pending/applied |
| `npm run db:migrate:diff --prefix server` | Print the SQL from the database to the schema, read-only (expected: only the `stories_embedding_idx` drop) |
| `npm run db:migrate:resolve --prefix server -- --rolled-back <name>` | Mark a failed migration as rolled back |
| `npm run db:migrate:deploy --prefix server` | Apply pending migrations to whatever `DATABASE_URL` points at (no local guard) |
| `npm run db:generate --prefix server` | Regenerate the Prisma client (**dev server stopped**) |

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

On a fully migrated database the only expected output is `DROP INDEX "stories_embedding_idx";` (see "Authoring a Migration", step 3). Never apply that line; anything else is real drift.

### Server Starts Against the Wrong Database

If `db:prepare` reports "not local", `DATABASE_URL` points away from the Docker database: either a value in the shell environment overrides `server/.env`, or `.env` itself names a remote host. Nothing was migrated.

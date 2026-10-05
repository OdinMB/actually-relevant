# Reconcile schema drift and protect the pgvector index

- **Date**: 2026-10-05
- **Status**: implemented
- **Type**: bugfix
- **Complexity**: simple
- **Author**: claude-code (AI)

## Problem

`server/prisma/schema.prisma` and the 28 committed migrations have drifted. Production and the local Docker database both have all 28 applied, and `prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma --script` gives the same output on both:

```sql
DROP INDEX "stories_embedding_idx";
ALTER TABLE "newsletter_sends" ALTER COLUMN "html_content" DROP DEFAULT,
ALTER COLUMN "stats" SET NOT NULL,
ALTER COLUMN "stats" SET DEFAULT '{}';
CREATE INDEX "newsletter_sends_plunk_campaign_id_idx" ON "newsletter_sends"("plunk_campaign_id");
CREATE UNIQUE INDEX "pending_subscriptions_token_key" ON "pending_subscriptions"("token");
ALTER INDEX "feeds_url_key" RENAME TO "feeds_rss_url_key";
```

Every future `db:migrate:create` picks these statements up and hides them in an unrelated migration. Worst of them is the first line: `stories_embedding_idx` is the HNSW pgvector index created by raw SQL in `20260206120000_add_embedding_fields`. Prisma cannot represent it, so it always proposes dropping it. If that line is ever committed, vector search (`<=>` cosine distance) falls back to a sequential scan, and nothing would notice.

Background: `.plans/2026-10-05_db-prepare-followup.md` ("Schema drift" item), `.context/database-migrations.md`.

## Approach

### 1. One migration, `20261005120000_reconcile_schema_drift`

It holds every diff statement except the `DROP INDEX`, with these risks handled:

- **`stats SET NOT NULL` on existing rows.** The column was created nullable (`20260201150000_feature_spree`), and neither insert path (`sendTest`, `sendLive` in `server/src/services/newsletter.ts`) sets it, so older rows can be SQL `NULL`. A backfill `UPDATE ... SET "stats" = '{}'` runs first. `'{}'` is the shape the code expects: the schema default, and the admin `StatsDisplay` (`client/src/components/admin/NewsletterDetail.tsx`) reads `stats.delivered` etc., renders "No stats yet" for `{}`, and would throw on `null`. The backfill also covers a JSON `null` value (`'null'::jsonb`), which a non-null `Json` field would also hand to the client as `null`.
- **Unique index on `pending_subscriptions.token`.** Tokens come only from `randomUUID()` in `subscribe()` (`server/src/services/subscribe.ts`); nothing updates a token afterwards. A v4 UUID has 122 random bits, so a collision among the table's rows is not plausible (about 10^-25 at a million rows). No dedupe step: deleting rows silently would destroy subscription records. If a duplicate existed anyway, `CREATE UNIQUE INDEX` fails, the migration rolls back (see atomicity) and names the duplicated key, and the owner decides. A read-only pre-deploy check query is recorded in the follow-up.
- **`html_content DROP DEFAULT`.** The Prisma field is a required `String` with no `@default`, so the generated client already requires `htmlContent` on every create, and both create calls pass the newsletter's HTML. There is no raw-SQL insert into `newsletter_sends`. Dropping the DB default changes nothing for any writer.
- **`feeds_url_key` rename.** The index was created on `feeds.url` in `init` and followed the column when `feature_spree` renamed it to `rss_url`; only the name is stale. Renaming an index is metadata-only.
- **Atomicity.** See "Atomicity" below. The script is kept free of statements that cannot run in a transaction (no `CONCURRENTLY`); the two tables are small, so a plain `CREATE INDEX` lock is momentary.

### 2. Permanent protection for `stories_embedding_idx`

A server vitest, `server/src/test/migrations.test.ts`, reads every `server/prisma/migrations/*/migration.sql` and fails when a migration drops `stories_embedding_idx` (any case, quoted or not, schema-qualified or not, alone or in a list) without creating it again later in the same migration (an HNSW index of that name on `stories`; tightened after code review). SQL comments are stripped first, so a migration may mention the index in a comment. It also asserts that the migrations folder and the creating migration are found, so the scan can never pass vacuously.

Choice made here: the literal request was "any migration other than the one that created it". A migration that drops *and* re-creates the index (for example to change HNSW parameters) also creates it, so it passes; a bare drop fails. This keeps a deliberate rebuild possible without editing the test.

Prisma support was checked first (see "Prisma support for the index" below): there is no supported way, so the test is the protection.

### 3. A `db:migrate:diff` script

`.context/database-migrations.md` documents the read-only diff as `cd server && node node_modules/prisma/build/index.js migrate diff ...`. A `db:migrate:diff` npm script (`prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`) replaces it, so the documented fallback and the drift check use the same `npm run db:* --prefix server` form as every other command.

### 4. Documentation

`.context/database-migrations.md`: the drift paragraph in "Authoring a Migration" step 3 and the "Schema Drift" troubleshooting section now describe only the residual `DROP INDEX "stories_embedding_idx"` line that `migrate create`/`diff` will always emit, that it must be deleted, and that the test catches it if not.

### 5. Verification

- `npm run db:prepare --prefix server` against the local Docker DB (applies the migration; regenerates the client only if the schema changed, which it does not). Before any generate, confirm no Actually Relevant server process is running (port 3000 belongs to an unrelated app).
- `npm run db:migrate:status --prefix server` is clean.
- `npm run db:migrate:diff --prefix server` shows only `DROP INDEX "stories_embedding_idx";`.
- Server typecheck and full test suite.
- Guard can fail: put a `DROP INDEX "stories_embedding_idx";` into a scratch migration, run the test, see it red, remove it, see it green.

### Atomicity (verified in prisma-engines source at the 6.19.3 engines commit `c2990dca`)

- `migrate deploy` sends the whole `migration.sql` in one `simple_query` call (`sql-schema-connector/src/flavour/postgres/connector/native/mod.rs`). PostgreSQL runs a multi-statement simple query as one implicit transaction, so the script is already atomic: any failing statement rolls all of it back. Prisma does not add a transaction of its own.
- **No explicit `BEGIN;`/`COMMIT;`.** Inside an explicit block a failure leaves the connection in an aborted transaction, and Prisma's bookkeeping write then fails with "current transaction is aborted", hiding the real error (prisma/prisma#15295). The implicit transaction gives the same atomicity without that.
- **What atomicity cannot prevent.** `record_migration_started` inserts the `_prisma_migrations` row in its own statement before the script runs (`commands/src/commands/apply_migrations.rs`). A failing script therefore rolls back its DDL but leaves a failed record, and the next deploy stops with P3009 until `migrate resolve --rolled-back 20261005120000_reconcile_schema_drift` is run. So the migration is made not to fail: the backfill removes the only data-dependent failure that is plausible (NULL stats). The remaining one, a duplicate token, is not plausible (above), and if it happened the database is untouched and the recovery is one `resolve` command.
- **Upgrade caveat.** On prisma-engines `main` (the 7.x line) the script is split and sent statement by statement, so this implicit atomicity does not survive a Prisma 7 upgrade. Recorded in `.context/database-migrations.md`.

### Prisma support for the index (checked)

Prisma 6.19 has no supported way to declare or ignore it. `IndexAlgorithm` has only BTree, Hash, Gist, Gin, SpGist and Brin (no HNSW). `prisma.config.ts` offers `experimental.externalTables` / `tables.external`, which work per table and would take all of `stories` out of migrations. Open issues prisma/prisma#28414 and #27770 report the same recurring `DROP INDEX` with no fix. An undocumented workaround exists (declare `@@index([embedding(ops: raw("vector_cosine_ops"))], map: "stories_embedding_idx")` and rely on the describer mapping the unknown `hnsw` method to BTree so the differ sees a match), but it depends on a silent fallback, and any diff that has to create the index (a fresh database, a shadow DB without the raw SQL) would emit a btree index with `vector_cosine_ops`, which PostgreSQL rejects. Not used; the test is the protection.

## Implementation notes (2026-10-05)

- Dry run first: the migration ran inside a rolled-back psql transaction on the Docker DB with an extra NULL-stats row; the backfill turned it into `{}` and every statement succeeded.
- `db:prepare` applied `20261005120000_reconcile_schema_drift`; the client was already up to date (schema unchanged, no generate). No Actually Relevant server process was running.
- `db:migrate:status`: 29 migrations, up to date. `db:migrate:diff`: only `DROP INDEX "stories_embedding_idx";`.
- Guard proven: a scratch migration with that drop turned the test red; removed, green again (re-done after the review fix).
- Server typecheck clean; server suite 99 files, 1190 tests passing.
- Specs: `NewsletterSend.stats` is no longer optional, `PendingSubscription.token` is unique.
- Follow-up: `.plans/2026-10-05_reconcile-schema-drift-followup.md`.

## Decisions

No ADR. Writing a reconciling migration is routine maintenance, and the test-based guard is cheap to reverse (delete one test file), so neither passes DOC-006's cost-of-reversal test. The reasoning lives here and in `.context/database-migrations.md`.

## Changes

| File | Change |
|---|---|
| `server/prisma/migrations/20261005120000_reconcile_schema_drift/migration.sql` | New migration |
| `server/src/test/migrations.test.ts` | New guard test |
| `server/package.json` | `db:migrate:diff` script |
| `.context/database-migrations.md` | Drift section, command reference |
| `BACKLOG.md` | Remaining open items from the db-prepare follow-up |

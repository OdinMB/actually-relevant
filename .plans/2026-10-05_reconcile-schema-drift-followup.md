# Follow-up: reconcile schema drift migration

## Controversial Decisions

- **The guard allows a drop that the same migration re-creates.** The request was "fails if any migration other than the one that created it drops `stories_embedding_idx`". A migration that drops and re-creates the index (for example to change HNSW parameters) also creates it, so it passes, provided the `CREATE INDEX` comes after the last drop, is on `stories` and uses `hnsw`. A bare drop fails, as does a create-then-drop, a non-HNSW re-create, or one that only names the index as a column. Known gaps (documented in the test): a drop inside a `DO` block or `EXECUTE` string, and implicit drops via `DROP COLUMN "embedding"` or `DROP TABLE "stories"`. This keeps a deliberate rebuild possible without editing the test.
- **SQL comments are ignored by the guard**, so a migration (like the new one) can explain in a comment that it left the drop out.
- **No explicit `BEGIN;`/`COMMIT;` in the migration.** Prisma 6.19 already sends the file as one simple query, which PostgreSQL runs as one implicit transaction. An explicit block would hide the real error on failure (prisma/prisma#15295). Atomicity cannot stop Prisma from recording a failed row (P3009), so the migration is written not to fail instead.
- **The backfill also rewrites JSON `null` stats to `{}`**, beyond SQL `NULL`: the admin stats display would throw on either.
- **No dedupe before the unique token index.** Tokens are `randomUUID()`, so a duplicate is not plausible; if one existed, the migration fails and rolls back rather than deleting a subscription row.
- **The Prisma `@@index(... ops: raw(...))` workaround was not used.** It relies on an undocumented fallback (unknown `hnsw` read as BTree) and would make Prisma emit invalid SQL wherever it has to create the index itself.
- **Guard test location:** `server/src/test/migrations.test.ts`, beside the shared test helpers. vitest only collects `src/**/*.test.ts`, so it cannot sit next to the migrations.

## User Input Needed

- Optional, before the next production deploy: confirm there are no duplicate confirmation tokens, read-only, in pgAdmin:
  `SELECT token, count(*) FROM pending_subscriptions GROUP BY token HAVING count(*) > 1;`
  An empty result means the unique index will build. If it is not empty, the deploy fails and rolls back, and recovery is `npm run db:migrate:resolve --prefix server -- --rolled-back 20261005120000_reconcile_schema_drift` against production, after deciding which rows to keep.

## DB Migrations

- `20261005120000_reconcile_schema_drift` applies to production automatically on the next Render deploy (`prisma migrate deploy` in the build). Applied locally with `db:prepare`.

## Suggested Follow-Up Work

- `pending_subscriptions.token` now has two indexes: the new unique `pending_subscriptions_token_key` and the older plain `pending_subscriptions_token_idx`, because the schema declares both `@unique` and `@@index([token])`. Removing `@@index([token])` and dropping the old index in a later migration saves a little write cost; harmless to leave.

- Before a Prisma 7 upgrade, re-check migration atomicity: prisma-engines `main` sends migration statements one at a time, so a multi-statement migration is no longer implicitly atomic.

## Landing Queue

- Repo `OdinMB/actually-relevant`, branch `main`, base `main`: push only, once the owner has read this. Remote protection: check at landing. Pushing deploys the migration to production.

## Mod code and load settings written

- none

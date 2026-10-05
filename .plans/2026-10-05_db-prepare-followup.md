# Follow-up: automatic local DB preparation on server dev start

## Controversial Decisions

- **Regenerate check uses a stored hash, not the client's schema copy.** Prisma 6.19 writes a reformatted schema (`prisma format` style, attributes reordered, LF endings) into `node_modules/.prisma/client/schema.prisma` and `inlineSchema`, so neither can be compared with `prisma/schema.prisma`. `db:prepare` writes `.db-prepare-schema.sha256` into the client folder after each generate. Consequence: the first `npm run dev` after any fresh install, or after someone runs `db:generate` by hand, regenerates once. Alternative rejected: formatting the schema in-process through Prisma's internal formatter (undocumented internal API).
- **Local hosts are exactly `localhost`, `127.0.0.1`, `::1`, plus a Unix-socket path in `host=`.** `host.docker.internal`, `127.0.0.2`, `*.localhost`, unparseable URLs and non-postgres schemes count as remote. A `host=` query parameter overrides the URL host, because Prisma connects there. The guard cannot detect an SSH tunnel mapping a remote DB onto localhost (documented).
- **The guard also skips client generation for remote/missing URLs**, not just migrations, per "skip the whole thing".
- **Location:** `server/src/scripts/db-prepare/` (five small modules + tests), run with tsx, because it needs server's vitest and dotenv; root `scripts/` holds only the build helper shared by client and server.
- **No ADR.** The decision is cheap to reverse (delete one `predev` line), so it fails DOC-006's cost test; the reasoning lives in `.context/database-migrations.md`.

## Implementation Issues

- **Schema drift between committed migrations and `schema.prisma`** (found with `migrate diff`, read-only, on the fully migrated Docker DB). The next `db:migrate:create` will include: `DROP INDEX "stories_embedding_idx"` (the pgvector index from raw SQL in `20260206120000_add_embedding_fields`; Prisma cannot model it, so this line must always be deleted), `newsletter_sends.html_content DROP DEFAULT`, `newsletter_sends.stats SET NOT NULL / SET DEFAULT '{}'`, new indexes `newsletter_sends_plunk_campaign_id_idx` and unique `pending_subscriptions_token_key`, and `feeds_url_key` renamed to `feeds_rss_url_key`. Production may or may not have these (manual pgAdmin runs could have applied them there); check before writing a reconciling migration. Documented in `.context/database-migrations.md`.
- `db:migrate:create` (`migrate dev --create-only`) against the Docker DB was **not** exercised end to end, to avoid creating a migration; the container user is a superuser (`rolsuper`, `rolcreatedb` both true), so shadow-database creation should work.
- The locked-client (EPERM) path was verified only by unit test on the classifier, not by a real lock.
- The guard-can-fail proof was done for the gate (removing the remote branch turned `gate.test.ts` red). A second mutation (forcing `checkLocalDatabase` to always say local) was refused by the permission classifier and not run; the `localDatabase.test.ts` remote cases assert that directly.

- Code review found a guard bypass: duplicate `host=` parameters (the guard read the first, a driver may use the last). Fixed: several `host=` values or any `hostaddr=` now count as remote, with tests.
- `dotenv.config({ quiet: true })` needs dotenv >= 16.6; installed 16.6.1, but `server/package.json` still says `^16.4.5` (the lockfile pins it). Bumping the range belongs to the dependency run.

## Records to Refresh

- None: no dependency, service, model or personal-data handling changed.

## Suggested Follow-Up Work

- Variable templates are dotted (`server/.env.sample`, `client/.env.sample`); they could not be read or updated to mention `SKIP_DB_PREPARE` or the Docker `DATABASE_URL`. Renaming to `env.example` (AGT-007) would make them maintainable by agents.
- Write a migration that reconciles the drift above (keeping the embedding index), after checking production.
- Optional: a `db:migrate:diff` npm script for the fallback command documented in `.context/database-migrations.md`.

## Landing Queue

- Nothing pushed or committed: the coordinator commits. Add to `server/package.json` scripts:
  `"predev": "tsx src/scripts/db-prepare/index.ts",` and `"db:prepare": "tsx src/scripts/db-prepare/index.ts",`

## Mod code and load settings written

- none

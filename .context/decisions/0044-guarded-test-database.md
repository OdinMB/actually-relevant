---
id: ADR-0044
title: Let tests migrate only a guarded local database named *_test, with migrate deploy once per run and TRUNCATE between tests
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data, testing]
---

# ADR-0044 · Let tests migrate only a guarded local database named *_test, with migrate deploy once per run and TRUNCATE between tests

## Context

The server's PostgreSQL integration tests (`*.db.test.ts`) truncate every table of the database they run against. Until now they were opt-in: skipped unless `TEST_DATABASE_URL` was set, guarded only by "local host and a name containing `test`", and run by nobody routinely, since the repository had no CI. The story lifecycle work (ADR-0045) moves the status rules into conditional SQL and transactions that only a real database can test, so these tests have to run on every change, in CI as well as locally. Unattended runs may migrate only a database the project designates as its test database; this record designates it. The owner approved the rule on 2026-10-19.

## Decision

Tests migrate exactly one database: the one `TEST_DATABASE_URL` names, which must be on a local host, have a name ending in `_test`, and not be the database the shell's `DATABASE_URL` names (`server/src/test/db/guard.ts`). The `db` vitest project's global setup checks this and runs `prisma migrate deploy` on it once per run with the project's own CLI; each test then starts from `TRUNCATE ... RESTART IDENTITY CASCADE` of every table but `_prisma_migrations`. No test or setup ever runs `migrate reset` or `migrate dev`. `npm run test` runs the unit project only; `npm run test:db` runs the db project and fails, not skips, without `TEST_DATABASE_URL`. A GitHub Actions workflow runs both against a `pgvector/pgvector:pg17` service whose database is `actually_relevant_test`, matching production's PostgreSQL 17. CI is advisory: Render's `autoDeployTrigger: commit` is unchanged.

## Consequences

A developer needs a local `*_test` database to run the db tests (`.context/database-migrations.md`, "Integration Tests"), and a run without one fails loudly instead of passing by skipping. A database called `test_db` or `my-tests` is refused. One database means db test files run one after another; that is fast enough at the current size. A red CI run does not stop a deploy; making Render wait for checks (`autoDeployTrigger: checksPass`) is a separate owner decision.

## Alternatives considered

- **Keep the tests opt-in**: no setup cost, but the tests that guard the status rules would again run only when someone remembers.
- **A database per test worker, cloned from a migrated template**: parallel db test files, at the cost of more harness code; this design can grow into it without touching a test.
- **Testcontainers**: a fresh container per run, but Docker becomes a requirement everywhere, including the Windows dev machine.
- **PGlite or another in-process PostgreSQL**: no server needed, but advisory locks and row-lock behavior, the very things the slug lock and the job lease rely on, are not the real thing.

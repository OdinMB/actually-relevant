---
id: ADR-0035
title: Keep the production PostgreSQL instance out of the blueprint
status: accepted
date: 2026-10-12
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [handover]
---

# ADR-0035 · Keep the production PostgreSQL instance out of the blueprint

## Context

When the two Render services were declared in a committed `render.yaml` (ADR-0034), the production PostgreSQL instance, which holds every story, feed and newsletter subscriber record, was the third Render resource. A blueprint adopts an existing resource whose name matches one of its entries; Render's documentation does not say when the creation flow adopts a resource and when it creates a new one with a suffixed name, so a database entry that did not match exactly could create a second, empty database. Render's documentation also says that a resource deleted by hand while a blueprint manages it is recreated on the next sync. Declaring the database would have let the backend's `DATABASE_URL` come from a `fromDatabase` link instead of a pasted value.

## Decision

The blueprint has no `databases:` section and no `fromDatabase` reference. The backend's `DATABASE_URL` is named in `render.yaml` with `sync: false`, so its value stays the one set in the dashboard, and the database, its plan and its backups are managed in the dashboard only.

## Consequences

No blueprint sync can create, recreate or reconfigure the production database, and the adoption runbook's review-screen gate treats any database on the screen as a reason to cancel. In exchange, the database's settings stay undeclared and unreviewed in git, a new deployment still creates the database and enables pgvector by hand (the README's first deployment step), and `DATABASE_URL` is a pasted value that must be updated by hand if the database's connection string ever changes.

Revisit this if Render documents adoption of an existing database by name as safe and deterministic, or if the database is moved or recreated, at which point declaring it could be weighed again.

## Alternatives considered

- **Adopting the database by its exact name, with no destructive fields** — safe if every field matches, but one typo stands between the blueprint and an empty production database.
- **Referencing the database with `fromDatabase` without managing it** — not documented as supported for a database the blueprint does not declare.
- **Folding this into ADR-0034 as a scoping detail** — the owner asked for this choice to be made and justified on its own, and "why isn't the database in the blueprint?" is the question a later reader will ask.

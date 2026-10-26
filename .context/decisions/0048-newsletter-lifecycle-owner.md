---
id: ADR-0048
title: Make one module, newsletterLifecycle.ts, the only writer of newsletter issue state and sends, with live sends claimed under the issue's row lock before Plunk
status: accepted
date: 2026-10-25
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [data, architecture]
---

# ADR-0048 · Make one module, newsletterLifecycle.ts, the only writer of newsletter issue state and sends, with live sends claimed under the issue's row lock before Plunk

## Context

A newsletter issue's state was spread over `newsletters.status`, `published_at`, `slug` and the presence of test and live `newsletter_sends` rows, and every writer applied its own subset of the rules. "Never send live twice" and "send live only after a test" lived only in the `publish_newsletter` job's query: the admin's send-live route checked nothing but the HTML, so a double click, a second editor or the job beside a manual send emailed every subscriber twice. The live send recorded its row only after Plunk accepted it, so a lost row let the next run send again; any old test counted as approval after the HTML changed; select, generate, HTML and `PUT` silently rewrote a sent, published issue's web edition; deleting a sent issue cascaded its sends, the record the weekly guard reads. The architecture scan of 2026-10-25 (N1) and the improvement scan (F2, F3) named this. The owner approved the plan on 2026-10-25 with its recommended answers: unpublishing a sent issue re-opens editing (Q1 A), a manual send also publishes (Q2 yes), an ambiguous Plunk failure blocks the issue until an editor marks the send not sent (Q3 A).

## Decision

`server/src/services/newsletterLifecycle.ts` owns every move of an issue (assign, select, generate, html, edit, publish, unpublish, delete, sendTest, sendLive, markSendFailed), on the model of `storyLifecycle.ts` (ADR-0045): a rule per move, typed refusals (`NewsletterRefusedError`, 409, with a code), and a source-scan fence (`server/src/test/newsletterWriters.test.ts`) that fails on any other writer of `status`, `published_at`, `content`, `html`, `selected_story_ids`, issue deletes or send rows. Every write move takes `SELECT ... FOR UPDATE` on the issue's row, re-checks its rule and writes in one transaction; the model-backed moves check before the call and again at the write. An issue is **frozen** while a live send is unconfirmed, or once it was sent and is published; a frozen issue refuses every build move and edit. A live send **claims** a `draft` live row under the lock before Plunk is called, refusing when a live non-failed send exists or no `sent` test carries the current HTML; a failure that proves nothing went out marks the row `failed`, any other leaves it `draft` (unconfirmed) until an editor marks it not sent; a confirmed send publishes the issue in the same transaction. No schema change: the unused `draft` send status means unconfirmed, and the current-test check compares the stored HTML snapshots.

## Consequences

However a live send starts, an issue reaches subscribers at most once; the price is that an ambiguous Plunk failure blocks the issue (and that week's automatic send) until a person checks Plunk. Fixing a sent issue means unpublishing, editing and republishing; it can never be emailed again, and it cannot be deleted. Moves on one issue serialize on its row; the transactions are short, and the model and Plunk calls run outside them. A field edit and a status move are two steps (`PUT /:id` edits, then publishes or unpublishes). The admin mirrors the frozen and send rules for its button states (`client/src/lib/newsletter-state.ts`), named debt until the server returns a computed state. A writer that bypasses the module is caught only by the textual fence, not by the database.

## Alternatives considered

- **A partial unique index** on `newsletter_sends (newsletter_id) WHERE NOT is_test AND status <> 'failed'`: holds even against a writer that bypasses the module, but Prisma 6 cannot declare a partial index in `schema.prisma`, so every later `db:migrate:create` would propose dropping it (as with `stories_embedding_idx`) and `check:migrations` would need a second guard. The fence keeps writers inside the module and the lock gives the same serialization there.
- **Guard only the send** (N1 option B): covers the duplicate email, leaves edits after sending and deletes unguarded.
- **Leave it to the admin's confirm dialog**: no protection against a second editor or the job.
- **Mark an ambiguous failure failed automatically** (Q3 B): no blocked week, but a possible duplicate email to everyone.
- **A content-hash column for the current test**: a migration and backfill for what the stored HTML snapshot already answers.

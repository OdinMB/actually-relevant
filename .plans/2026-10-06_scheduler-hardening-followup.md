# Follow-up: scheduler hardening (2026-10-06)

Plan: `.plans/completed/2026-10-06_scheduler-hardening.md`

## Controversial Decisions

- **Social candidates count a post in any status** (draft, failed) as "already posted", not only published ones. This goes slightly past the literal scope: without it a story with a draft or failed post on the only enabled channel would still be picked, and `generateDraft` would refuse it, so the job would post nothing and report success. No behaviour is lost, because a failed post's story was never retried automatically anyway. Veto by restoring `status: 'published'` in `storiesWithPost` and `hasPost`.
- **6.5-day (156 h) spacing also applies to a manual admin run of `generate_newsletter`.** Running the job by hand midweek after a Saturday issue now skips (within 156 h of a built automatic issue), where it used to build a new "Week N+1" issue. An admin can still create a newsletter by hand from the Newsletters page.
- **No process-level `unhandledRejection` handler** (plan's choice, kept): any rejection that still escapes crashes visibly and Render restarts.
- **`getWeekKey` uses the date's local calendar day**, like `getWeekTitle`, rather than UTC, so title and key always agree. Identical on Render (UTC).
- **Shared `Newsletter` type** in `shared/types/index.ts` was not given `weekKey`: the client does not use it. The admin API now returns it as an extra field.

## Decisions to Review

None. The plan carried no decision stubs; no ADR was written.

## Records to Refresh

None. `.context/ai-transparency.md` (the AI Act record) was updated in this change: q1 now reads "confirm `PLUNK_TEST_SEGMENT_ID` is set in production". No plugin-kept records (personal-data note, data inventory, model cards) exist in the repo.

## User Input Needed

- **Is `PLUNK_TEST_SEGMENT_ID` set in production?** If not, from the next deploy the Saturday job builds the issue, refuses the "[TEST]" send, and alerts every week (the issue is kept; it can be sent live from the admin).
- **Which social channels are enabled in production?** With one channel enabled, the auto-post job now only picks stories missing on that channel.

## DB Migrations

- `server/prisma/migrations/20261006120000_newsletter_week_key/migration.sql` (hand-written, local Docker DB was down): adds nullable `newsletters.week_key` and backfills `YYYY-Www` for built rows titled "Week N, YYYY". Not applied anywhere. Apply locally by restarting the server dev process (`db:prepare`); production applies it on deploy. Check once by hand: a "Week 7, 2026" row with HTML gets `2026-W07`, a row without HTML stays null.
- The Prisma client was regenerated locally (`npm run db:generate --prefix server`) so the server typechecks; the next `db:prepare` will regenerate once more (its schema stamp predates this).

## Implementation Issues

- No code review agents ran: this agent had no Agent tool, so the three parallel `feature-dev:code-reviewer` passes and the isolated check worker were replaced by a self-review against the structure guidelines and inline checks. A human or agent review of the commit is advisable before landing.

## Suggested Follow-Up Work

- Make `social_auto_post` fail, and alert, when every channel attempt failed (today per-channel errors are only logged).
- Admin run route (`POST /api/admin/jobs/:jobName/run`) could return 409 when the job is already running (today it answers "triggered" and `runJob` skips).
- Remove the dead `server/src/jobs/blueskyAutoPost.ts`.
- Sequence the boot catch-up jobs (all overdue jobs start at once today).

## Landing Queue

- repo `OdinMB/actually-relevant`, branch `main`, base `main`: push only (committed locally to `main` as instructed by the caller). Pull-request case: none shown by the rule index (REPO-004/REPO-006 not switched on); remote protection: check at landing. Status: done.

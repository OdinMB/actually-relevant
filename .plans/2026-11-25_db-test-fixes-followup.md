# Follow-up: the failing PostgreSQL integration tests (2026-11-25)

Task: fix the 18 db tests that failed in the owner's `test:coverage` run (branch `claude/project-thread-egeer5`). Every failure was a test or test fixture out of date with an intended behavior change; no code bug was found.

## Controversial Decisions

- `overviewLifecycle.db.test.ts` kept its own copies of the link-result fixtures, which had fallen behind `LinkResult` (no `refusedFoundings` and five more fields). Rather than add the missing fields to the copies, the file now uses the shared, type-checked fixtures in `server/src/test/db/overviewFixtures.ts` that the unit tests already use. They differ from the old copies only where nothing that writes a link reads (the story's title, the join candidate's `mayHold`, `endDropped`, `nearMatch`); a reviewer traced `applyLink` and the plans and confirmed it.
- The reviewer's Structure check returned `violation` on `fakeContextDeps().call` (`server/src/test/contextDeps.ts`), which this change grew by a fifth per-step branch beside the catch-all `else` that caused the failures. Applied: the fake now answers from a map keyed by `ContextStep` and typed by each step's schema, so a step a run gains fails the type-check there (verified: removing the `figure-check` entry fails `npm run typecheck`). The never-reached `extract` step now answers nothing (it fell into the catch-all before).
- Coverage floor raised by the ratchet rule (`.context/ci.md`, "Coverage floor"): measured 86.92, 81.9, 86.58, 87.52, so statements 85 → 86, functions 85 → 86, lines 86 → 87; branches kept at 81 (82 is above the measured value).

## Implementation Issues

- **The rewritten story context fake was not run against the database.** The full gate (`test:coverage` with the db project, typecheck, lint, format, build) ran green before the reviewer's fix to `server/src/test/contextDeps.ts`. During that fix the session's secret-redaction hook replaced the test database URL in this agent's context, so `test:db` could no longer be run. What was checked instead: typecheck, lint and format green, and a temporary unit test (deleted) that ran the real `buildStoryContext` with the old fake and the rewritten one, for the default, `failWrite`, both `writeError` cases and the citing fake: outputs and steps called deep-equal in all five. Before pushing, run `npm run test:db --prefix server -- src/services/storyContextRuns.db.test.ts src/services/storyContextOnDemand.db.test.ts` (or the whole `test:coverage`) with `TEST_DATABASE_URL` set.

## Suggested Follow-Up Work

- **Type-check the test files.** `server/tsconfig.json` excludes `src/**/*.test.ts` and lint uses the untyped presets, so nothing but a test run catches a fixture or fake that falls behind the code (all four files here were such cases: a missing `now()` dep, missing result fields, an unanswered model step, a new `owedSlices` field). A `tsconfig.test.json` run by `npm run typecheck` would catch them at type-check time. Cost unknown until measured: the test files have never been type-checked, so the first run may report many errors to fix. Worth a plan of its own.
- **The sandbox parity test copies the replay's wiring.** `server/src/jobs/linkOverviews.db.test.ts` (`run()`, ~lines 214-240) builds the sandbox's link deps by hand from `server/src/scripts/eval/overviews/replay.ts` (~lines 230-242); that copy is how `now` drifted, and a parity test built on a copy cannot catch drift in the replay's own wiring. Seam: a small builder in `overviewSandbox.ts` taking the neighbours read, the stories read and the clock, used by both. It touches `server/src/scripts/eval/`, which was off limits while a paid eval ran.
- `server/src/services/overviewLifecycle.db.test.ts` passes `now: () => new Date()` in two `LinkDeps` while its stories are dated from `NOW` (2026-06-02); harmless today (the stories only fall further past `recenterLookbackDays`), `() => NOW` would be consistent.

## Landing Queue

- repo `OdinMB/actually-relevant`, branch `claude/project-thread-egeer5`, base `main`: push only, with the rest of the branch. Pull-request case: none from the rule index (REPO-004 and REPO-006 are not active); remote protection: check at landing (the ruleset `no-nonsense-main` requires the `server` and `client` checks). Status: done; run the two story context db test files first (Implementation Issues).

import { configDefaults, defineConfig } from 'vitest/config'

// PostgreSQL integration tests (`*.db.test.ts`, `.context/database-migrations.md` "Integration
// Tests"): the `db` project runs against TEST_DATABASE_URL, which it hands to Prisma as
// DATABASE_URL, and fails without it (globalSetup). `npm run test` runs the `unit` project only;
// `npm run test:db` runs the `db` project; `npm run test:coverage` runs both.
const testDatabaseUrl = process.env.TEST_DATABASE_URL

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // On Windows a test that first loads a large library (LangChain, OpenAI, Bluesky) can take over
    // vitest's 5s under a full run (file scanning of node_modules); CI runs on Linux at the defaults.
    ...(process.platform === 'win32' ? { testTimeout: 30_000, hookTimeout: 30_000 } : {}),
    // `npm run test:coverage` (CI) measures the unit and db projects together, so a db test that
    // replaces a mock test keeps the lines it covers counted (.context/ci.md, "Coverage floor").
    // A ratchet set just below the coverage measured: raise a threshold when coverage rises; never
    // lower one to land a change.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Re-baselined once on 2026-10-25, when the db project joined the measurement (owner decision):
      // unit and db together measured statements 73.86, branches 69.69, functions 68.52, lines 75.22
      // (unit alone had been 69.78, 65.24, 64.09, 71.28). Raised 2026-10-25 with the newsletter
      // lifecycle's db tests: measured 74.83, 70.83, 69.65, 76.21. Raised 2026-10-25 with the shared
      // prompt-input builders: measured 75.28, 72.23, 70.46, 76.59. Raised 2026-10-27 with the public
      // API contract checks: measured 76.21, 73.31, 72.15, 77.39 (functions kept at 71: 72 would leave no
      // margin, a few untested functions anywhere would fail it). Raised 2026-11-05 with the
      // interrupted-run sweep: measured 77.27, 73.97, 73.20, 78.45 (functions kept at 72, as above).
      // Raised 2026-11-16 with the spending overview (risen since without a raise): measured 82.18,
      // 78.89, 79.67, 82.91 (functions kept at 78, as above). Raised 2026-11-16 with story context:
      // measured 83.09, 79.47, 80.93, 83.73 (functions kept at 79, as above). Raised 2026-11-17 with
      // story context's eval: measured 83.49, 79.68, 81.99, 84.03 (functions raised to 80, as above;
      // lines kept at 83, since 84 would leave no margin). Raised 2026-11-17 with story context's
      // cleanup: measured 83.64, 79.94, 82.19, 84.16 (functions raised to 81; the rest kept, as above).
      // Raised 2026-11-18 with the research passes' records and first pass: measured 84.03, 80.38,
      // 82.84, 84.60 (branches raised to 80, lines to 84; statements kept at 83 and functions at 81,
      // since 84 and 82 would leave no margin, as above). Raised 2026-11-18 with the later pass and
      // the update eval: measured 84.46, 80.48, 83.37, 85.03 (statements raised to 84, functions to
      // 82; branches kept at 80 and lines at 84, since 81 and 85 would leave no margin). Raised
      // 2026-11-18 with the research passes' wiring: measured 84.65, 80.62, 83.55, 85.23 (functions
      // raised to 83; statements kept at 84, branches at 80 and lines at 84, as above). Raised
      // 2026-11-18 with the prompt layout and the research cost changes: measured 85.05, 80.94,
      // 83.91, 85.64 (lines raised to 85; statements kept at 84, branches at 80 and functions at 83,
      // since 85, 81 and 84 would leave no margin). Raised 2026-11-18 with the overviews' admin
      // views: measured 85.45, 80.85, 84.37, 86.13 (statements raised to 85, functions to 84;
      // branches kept at 80 and lines at 85, since 81 and 86 would leave no margin). Measured
      // 2026-11-19 with the overviews' public reads: 85.53, 80.9, 84.48, 86.21 (none raised: lines
      // at 86 would leave 0.21). Raised 2026-11-20 with the overviews' scan fixes: measured 86.14,
      // 81.32, 85.51, 86.79 (branches raised to 81, functions to 85, lines to 86; statements kept at
      // 85, since 86 would leave 0.14). Raised 2026-11-25 with the db tests brought up to date:
      // measured 86.92, 81.9, 86.58, 87.52 (statements raised to 86, functions to 86, lines to 87;
      // branches kept at 81, since 82 is above the measured value)
      thresholds: { statements: 86, branches: 81, functions: 86, lines: 87 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.db.test.ts'],
          // Nothing calls OpenAI in unit tests, but the openai SDK's constructor throws without a key
          // (services/embedding.ts builds one at import), so test files load without a `.env`.
          // Usage counting stays off whatever a local `.env` says, so no test sends Simple Analytics an event.
          env: { OPENAI_API_KEY: 'sk-test-dummy', SIMPLE_ANALYTICS_EVENTS_ENABLED: 'false' },
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['src/**/*.db.test.ts'],
          globalSetup: ['src/test/db/globalSetup.ts'],
          // One database, truncated between tests: files must not run side by side
          fileParallelism: false,
          env: { SIMPLE_ANALYTICS_EVENTS_ENABLED: 'false', ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}) },
        },
      },
    ],
  },
})

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
      // prompt-input builders: measured 75.28, 72.23, 70.46, 76.59
      thresholds: { statements: 75, branches: 72, functions: 70, lines: 76 },
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
          env: { OPENAI_API_KEY: 'sk-test-dummy' },
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
          env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
        },
      },
    ],
  },
})

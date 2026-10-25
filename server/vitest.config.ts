import { configDefaults, defineConfig } from 'vitest/config'

// PostgreSQL integration tests (`*.db.test.ts`, `.context/database-migrations.md` "Integration
// Tests"): the `db` project runs against TEST_DATABASE_URL, which it hands to Prisma as
// DATABASE_URL, and fails without it (globalSetup). `npm run test` runs the `unit` project only;
// `npm run test:db` runs the `db` project.
const testDatabaseUrl = process.env.TEST_DATABASE_URL

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `npm run test:coverage` (CI) measures the unit project. A ratchet set just below the coverage
    // measured when it was introduced: raise a threshold when coverage rises; never lower one to
    // land a change.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Measured 2026-10-19: statements 69.54, branches 65.12, functions 63.99, lines 71.12 (71.00
      // once the Prettier reformat re-wrapped the code, which changes the line count but not statements)
      thresholds: { statements: 69, branches: 65, functions: 63, lines: 70 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.db.test.ts'],
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

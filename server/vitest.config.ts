import { configDefaults, defineConfig } from 'vitest/config'

// PostgreSQL integration tests (`*.db.test.ts`, `.context/database-migrations.md` "Integration
// tests"): they run against TEST_DATABASE_URL, which their project hands to Prisma as DATABASE_URL,
// and are skipped when it is unset, so `npm run test` passes without a database.
const testDatabaseUrl = process.env.TEST_DATABASE_URL

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts']
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
  }
})

/**
 * Global setup of the `db` test project: applies the committed migrations to TEST_DATABASE_URL with
 * the project's own Prisma CLI (`migrate deploy`, as db:prepare does), and never anything else
 * (ADR-0044). Without TEST_DATABASE_URL the run fails: the db tests are part of the check battery,
 * not optional extras.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { testDatabaseRefusal } from './guard.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PRISMA_CLI = path.join(SERVER_DIR, 'node_modules/prisma/build/index.js')

export const MISSING_TEST_DATABASE =
  'TEST_DATABASE_URL is not set: the db tests need a local database whose name ends in "_test" ' + '(see .context/database-migrations.md, "Integration Tests")'

function migrateDeploy(url: string): void {
  const result = spawnSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  })
  if (result.error || result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-15).join('\n')
    throw new Error(`could not migrate the test database: ${result.error ?? output}`)
  }
}

/**
 * Check the test database and migrate it. `env` is the shell's environment: here, unlike inside the
 * test workers, DATABASE_URL is still the development database, which the test database must not be.
 */
export function prepareTestDatabase(env: NodeJS.ProcessEnv, migrate: (url: string) => void = migrateDeploy): void {
  const url = env.TEST_DATABASE_URL
  if (!url) throw new Error(MISSING_TEST_DATABASE)

  const refusal = testDatabaseRefusal(url, env.DATABASE_URL)
  if (refusal) throw new Error(refusal)

  migrate(url)
}

export default function setup(): void {
  prepareTestDatabase(process.env)
}

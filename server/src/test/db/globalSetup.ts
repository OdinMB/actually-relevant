/**
 * Global setup of the `db` test project: applies the committed migrations to TEST_DATABASE_URL with
 * the project's own Prisma CLI (`migrate deploy`, as db:prepare does). Without TEST_DATABASE_URL it
 * does nothing and the db tests skip themselves.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { testDatabaseRefusal } from './guard.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PRISMA_CLI = path.join(SERVER_DIR, 'node_modules/prisma/build/index.js')

export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return

  const refusal = testDatabaseRefusal(url)
  if (refusal) throw new Error(refusal)

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

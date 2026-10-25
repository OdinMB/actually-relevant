/**
 * The integration tests truncate every table of the database they are given, so they refuse any
 * database that is not plainly a local throwaway one (ADR-0044): a local host (the db:prepare
 * guard's rule), a database name ending in `_test`, and, when the shell's DATABASE_URL is given,
 * a database other than that development one.
 */
import { checkLocalDatabase } from '../../scripts/db-prepare/localDatabase.js'

const databaseName = (url: string) => decodeURIComponent(new URL(url.trim()).pathname.replace(/^\//, ''))

export function testDatabaseRefusal(url: string, devUrl?: string): string | null {
  const location = checkLocalDatabase(url)
  if (location.kind !== 'local') {
    return `TEST_DATABASE_URL must point at a local database (got host "${location.kind === 'remote' ? location.host : ''}")`
  }
  const name = databaseName(url)
  if (!/_test$/.test(name)) {
    return `TEST_DATABASE_URL must name a database whose name ends in "_test" (got "${name}"); its tables are truncated`
  }
  if (devUrl && checkLocalDatabase(devUrl).kind === 'local' && databaseName(devUrl) === name) {
    return `TEST_DATABASE_URL names the same database as DATABASE_URL ("${name}"); use a separate test database`
  }
  return null
}

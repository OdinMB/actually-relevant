/**
 * The integration tests truncate every table of the database they are given, so they refuse any
 * database that is not plainly a local throwaway one: a local host (the db:prepare guard's rule) and
 * a database name containing "test".
 */
import { checkLocalDatabase } from '../../scripts/db-prepare/localDatabase.js'

export function testDatabaseRefusal(url: string): string | null {
  const location = checkLocalDatabase(url)
  if (location.kind !== 'local') {
    return `TEST_DATABASE_URL must point at a local database (got host "${location.kind === 'remote' ? location.host : ''}")`
  }
  const name = decodeURIComponent(new URL(url.trim()).pathname.replace(/^\//, ''))
  if (!/test/i.test(name)) {
    return `TEST_DATABASE_URL must name a database whose name contains "test" (got "${name}"); its tables are truncated`
  }
  return null
}

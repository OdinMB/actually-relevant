/**
 * Decides whether the synthetic data set may be written to a database (`.context/database-migrations.md`,
 * "Run Locally with Synthetic Data"). The seeder empties the database it fills, so it takes only one
 * that is plainly local and plainly synthetic: a local host (the db:prepare rule, `checkLocalDatabase`)
 * and a database name ending in `_synthetic`, which neither the development database
 * (`actually_relevant_dev`), a test database (`*_test`) nor production carries.
 */
import { checkLocalDatabase } from '../db-prepare/localDatabase.js'

export const SYNTHETIC_DATABASE_SUFFIX = '_synthetic'

/** Why the synthetic data set may not be written to `url`, or null when it may. */
export function syntheticDatabaseRefusal(url: string | undefined): string | null {
  const location = checkLocalDatabase(url)
  if (location.kind === 'missing') {
    return `SYNTHETIC_DATABASE_URL is not set: name a local database whose name ends in "${SYNTHETIC_DATABASE_SUFFIX}"`
  }
  if (location.kind === 'remote') {
    return `SYNTHETIC_DATABASE_URL must point at a local database (got host "${location.host}")`
  }
  const name = decodeURIComponent(new URL(String(url).trim()).pathname.replace(/^\//, ''))
  if (!name.endsWith(SYNTHETIC_DATABASE_SUFFIX)) {
    return `SYNTHETIC_DATABASE_URL must name a database whose name ends in "${SYNTHETIC_DATABASE_SUFFIX}" (got "${name}"); the seeder empties it`
  }
  return null
}

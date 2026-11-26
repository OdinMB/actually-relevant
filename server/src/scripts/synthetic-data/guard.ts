/**
 * Decides whether the synthetic data set may be written to a database (`.context/database-migrations.md`,
 * "Run Locally with Synthetic Data"). The seeder empties the database it fills, so it takes only one
 * that is plainly local and plainly synthetic: a local host and a database name ending in
 * `_synthetic` (`scratchDatabaseRefusal`).
 */
import { scratchDatabaseRefusal } from '../db-prepare/scratchDatabase.js'

export const SYNTHETIC_DATABASE_SUFFIX = '_synthetic'

/** Why the synthetic data set may not be written to `url`, or null when it may. */
export const syntheticDatabaseRefusal = (url: string | undefined): string | null =>
  scratchDatabaseRefusal(url, { variable: 'SYNTHETIC_DATABASE_URL', suffix: SYNTHETIC_DATABASE_SUFFIX, emptiedBy: 'the seeder' })

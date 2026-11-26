/**
 * Decides which database the eval copy may be imported into (`.context/database-migrations.md`, "A
 * Stories-Only Copy for Cloud Evals"). The import empties it, so it takes only a local database whose
 * name ends in `_eval` (`scratchDatabaseRefusal`).
 */
import { scratchDatabaseRefusal } from '../db-prepare/scratchDatabase.js'

export const EVAL_DATABASE_SUFFIX = '_eval'

/** Why the copy may not be imported into `url`, or null when it may. */
export const evalDatabaseRefusal = (url: string | undefined): string | null =>
  scratchDatabaseRefusal(url, { variable: 'EVAL_DATABASE_URL', suffix: EVAL_DATABASE_SUFFIX, emptiedBy: 'the import' })

/**
 * Decides whether a command that empties the database it fills may take the one a URL names: only a
 * plainly local one (the db:prepare rule, `checkLocalDatabase`) whose name ends in the command's own
 * suffix, which neither the development database (`actually_relevant_dev`), a test database
 * (`*_test`), another command's database nor production carries. Used by the synthetic seeder
 * (`_synthetic`) and the eval copy's import (`_eval`).
 */
import { checkLocalDatabase } from './localDatabase.js'

export interface ScratchDatabase {
  /** The variable the URL comes from, as the refusal names it. */
  variable: string
  suffix: string
  /** Who empties the database, for the refusal: "the seeder". */
  emptiedBy: string
}

/** Why the command may not take the database `url` names, or null when it may. */
export function scratchDatabaseRefusal(url: string | undefined, s: ScratchDatabase): string | null {
  const location = checkLocalDatabase(url)
  if (location.kind === 'missing') return `${s.variable} is not set: name a local database whose name ends in "${s.suffix}"`
  if (location.kind === 'remote') return `${s.variable} must point at a local database (got host "${location.host}")`
  const name = decodeURIComponent(new URL(String(url).trim()).pathname.replace(/^\//, ''))
  if (!name.endsWith(s.suffix)) return `${s.variable} must name a database whose name ends in "${s.suffix}" (got "${name}"); ${s.emptiedBy} empties it`
  return null
}

/**
 * The one place that decides whether db:prepare may touch the database: never
 * when it was asked to skip, and never unless DATABASE_URL is local.
 */
import { checkLocalDatabase } from './localDatabase.js'

export type Preparation =
  | { action: 'run' }
  | { action: 'skip-requested' }
  | { action: 'skip-missing' }
  | { action: 'skip-remote'; host: string }

export function decidePreparation(env: Record<string, string | undefined>): Preparation {
  if (/^(1|true|yes)$/i.test(env.SKIP_DB_PREPARE ?? '')) return { action: 'skip-requested' }
  const location = checkLocalDatabase(env.DATABASE_URL)
  if (location.kind === 'missing') return { action: 'skip-missing' }
  if (location.kind === 'remote') return { action: 'skip-remote', host: location.host }
  return { action: 'run' }
}

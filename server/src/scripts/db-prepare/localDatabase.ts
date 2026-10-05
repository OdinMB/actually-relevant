/**
 * Decides whether DATABASE_URL points at a database on this machine, so that
 * db:prepare only ever migrates a local development database. Anything it
 * cannot positively identify as local counts as remote.
 */

export type DatabaseLocation =
  | { kind: 'missing' }
  | { kind: 'local'; host: string }
  | { kind: 'remote'; host: string }

// Exact hostnames only. host.docker.internal and *.localhost are deliberately
// absent: the server runs on the host, not in a container, so neither is the
// Docker dev database as this repo sets it up.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const POSTGRES_SCHEMES = new Set(['postgresql:', 'postgres:'])

export function checkLocalDatabase(databaseUrl: string | undefined): DatabaseLocation {
  if (!databaseUrl || databaseUrl.trim() === '') return { kind: 'missing' }

  let url: URL
  try {
    url = new URL(databaseUrl.trim())
  } catch {
    return { kind: 'remote', host: '(unparseable DATABASE_URL)' }
  }

  if (!POSTGRES_SCHEMES.has(url.protocol)) return { kind: 'remote', host: url.host || url.protocol }

  // Ambiguous connection targets fail closed: which of several `host` values a
  // driver uses is not something to bet a production database on.
  const hostParams = url.searchParams.getAll('host')
  if (hostParams.length > 1 || url.searchParams.has('hostaddr')) {
    return { kind: 'remote', host: '(ambiguous host parameters)' }
  }

  // Prisma connects to the `host` query parameter when one is given, so judge that.
  const host = (url.searchParams.get('host') ?? url.hostname).toLowerCase()
  const isSocketPath = host.startsWith('/')
  return LOCAL_HOSTS.has(host) || isSocketPath ? { kind: 'local', host } : { kind: 'remote', host }
}

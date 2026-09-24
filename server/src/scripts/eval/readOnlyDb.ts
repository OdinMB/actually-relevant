/**
 * The eval's database session, enforced read-only by Postgres itself.
 *
 * The session is opened with `default_transaction_read_only=on` (a startup
 * option carried in the connection URL, so it survives a Prisma reconnect).
 * If the server or a pooler rejects that option, every read instead runs
 * inside ONE interactive transaction whose first statement is
 * `SET TRANSACTION READ ONLY` (a session-level SET would be lost silently on
 * reconnect). Either way `SHOW transaction_read_only = on` is asserted before
 * any fixture query. The URL and host are never printed.
 */
import { PrismaClient, type Prisma } from '@prisma/client'

export type Db = Prisma.TransactionClient

export interface ReadOnlyDb {
  mode: 'session' | 'transaction'
  dbClass: 'local' | 'remote'
  read<T>(fn: (db: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** Only `local` or `remote` is ever reported. */
export function classifyDb(url: string): 'local' | 'remote' {
  try {
    const host = new URL(url).hostname
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) ? 'local' : 'remote'
  } catch {
    return 'remote'
  }
}

/** DATABASE_URL with one connection and, optionally, the read-only startup option. */
export function readOnlyUrl(url: string, withOptions: boolean): string {
  const parsed = new URL(url)
  const kept = [...parsed.searchParams].filter(([k]) => k !== 'connection_limit' && k !== 'options')
  parsed.search = new URLSearchParams(kept).toString()
  const base = parsed.toString()
  const extra = ['connection_limit=1']
  if (withOptions) extra.push(`options=${encodeURIComponent('-c default_transaction_read_only=on')}`)
  return `${base}${parsed.search ? '&' : '?'}${extra.join('&')}`
}

export function assertReadOnly(value: string | undefined): void {
  if (value !== 'on') {
    throw new Error('read-only guard: transaction_read_only is not "on"; aborting before any fixture query')
  }
}

type ShowRow = { transaction_read_only: string }

/** Prisma connection errors can name the host; report only the error code. */
function sanitizedError(err: unknown): Error {
  const code = (err as { errorCode?: string; code?: string }).errorCode ?? (err as { code?: string }).code ?? 'unknown'
  return new Error(`could not open the read-only database session (error code ${code})`)
}

async function trySessionMode(url: string): Promise<PrismaClient | null> {
  const client = new PrismaClient({ datasourceUrl: readOnlyUrl(url, true) })
  try {
    const rows = await client.$queryRaw<ShowRow[]>`SHOW transaction_read_only`
    if (rows[0]?.transaction_read_only === 'on') return client
  } catch {
    // A pooler may reject the startup option; fall back to transaction mode.
  }
  await client.$disconnect().catch(() => undefined)
  return null
}

export async function openReadOnlyDb(): Promise<ReadOnlyDb> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const dbClass = classifyDb(url)

  const session = await trySessionMode(url).catch(() => null)
  if (session) {
    return { mode: 'session', dbClass, read: fn => fn(session), close: () => session.$disconnect() }
  }

  const client = new PrismaClient({ datasourceUrl: readOnlyUrl(url, false) })
  try {
    await client.$connect()
  } catch (err) {
    throw sanitizedError(err)
  }
  return {
    mode: 'transaction',
    dbClass,
    read: fn =>
      client.$transaction(
        async tx => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`
          const rows = await tx.$queryRaw<ShowRow[]>`SHOW transaction_read_only`
          assertReadOnly(rows[0]?.transaction_read_only)
          return fn(tx)
        },
        { timeout: 300_000, maxWait: 30_000 },
      ),
    close: () => client.$disconnect(),
  }
}

/** Run the guard's own check and return the observed value (for the dry-run banner). */
export async function readOnlyStatus(db: ReadOnlyDb): Promise<string> {
  return db.read(async q => {
    const rows = await q.$queryRaw<ShowRow[]>`SHOW transaction_read_only`
    assertReadOnly(rows[0]?.transaction_read_only)
    return rows[0].transaction_read_only
  })
}

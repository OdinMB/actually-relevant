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
import { Prisma, PrismaClient } from '@prisma/client'

export type Db = Prisma.TransactionClient

/** All a sampler needs of the session: tagged, parameterized SELECTs. `Db` is one, and a test can pass a stub. */
export interface SelectDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

export interface ReadOnlyDb {
  mode: 'session' | 'transaction'
  dbClass: 'local' | 'remote'
  read<T>(fn: (db: Db) => Promise<T>): Promise<T>
  /**
   * `fn` inside one `REPEATABLE READ, READ ONLY` transaction of at most `timeoutMs`: every query sees
   * the database as it was at the first, so tables read one after another agree (the eval copy's export).
   */
  snapshot<T>(fn: (db: Db) => Promise<T>, timeoutMs: number): Promise<T>
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

/** A transaction's first statement: read-only from here on, which is asserted before any query of the caller's. */
async function readOnlyFirst(tx: Db): Promise<void> {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`
  const rows = await tx.$queryRaw<ShowRow[]>`SHOW transaction_read_only`
  assertReadOnly(rows[0]?.transaction_read_only)
}

/** `ReadOnlyDb.snapshot` on a client: Prisma opens the transaction at `REPEATABLE READ`, which is asserted with read-only before `fn`. */
const snapshotOn =
  (client: PrismaClient) =>
  <T>(fn: (db: Db) => Promise<T>, timeoutMs: number): Promise<T> =>
    client.$transaction(
      async tx => {
        await readOnlyFirst(tx)
        const rows = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`
        if (rows[0]?.transaction_isolation !== 'repeatable read') throw new Error('the snapshot is not at REPEATABLE READ; aborting before any query')
        return fn(tx)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: timeoutMs, maxWait: 30_000 },
    )

export async function openReadOnlyDb(): Promise<ReadOnlyDb> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const dbClass = classifyDb(url)

  const session = await trySessionMode(url).catch(() => null)
  if (session) {
    return { mode: 'session', dbClass, read: fn => fn(session), snapshot: snapshotOn(session), close: () => session.$disconnect() }
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
          await readOnlyFirst(tx)
          return fn(tx)
        },
        { timeout: 300_000, maxWait: 30_000 },
      ),
    snapshot: snapshotOn(client),
    close: () => client.$disconnect(),
  }
}

/** Run the guard's own check and return the observed value (for the dry-run banner). */
export async function readOnlyStatus(db: ReadOnlyDb): Promise<string> {
  return db.read(async q => {
    const rows = await q.$queryRaw<ShowRow[]>`SHOW transaction_read_only`
    assertReadOnly(rows[0]?.transaction_read_only)
    return rows[0]!.transaction_read_only
  })
}

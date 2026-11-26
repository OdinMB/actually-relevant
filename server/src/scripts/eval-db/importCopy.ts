/**
 * The eval copy's import (`.context/database-migrations.md`, "A Stories-Only Copy for Cloud Evals"),
 * in one transaction: empties every table but Prisma's migration history, loads the copy's rows in
 * its order through `jsonb_populate_recordset` (each value through its column type's own input, so
 * vectors, arrays and dates come back as exported), sets the deferred columns once every table is
 * in, and holds the rows read against the copy's end line (`CopyReader`). A refusal or an error rolls
 * the whole import back, leaving the database as it was. Which database it may take is the command's
 * to check (`guard.ts`), before it migrates it.
 */
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { Prisma, type PrismaClient } from '@prisma/client'
import { CopyFileError, CopyReader, splitLines } from './copyFile.js'
import { ident, newestMigration, tableColumns } from './database.js'
import type { Row } from './scrub.js'
import { EXPORTED_TABLES, type ExportedTable } from './tables.js'

type Tx = Prisma.TransactionClient

export interface ImportSummary {
  counts: Record<string, number>
  exportedAt: string
  /** The newest migration of the database the copy was made from, and of this one. */
  copyMigration: string | null
  databaseMigration: string | null
}

const BATCH_ROWS = 500
const BATCH_CHARS = 8_000_000
const IMPORT_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** Truncate every table but Prisma's migration history. */
async function emptyDatabase(tx: Tx): Promise<void> {
  const tables = await tx.$queryRaw<{ name: string }[]>`
    SELECT tablename::text AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
  if (tables.length === 0) return
  await tx.$executeRaw`TRUNCATE TABLE ${Prisma.join(tables.map(t => ident(t.name)))} RESTART IDENTITY CASCADE`
}

/** Rows gathered per table and inserted a batch at a time; the deferred columns' values kept for `setDeferred`. */
class Loader {
  private table: ExportedTable | null = null
  private rows: Row[] = []
  private signature = ''
  private chars = 0
  private readonly deferred = new Map<string, Row[]>()
  private readonly byName = new Map(EXPORTED_TABLES.map(t => [t.table, t]))

  constructor(
    private readonly tx: Tx,
    private readonly columns: ReadonlyMap<string, readonly string[]>,
  ) {}

  async add(table: string, row: Row, chars: number): Promise<void> {
    const t = this.byName.get(table)!
    const known = this.columns.get(table) ?? []
    const unknown = Object.keys(row).filter(c => !known.includes(c))
    if (unknown.length > 0) {
      throw new CopyFileError(
        `the copy has columns this database lacks: ${unknown.map(c => `${table}.${c}`).join(', ')}; export the copy again from a database migrated as this one is`,
      )
    }
    const loaded: Row = { ...row }
    for (const column of t.deferred) {
      if (loaded[column] === null || loaded[column] === undefined) continue
      const key = `${table}.${column}`
      const later = this.deferred.get(key) ?? []
      later.push({ [t.key]: loaded[t.key], [column]: loaded[column] })
      this.deferred.set(key, later)
      loaded[column] = null
    }
    const signature = Object.keys(loaded).join(',')
    if (t !== this.table || signature !== this.signature || this.rows.length >= BATCH_ROWS || this.chars >= BATCH_CHARS) await this.flush()
    this.table = t
    this.signature = signature
    this.rows.push(loaded)
    this.chars += chars
  }

  async flush(): Promise<void> {
    if (this.table && this.rows.length > 0) await this.insert(this.table.table, this.rows)
    this.rows = []
    this.chars = 0
  }

  /** Each deferred column set on the rows already loaded, by their key. */
  async setDeferred(): Promise<void> {
    for (const [key, rows] of this.deferred) {
      const [table, column] = key.split('.') as [string, string]
      const t = this.byName.get(table)!
      for (let i = 0; i < rows.length; i += BATCH_ROWS) {
        await this.tx.$executeRaw`
          UPDATE ${ident(table)} AS t SET ${ident(column)} = d.${ident(column)}
          FROM jsonb_populate_recordset(NULL::${ident(table)}, ${JSON.stringify(rows.slice(i, i + BATCH_ROWS))}::jsonb) AS d
          WHERE t.${ident(t.key)} = d.${ident(t.key)}`
      }
    }
  }

  private async insert(table: string, rows: Row[]): Promise<void> {
    const list = Prisma.join(Object.keys(rows[0]!).map(ident))
    await this.tx.$executeRaw`
      INSERT INTO ${ident(table)} (${list})
      SELECT ${list} FROM jsonb_populate_recordset(NULL::${ident(table)}, ${JSON.stringify(rows)}::jsonb)`
  }
}

/** Replace everything in the database `db` connects to with the copy in `file`. */
export async function importEvalCopy(db: PrismaClient, file: string, options: { timeoutMs?: number } = {}): Promise<ImportSummary> {
  const tables = EXPORTED_TABLES.map(t => t.table)
  const summary = await db.$transaction(
    async tx => {
      await emptyDatabase(tx)
      const loader = new Loader(tx, await tableColumns(tx, tables))
      const reader = new CopyReader(tables)
      // The pipeline reports its own abort once the last stage throws: keep the stage's error, which says why
      let refusal: unknown = null
      await pipeline(createReadStream(file), createGunzip(), async (source: AsyncIterable<Buffer>) => {
        try {
          for await (const line of splitLines(source)) {
            const entry = reader.read(line)
            if (entry) await loader.add(entry.table, entry.row, line.length)
          }
        } catch (err) {
          refusal = err
          throw err
        }
      }).catch((err: unknown) => {
        throw refusal ?? err
      })
      await loader.flush()
      const counts = reader.finish()
      await loader.setDeferred()
      return { counts, exportedAt: reader.header!.exportedAt, copyMigration: reader.header!.migration, databaseMigration: await newestMigration(tx) }
    },
    { timeout: options.timeoutMs ?? IMPORT_TIMEOUT_MS, maxWait: 30_000 },
  )
  // Fresh planner statistics for the evals' queries (the vector and window queries above all)
  await db.$executeRaw`ANALYZE`
  return summary
}

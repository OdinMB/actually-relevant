/**
 * The eval copy's export (`.context/database-migrations.md`, "A Stories-Only Copy for Cloud Evals"):
 * in one read-only snapshot of the eval's session, holds the database's columns against the
 * classification (`checkSourceColumns`), then reads each table `tables.ts` lists, in pages by its key,
 * scrubs every row (`scrubRow`) and writes the copy file (`copyFile.ts`). No other table is ever
 * queried. The file is written as `<out>.partial` and renamed when complete, so a failed export
 * leaves no file under the name asked for.
 */
import { createWriteStream, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { Prisma } from '@prisma/client'
import type { Db, ReadOnlyDb } from '../eval/readOnlyDb.js'
import { headerLine, rowLine, trailerLine } from './copyFile.js'
import { ident, newestMigration, tableColumns } from './database.js'
import { checkSourceColumns, scrubRow, type Row } from './scrub.js'
import { EXPORTED_TABLES, type ExportedTable } from './tables.js'

export interface ExportSummary {
  /** Rows written per table. */
  counts: Record<string, number>
  /** Rows whose value the scrub changed, per `table.column`. */
  scrubbed: Record<string, number>
  /** Exported tables, and classified columns, the database does not have (it is migrated to an older schema). */
  absentTables: string[]
  absentColumns: string[]
  migration: string | null
  bytes: number
}

export interface ExportOptions {
  now?: Date
  /** Rows per query. */
  pageSize?: number
  /** How long the snapshot may stay open. */
  timeoutMs?: number
}

const PAGE_SIZE = 250
const SNAPSHOT_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** A table's rows as JSON (`to_jsonb`: every column, through its type's own output), a page at a time in key order. */
async function* pagesOf(db: Db, t: ExportedTable, pageSize: number): AsyncGenerator<Row[]> {
  let after: string | null = null
  for (;;) {
    const from: Prisma.Sql = after === null ? Prisma.empty : Prisma.sql`WHERE t.${ident(t.key)} > ${after}`
    const page = await db.$queryRaw<{ row: Row }[]>(
      Prisma.sql`SELECT to_jsonb(t) AS row FROM ${ident(t.table)} t ${from} ORDER BY t.${ident(t.key)} LIMIT ${pageSize}`,
    )
    if (page.length > 0) yield page.map(p => p.row)
    if (page.length < pageSize) return
    after = String(page[page.length - 1]!.row[t.key])
  }
}

/** Write the copy of the database `db` reads to `out`. Refuses, writing nothing, a database with a column the classification does not name. */
export async function exportEvalCopy(db: Pick<ReadOnlyDb, 'snapshot'>, out: string, options: ExportOptions = {}): Promise<ExportSummary> {
  const partial = `${out}.partial`
  const pageSize = options.pageSize ?? PAGE_SIZE
  const counts: Record<string, number> = {}
  const tally = new Map<string, number>()
  try {
    const found = await db.snapshot(async q => {
      const source = await tableColumns(
        q,
        EXPORTED_TABLES.map(t => t.table),
      )
      const { absentTables, absentColumns } = checkSourceColumns(EXPORTED_TABLES, source)
      const migration = await newestMigration(q)
      const tables = EXPORTED_TABLES.filter(t => !absentTables.includes(t.table))
      async function* lines(): AsyncGenerator<string> {
        yield `${headerLine({ exportedAt: (options.now ?? new Date()).toISOString(), migration })}\n`
        for (const t of tables) {
          counts[t.table] = 0
          for await (const page of pagesOf(q, t, pageSize)) {
            counts[t.table]! += page.length
            yield `${page.map(row => rowLine(t.table, scrubRow(t, row, tally))).join('\n')}\n`
          }
        }
        yield `${trailerLine(counts)}\n`
      }
      await pipeline(Readable.from(lines()), createGzip(), createWriteStream(partial))
      return { absentTables, absentColumns, migration }
    }, options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS)
    renameSync(partial, out)
    return { counts, scrubbed: Object.fromEntries(tally), ...found, bytes: statSync(out).size }
  } catch (err) {
    rmSync(partial, { force: true })
    throw err
  }
}

/**
 * The eval copy's export (`.context/database-migrations.md`, "A Stories-Only Copy for Cloud Evals"):
 * in one read-only snapshot of the eval's session, holds the database's columns against the
 * classification (`checkSourceColumns`), works out which rows a window holds (`selection.ts`; every
 * row with `all`), then reads each table `tables.ts` lists, in pages by its key, scrubs every row
 * (`scrubRow`), holds it to the foreign keys (`ReferenceGuard`) and writes the copy file
 * (`copyFile.ts`). No other table of the schema is ever queried (the catalog only for its columns and
 * foreign keys). The file is written as `<out>.partial` and renamed
 * when complete, so a failed export leaves no file under the name asked for.
 */
import { createWriteStream, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { Prisma } from '@prisma/client'
import type { Db, ReadOnlyDb } from '../eval/readOnlyDb.js'
import { headerLine, rowLine, trailerLine } from './copyFile.js'
import { ident, newestMigration, tableColumns } from './database.js'
import { ReferenceGuard, foreignKeys } from './references.js'
import { checkSourceColumns, scrubRow, type Row } from './scrub.js'
import { rowFilter, selectRows } from './selection.js'
import { EXPORTED_TABLES, type ExportedTable } from './tables.js'
import { DEFAULT_WINDOW_MONTHS, copyWindow, type CopyWindow, type WindowChoice } from './window.js'

export interface ExportSummary {
  window: CopyWindow
  /** The stories first seen in the window, before the older ones the copy's rows point at joined; null for every story. */
  inWindow: number | null
  /** Rows written per table. */
  counts: Record<string, number>
  /** Rows whose value the scrub changed, per `table.column`. */
  scrubbed: Record<string, number>
  /** References to a row outside the copy written as null, per `table.column`. */
  nulled: Record<string, number>
  /** Exported tables, and classified columns, the database does not have (it is migrated to an older schema). */
  absentTables: string[]
  absentColumns: string[]
  migration: string | null
  bytes: number
}

export interface ExportOptions {
  now?: Date
  /** The calendar months of stories to copy, or every story; six months unless given. */
  window?: WindowChoice
  /** Rows per query. */
  pageSize?: number
  /** How long the snapshot may stay open. */
  timeoutMs?: number
}

const PAGE_SIZE = 250
const SNAPSHOT_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** A table's rows as JSON (`to_jsonb`: every column, through its type's own output), those `filter` admits, a page at a time in key order. */
async function* pagesOf(db: Db, t: ExportedTable, pageSize: number, filter: Prisma.Sql | null): AsyncGenerator<Row[]> {
  let after: string | null = null
  for (;;) {
    const conditions: Prisma.Sql[] = [...(filter ? [filter] : []), ...(after === null ? [] : [Prisma.sql`t.${ident(t.key)} > ${after}`])]
    const where: Prisma.Sql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
    const page: { row: Row }[] = await db.$queryRaw<{ row: Row }[]>(
      Prisma.sql`SELECT to_jsonb(t) AS row FROM ${ident(t.table)} t ${where} ORDER BY t.${ident(t.key)} LIMIT ${pageSize}`,
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
  const now = options.now ?? new Date()
  const window = copyWindow(options.window ?? DEFAULT_WINDOW_MONTHS, now)
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
      const keys = await foreignKeys(
        q,
        tables.map(t => t.table),
      )
      const selection = window === 'all' ? null : await selectRows(q, tables, keys, new Date(window.since))
      const guard = new ReferenceGuard(
        keys,
        tables.map(t => t.table),
      )
      async function* lines(): AsyncGenerator<string> {
        yield `${headerLine({ exportedAt: now.toISOString(), migration, window })}\n`
        for (const t of tables) {
          counts[t.table] = 0
          for await (const page of pagesOf(q, t, pageSize, selection && rowFilter(t, selection))) {
            counts[t.table]! += page.length
            yield `${page.map(row => rowLine(t.table, guard.admit(t.table, scrubRow(t, row, tally)))).join('\n')}\n`
          }
        }
        guard.finish()
        yield `${trailerLine(counts)}\n`
      }
      await pipeline(Readable.from(lines()), createGzip(), createWriteStream(partial))
      return { absentTables, absentColumns, migration, inWindow: selection?.inWindow ?? null, nulled: Object.fromEntries(guard.nulled) }
    }, options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS)
    renameSync(partial, out)
    return { window, counts, scrubbed: Object.fromEntries(tally), ...found, bytes: statSync(out).size }
  } catch (err) {
    rmSync(partial, { force: true })
    throw err
  }
}

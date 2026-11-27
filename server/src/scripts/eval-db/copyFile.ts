/**
 * The eval copy's file: gzip-compressed JSON lines, a header first (`format`, `version`, when it was
 * made, the newest migration its database had and its window), then one line per row
 * (`{"table":…,"row":…}`, every table's rows together, in load order), then an end line with each
 * table's count. A reader refuses anything else: a table off the list it is given, a table out of
 * order, a line after the end, a copy cut short, counts that differ from the rows.
 */
import { StringDecoder } from 'node:string_decoder'
import type { Row } from './scrub.js'
import type { CopyWindow } from './window.js'

export const COPY_FORMAT = 'actually-relevant-eval-copy'
export const COPY_VERSION = 1

export interface CopyHeader {
  format: typeof COPY_FORMAT
  version: typeof COPY_VERSION
  exportedAt: string
  migration: string | null
  /** A header without one is a copy made before the window existed, which held every story. */
  window: CopyWindow
}

/** A copy the reader refuses. */
export class CopyFileError extends Error {}

export const headerLine = (h: Pick<CopyHeader, 'exportedAt' | 'migration' | 'window'>): string =>
  JSON.stringify({ format: COPY_FORMAT, version: COPY_VERSION, exportedAt: h.exportedAt, migration: h.migration, window: h.window })

export const rowLine = (table: string, row: Row): string => JSON.stringify({ table, row })

export const trailerLine = (counts: Record<string, number>): string => JSON.stringify({ end: true, counts })

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The header's window; refuses one this code cannot read. */
function readWindow(value: unknown): CopyWindow {
  if (value === undefined || value === 'all') return 'all'
  if (isObject(value) && Number.isInteger(value.months) && typeof value.since === 'string' && !Number.isNaN(Date.parse(value.since))) {
    return { months: value.months as number, since: value.since }
  }
  throw new CopyFileError(`the copy's header has a window this code cannot read: ${JSON.stringify(value)}`)
}

/** Reads a copy line by line, in order, against the tables it may hold (in their load order). */
export class CopyReader {
  header: CopyHeader | null = null
  private readonly order: Map<string, number>
  private readonly counts = new Map<string, number>()
  private at = -1
  private line = 0
  private end: Record<string, number> | null = null

  constructor(tables: readonly string[]) {
    this.order = new Map(tables.map((t, i) => [t, i]))
  }

  /** The row a line holds, or null for the header and the end line. */
  read(text: string): { table: string; row: Row } | null {
    this.line++
    if (this.end) throw new CopyFileError(`the copy has a line after its end (line ${this.line})`)
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new CopyFileError(`line ${this.line} of the copy is not JSON`)
    }
    if (!isObject(value)) throw new CopyFileError(`line ${this.line} of the copy is not an object`)

    if (!this.header) {
      if (value.format !== COPY_FORMAT) throw new CopyFileError(`the file does not start with an eval copy's header (format "${COPY_FORMAT}")`)
      if (value.version !== COPY_VERSION)
        throw new CopyFileError(`the copy is format version ${String(value.version)}; this code reads version ${COPY_VERSION}`)
      this.header = {
        format: COPY_FORMAT,
        version: COPY_VERSION,
        exportedAt: String(value.exportedAt),
        migration: typeof value.migration === 'string' ? value.migration : null,
        window: readWindow(value.window),
      }
      return null
    }
    if (value.end === true && isObject(value.counts)) {
      this.end = Object.fromEntries(Object.entries(value.counts).map(([t, n]) => [t, Number(n)]))
      return null
    }

    const { table, row } = value
    if (typeof table !== 'string' || !isObject(row)) throw new CopyFileError(`line ${this.line} of the copy is not a row`)
    const index = this.order.get(table)
    if (index === undefined) throw new CopyFileError(`the copy holds the table "${table}", which is not one the copy may hold`)
    // A table seen before has an index at most `at`, so one that comes back after another is below it
    if (index < this.at) throw new CopyFileError(`the copy's table "${table}" is out of order (line ${this.line})`)
    this.at = index
    this.counts.set(table, (this.counts.get(table) ?? 0) + 1)
    return { table, row }
  }

  /** Each table's rows read; refuses a copy without its end line, or whose end line counts other rows. */
  finish(): Record<string, number> {
    if (!this.header || !this.end) throw new CopyFileError('the copy is cut short: it has no end line')
    const counts = Object.fromEntries(this.counts)
    for (const table of new Set([...Object.keys(counts), ...Object.keys(this.end)])) {
      const read = counts[table] ?? 0
      const said = this.end[table] ?? 0
      if (read !== said) throw new CopyFileError(`the copy does not hold the rows its end line counts: ${table}: ${read} rows, its end says ${said}`)
    }
    return counts
  }
}

/** The lines of a byte stream (UTF-8, `\n`-separated), with no empty line after a final newline. */
export async function* splitLines(source: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8')
  let rest = ''
  for await (const chunk of source) {
    rest += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    const lines = rest.split('\n')
    rest = lines.pop()!
    yield* lines
  }
  rest += decoder.end()
  if (rest !== '') yield rest
}

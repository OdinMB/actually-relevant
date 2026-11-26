/**
 * Reads `prisma/schema.prisma` as text, for the fence tests that hold a list against the schema
 * (`scripts/eval-db/tables.test.ts`): each model's table, its columns (mapped names, whether a column
 * may be null) and the foreign keys its relations declare. A relation field (another model's type) is
 * not a column; an `Unsupported(...)` field is.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SchemaColumn {
  /** The column's name in the database (`@map`, else the field's). */
  name: string
  field: string
  /** The Prisma type without `?` or `[]`: `String`, an enum's name, `Unsupported("vector(1536)")`. */
  type: string
  optional: boolean
  list: boolean
}

export interface SchemaForeignKey {
  columns: string[]
  /** The table the key points at. */
  table: string
}

export interface SchemaTable {
  model: string
  table: string
  columns: SchemaColumn[]
  foreignKeys: SchemaForeignKey[]
}

const SCHEMA_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/schema.prisma')

/** A line without its comment; a `//` inside a quoted string stays. */
const withoutComment = (line: string) => line.replace(/("[^"]*")|\s*\/\/.*$/g, (_m, quoted: string | undefined) => quoted ?? '').trim()

const FIELD = /^(\w+)\s+(Unsupported\("[^"]*"\)|\w+)(\[\])?(\?)?(.*)$/

export function parsePrismaSchema(text: string): SchemaTable[] {
  const blocks = [...text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(m => ({ model: m[1]!, body: m[2]! }))
  const models = new Set(blocks.map(b => b.model))
  const tableOf = new Map(blocks.map(b => [b.model, /@@map\("([^"]+)"\)/.exec(b.body)?.[1] ?? b.model]))

  return blocks.map(({ model, body }) => {
    const columns: SchemaColumn[] = []
    const relations: { fields: string[]; model: string }[] = []
    for (const raw of body.split(/\r?\n/)) {
      const line = withoutComment(raw)
      if (line === '' || line.startsWith('@@')) continue
      const m = FIELD.exec(line)
      if (!m) throw new Error(`schema line not understood in model ${model}: ${line}`)
      const [, field, type, list, optional, rest] = m as unknown as [string, string, string, string | undefined, string | undefined, string]
      if (models.has(type)) {
        const fields = /fields:\s*\[([^\]]*)\]/.exec(rest)?.[1]
        if (fields) relations.push({ fields: fields.split(',').map(f => f.trim()), model: type })
        continue
      }
      columns.push({ name: /@map\("([^"]+)"\)/.exec(rest)?.[1] ?? field, field, type, optional: optional === '?', list: list === '[]' })
    }
    const columnOf = new Map(columns.map(c => [c.field, c.name]))
    const foreignKeys = relations.map(r => ({ columns: r.fields.map(f => columnOf.get(f) ?? f), table: tableOf.get(r.model)! }))
    return { model, table: tableOf.get(model)!, columns, foreignKeys }
  })
}

export const readPrismaSchema = (): SchemaTable[] => parsePrismaSchema(readFileSync(SCHEMA_FILE, 'utf8'))

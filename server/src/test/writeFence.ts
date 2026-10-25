/**
 * The source scanner behind the write fences (`statusWriters.test.ts`, `newsletterWriters.test.ts`):
 * tests that keep one module the only writer of some fields by reading every other source file.
 *
 * The match is textual: a Prisma call's `data` passed as a variable, or a key spread in from
 * elsewhere, is not seen. Strings and comments are not special-cased.
 */
import { readdirSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

/** The server's `src/` directory. */
export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every non-test `.ts` file under `dir`, minus the `allowed` files (the owning module) and the
 * `skippedDirs`, both given relative to `src/`.
 */
export function sourceFiles(dir: string, allowed: ReadonlySet<string>, skippedDirs: ReadonlySet<string>): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    const rel = relative(SRC, path)
    if (statSync(path).isDirectory()) return skippedDirs.has(rel) ? [] : sourceFiles(path, allowed, skippedDirs)
    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.endsWith('.d.ts')) return []
    return allowed.has(rel) ? [] : [path]
  })
}

/** The text between the bracket at `open` and its match. */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const c = src[i]!
    const close = pairs[c]
    if (close) stack.push(close)
    else if (c === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return src.slice(open + 1, i)
    }
  }
  return src.slice(open + 1)
}

/** Top-level keys of an object literal's body. */
function topLevelKeys(body: string): string[] {
  const keys: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= body.length; i++) {
    const c = body[i]
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if ((c === ',' || i === body.length) && depth === 0) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*(:|,|$)/.exec(body.slice(start, i))
      if (m) keys.push(m[1]!)
      start = i + 1
    }
  }
  return keys
}

/** Object-literal bodies under `key:` at the top level of the call's argument. */
function writtenObjects(arg: string, keys: string[]): string[] {
  const out: string[] = []
  const firstObject = arg.indexOf('{')
  if (firstObject === -1) return out
  const top = balanced(arg, firstObject)
  for (const key of keys) {
    const re = new RegExp(`(^|[,{\\s])${key}\\s*:\\s*\\{`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(top))) {
      const open = m.index + m[0].length - 1
      out.push(balanced(top, open))
    }
  }
  return out
}

/**
 * Prisma calls `.<model>.<operation>(...)` in `src` that write a guarded field: one whose written
 * object (`data`, or `create`/`update` for upsert) has a top-level key in `keys`. With `keys`
 * null, every such call counts (deletes, or inserts the module alone may make).
 */
export function prismaWrites(src: string, model: string, operations: readonly string[], keys: ReadonlySet<string> | null): string[] {
  const found: string[] = []
  const call = new RegExp(`\\.${model}\\.(${operations.join('|')})\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = call.exec(src))) {
    const operation = m[1]!
    if (keys) {
      const arg = balanced(src, m.index + m[0].length - 1)
      const objects = writtenObjects(arg, operation === 'upsert' ? ['create', 'update'] : ['data'])
      if (!objects.some(body => topLevelKeys(body).some(k => keys.has(k)))) continue
    }
    found.push(`${model}.${operation} at offset ${m.index}`)
  }
  return found
}

/** Raw SQL in `src` of the form `UPDATE <table> ... SET ...` whose assignments name a column matching `columns`. */
export function rawUpdates(src: string, table: string, columns: RegExp): string[] {
  const found: string[] = []
  const update = new RegExp(`UPDATE\\s+"?${table}"?(\\s+(AS\\s+)?\\w+)?\\s+SET\\b([\\s\\S]*?)(\\bWHERE\\b|\\bFROM\\b|\`|;)`, 'gi')
  let m: RegExpExecArray | null
  while ((m = update.exec(src))) {
    if (columns.test(m[3]!)) found.push(`raw UPDATE ${table} at offset ${m.index}`)
  }
  return found
}

/** Raw SQL in `src` that adds or removes rows of `table`: `INSERT INTO <table>` or `DELETE FROM <table>`. */
export function rawInsertsOrDeletes(src: string, table: string): string[] {
  const found: string[] = []
  const statement = new RegExp(`\\b(INSERT\\s+INTO|DELETE\\s+FROM)\\s+"?${table}"?(?![\\w"])`, 'gi')
  let m: RegExpExecArray | null
  while ((m = statement.exec(src))) found.push(`raw ${m[1]!.split(/\s+/)[0]!.toUpperCase()} ${table} at offset ${m.index}`)
  return found
}

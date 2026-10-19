import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname, relative, sep } from 'path'
import { fileURLToPath } from 'url'

/**
 * Keeps `services/storyLifecycle.ts` the only code that writes `stories.status` and
 * `stories.rejection_reason` (ADR-0045, `.context/story-pipeline.md`).
 *
 * Scans every non-test source file under `src/` except the module itself and `src/scripts/`
 * (one-off operator scripts) for:
 * - a Prisma `story.create|createMany|update|updateMany|updateManyAndReturn|upsert(...)` call
 *   whose `data` (or `create`/`update` for upsert) object literal has a `status` or
 *   `rejectionReason` key;
 * - a raw `UPDATE stories ... SET ...` naming `status` or `rejection_reason`.
 *
 * The match is textual: a `data` passed as a variable, or a key spread in from elsewhere, is not
 * seen (`createStory` spreads `initialStatus()` from the module, which is the intended route).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED = new Set([join('services', 'storyLifecycle.ts')])
const SKIPPED_DIRS = new Set([join('scripts'), join('test')])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    const rel = relative(SRC, path)
    if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(rel) ? [] : sourceFiles(path)
    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.endsWith('.d.ts')) return []
    return ALLOWED.has(rel) ? [] : [path]
  })
}

/** The text between the bracket at `open` and its match (strings and comments are not special-cased). */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (pairs[c]) stack.push(pairs[c])
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
      if (m) keys.push(m[1])
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

const PRISMA_WRITE = /\.story\.(create|createMany|update|updateMany|updateManyAndReturn|upsert)\s*\(/g
const STATUS_KEYS = new Set(['status', 'rejectionReason'])

export function statusWrites(src: string): string[] {
  const found: string[] = []
  let m: RegExpExecArray | null
  PRISMA_WRITE.lastIndex = 0
  while ((m = PRISMA_WRITE.exec(src))) {
    const arg = balanced(src, m.index + m[0].length - 1)
    const objects = writtenObjects(arg, m[1] === 'upsert' ? ['create', 'update'] : ['data'])
    if (objects.some(body => topLevelKeys(body).some(k => STATUS_KEYS.has(k)))) {
      found.push(`story.${m[1]} at offset ${m.index}`)
    }
  }
  const raw = /UPDATE\s+"?stories"?(\s+(AS\s+)?\w+)?\s+SET\b([\s\S]*?)(\bWHERE\b|\bFROM\b|`|;)/gi
  while ((m = raw.exec(src))) {
    if (/\b(status|rejection_reason)\b/i.test(m[3])) found.push(`raw UPDATE stories at offset ${m.index}`)
  }
  return found
}

describe('story status writers', () => {
  it('only the lifecycle module writes stories.status or rejection_reason', () => {
    const offenders = sourceFiles(SRC).flatMap((path) =>
      statusWrites(readFileSync(path, 'utf8')).map(w => `${relative(SRC, path).split(sep).join('/')}: ${w}`))
    expect(offenders).toEqual([])
  })

  it('the scan finds the write shapes it guards against', () => {
    expect(statusWrites(`await prisma.story.update({ where: { id }, data: { status: 'published' } })`)).toHaveLength(1)
    expect(statusWrites(`await tx.story.updateMany({ where: { id: { in: ids } }, data: { title, rejectionReason: 'editor' } })`)).toHaveLength(1)
    expect(statusWrites(`await prisma.story.create({ data: { feedId, status: StoryStatus.fetched } })`)).toHaveLength(1)
    expect(statusWrites(`await prisma.story.upsert({ where: { id }, create: { id }, update: { status } })`)).toHaveLength(1)
    expect(statusWrites('await prisma.$executeRaw`UPDATE stories SET status = \'trashed\' WHERE id = ${id}`')).toHaveLength(1)
    expect(statusWrites('await prisma.$executeRaw`UPDATE "stories" s SET rejection_reason = NULL FROM x`')).toHaveLength(1)
  })

  it('the scan ignores status in filters and other tables', () => {
    expect(statusWrites(`await prisma.story.updateMany({ where: { status: 'analyzed' }, data: { relevance: 3 } })`)).toEqual([])
    expect(statusWrites(`await prisma.story.update({ where: { id }, data: { feed: { connect: { id: f } } } })`)).toEqual([])
    expect(statusWrites(`await prisma.newsletter.update({ where: { id }, data: { status: 'sent' } })`)).toEqual([])
    expect(statusWrites('await prisma.$executeRaw`UPDATE stories SET embedding = NULL WHERE status = \'rejected\'`')).toEqual([])
  })
})

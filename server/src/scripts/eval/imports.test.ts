/**
 * Static guard: the eval must have no write path to any database. It reads
 * source files as text, so a new eval file inherits the checks the day it is
 * added.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

/** Source without comments, so prose like "not wrapped in withRetry" does not trip the scan. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = sourceFiles(ROOT).map(path => ({
  name: relative(ROOT, path).replace(/\\/g, '/'),
  text: stripComments(readFileSync(path, 'utf8')),
}))

interface ImportStatement {
  specifier: string
  names: string[] | null // null = default/namespace/side-effect import
  typeOnly: boolean
}

function importsOf(text: string): ImportStatement[] {
  const out: ImportStatement[] = []
  for (const m of text.matchAll(/import\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[2].trim()
    const named = /^\{([^}]*)\}$/.exec(clause)
    out.push({
      specifier: m[3],
      typeOnly: Boolean(m[1]),
      names: named
        ? named[1]
            .split(',')
            .map(
              n =>
                n
                  .trim()
                  .replace(/^type\s+/, '')
                  .split(/\s+as\s+/)[0],
            )
            .filter(Boolean)
        : null,
    })
  }
  for (const m of text.matchAll(/import\s+['"]([^'"]+)['"]/g)) out.push({ specifier: m[1], typeOnly: false, names: null })
  return out
}

/** `'*'`: any named import, for a module held to having no I/O below. */
const ALLOWED_SERVICE_IMPORTS: Record<string, string[] | '*'> = {
  'services/llm.js': ['createChatModel'],
  // Production's prompt-input builders, so the eval sends the prompts production sends.
  'services/promptInputs.js': '*',
  'services/bluesky.js': ['blueskyDraftInput'],
  'services/mastodon.js': ['mastodonDraftInput'],
  // Pure dialogue rules (no I/O): the eval scores and renders with production's own validation.
  'services/podcastDialogue.js': ['validateDialogue', 'DialogueStoryRef', 'assembleSpokenSegments', 'renderScript', 'dialogueCharBudget'],
}

/** The pure modules the eval may import whole: config and prompt types only. */
const PURE_SERVICE_MODULES = ['promptInputs.ts']

describe('eval harness has no write path', () => {
  it('finds the eval source files', () => {
    expect(files.map(f => f.name)).toEqual(expect.arrayContaining(['fixtures.ts', 'readOnlyDb.ts', 'models.ts', 'run.ts', 'suites/preassess.ts']))
  })

  it('imports @prisma/client only from the two database modules, and never lib/prisma', () => {
    const dbModules = ['readOnlyDb.ts', 'fixtures.ts']
    const offenders = files.flatMap(f =>
      importsOf(f.text)
        .filter(i => (i.specifier === '@prisma/client' && !i.typeOnly && !dbModules.includes(f.name)) || /lib\/prisma(\.js)?$/.test(i.specifier))
        .map(i => `${f.name}: ${i.specifier}`),
    )
    expect(offenders).toEqual([])
  })

  it('imports only createChatModel, the prompt-input builders and the pure dialogue rules from services', () => {
    const offenders = files.flatMap(f =>
      importsOf(f.text)
        .filter(i => i.specifier.includes('/services/'))
        .flatMap(i => {
          const allowed = Object.entries(ALLOWED_SERVICE_IMPORTS).find(([suffix]) => i.specifier.endsWith(suffix))?.[1]
          if (!allowed || i.names === null) return [`${f.name}: ${i.specifier}`]
          if (allowed === '*') return []
          return i.names.filter(n => !allowed.includes(n)).map(n => `${f.name}: ${n} from ${i.specifier}`)
        }),
    )
    expect(offenders).toEqual([])
  })

  it('imports whole only service modules that import nothing but config and prompt types', () => {
    const offenders = PURE_SERVICE_MODULES.flatMap(name =>
      importsOf(stripComments(readFileSync(join(ROOT, '../../services', name), 'utf8')))
        .filter(i => !(i.specifier === '../config.js' || (i.typeOnly && i.specifier.startsWith('../prompts/'))))
        .map(i => `${name}: ${i.specifier}`),
    )
    expect(offenders).toEqual([])
  })

  it('never calls the rate limiter, withRetry, or a Prisma write', () => {
    const forbidden = [
      /\brateLimitDelay\b/,
      /\bwithRetry\b/,
      /\bprisma\./,
      // A Prisma delegate call (`db.story.update(`); `createHash(...).update(` has no identifier before the dot.
      /\b[A-Za-z_]\w*\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/,
      /\$executeRawUnsafe|\$queryRawUnsafe/,
    ]
    const offenders = files.flatMap(f => forbidden.filter(re => re.test(f.text)).map(re => `${f.name}: ${re}`))
    expect(offenders).toEqual([])
  })

  it('uses $executeRaw only for SET TRANSACTION READ ONLY in readOnlyDb.ts', () => {
    const uses = files.flatMap(f => [...f.text.matchAll(/\$executeRaw`([^`]*)`/g)].map(m => `${f.name}: ${m[1].trim()}`))
    expect(uses).toEqual(['readOnlyDb.ts: SET TRANSACTION READ ONLY'])
    const bare = files.filter(f => /\$executeRaw(?!`)/.test(f.text.replace(/\$executeRaw`[^`]*`/g, '')))
    expect(bare.map(f => f.name)).toEqual([])
  })
})

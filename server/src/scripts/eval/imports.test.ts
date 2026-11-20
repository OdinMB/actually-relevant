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
  // Production's research steps, so eval:research measures what the admin action runs. Each is
  // held below to doing no I/O of its own (the loader queries only the client it is given).
  'services/researchPipeline.js': '*',
  'services/researchInput.js': '*',
  'services/researchFilter.js': '*',
  'services/researchChecks.js': '*',
  'services/researchCopying.js': '*',
  // Production's research pass, its steps, record, working pool, card stage and its pool's shapes, so
  // eval:research and the `context` step run what the step runs; held below to doing no I/O of its own.
  'services/researchPass.js': '*',
  'services/researchPassSteps.js': '*',
  'services/researchPassRecord.js': '*',
  'services/researchPassPool.js': '*',
  'services/researchPassCards.js': '*',
  'services/researchPool.js': '*',
  // A later pass's article step, so the `update` step runs what a later pass runs; held below to doing no I/O of its own.
  'services/researchPassLater.js': '*',
  // A version's article and its sections as readers see them (pure): the `update` step's fixtures and its identity bar.
  'services/articleVersions.js': ['versionArticle', 'sectionTexts'],
  // What the legacy import makes of a story's runs, read with SELECTs through the client it is given (held below), never written.
  'services/legacyPool.js': ['readLegacyImport'],
  // The text readers see of an applied research version (pure): eval:overviews finds the answer keys' quotes in it.
  'services/researchedStory.js': ['storedResearchText'],
  // Production's story context steps, so the `context` step of eval:overviews runs what the job
  // runs; each held below to doing no I/O of its own.
  'services/storyContextPipeline.js': '*',
  'services/storyContextChecks.js': '*',
  'services/storyContextSources.js': '*',
  'services/storyContextPlacement.js': '*',
  'services/storyContextRecords.js': '*',
  'services/storyContextServed.js': '*',
  'services/storyContextLayout.js': '*',
  // One story's input, loaded with SELECTs through the client it is given (held below): the eval's read-only session.
  'services/storyContextInput.js': ['loadContextInput'],
  // A first pass's input, the same way; it reads no pass table (held below).
  'services/researchPassInput.js': ['loadFirstPassInput'],
  // Overview linking: the pure steps and types whole, and the candidate and input reads, SELECT only through the client given (held below).
  'services/overviewLink.js': '*',
  'services/overviewTypes.js': '*',
  'services/overviewCandidates.js': '*',
  'services/overviewInput.js': '*',
  // Overview upkeep: the stands, closing, review and status steps and the night's order, pure (held below), so the
  // `stands`, `closure`, `review` and `replay` steps run what the job runs.
  'services/overviewStands.js': '*',
  'services/overviewClose.js': '*',
  'services/overviewReview.js': '*',
  'services/overviewStatus.js': '*',
  'services/overviewUpkeep.js': '*',
  // The automated re-center's rules and attempt, pure (held below), so the `recenter` and `replay` steps run what the job runs.
  'services/overviewRecenter.js': '*',
  // The review, closing and re-center cases from raw rows, the owed-story rule and the night, pure (held below), so the
  // sandbox and the `replay` step build the cases, retry the stories and run the night as the job does.
  'services/overviewCases.js': '*',
  'services/overviewOwed.js': '*',
  'services/overviewNight.js': '*',
  // The write model, production's planners, the state they judge and the decision log's schemas, pure (held below), so
  // the sandbox writes by the lifecycle's own plans.
  'services/overviewChanges.js': '*',
  'services/overviewPlans.js': '*',
  'services/overviewState.js': '*',
  'services/overviewDecisions.js': '*',
  // The step's model calls declared once (tier, effort, schema, prompt), pure (held below), so the evals call what the job calls.
  'services/overviewSteps.js': '*',
  // The member stories' usable facts, read with SELECTs through the client it is given (held below), never written.
  'services/passRecords.js': ['loadMemberFacts'],
}

/** The overview modules the eval imports whole: no database client, model client or HTTP of their own; the two readers SELECT only through the client given. */
const OVERVIEW_SERVICE_MODULES = [
  'overviewLink.ts',
  'overviewTypes.ts',
  'overviewCandidates.ts',
  'overviewInput.ts',
  'overviewStands.ts',
  'overviewClose.ts',
  'overviewReview.ts',
  'overviewStatus.ts',
  'overviewUpkeep.ts',
  'overviewRecenter.ts',
  'overviewCases.ts',
  'overviewOwed.ts',
  'overviewNight.ts',
  'overviewChanges.ts',
  'overviewPlans.ts',
  'overviewState.ts',
  'overviewDecisions.ts',
  'overviewSteps.ts',
]
const OVERVIEW_READERS = ['overviewCandidates.ts', 'overviewInput.ts']

/** The story context modules the eval imports whole: no database client, model client, HTTP or retry of their own (hashing is fine). */
const CONTEXT_SERVICE_MODULES = [
  'storyContextPipeline.ts',
  'storyContextChecks.ts',
  'storyContextSources.ts',
  'storyContextPlacement.ts',
  'storyContextRecords.ts',
  'storyContextServed.ts',
  'storyContextLayout.ts',
]

/** The pure modules the eval may import whole: config and prompt types only. */
const PURE_SERVICE_MODULES = ['promptInputs.ts']

/** The research modules the eval imports whole: no database client, model client, HTTP or retry of their own. */
const RESEARCH_SERVICE_MODULES = [
  'researchPipeline.ts',
  'researchInput.ts',
  'researchFilter.ts',
  'researchChecks.ts',
  'researchCopying.ts',
  'researchPass.ts',
  'researchPassSteps.ts',
  'researchPassRecord.ts',
  'researchPassPool.ts',
  'researchPassCards.ts',
  'researchPool.ts',
  'researchPassLater.ts',
]

/** Constants a research module may take from the Tavily module, which makes the HTTP request: never its request function. */
const TAVILY_CONSTANTS = ['TAVILY_DEPTH', 'CREDITS_PER_SEARCH']
const tavilyConstantsOnly = (i: ImportStatement) => /lib\/tavily\.js$/.test(i.specifier) && i.names !== null && i.names.every(n => TAVILY_CONSTANTS.includes(n))

/** Model calls are never retried (parse failures are what the eval measures), and the eval has no other HTTP of its own. */
const WITH_RETRY_ALLOWED: string[] = []

describe('eval harness has no write path', () => {
  it('finds the eval source files', () => {
    expect(files.map(f => f.name)).toEqual(
      expect.arrayContaining([
        'fixtures.ts',
        'readOnlyDb.ts',
        'models.ts',
        'run.ts',
        'suites/preassess.ts',
        'overviews.ts',
        'overviews/factCheck.ts',
        'overviews/keyCheck.ts',
        'overviews/gapKeyCheck.ts',
        'overviews/gapDraft.ts',
        'overviews/contextInputs.ts',
        'overviews/context.ts',
      ]),
    )
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

  it('imports whole only research modules that bring no client, HTTP or retry of their own', () => {
    expect(RESEARCH_SERVICE_MODULES.map(name => `services/${name.replace(/\.ts$/, '.js')}`)).toEqual(
      Object.entries(ALLOWED_SERVICE_IMPORTS)
        .filter(([suffix, names]) => names === '*' && suffix.includes('/research'))
        .map(([suffix]) => suffix),
    )
    const ioModule = /lib\/prisma\.js$|^@prisma\/client$|^\.\/llm\.js$|lib\/retry\.js$|^axios$|lib\/tavily\.js$|researchCalls\.js$|researchRuns\.js$|^node:/
    const io = /\bprisma\.|\brateLimitDelay\b|\bwithRetry\b|\$executeRaw|\$queryRawUnsafe|\bwithStructuredOutput\b/
    const offenders = RESEARCH_SERVICE_MODULES.flatMap(name => {
      const text = stripComments(readFileSync(join(ROOT, '../../services', name), 'utf8'))
      return [
        ...importsOf(text)
          .filter(i => !i.typeOnly && ioModule.test(i.specifier) && !tavilyConstantsOnly(i))
          .map(i => `${name}: ${i.specifier}`),
        ...(io.test(text) ? [`${name}: ${io.exec(text)?.[0]}`] : []),
      ]
    })
    expect(offenders).toEqual([])
  })

  it('imports whole only story context modules that bring no client, HTTP or retry of their own', () => {
    expect(CONTEXT_SERVICE_MODULES.map(name => `services/${name.replace(/\.ts$/, '.js')}`)).toEqual(
      Object.entries(ALLOWED_SERVICE_IMPORTS)
        .filter(([suffix, names]) => names === '*' && suffix.includes('/storyContext'))
        .map(([suffix]) => suffix),
    )
    const ioModule =
      /lib\/prisma\.js$|^@prisma\/client$|^\.\/llm\.js$|lib\/retry\.js$|^axios$|lib\/tavily\.js$|storyContextSearch\.js$|storyContextRuns\.js$|^node:(?!crypto$)/
    const io = /\bprisma\.|\brateLimitDelay\b|\bwithRetry\b|\$executeRaw|\$queryRaw|\bwithStructuredOutput\b|\bfetch\(/
    const offenders = CONTEXT_SERVICE_MODULES.flatMap(name => {
      const text = stripComments(readFileSync(join(ROOT, '../../services', name), 'utf8'))
      return [
        ...importsOf(text)
          .filter(i => !i.typeOnly && ioModule.test(i.specifier))
          .map(i => `${name}: ${i.specifier}`),
        ...(io.test(text) ? [`${name}: ${io.exec(text)?.[0]}`] : []),
      ]
    })
    expect(offenders).toEqual([])
  })

  it('imports whole only overview modules that bring no client or HTTP of their own, whose readers SELECT only through the client given', () => {
    expect(OVERVIEW_SERVICE_MODULES.map(name => `services/${name.replace(/\.ts$/, '.js')}`)).toEqual(
      Object.entries(ALLOWED_SERVICE_IMPORTS)
        .filter(([suffix, names]) => names === '*' && suffix.includes('/overview'))
        .map(([suffix]) => suffix),
    )
    const ioModule =
      /lib\/prisma\.js$|^@prisma\/client$|^\.\/llm\.js$|lib\/retry\.js$|^axios$|lib\/tavily\.js$|structuredCall\.js$|overviewLifecycle\.js$|^node:/
    const io = /\bprisma\.|\brateLimitDelay\b|\bwithRetry\b|\$executeRaw|\$queryRawUnsafe|\bwithStructuredOutput\b|\bfetch\(/
    const offenders = OVERVIEW_SERVICE_MODULES.flatMap(name => {
      const text = stripComments(readFileSync(join(ROOT, '../../services', name), 'utf8'))
      const queries = [...text.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map(m => m[1]!.trim())
      return [
        ...importsOf(text)
          .filter(i => !i.typeOnly && ioModule.test(i.specifier))
          .map(i => `${name}: ${i.specifier}`),
        ...(io.test(text) ? [`${name}: ${io.exec(text)?.[0]}`] : []),
        ...(!OVERVIEW_READERS.includes(name) && /\$queryRaw/.test(text) ? [`${name}: reads the database`] : []),
        ...queries.filter(q => !/^(SELECT|WITH)\b/.test(q) || /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(q)).map(q => `${name}: ${q.slice(0, 40)}`),
      ]
    })
    expect(offenders).toEqual([])
    for (const name of OVERVIEW_READERS) expect(readFileSync(join(ROOT, '../../services', name), 'utf8')).toMatch(/\$queryRaw</)
  })

  it('loads story context input with SELECTs only, through the client it is given', () => {
    const text = stripComments(readFileSync(join(ROOT, '../../services/storyContextInput.ts'), 'utf8'))
    expect(importsOf(text).filter(i => /lib\/prisma(\.js)?$|\.\/llm\.js$|lib\/tavily\.js$/.test(i.specifier))).toEqual([])
    expect(/\bprisma\.|\$executeRaw|\$queryRawUnsafe/.test(text)).toBe(false)
    const queries = [...text.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map(m => m[1]!.trim())
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.filter(q => !/^SELECT\b/.test(q))).toEqual([])
  })

  it('reads what the legacy import makes with SELECTs only, through the client it is given, and writes nothing', () => {
    const text = stripComments(readFileSync(join(ROOT, '../../services/legacyPool.ts'), 'utf8'))
    const read = /export async function readLegacyImport[\s\S]*?\n}/.exec(text)?.[0] ?? ''
    expect(read).not.toBe('')
    expect(/\bprisma\.|\$executeRaw|\$queryRawUnsafe|insert[A-Z]\w*\(/.test(read)).toBe(false)
    const queries = [...read.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map(m => m[1]!.trim())
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.filter(q => !/^SELECT\b/.test(q))).toEqual([])
  })

  it("reads the pool records, the members' facts among them, with SELECTs only, through the client it is given", () => {
    const text = stripComments(readFileSync(join(ROOT, '../../services/passRecords.ts'), 'utf8'))
    expect(importsOf(text).filter(i => /lib\/prisma(\.js)?$|\.\/llm\.js$|lib\/tavily\.js$/.test(i.specifier))).toEqual([])
    expect(/\bprisma\.|\$executeRaw|\$queryRawUnsafe/.test(text)).toBe(false)
    expect(text).toMatch(/export async function loadMemberFacts/)
    const queries = [...text.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map(m => m[1]!.trim())
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.filter(q => !/^SELECT\b/.test(q) || /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(q))).toEqual([])
  })

  it("loads a first pass's input with SELECTs only, through the client it is given, and without the pass tables", () => {
    const text = stripComments(readFileSync(join(ROOT, '../../services/researchPassInput.ts'), 'utf8'))
    expect(importsOf(text).filter(i => /lib\/prisma(\.js)?$|\.\/llm\.js$|lib\/tavily\.js$|^@prisma\/client$/.test(i.specifier) && !i.typeOnly)).toEqual([])
    expect(/\bprisma\.|\$executeRaw|\$queryRawUnsafe/.test(text)).toBe(false)
    const queries = [...text.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map(m => m[1]!.trim())
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.filter(q => !/^SELECT\b/.test(q))).toEqual([])
    // The first pass's loader passes the empty pool and no version: it never calls the pass tables' readers
    const first = /async function loadFirstPassInput[\s\S]*?\n}/.exec(text)?.[0] ?? ''
    expect(first).toContain('EMPTY_POOL')
    expect(/loadPool|currentVersion/.test(first)).toBe(false)
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
    const offenders = files.flatMap(f =>
      forbidden.filter(re => !(re.source === '\\bwithRetry\\b' && WITH_RETRY_ALLOWED.includes(f.name)) && re.test(f.text)).map(re => `${f.name}: ${re}`),
    )
    expect(offenders).toEqual([])
  })

  it('uses withRetry nowhere', () => {
    expect(files.filter(f => /\bwithRetry\b/.test(f.text)).map(f => f.name)).toEqual(WITH_RETRY_ALLOWED)
  })

  it('uses $executeRaw only for SET TRANSACTION READ ONLY in readOnlyDb.ts', () => {
    const uses = files.flatMap(f => [...f.text.matchAll(/\$executeRaw`([^`]*)`/g)].map(m => `${f.name}: ${m[1].trim()}`))
    expect(uses).toEqual(['readOnlyDb.ts: SET TRANSACTION READ ONLY'])
    const bare = files.filter(f => /\$executeRaw(?!`)/.test(f.text.replace(/\$executeRaw`[^`]*`/g, '')))
    expect(bare.map(f => f.name)).toEqual([])
  })
})

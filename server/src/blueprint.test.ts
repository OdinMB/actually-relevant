/**
 * Holds render.yaml, .node-version and both env.example files to the variables the code
 * reads, and to the properties the deployment rests on (ADR-0036). Adapted from the
 * owner's render-side-project blueprint test; each adaptation is commented where it sits.
 *
 * A new setting goes into the code, server/env.example and render.yaml together, or into
 * one of the three exclusion lists below with its reason. Otherwise this test fails.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, resolve, relative, sep } from 'path'
import { fileURLToPath } from 'url'
import { parseTrustProxyHops } from './config.js'

const SERVER_SRC = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(SERVER_SRC, '..', '..')
const CLIENT_SRC = join(REPO_ROOT, 'client', 'src')

const readRepoFile = (...parts: string[]) => readFileSync(join(REPO_ROOT, ...parts), 'utf8')

// ---------------------------------------------------------------------------
// What the code reads
// ---------------------------------------------------------------------------

/** Read by a library rather than by our code. */
const READ_BY_LIBRARIES: Record<string, string> = {
  OPENAI_API_KEY: '@langchain/openai and the openai SDK read it themselves',
}

/** Read by Render to choose the runtime; may appear on both services though no code reads it. */
const READ_BY_RENDER = ['NODE_VERSION']

/** Read by the server, but must never be named in the blueprint. */
const NOT_IN_BLUEPRINT: Record<string, string> = {
  PORT: 'Render sets it',
  SCHEDULER_ENABLED: 'only for a second process run against the production database',
}

const tunables = (reason: string, names: string[]) => Object.fromEntries(names.map(name => [name, reason]))

/**
 * Read by the server; production runs the code default in server/src/config.ts (or the
 * module named), so the blueprint leaves them out. Accepted debt: a new tunable is edited
 * in config.ts and in this list. If production ever sets one, move it into render.yaml.
 */
const RUNS_ON_ITS_CODE_DEFAULT: Record<string, string> = {
  ...tunables('auth tuning', ['AUTH_REFRESH_REUSE_GRACE_MS']),
  ...tunables('database tuning', ['DB_TRANSACTION_TIMEOUT_MS']),
  ...tunables('model tiers: GPT-6 defaults, changed only with prompts (.context/llm-analysis.md)', [
    'OPENAI_MODEL_SMALL',
    'OPENAI_EFFORT_SMALL',
    'OPENAI_MODEL_MEDIUM',
    'OPENAI_EFFORT_MEDIUM',
    'OPENAI_MODEL_LARGE',
    'OPENAI_EFFORT_LARGE',
    'LLM_DELAY_MS',
  ]),
  ...tunables('pipeline tuning', [
    'SELECT_MAX_GROUP_SIZE',
    'SELECT_RATIO',
    'SELECT_RELEVANCE_MIN',
    'PUBLISH_CHUNK_SIZE',
    'STORY_ASSIGNMENT_DAYS',
    'NEWSLETTER_STORIES_PER_ISSUE',
    'CONCURRENCY_PREASSESS',
    'CONCURRENCY_ASSESS',
    'CONCURRENCY_SELECT',
    'CONCURRENCY_RECLASSIFY',
  ]),
  ...tunables('embedding tuning', ['EMBEDDING_MODEL', 'EMBEDDING_BATCH_SIZE', 'EMBEDDING_CONCURRENCY', 'EMBEDDING_DELAY_MS']),
  ...tunables('crawl and extraction tuning', [
    'RSS_ITEM_LIMIT',
    'HTTP_TIMEOUT_MS',
    'MIN_CONTENT_LENGTH',
    'MAX_PARSE_BYTES',
    'STALE_AFTER_EMPTY_CRAWLS',
    'DIFFBOT_TIMEOUT_MS',
    'DIFFBOT_RATE_LIMIT',
    'PIPFEED_TIMEOUT_MS',
    'MAX_CONCURRENCY_PER_DOMAIN',
    'MIN_DELAY_PER_DOMAIN_MS',
    'LOCAL_FAIL_THRESHOLD',
    'TOTAL_FAIL_THRESHOLD',
    'PAYWALL_LOCKED_MAX_CHARS',
    'PAYWALL_MIN_WORD_RATIO',
  ]),
  ...tunables('job lease timing (ADR-0020)', ['JOB_LEASE_SECONDS', 'JOB_LEASE_RENEW_SECONDS']),
  ...tunables('feed and sitemap caching', ['RSS_FEED_SIZE', 'RSS_CACHE_MAX_AGE', 'SITEMAP_CACHE_MAX_AGE']),
  ...tunables('story link preview caching (.context/seo.md)', ['STORY_PAGE_SHELL_CACHE_SECONDS', 'STORY_OG_IMAGE_CACHE_SECONDS']),
  ...tunables('rate limits', [
    'RATE_LIMIT_PUBLIC_WINDOW_MS',
    'RATE_LIMIT_PUBLIC_MAX',
    'RATE_LIMIT_EXPENSIVE_WINDOW_MS',
    'RATE_LIMIT_EXPENSIVE_MAX',
    'RATE_LIMIT_SEARCH_WINDOW_MS',
    'RATE_LIMIT_SEARCH_MAX',
    'FEEDBACK_RATE_LIMIT_WINDOW_MS',
    'FEEDBACK_RATE_LIMIT_MAX',
  ]),
  ...tunables('newsletter signup limits', [
    'SUBSCRIBE_TOKEN_EXPIRY_HOURS',
    'SUBSCRIBE_RATE_LIMIT_WINDOW_MS',
    'SUBSCRIBE_RATE_LIMIT_MAX',
    'SUBSCRIBE_RATE_LIMIT_DAILY_WINDOW_MS',
    'SUBSCRIBE_RATE_LIMIT_DAILY_MAX',
    'SUBSCRIBE_MIN_FORM_FILL_MS',
    'SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS',
    'SUBSCRIBE_PER_ADDRESS_WINDOW_HOURS',
    'SUBSCRIBE_GLOBAL_HOURLY_MAX',
  ]),
  ...tunables('dedup tuning', ['DEDUP_MAX_CANDIDATES', 'DEDUP_TIME_WINDOW_DAYS', 'DEDUP_ENABLED']),
  ...tunables('social posting tuning', [
    'BLUESKY_SERVICE_URL',
    'BLUESKY_LOOKBACK_HOURS',
    'BLUESKY_METRICS_MAX_AGE_DAYS',
    'BLUESKY_POST_DELAY_MS',
    'MASTODON_METRICS_MAX_AGE_DAYS',
    'MASTODON_POST_DELAY_MS',
    'MASTODON_VISIBILITY',
    'MASTODON_CHAR_LIMIT',
    'SOCIAL_LOOKBACK_HOURS',
  ]),
  ...tunables('local file paths and log rotation (config.log, config.crawl.faviconDir)', ['LOG_DIR', 'LOG_RETENTION_DAYS', 'FAVICON_DIR']),
}

/**
 * Read by the server and listed in server/env.example, but not set in production as of
 * 2026-10-13 (Render's export of the live services), so the blueprint leaves them out:
 * named there as `sync: false`, they would be prompted for on blueprint creation and could
 * be created empty. Each read treats "" and unset alike (`||` or a truthiness check), and
 * production runs on the code default or with the feature off. If production ever sets
 * one, move it into render.yaml.
 */
const NOT_SET_IN_PRODUCTION: Record<string, string> = {
  ...tunables('not set in production as of 2026-10-13 (Render export); runs on its code default', [
    'SITE_URL',
    'CLIENT_URL',
    'FORM_TOKEN_SECRET',
    'PLUNK_FROM_NAME',
    'EXTRACTION_API',
    'LOG_LEVEL',
  ]),
  ...tunables('not set in production as of 2026-10-13 (Render export); feature off', ['PUBLIC_API_KEY', 'WEBHOOK_URL']),
}

const LEFT_OUT_OF_BLUEPRINT = (name: string) => name in NOT_IN_BLUEPRINT || name in RUNS_ON_ITS_CODE_DEFAULT || name in NOT_SET_IN_PRODUCTION

function filesUnder(dir: string, keep: (relPath: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map(name => name.split(sep).join('/'))
    .filter(keep)
    .map(name => join(dir, name))
}

/**
 * Adaptation: the skill records what a `loadConfig(env)` reads through a Proxy, but here
 * config.ts reads several variables at call time (its `get` settings), which a Proxy over
 * one load would miss, so the source is scanned instead. Tests, src/test/ and src/scripts/ are left out: scripts/db-prepare
 * passes process.env whole and runs only locally.
 */
const serverSourceFiles = filesUnder(SERVER_SRC, p => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.startsWith('test/') && !p.startsWith('scripts/'))

function namesMatching(pattern: RegExp, files: string[]): Set<string> {
  const names = new Set<string>()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) names.add(match[1])
  }
  return names
}

const serverReads = new Set<string>([
  ...namesMatching(/process\.env\.([A-Z][A-Z0-9_]*)/g, serverSourceFiles),
  ...[...readRepoFile('server', 'prisma', 'schema.prisma').matchAll(/env\("([A-Z][A-Z0-9_]*)"\)/g)].map(m => m[1]),
  ...Object.keys(READ_BY_LIBRARIES),
])

const clientSourceFiles = filesUnder(CLIENT_SRC, p => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p) && !p.startsWith('test/'))
const clientReads = namesMatching(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g, clientSourceFiles)

// ---------------------------------------------------------------------------
// The strict render.yaml reader
// ---------------------------------------------------------------------------

interface EnvVar {
  key: string
  value?: string
  sync?: string
  generateValue?: string
}

interface Service {
  fields: Record<string, string>
  /** Plain scalar lists under a four-space field, such as `domains:`. */
  lists: Record<string, string[]>
  envVars: EnvVar[]
}

/** Strip surrounding quotes, or an inline comment from an unquoted scalar. */
function scalar(raw: string): string {
  const text = raw.trim()
  const quoted = /^(["'])(.*?)\1/.exec(text)
  if (quoted) return quoted[2]
  return text.replace(/\s+#.*$/, '').trim()
}

const isBlankOrComment = (line: string) => line.trim() === '' || line.trim().startsWith('#')
const indentOf = (line: string) => line.length - line.trimStart().length

/**
 * A line-by-line reader for the two services. A `  - type:` line starts a service; its
 * four-space fields are recorded; inside `envVars:` each entry is `- key:` with `value:`,
 * `sync:` or `generateValue:`, and any other line throws, so a shape this reader cannot
 * read fails loudly instead of being skipped.
 */
function readBlueprint(text: string): Service[] {
  const services: Service[] = []
  let current: Service | undefined
  let inEnvVars = false
  let entry: EnvVar | undefined
  let list: string[] | undefined

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (isBlankOrComment(line)) continue
    const fail = (why: string) => new Error(`render.yaml line ${index + 1}: ${why}: ${line}`)

    if (inEnvVars && indentOf(line) <= 4) {
      inEnvVars = false
      entry = undefined
    }

    if (inEnvVars) {
      const key = /^ {6}- key:\s*(.+)$/.exec(line)
      if (key) {
        entry = { key: scalar(key[1]) }
        current!.envVars.push(entry)
        continue
      }
      const field = /^ {8}(value|sync|generateValue):\s*(.*)$/.exec(line)
      if (!field || !entry) throw fail('unexpected line in envVars')
      entry[field[1] as 'value' | 'sync' | 'generateValue'] = scalar(field[2])
      continue
    }

    const start = /^ {2}- type:\s*(.+)$/.exec(line)
    if (start) {
      current = { fields: { type: scalar(start[1]) }, lists: {}, envVars: [] }
      services.push(current)
      list = undefined
      continue
    }
    const item = /^ {6}- ([^\s:#]+)\s*$/.exec(line)
    if (item && list) {
      list.push(item[1])
      continue
    }
    const field = /^ {4}([A-Za-z]+):\s*(.*)$/.exec(line)
    if (!field || !current) continue
    list = undefined
    if (field[1] !== 'envVars') {
      current.fields[field[1]] = scalar(field[2])
      if (field[2].trim() === '') list = current.lists[field[1]] = []
      continue
    }
    if (field[2].trim() !== '') throw fail('envVars must be a block list')
    inEnvVars = true
  }
  return services
}

const blueprintText = readRepoFile('render.yaml')
const services = readBlueprint(blueprintText)
const backend = services.find(s => s.fields.runtime === 'node')
const staticSite = services.find(s => s.fields.runtime === 'static')

const keysOf = (service: Service | undefined) => (service?.envVars ?? []).map(v => v.key)
const entryOf = (service: Service | undefined, key: string) => service?.envVars.find(v => v.key === key)
const SECRET_NAME = /PASSWORD|SECRET|KEY|TOKEN|EMAIL|DATABASE_URL/
const CANONICAL_ADDRESSES = ['SITE_URL', 'CLIENT_URL', 'FRONTEND_URL', 'API_URL', 'VITE_API_URL']

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

describe('render.yaml', () => {
  it('scans source that reads process.env only by name', () => {
    // The scan above sees only `process.env.NAME`; a computed read, destructuring or
    // passing the whole object would escape it.
    const offenders = serverSourceFiles
      .filter(file => /process\.env(?!\.[A-Z][A-Z0-9_]*)/.test(readFileSync(file, 'utf8')))
      .map(file => relative(REPO_ROOT, file))
    expect(offenders).toEqual([])
  })

  it('finds the variables it should (sanity check on the scan)', () => {
    for (const name of ['TRUST_PROXY', 'JWT_SECRET', 'DATABASE_URL', 'FEEDBACK_IP_HASH_SECRET']) {
      expect(serverReads.has(name), name).toBe(true)
    }
    expect(clientReads.has('VITE_API_URL')).toBe(true)
  })

  it('keeps every exclusion-list entry a variable the server reads', () => {
    const stale = [...Object.keys(NOT_IN_BLUEPRINT), ...Object.keys(RUNS_ON_ITS_CODE_DEFAULT), ...Object.keys(NOT_SET_IN_PRODUCTION)].filter(
      name => !serverReads.has(name),
    )
    expect(stale).toEqual([])
  })

  it('has the two services, shaped as the deployment expects', () => {
    // Both services deploy only once the commit's CI checks pass (`checksPass`, ADR-0047). Name,
    // region and plan are copied from Render's export of the live services; only their
    // presence is checked.
    expect(services).toHaveLength(2)
    expect(backend?.fields).toMatchObject({
      type: 'web',
      runtime: 'node',
      rootDir: 'server',
      branch: 'main',
      autoDeployTrigger: 'checksPass',
      healthCheckPath: '/health',
    })
    expect(backend?.fields.region).toBeTruthy()
    expect(backend?.fields.plan).toBeTruthy()
    expect(blueprintText).not.toMatch(/^[^#\n]*FROM-DASHBOARD/m) // no adoption placeholder left
    expect(staticSite?.fields).toMatchObject({
      type: 'web',
      runtime: 'static',
      rootDir: 'client',
      branch: 'main',
      autoDeployTrigger: 'checksPass',
    })
    // Dropped: the shutdown-delay check. The app's force exit is 10 s, inside Render's
    // 30 s default (not verified, Render docs); setting maxShutdownDelaySeconds would
    // overwrite an unknown production setting.
  })

  it('lists the custom domains, so that a sync cannot drop one (ADR-0038)', () => {
    // The rewrites proxy to the backend by its custom domain, so the backend must list it.
    const rewriteHosts = [...blueprintText.matchAll(/destination: https:\/\/([^/\s]+)\//g)].map(m => m[1])
    expect(rewriteHosts.length).toBeGreaterThan(0)
    for (const host of rewriteHosts) expect(backend?.lists.domains ?? []).toContain(host)
    expect(staticSite?.lists.domains ?? []).not.toEqual([])
  })

  it('keeps the sitemap and podcast rewrites above the SPA catch-all', () => {
    // Addition: Render applies the first matching rule.
    const catchAll = blueprintText.indexOf('source: /*')
    expect(catchAll).toBeGreaterThan(-1)
    expect(blueprintText.indexOf('source: /sitemap.xml')).toBeGreaterThan(-1)
    expect(blueprintText.indexOf('source: /sitemap.xml')).toBeLessThan(catchAll)
    expect(blueprintText.indexOf('source: /podcast.xml')).toBeGreaterThan(-1)
    expect(blueprintText.indexOf('source: /podcast.xml')).toBeLessThan(catchAll)
    // Story pages go through the backend for their link-preview tags (.context/seo.md)
    expect(blueprintText.indexOf('source: /stories/*')).toBeGreaterThan(-1)
    expect(blueprintText.indexOf('source: /stories/*')).toBeLessThan(catchAll)
  })

  it('names every variable the code reads, or leaves it out deliberately', () => {
    const named = new Set(keysOf(backend))
    const missing = [...serverReads].filter(name => !named.has(name) && !LEFT_OUT_OF_BLUEPRINT(name))
    expect(missing).toEqual([])
    const staticNamed = new Set(keysOf(staticSite))
    expect([...clientReads].filter(name => !staticNamed.has(name))).toEqual([])
  })

  it('names nothing extra, and nothing twice', () => {
    for (const [service, reads] of [
      [backend, serverReads],
      [staticSite, clientReads],
    ] as const) {
      const keys = keysOf(service)
      expect(keys.filter(key => !reads.has(key) && !READ_BY_RENDER.includes(key))).toEqual([])
      expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([])
    }
  })

  it('names nothing forbidden on either service', () => {
    const forbidden = keysOf(backend).filter(key => LEFT_OUT_OF_BLUEPRINT(key) || /^(TEST_|LANGSMITH_|LANGCHAIN_|VITE_)/.test(key))
    expect(forbidden).toEqual([])
    // Adaptation: Render builds the static site from source, and its VITE_* values are
    // public by design, so it names only those and Render's own build setting.
    expect(keysOf(staticSite).filter(key => !key.startsWith('VITE_') && !READ_BY_RENDER.includes(key))).toEqual([])
  })

  it('gives every variable exactly one mode: a fixed value or sync: false', () => {
    const wrong = services
      .flatMap(s => s.envVars)
      .filter(v => v.generateValue !== undefined || (v.value !== undefined) === (v.sync === 'false') || v.value === '')
      .map(v => v.key)
    expect(wrong).toEqual([])
  })

  it('keeps secrets and canonical addresses in the dashboard', () => {
    const fixed = services
      .flatMap(s => s.envVars)
      .filter(v => (SECRET_NAME.test(v.key) || CANONICAL_ADDRESSES.includes(v.key)) && v.sync !== 'false')
      .map(v => v.key)
    expect(fixed).toEqual([])
  })

  it('carries no credentials in a URL and declares no database (ADR-0035)', () => {
    expect(blueprintText).not.toMatch(/:\/\/[^\s/:@]+:[^\s/@]+@/)
    expect(blueprintText).not.toMatch(/^databases:/m)
    expect(blueprintText).not.toMatch(/^[^#\n]*fromDatabase/m) // the header comment may name it
  })

  it('fixes the production marker and the measured hop count', () => {
    // Adaptation: no pool-size check, because the project has no pool variable.
    expect(entryOf(backend, 'NODE_ENV')?.value).toBe('production')
    const hops = entryOf(backend, 'TRUST_PROXY')?.value ?? ''
    expect(hops).toMatch(/^\d+$/)
    expect(() => parseTrustProxyHops(hops)).not.toThrow()
  })

  it('pins the same exact Node version on both services as .node-version', () => {
    // Addition: an upgrade changes .node-version and both values in one commit.
    const pinned = readRepoFile('.node-version').trim()
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
    expect(entryOf(backend, 'NODE_VERSION')?.value).toBe(pinned)
    expect(entryOf(staticSite, 'NODE_VERSION')?.value).toBe(pinned)
  })
})

describe('readBlueprint', () => {
  it('throws on a line it cannot read inside envVars', () => {
    const text = ['services:', '  - type: web', '    envVars:', '      - key: A', '        sync: false', '        surprise: 1'].join('\n')
    expect(() => readBlueprint(text)).toThrow(/line 6/)
  })

  it('ends envVars at a line no deeper than the key, and strips quotes and comments', () => {
    const text = ['services:', '  - type: web', '    envVars:', '      - key: A', '        value: "2" # measured', '    routes:', '      - type: rewrite'].join(
      '\n',
    )
    const [service] = readBlueprint(text)
    expect(service.envVars).toEqual([{ key: 'A', value: '2' }])
  })

  it('reads a plain list under a field, and not the mappings of a list such as routes', () => {
    const text = [
      'services:',
      '  - type: web',
      '    domains:',
      '      - example.org',
      '      - www.example.org',
      '    routes:',
      '      - type: rewrite',
      '        source: /*',
      '    rootDir: client',
      '      - stray.example.org',
    ].join('\n')
    const [service] = readBlueprint(text)
    expect(service.lists).toEqual({ domains: ['example.org', 'www.example.org'], routes: [] })
  })
})

// ---------------------------------------------------------------------------
// The variable templates
// ---------------------------------------------------------------------------

interface TemplateEntry {
  name: string
  value: string
}

/** Every `NAME=` line, set or commented (`# NAME=`), with its value minus any inline comment. */
function templateEntries(text: string): TemplateEntry[] {
  return text.split(/\r?\n/).flatMap(line => {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) return []
    const value = scalar(match[2])
    return [{ name: match[1], value }]
  })
}

describe('env.example templates', () => {
  const server = templateEntries(readRepoFile('server', 'env.example'))
  const client = templateEntries(readRepoFile('client', 'env.example'))

  it('server/env.example lists every variable the server reads, apart from code-default tunables', () => {
    const listed = new Set(server.map(e => e.name))
    expect([...serverReads].filter(name => !listed.has(name) && !(name in RUNS_ON_ITS_CODE_DEFAULT))).toEqual([])
  })

  it('client/env.example lists every VITE_* variable the client reads', () => {
    const listed = new Set(client.map(e => e.name))
    expect([...clientReads].filter(name => !listed.has(name))).toEqual([])
  })

  it('gives no value to a secret-looking name in either template', () => {
    const withValues = [...server, ...client].filter(e => SECRET_NAME.test(e.name) && e.value !== '' && !/^\d+$/.test(e.value)).map(e => e.name)
    expect(withValues).toEqual([])
  })
})

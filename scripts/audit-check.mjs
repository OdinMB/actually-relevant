// `npm run audit:prod` in client/ and server/: `npm audit --omit=dev` at --audit-level (default
// high), minus the package's reviewed audit-allowlist.json (.context/ci.md, "Dependency audit").
//
// An allowlist entry excuses one advisory in one package, and only while every production path
// to that package runs through the entry's `via` package. It fails the check when:
// - an advisory at or above the level has no entry,
// - an allowed package also reaches production some other way, or
// - an entry no longer matches any reported advisory (fixed upstream: delete the entry).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical']
const PREFIX = '[audit:prod]'

const levelAt = process.argv.indexOf('--audit-level')
const level = levelAt === -1 ? 'high' : process.argv[levelAt + 1]
if (!LEVELS.includes(level)) {
  console.error(`${PREFIX} --audit-level must be one of ${LEVELS.join(', ')}`)
  process.exit(1)
}

// As in install-dev-deps.mjs: reuse the running npm, without the prefix `npm run --prefix` exports
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_prefix'))
const npmCli = process.env.npm_execpath

function npm(args) {
  const result =
    npmCli && /npm-cli\.[cm]?js$/.test(npmCli)
      ? spawnSync(process.execPath, [npmCli, ...args], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
      : spawnSync(`npm ${args.join(' ')}`, { encoding: 'utf8', env, shell: true, maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  try {
    return JSON.parse(result.stdout)
  } catch {
    console.error(`${PREFIX} npm ${args.join(' ')} gave no JSON:\n${result.stderr || result.stdout}`)
    process.exit(1)
  }
}

const ghsaOf = (url) => /GHSA-[\w-]+/.exec(url ?? '')?.[0] ?? String(url)

/** Every chain of package names from the root to `name` in an `npm ls --json` tree. */
function pathsTo(name, node, trail = []) {
  return Object.entries(node.dependencies ?? {}).flatMap(([dep, child]) => {
    const here = [...trail, dep]
    return dep === name ? [here] : pathsTo(name, child, here)
  })
}

const allowlistFile = join(process.cwd(), 'audit-allowlist.json')
const allowlist = existsSync(allowlistFile) ? JSON.parse(readFileSync(allowlistFile, 'utf8')).advisories : []

const report = npm(['audit', '--omit=dev', '--json'])
if (report.error) {
  console.error(`${PREFIX} npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`)
  process.exit(1)
}

const advisories = new Map()
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== 'object' || LEVELS.indexOf(via.severity) < LEVELS.indexOf(level)) continue
    advisories.set(`${ghsaOf(via.url)} ${via.name}`, via)
  }
}

const problems = []
const used = new Set()
for (const [key, advisory] of advisories) {
  const entry = allowlist.find((e) => `${e.advisory} ${e.package}` === key)
  if (!entry) {
    problems.push(`${advisory.name}: ${advisory.severity} ${ghsaOf(advisory.url)} "${advisory.title}" (fix it, or add a reviewed entry to audit-allowlist.json)`)
    continue
  }
  used.add(entry)
  const tree = npm(['ls', entry.package, '--omit=dev', '--all', '--json'])
  const outside = pathsTo(entry.package, tree).filter((path) => !path.includes(entry.via))
  for (const path of outside) problems.push(`${entry.package} reaches production outside ${entry.via}: ${path.join(' > ')}`)
}
for (const entry of allowlist) {
  if (!used.has(entry)) problems.push(`allowlist entry ${entry.advisory} (${entry.package}) matches nothing at ${level} or above; delete it`)
}

if (problems.length > 0) {
  console.error(`${PREFIX} ${problems.length} problem(s) at --audit-level ${level}:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
const excused = used.size > 0 ? `, ${used.size} allowlisted (${[...used].map((e) => e.package).join(', ')})` : ''
console.log(`${PREFIX} ok: no unexcused production advisory at ${level} or above${excused}`)

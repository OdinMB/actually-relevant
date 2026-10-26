/**
 * The harness's parameters (README.md, "Parameters"), the steps file, and the output folder.
 * Parsing is pure; `prepareOutDir` is the one function here that touches the disk.
 */
import fs from 'node:fs'
import path from 'node:path'
import { GUARD_TEST_CASES } from './guard.mjs'

export const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
}

const DEFAULTS = { timeoutSec: 300, stepTimeoutSec: 30 }

/** Marks a folder as the harness's own output folder, so a later run may clear its outputs. */
export const OUT_MARKER = '.site-harness-out'

export class UsageError extends Error {}

/** A site path such as `/newsletter?page=2`; never a URL to another host. */
export function parseSitePath(value, what = 'a route') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    throw new UsageError(`${what} must be a path on the local site starting with /, not a URL: ${JSON.stringify(value)}`)
  }
  const parsed = new URL(value, 'http://site.invalid')
  if (parsed.origin !== 'http://site.invalid') throw new UsageError(`${what} must stay on the local site: ${JSON.stringify(value)}`)
  return parsed.pathname + parsed.search + parsed.hash
}

/** `phone`, `desktop` or `<width>x<height>`. */
export function parseViewport(value) {
  if (value in VIEWPORTS) return { name: value, ...VIEWPORTS[value] }
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value)
  if (!match) throw new UsageError(`--viewport must be phone, desktop or <width>x<height>, such as 768x1024: ${JSON.stringify(value)}`)
  const width = Number(match[1])
  const height = Number(match[2])
  return { name: value, width, height, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 }
}

function parsePathSpec(flag, value) {
  const eq = value.lastIndexOf('=')
  if (eq <= 0)
    throw new UsageError(`${flag} takes <path>=<value>, such as ${flag === '--fail' ? '/api/homepage=500' : '/api/homepage=3000'}: ${JSON.stringify(value)}`)
  const specPath = value.slice(0, eq)
  if (!specPath.startsWith('/') || specPath.includes('*', 0) !== specPath.endsWith('*') || specPath.indexOf('*') !== specPath.lastIndexOf('*')) {
    throw new UsageError(`${flag} path must start with / and may end in a single *: ${JSON.stringify(specPath)}`)
  }
  return { path: specPath, value: value.slice(eq + 1) }
}

/** `--fail <path>=<status>[:<code>]`, the status 400 to 599 or `drop` (the connection is cut). */
export function parseFailSpec(value) {
  const { path: specPath, value: rest } = parsePathSpec('--fail', value)
  if (rest === 'drop') return { path: specPath, status: 'drop' }
  const match = /^(\d{3})(?::([A-Z0-9_]+))?$/.exec(rest)
  const status = match ? Number(match[1]) : NaN
  if (!match || status < 400 || status > 599) throw new UsageError(`--fail takes a status from 400 to 599, optionally :CODE, or drop: ${JSON.stringify(rest)}`)
  return match[2] ? { path: specPath, status, code: match[2] } : { path: specPath, status }
}

/** `--delay <path>=<milliseconds>`, up to a minute. */
export function parseDelaySpec(value) {
  const { path: specPath, value: rest } = parsePathSpec('--delay', value)
  const ms = Number(rest)
  if (!/^\d+$/.test(rest) || ms > 60_000) throw new UsageError(`--delay takes whole milliseconds up to 60000: ${JSON.stringify(rest)}`)
  return { path: specPath, ms }
}

function positiveSeconds(flag, value) {
  const n = Number(value)
  if (!/^\d+$/.test(value) || n < 1 || n > 3600) throw new UsageError(`${flag} takes whole seconds from 1 to 3600: ${JSON.stringify(value)}`)
  return n
}

const VALUE_FLAGS = new Set(['--out', '--route', '--viewport', '--steps', '--chrome', '--fail', '--delay', '--timeout', '--step-timeout', '--guard-test'])
const BOOLEAN_FLAGS = new Set(['--viewport-only', '--list-routes', '--help'])

/** Parses the command line. Throws UsageError with a message for the person. */
export function parseArgs(argv) {
  const opts = {
    out: undefined,
    routes: [],
    viewports: [],
    stepsFile: undefined,
    chrome: undefined,
    failures: [],
    delays: [],
    timeoutSec: DEFAULTS.timeoutSec,
    stepTimeoutSec: DEFAULTS.stepTimeoutSec,
    fullPage: true,
    guardTest: undefined,
    listRoutes: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg
    if (BOOLEAN_FLAGS.has(flag)) {
      if (flag !== arg) throw new UsageError(`${flag} takes no value`)
      if (flag === '--help') opts.help = true
      if (flag === '--list-routes') opts.listRoutes = true
      if (flag === '--viewport-only') opts.fullPage = false
      continue
    }
    if (!VALUE_FLAGS.has(flag)) throw new UsageError(`unknown parameter ${JSON.stringify(arg)}; see --help`)
    let value
    if (flag !== arg) value = arg.slice(eq + 1)
    else {
      value = argv[++i]
      if (value === undefined) throw new UsageError(`${flag} needs a value`)
    }
    switch (flag) {
      case '--out':
        opts.out = value
        break
      case '--route':
        opts.routes.push(parseSitePath(value))
        break
      case '--viewport':
        opts.viewports.push(parseViewport(value))
        break
      case '--steps':
        opts.stepsFile = value
        break
      case '--chrome':
        opts.chrome = value
        break
      case '--fail':
        opts.failures.push(parseFailSpec(value))
        break
      case '--delay':
        opts.delays.push(parseDelaySpec(value))
        break
      case '--timeout':
        opts.timeoutSec = positiveSeconds(flag, value)
        break
      case '--step-timeout':
        opts.stepTimeoutSec = positiveSeconds(flag, value)
        break
      case '--guard-test':
        if (!GUARD_TEST_CASES.includes(value)) throw new UsageError(`--guard-test takes one of ${GUARD_TEST_CASES.join(', ')}: ${JSON.stringify(value)}`)
        opts.guardTest = value
        break
    }
  }
  if (opts.help || opts.listRoutes) return opts
  if (!opts.out) throw new UsageError('--out <folder> is required: the run writes only under it')
  if (opts.viewports.length === 0) opts.viewports = [parseViewport('phone'), parseViewport('desktop')]
  const names = opts.viewports.map(v => v.name)
  if (new Set(names).size !== names.length) throw new UsageError('each --viewport may be given once')
  if (opts.routes.length === 0 && !opts.stepsFile) opts.routes = ['/']
  return opts
}

const SELECTOR_ACTIONS = ['click', 'hover']

/**
 * The steps file: a JSON array of steps, or `{ "steps": [...] }`. Each step does one thing:
 * `goto`, `click`, `hover`, `type` (with `into`), `press`, `wait` or `scroll`; `name` labels its
 * files and `capture: false` skips its screenshot, text and accessibility snapshot.
 */
export function parseSteps(json) {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' && Array.isArray(json.steps) ? json.steps : null
  if (!list) throw new UsageError('the steps file must hold a JSON array of steps, or an object with a "steps" array')
  return list.map((step, index) => {
    const where = `step ${index + 1}`
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new UsageError(`${where} must be an object`)
    const { name, capture, ...rest } = step
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) throw new UsageError(`${where}: name must be a non-empty string`)
    if (capture !== undefined && typeof capture !== 'boolean') throw new UsageError(`${where}: capture must be true or false`)
    const base = { ...(name ? { name } : {}), capture: capture !== false }
    const keys = Object.keys(rest)
    if ('type' in rest) {
      if (keys.some(k => k !== 'type' && k !== 'into')) throw new UsageError(`${where}: a type step takes only "type", "into", "name" and "capture"`)
      if (typeof rest.type !== 'string') throw new UsageError(`${where}: "type" is the text to type`)
      if (typeof rest.into !== 'string' || rest.into.length === 0) throw new UsageError(`${where}: a type step needs "into", the selector of the field`)
      return { ...base, action: 'type', text: rest.type, selector: rest.into }
    }
    if (keys.length !== 1) throw new UsageError(`${where} must do exactly one thing: goto, click, hover, type, press, wait or scroll`)
    const [action] = keys
    const value = rest[action]
    if (action === 'goto') return { ...base, action, path: parseSitePath(value, `${where}: goto`) }
    if (SELECTOR_ACTIONS.includes(action)) {
      if (typeof value !== 'string' || value.length === 0) throw new UsageError(`${where}: ${action} takes a selector`)
      return { ...base, action, selector: value }
    }
    if (action === 'press') {
      if (typeof value !== 'string' || value.length === 0) throw new UsageError(`${where}: press takes a key name, such as Enter`)
      return { ...base, action, key: value }
    }
    if (action === 'wait') {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60_000) return { ...base, action, ms: value }
      if (typeof value === 'string' && value.length > 0) return { ...base, action, selector: value }
      throw new UsageError(`${where}: wait takes milliseconds (up to 60000) or a selector`)
    }
    if (action === 'scroll') {
      if (value === 'top' || value === 'bottom') return { ...base, action, to: value }
      if (typeof value === 'number' && Number.isInteger(value)) return { ...base, action, by: value }
      if (typeof value === 'string' && value.length > 0) return { ...base, action, selector: value }
      throw new UsageError(`${where}: scroll takes "top", "bottom", a number of pixels or a selector`)
    }
    throw new UsageError(`${where}: unknown action ${JSON.stringify(action)}`)
  })
}

/** The steps a run takes on each viewport: one goto per --route, then the steps file's steps. */
export function planSteps(routes, fileSteps = []) {
  return [...routes.map(route => ({ action: 'goto', path: route, capture: true })), ...fileSteps]
}

/** A short file-name label for a step. */
export function stepLabel(step) {
  const raw =
    step.name ??
    (step.action === 'goto'
      ? step.path === '/'
        ? 'home'
        : step.path
      : step.action === 'type'
        ? `type-${step.selector}`
        : `${step.action}-${step.selector ?? step.key ?? step.to ?? step.by ?? step.ms ?? ''}`)
  const slug = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '')
  return slug || step.action
}

function isInside(target, folder) {
  const rel = path.relative(folder, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** The files a run writes at the top of its output folder (README.md, "Outputs"). */
export const OUTPUT_FILES = ['report.json', 'console.json', 'blocked-requests.json', 'api-requests.json', 'proxy-sink.json']

/** Names of earlier outputs a run may clear in a folder that carries the marker. */
function isOwnOutput(name) {
  return [...OUTPUT_FILES, '.runtime'].includes(name) || /^(phone|desktop|\d{3,4}x\d{3,4})$/.test(name)
}

/**
 * The checkouts the harness sits in: the repository, and every folder above it that holds a `.git`
 * (a worktree nests inside the main checkout, at `<main>/.claude/worktrees/<name>`).
 */
export function checkoutRoots(repoRoot) {
  const roots = [path.resolve(repoRoot)]
  for (let dir = path.dirname(roots[0]); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) roots.push(dir)
  }
  return roots
}

/** True when the absolute path `target` is in one of the checkouts the harness sits in. */
export function isInsideCheckout(target, repoRoot) {
  return checkoutRoots(repoRoot).some(root => isInside(target, root))
}

/**
 * Makes the output folder ready: it must be outside every checkout the harness sits in, and be new,
 * empty or an earlier output folder of this harness (it carries OUT_MARKER). Clears that earlier
 * run's outputs and its `.runtime/`, keeps `.cache/` (Vite's dependency cache), and returns the
 * absolute path.
 */
export function prepareOutDir(out, repoRoot) {
  const abs = path.resolve(out)
  if (checkoutRoots(repoRoot).some(root => isInside(abs, root) || isInside(root, abs))) {
    throw new UsageError(
      '--out must be a folder outside the repository (and outside the checkout a worktree sits in), such as one in your temp or scratch folder',
    )
  }
  if (fs.existsSync(abs)) {
    if (!fs.statSync(abs).isDirectory()) throw new UsageError('--out exists and is not a folder')
    const entries = fs.readdirSync(abs)
    if (entries.length > 0 && !entries.includes(OUT_MARKER)) {
      throw new UsageError('--out is a folder with other files in it; give a new or empty folder (or one this harness wrote before)')
    }
    for (const name of entries) {
      if (isOwnOutput(name)) fs.rmSync(path.join(abs, name), { recursive: true, force: true, maxRetries: 3 })
    }
  }
  fs.mkdirSync(abs, { recursive: true })
  fs.writeFileSync(path.join(abs, OUT_MARKER), 'Output folder of harness/site in the actually-relevant repository. A later run clears its outputs.\n')
  return abs
}

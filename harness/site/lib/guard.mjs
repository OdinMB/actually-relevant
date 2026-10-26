/**
 * The hermetic guard of the site harness: what the run's environment may hold, which targets it
 * may reach, and the checks that refuse a run before anything is served. Every function here is
 * pure (no I/O), so the tests can show that each negative-test case is refused.
 *
 * Messages name variables and settings, never their values.
 */
import path from 'node:path'

/** Printed once every assertion has passed, with the site's port. */
export function guardOkLine(port) {
  return `hermetic-guard: ok port ${port}`
}

/** Printed, with exit code 2, when an assertion fails. */
export function guardRefusedLine(problems) {
  return `hermetic-guard: refused: ${problems.join('; ')}`
}

/** Exit codes the harness uses (README.md, "Exit codes"). */
export const EXIT = { ok: 0, failed: 1, refused: 2, usage: 64, timeout: 124, interrupted: 130 }

/**
 * Assertion 0, on the Node that runs the product: it must load the server's TypeScript copy module
 * (the fixtures' AI wording) and honor NODE_USE_ENV_PROXY, or its fetch would ignore the proxy
 * variables and reach the network directly.
 */
export function checkRuntime({ version, features, allowedNodeEnvironmentFlags }) {
  const problems = []
  if (!features?.typescript) problems.push(`this Node (${version}) cannot strip TypeScript types; use the version in .node-version`)
  if (!allowedNodeEnvironmentFlags?.has('--use-env-proxy')) {
    problems.push(`this Node (${version}) ignores NODE_USE_ENV_PROXY, so its fetch would bypass the proxy sink; use the version in .node-version`)
  }
  return problems
}

/** Copied from the caller's environment: what the OS needs to start processes at all. */
const SYSTEM_NAMES = { posix: ['PATH'], win32: ['PATH', 'SYSTEMROOT', 'COMSPEC', 'WINDIR', 'PATHEXT'] }

/** Each points at a folder under the output folder's `.runtime/`. */
export const TEMP_DIR_NAMES = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'TMP', 'TEMP']

/** Off-machine requests from Node go to the proxy sink the harness holds, which drops them. */
export const PROXY_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY']
export const NO_PROXY_VALUE = '127.0.0.1,localhost'

/** The fixture names: the client's variables (client/env.example) and the harness's own. */
export const FIXTURE_NAMES = ['VITE_API_URL', 'VITE_TURNSTILE_SITE_KEY', 'NODE_ENV', 'SITE_HARNESS_CHILD']

/** Keys Vite itself adds to import.meta.env. */
const VITE_BUILTIN_ENV_KEYS = ['BASE_URL', 'MODE', 'DEV', 'PROD', 'SSR']

/** The fixture values, given the fixture API's origin once it listens (undefined before). */
export function fixtureValues(apiOrigin) {
  return { VITE_API_URL: apiOrigin, VITE_TURNSTILE_SITE_KEY: '', NODE_ENV: 'development', SITE_HARNESS_CHILD: '1' }
}

/** The run's private folders under `<out>/.runtime`. */
export function runtimeDirs(runtimeDir) {
  const at = name => path.join(runtimeDir, name)
  return {
    root: runtimeDir,
    home: at('home'),
    appData: at('appdata'),
    localAppData: at('localappdata'),
    config: at('config'),
    cache: at('cache'),
    data: at('data'),
    tmp: at('tmp'),
    chromeProfile: at('chrome-profile'),
    viteConfig: at('vite-config'),
  }
}

function sinkUrl(sinkPort) {
  return `http://127.0.0.1:${sinkPort}`
}

function normalizeName(name, platform) {
  return platform === 'win32' ? name.toUpperCase() : name
}

/** Reads a variable, case-insensitively on Windows as the OS does. */
function readVar(env, name, platform) {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/** Every name the run's environment may hold. */
export function allowedEnvNames(platform) {
  const system = platform === 'win32' ? SYSTEM_NAMES.win32 : SYSTEM_NAMES.posix
  return new Set([...system, ...TEMP_DIR_NAMES, ...PROXY_NAMES, ...FIXTURE_NAMES].map(n => normalizeName(n, platform)))
}

/**
 * The cleared environment the run starts with: the system names copied from the caller, temporary
 * folders under the output folder, the proxy sink, and the fixture values. Nothing else of the
 * caller's environment reaches it. VITE_API_URL is set by the run once the fixture API listens.
 */
export function buildChildEnv({ parentEnv, platform, runtimeDir, sinkPort }) {
  const env = {}
  for (const name of platform === 'win32' ? SYSTEM_NAMES.win32 : SYSTEM_NAMES.posix) {
    const value = readVar(parentEnv, name, platform)
    if (value !== undefined) env[name] = value
  }
  const dirs = runtimeDirs(runtimeDir)
  Object.assign(env, {
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    APPDATA: dirs.appData,
    LOCALAPPDATA: dirs.localAppData,
    XDG_CONFIG_HOME: dirs.config,
    XDG_CACHE_HOME: dirs.cache,
    XDG_DATA_HOME: dirs.data,
    TMPDIR: dirs.tmp,
    TMP: dirs.tmp,
    TEMP: dirs.tmp,
    HTTP_PROXY: sinkUrl(sinkPort),
    HTTPS_PROXY: sinkUrl(sinkPort),
    NO_PROXY: NO_PROXY_VALUE,
    NODE_USE_ENV_PROXY: '1',
  })
  const { VITE_API_URL: _setLater, ...fixtures } = fixtureValues(undefined)
  return { ...env, ...fixtures }
}

function isInside(target, folder) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return false
  const rel = path.relative(folder, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Assertion 1: the environment holds only the allowlist and the fixture names, its temporary
 * folders are under the output folder, its proxy variables point at the harness's sink, and each
 * fixture name is unset or holds its fixture value. Anything else came from a dotenv file or a
 * leaked shell variable.
 */
export function checkEnvironment(env, { platform, runtimeDir, sinkPort, apiOrigin }) {
  const problems = []
  const allowed = allowedEnvNames(platform)
  for (const key of Object.keys(env)) {
    // Windows keeps per-drive working folders as hidden "=C:" entries
    if (platform === 'win32' && key.startsWith('=')) continue
    if (!allowed.has(normalizeName(key, platform))) problems.push(`the environment holds ${key}, which is on no allowlist`)
  }
  for (const name of TEMP_DIR_NAMES) {
    if (!isInside(readVar(env, name, platform), runtimeDir)) problems.push(`${name} is not a folder under the output folder`)
  }
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY']) {
    if (readVar(env, name, platform) !== sinkUrl(sinkPort)) problems.push(`${name} does not point at the harness's proxy sink`)
  }
  if (readVar(env, 'NO_PROXY', platform) !== NO_PROXY_VALUE) problems.push(`NO_PROXY is not ${NO_PROXY_VALUE}`)
  if (readVar(env, 'NODE_USE_ENV_PROXY', platform) !== '1') problems.push('NODE_USE_ENV_PROXY is not 1')
  const fixtures = fixtureValues(apiOrigin)
  for (const name of FIXTURE_NAMES) {
    const value = readVar(env, name, platform)
    if (value !== undefined && value !== fixtures[name]) problems.push(`${name} holds something other than its fixture value`)
  }
  return problems
}

/** The variable names a committed env template names (`NAME=value` lines; comments skipped). */
export function parseEnvExampleNames(text) {
  const names = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (match && !line.trimStart().startsWith('#')) names.push(match[1])
  }
  return names
}

/** Assertion 2: every variable client/env.example names is unset or holds its fixture value. */
export function checkEnvExample(names, env, { platform, apiOrigin }) {
  const fixtures = fixtureValues(apiOrigin)
  const problems = []
  for (const name of names) {
    const value = readVar(env, name, platform)
    if (value === undefined) continue
    if (!(name in fixtures) || value !== fixtures[name]) problems.push(`${name} (named in client/env.example) is set to something other than its fixture value`)
  }
  return problems
}

/** True when `url` is http on 127.0.0.1 at a port the harness started itself. */
export function isStartedOrigin(url, startedOrigins) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && startedOrigins.includes(parsed.origin)
}

/** The plugin the client's build uses to prerender; the harness never loads it. */
export const PRERENDER_PLUGIN_NAME = 'Prerender Plugin'

/**
 * Assertion 3, on the configuration Vite resolved from the client's own vite.config.ts: no env
 * files read, import.meta.env holds only the fixtures, every outward target (the API base URL, the
 * dev proxy, HMR) is a server the harness started, Turnstile is off, and nothing prerenders.
 */
export function checkSiteConfig(resolved, { apiOrigin, siteOrigin, hmrServer }) {
  const problems = []
  const started = [apiOrigin, siteOrigin]
  const sitePort = Number(new URL(siteOrigin).port)
  if (resolved.envDir !== false) problems.push('Vite would read env files (envDir is not off)')
  const env = resolved.env ?? {}
  const allowedKeys = new Set(['VITE_API_URL', 'VITE_TURNSTILE_SITE_KEY', ...VITE_BUILTIN_ENV_KEYS])
  for (const key of Object.keys(env)) {
    if (!allowedKeys.has(key)) problems.push(`import.meta.env holds ${key}, which no fixture sets`)
  }
  if (env.VITE_API_URL !== apiOrigin || !isStartedOrigin(env.VITE_API_URL, started)) {
    problems.push('VITE_API_URL, the API base URL the client calls, is not the fixture API the harness started')
  }
  if (env.VITE_TURNSTILE_SITE_KEY) problems.push("the Turnstile site key is set, so the forms would load Cloudflare's script")
  const server = resolved.server ?? {}
  if (server.middlewareMode !== true) problems.push('Vite is not in middleware mode, so it would open a listener of its own')
  if (server.host !== '127.0.0.1') problems.push('the site host is not 127.0.0.1')
  if (server.origin !== undefined && !isStartedOrigin(server.origin, started)) problems.push('server.origin is not the site server')
  for (const [route, entry] of Object.entries(server.proxy ?? {})) {
    const target = typeof entry === 'string' ? entry : entry?.target
    if (typeof target !== 'string' || !isStartedOrigin(target, started))
      problems.push(`the dev proxy for ${route} points at a target the harness did not start`)
  }
  const hmr = server.hmr
  const hmrOnSite =
    hmr !== null &&
    typeof hmr === 'object' &&
    hmr.server === hmrServer &&
    hmrServer !== undefined &&
    (hmr.port === undefined || hmr.port === sitePort) &&
    (hmr.clientPort === undefined || hmr.clientPort === sitePort) &&
    (hmr.host === undefined || hmr.host === '127.0.0.1')
  if (!hmrOnSite) problems.push("the HMR socket would connect somewhere other than the site server's port")
  if ((resolved.plugins ?? []).some(p => p?.name === PRERENDER_PLUGIN_NAME)) problems.push('the prerender plugin is still loaded')
  return problems
}

/**
 * The browser's request policy: a request goes through only to a port the harness started; data:,
 * blob: and about: URLs never leave the page. Everything else is blocked and reported.
 */
export function isAllowedRequest(url, startedOrigins) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') return true
  return isStartedOrigin(url, startedOrigins)
}

/** Absolute http(s) and protocol-relative URLs in src= and href= attributes. */
export function externalUrlsInHtml(html) {
  const urls = []
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[1].trim()
    if (/^https?:\/\//i.test(value)) urls.push(value)
    else if (value.startsWith('//')) urls.push(`https:${value}`)
  }
  return urls
}

/**
 * Assertion 4: every outside script or stylesheet the client's index.html loads (the analytics
 * script) is one the browser's request policy blocks. Returns the problems and the URLs blocked.
 */
export function checkIndexHtml(html, startedOrigins) {
  const problems = []
  const blocked = []
  for (const url of externalUrlsInHtml(html)) {
    if (isStartedOrigin(url, startedOrigins)) continue
    if (isAllowedRequest(url, startedOrigins)) problems.push('index.html loads an outside URL the request policy would let through')
    else blocked.push(url)
  }
  return { problems, blocked }
}

/**
 * All assertions, as the run makes them once Vite has resolved the client's configuration and
 * before the site answers a request. An empty list means the run may serve.
 */
export function assertHermetic({ env, platform, runtimeDir, sinkPort, apiOrigin, siteOrigin, envExampleNames, resolvedConfig, hmrServer, indexHtml }) {
  return [
    ...checkEnvironment(env, { platform, runtimeDir, sinkPort, apiOrigin }),
    ...checkEnvExample(envExampleNames, env, { platform, apiOrigin }),
    ...checkSiteConfig(resolvedConfig, { apiOrigin, siteOrigin, hmrServer }),
    ...checkIndexHtml(indexHtml, [apiOrigin, siteOrigin]).problems,
  ]
}

/** Browser flags that send everything but the harness's own ports to the sink, and resolve no names. */
export function chromeArgs({ sinkPort, allowedPorts }) {
  const bypass = [...allowedPorts.map(port => `127.0.0.1:${port}`), '<-loopback>'].join(';')
  return [
    `--proxy-server=${sinkUrl(sinkPort)}`,
    // <-loopback> drops Chrome's implicit loopback bypass, so another local port goes to the sink too
    `--proxy-bypass-list=${bypass}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    // navigator.webdriver stays false: the client treats a webdriver browser as its prerenderer
    '--disable-blink-features=AutomationControlled',
    // As the client's prerender launches it (vite.config.ts); the browser only sees the local site
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ]
}

/** The negative tests (README.md, "Negative tests"). */
export const GUARD_TEST_CASES = ['env', 'target', 'target-loopback', 'network']

/** The off-machine GET the `network` case makes from inside the run, once from the browser and once from Node. */
export const GUARD_TEST_NETWORK_URL = 'https://example.com/'

/**
 * The `network` case's outcome from its probes (`{ from, reached, detail }`): refused only when
 * every probe ran and none reached the target. A probe that got any answer means the block is broken.
 */
export function networkTestVerdict(probes) {
  const reached = probes.filter(probe => probe.reached)
  if (probes.length > 0 && reached.length === 0) {
    const how = probes.map(probe => `from ${probe.from} (${probe.detail})`).join(' and ')
    return { refused: true, line: guardRefusedLine([`guard-test network: the GET to ${GUARD_TEST_NETWORK_URL} failed ${how}`]) }
  }
  const from = reached.map(probe => probe.from).join(' and ') || 'nowhere: no probe ran'
  return { refused: false, line: `hermetic-guard: NOT refused: guard-test network reached ${GUARD_TEST_NETWORK_URL} from ${from}; the network block is broken` }
}

/** Invented outward targets, planted where the client reads its API base URL. */
export const GUARD_TEST_TARGETS = { target: 'https://guard-test.invalid', 'target-loopback': 'http://127.0.0.1:9' }

/** The planted variable for the `env` case, as a dotenv file would add one. */
export const GUARD_TEST_STRAY_NAME = 'SITE_HARNESS_GUARD_TEST_STRAY'

/**
 * Plants a negative-test case into the run's own environment, after it was cleared: `env` once the
 * run starts, the targets once the fixture API has set VITE_API_URL. `network` plants nothing here;
 * the run makes its request once the browser is up. Returns true when it planted something.
 */
export function plantGuardTest(caseName, stage, env) {
  if (caseName === 'env' && stage === 'cleared') {
    env[GUARD_TEST_STRAY_NAME] = 'planted'
    return true
  }
  if ((caseName === 'target' || caseName === 'target-loopback') && stage === 'api-started') {
    env.VITE_API_URL = GUARD_TEST_TARGETS[caseName]
    return true
  }
  return false
}

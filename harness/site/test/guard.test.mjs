import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertHermetic,
  buildChildEnv,
  checkEnvExample,
  checkEnvironment,
  checkIndexHtml,
  checkRuntime,
  checkSiteConfig,
  chromeArgs,
  GUARD_TEST_CASES,
  GUARD_TEST_NETWORK_URL,
  GUARD_TEST_STRAY_NAME,
  guardOkLine,
  guardRefusedLine,
  isAllowedRequest,
  networkTestVerdict,
  parseEnvExampleNames,
  plantGuardTest,
  PRERENDER_PLUGIN_NAME,
} from '../lib/guard.mjs'
import { startSink } from '../lib/sink.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const envExampleNames = parseEnvExampleNames(fs.readFileSync(path.join(repoRoot, 'client/env.example'), 'utf8'))
const indexHtml = fs.readFileSync(path.join(repoRoot, 'client/index.html'), 'utf8')

const runtimeDir = path.resolve('/harness-out/.runtime')
const sinkPort = 40001
const apiOrigin = 'http://127.0.0.1:40002'
const siteOrigin = 'http://127.0.0.1:40003'
const hmrServer = { name: 'the site server' }
const parentEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/someone',
  DATABASE_URL: 'postgres://db.example.invalid/x',
  MODEL_CLIENT_SETTING: 'invented',
  HTTPS_PROXY: 'http://proxy.example.invalid:8080',
  VITE_API_URL: 'http://localhost:3001',
}

/** What Vite resolves into import.meta.env from this environment (its loadEnv, envDir off). */
function viteEnvFrom(env) {
  const fromEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('VITE_')))
  return { ...fromEnv, BASE_URL: '/', MODE: 'development', DEV: true, PROD: false }
}

/** A resolved Vite config as the harness's overrides produce it, read from `env`. */
function resolvedConfigFrom(env, overrides = {}) {
  return {
    envDir: false,
    env: viteEnvFrom(env),
    plugins: [{ name: 'html-transform' }, { name: 'vite:react-babel' }],
    ...overrides,
    server: {
      middlewareMode: true,
      host: '127.0.0.1',
      proxy: { '/api': { target: apiOrigin, changeOrigin: false } },
      hmr: { server: hmrServer, port: 40003, clientPort: 40003 },
      ...overrides.server,
    },
  }
}

/** The run's environment once the fixture API listens, as the child holds it. */
function runEnv() {
  const env = buildChildEnv({ parentEnv, platform: 'linux', runtimeDir, sinkPort })
  env.VITE_API_URL = apiOrigin
  return env
}

function assertRun(env, resolvedConfig = resolvedConfigFrom(env)) {
  return assertHermetic({
    env,
    platform: 'linux',
    runtimeDir,
    sinkPort,
    apiOrigin,
    siteOrigin,
    envExampleNames,
    resolvedConfig,
    hmrServer,
    indexHtml,
  })
}

test('the run starts with only the allowlist: nothing else of the caller reaches it', () => {
  const env = buildChildEnv({ parentEnv, platform: 'linux', runtimeDir, sinkPort })
  assert.equal(env.PATH, '/usr/bin:/bin')
  for (const leaked of ['DATABASE_URL', 'MODEL_CLIENT_SETTING', 'VITE_API_URL']) assert.equal(env[leaked], undefined, leaked)
  assert.equal(env.HTTPS_PROXY, `http://127.0.0.1:${sinkPort}`)
  assert.equal(env.HOME, path.join(runtimeDir, 'home'))
  assert.equal(env.TMPDIR, path.join(runtimeDir, 'tmp'))
  assert.equal(env.VITE_TURNSTILE_SITE_KEY, '')
  assert.deepEqual(checkEnvironment(env, { platform: 'linux', runtimeDir, sinkPort, apiOrigin: undefined }), [])
})

test('on Windows the system variables are copied case-insensitively and drive entries are ignored', () => {
  const env = buildChildEnv({
    parentEnv: { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe', CALLER_SETTING: 'x' },
    platform: 'win32',
    runtimeDir,
    sinkPort,
  })
  assert.equal(env.PATH, 'C:\\Windows')
  assert.equal(env.SYSTEMROOT, 'C:\\Windows')
  assert.equal(env.CALLER_SETTING, undefined)
  env['=C:'] = 'C:\\work'
  assert.deepEqual(checkEnvironment(env, { platform: 'win32', runtimeDir, sinkPort, apiOrigin: undefined }), [])
})

test('a clean run passes every assertion', () => {
  assert.deepEqual(assertRun(runEnv()), [])
})

test('the env negative test is refused: a variable on no allowlist, planted after clearing', () => {
  const env = runEnv()
  assert.equal(plantGuardTest('env', 'cleared', env), true)
  const problems = assertRun(env)
  assert.ok(
    problems.some(p => p.includes(GUARD_TEST_STRAY_NAME)),
    problems.join('; '),
  )
})

for (const caseName of ['target', 'target-loopback']) {
  test(`the ${caseName} negative test is refused where the client reads its API base URL`, () => {
    const env = runEnv()
    assert.equal(plantGuardTest(caseName, 'cleared', env), false)
    assert.equal(plantGuardTest(caseName, 'api-started', env), true)
    const problems = assertRun(env)
    assert.ok(
      problems.some(p => p.startsWith('VITE_API_URL, the API base URL')),
      problems.join('; '),
    )
    assert.ok(
      problems.some(p => p.includes('client/env.example')),
      problems.join('; '),
    )
  })
}

test('each planting case is documented, and network plants nothing in the environment', () => {
  assert.deepEqual(GUARD_TEST_CASES, ['env', 'target', 'target-loopback', 'network'])
  const env = runEnv()
  assert.equal(plantGuardTest('network', 'cleared', env), false)
  assert.equal(plantGuardTest('network', 'api-started', env), false)
  assert.deepEqual(assertRun(env), [])
})

test('the environment check refuses leaks a dotenv file or a shell could add', () => {
  const opts = { platform: 'linux', runtimeDir, sinkPort, apiOrigin }
  const cases = {
    'a lowercase proxy variable': env => (env.http_proxy = 'http://proxy.example.invalid:8080'),
    'a proxy pointing elsewhere': env => (env.HTTPS_PROXY = 'http://127.0.0.1:3128'),
    'HOME outside the output folder': env => (env.HOME = '/home/someone'),
    'TMPDIR missing': env => delete env.TMPDIR,
    'NO_PROXY widened': env => (env.NO_PROXY = '*'),
    'Turnstile key set': env => (env.VITE_TURNSTILE_SITE_KEY = 'invented-site-key'),
    'NODE_ENV changed': env => (env.NODE_ENV = 'production'),
    'a database URL': env => (env.DATABASE_URL = 'postgres://127.0.0.1:5433/x'),
  }
  for (const [label, mutate] of Object.entries(cases)) {
    const env = runEnv()
    mutate(env)
    assert.notDeepEqual(checkEnvironment(env, opts), [], label)
  }
})

test('client/env.example names are read from the committed template', () => {
  assert.deepEqual(envExampleNames, ['VITE_API_URL', 'VITE_TURNSTILE_SITE_KEY'])
  assert.deepEqual(checkEnvExample(envExampleNames, {}, { platform: 'linux', apiOrigin }), [])
  assert.deepEqual(checkEnvExample(['SOME_NEW_VAR'], { SOME_NEW_VAR: 'x' }, { platform: 'linux', apiOrigin }).length, 1)
  assert.deepEqual(parseEnvExampleNames('# A=1\nB=2\n  export C=3\nnot a line\n'), ['B', 'C'])
})

test('the site config check refuses every target the harness did not start', () => {
  const env = runEnv()
  const opts = { apiOrigin, siteOrigin, hmrServer }
  assert.deepEqual(checkSiteConfig(resolvedConfigFrom(env), opts), [])
  const refused = {
    'env files read': { envDir: '/some/folder' },
    'a stray import.meta.env key': { env: { ...viteEnvFrom(env), VITE_EXTRA: 'x' } },
    'API base unset (same origin)': { env: { ...viteEnvFrom(env), VITE_API_URL: '' } },
    'API base on localhost': { env: { ...viteEnvFrom(env), VITE_API_URL: 'http://localhost:40002' } },
    'Turnstile on': { env: { ...viteEnvFrom(env), VITE_TURNSTILE_SITE_KEY: 'key' } },
    'the product dev proxy': { server: { proxy: { '/api': 'http://localhost:3001' } } },
    'a proxy with no target': { server: { proxy: { '/api': {} } } },
    'a listener of its own': { server: { middlewareMode: false } },
    'listening beyond loopback': { server: { host: '0.0.0.0' } },
    'HMR off the site server': { server: { hmr: false } },
    'HMR on another port': { server: { hmr: { server: hmrServer, clientPort: 24678 } } },
    prerendering: { plugins: [{ name: PRERENDER_PLUGIN_NAME }] },
  }
  for (const [label, overrides] of Object.entries(refused)) {
    assert.notDeepEqual(checkSiteConfig(resolvedConfigFrom(env, overrides), opts), [], label)
  }
})

test('the request policy lets through only the two ports the run started', () => {
  const started = [apiOrigin, siteOrigin]
  for (const url of [
    `${siteOrigin}/`,
    `${siteOrigin}/src/main.tsx?t=1`,
    `${apiOrigin}/api/homepage`,
    'data:image/png;base64,AAAA',
    'blob:http://127.0.0.1:40003/x',
    'about:blank',
  ]) {
    assert.equal(isAllowedRequest(url, started), true, url)
  }
  for (const url of [
    'https://example.com/',
    'https://scripts.simpleanalyticscdn.com/latest.js',
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    'http://127.0.0.1:9/',
    'http://127.0.0.1:3001/api/homepage',
    'http://localhost:40003/',
    'https://127.0.0.1:40003/',
    'ws://127.0.0.1:24678/',
    'file:///etc/hosts',
    'not a url',
  ]) {
    assert.equal(isAllowedRequest(url, started), false, url)
  }
})

test("index.html's analytics script is one the request policy blocks", () => {
  const { problems, blocked } = checkIndexHtml(indexHtml, [apiOrigin, siteOrigin])
  assert.deepEqual(problems, [])
  assert.ok(
    blocked.some(url => url.startsWith('https://scripts.simpleanalyticscdn.com/')),
    blocked.join(', '),
  )
  assert.deepEqual(checkIndexHtml('<script src="//cdn.example.com/x.js"></script>', [apiOrigin]).blocked, ['https://cdn.example.com/x.js'])
})

test('the browser sends everything but the started ports to the sink and resolves no names', () => {
  const args = chromeArgs({ sinkPort, allowedPorts: [40003, 40002] })
  assert.ok(args.includes(`--proxy-server=http://127.0.0.1:${sinkPort}`))
  assert.ok(args.includes('--proxy-bypass-list=127.0.0.1:40003;127.0.0.1:40002;<-loopback>'))
  assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'))
  assert.ok(args.includes('--disable-blink-features=AutomationControlled'))
})

test('the proxy sink drops every connection and counts it', async () => {
  const sink = await startSink()
  try {
    await new Promise((resolve, reject) => {
      const socket = net.connect(sink.port, '127.0.0.1')
      socket.on('error', () => {})
      socket.on('close', resolve)
      socket.setTimeout(5000, () => reject(new Error('the sink kept the connection open')))
    })
    assert.equal(sink.dropped(), 1)
  } finally {
    await sink.close()
  }
})

test('the guard lines', () => {
  assert.equal(guardOkLine(40003), 'hermetic-guard: ok port 40003')
  assert.equal(guardRefusedLine(['a', 'b']), 'hermetic-guard: refused: a; b')
})

test('the runtime check: this Node passes; one without type stripping or env-proxy support is refused', () => {
  assert.deepEqual(checkRuntime({ version: process.version, features: process.features, allowedNodeEnvironmentFlags: process.allowedNodeEnvironmentFlags }), [])
  const flags = new Set(['--use-env-proxy'])
  assert.match(checkRuntime({ version: 'v20.0.0', features: {}, allowedNodeEnvironmentFlags: flags }).join(), /TypeScript/)
  assert.match(checkRuntime({ version: 'v22.0.0', features: { typescript: 'strip' }, allowedNodeEnvironmentFlags: new Set() }).join(), /NODE_USE_ENV_PROXY/)
})

test('the network verdict: refused only when every probe failed', () => {
  const failedBrowser = { from: 'the browser', reached: false, detail: 'net::ERR_BLOCKED_BY_CLIENT' }
  const failedNode = { from: 'Node', reached: false, detail: 'UND_ERR_SOCKET' }
  const refused = networkTestVerdict([failedBrowser, failedNode])
  assert.equal(refused.refused, true)
  assert.equal(
    refused.line,
    `hermetic-guard: refused: guard-test network: the GET to ${GUARD_TEST_NETWORK_URL} failed from the browser (net::ERR_BLOCKED_BY_CLIENT) and from Node (UND_ERR_SOCKET)`,
  )
  const through = networkTestVerdict([failedBrowser, { from: 'Node', reached: true, detail: 'HTTP 200' }])
  assert.equal(through.refused, false)
  assert.match(through.line, /^hermetic-guard: NOT refused: .* from Node; the network block is broken$/)
  assert.equal(networkTestVerdict([]).refused, false, 'no probe is no proof')
})

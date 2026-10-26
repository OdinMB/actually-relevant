/**
 * The run's order of events, with stand-ins for the fixture API, Vite and the browser: nothing
 * listens, no config loads, no browser starts. Each negative-test case must be refused before the
 * site answers a request or a browser starts, and a clean run must print the guard line once,
 * before it serves.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildChildEnv, EXIT, GUARD_TEST_NETWORK_URL, GUARD_TEST_STRAY_NAME, parseEnvExampleNames } from '../lib/guard.mjs'
import { parseArgs } from '../lib/options.mjs'
import { clientDir } from '../lib/paths.mjs'
import { createCleanup, createRunRecord, runHermetic, writeOutputs } from '../lib/run-child.mjs'

const envExampleNames = parseEnvExampleNames(fs.readFileSync(path.join(clientDir, 'env.example'), 'utf8'))
const indexHtml = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8')
const runtimeDir = path.resolve('/harness-out/.runtime')
const tmpDir = path.resolve('/tmp/site-harness-Ab12Cd')
const sinkPort = 40001
const apiPort = 40002
const sitePort = 40003
const goodRuntime = { version: 'v22.23.4', features: { typescript: 'strip' }, allowedNodeEnvironmentFlags: new Set(['--use-env-proxy']) }

/** Vite's import.meta.env from the environment, as its loadEnv reads it with envDir off. */
function viteEnvFrom(env) {
  const fromEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('VITE_')))
  return { ...fromEnv, BASE_URL: '/', MODE: 'development', DEV: true, PROD: false }
}

/**
 * Stand-ins that record what the run did, in order. `resolveHook` and `createHook` stand for the
 * client's config doing something at load time (a dotenv loader, a changed setting).
 */
function harness({ opts = parseArgs(['--out', '/harness-out']), steps = [], runtime = goodRuntime, resolveHook, createHook, probes, stepError } = {}) {
  const events = []
  const env = buildChildEnv({ parentEnv: { PATH: '/usr/bin', CALLER_SETTING: 'x' }, platform: 'linux', runtimeDir, tmpDir, sinkPort })
  const hmrServer = { name: 'site server' }
  const configFor = (apiOrigin, server = {}) => ({
    envDir: false,
    env: viteEnvFrom(env),
    plugins: [{ name: 'vite:react-babel' }],
    server: {
      middlewareMode: true,
      host: '127.0.0.1',
      proxy: { '/api': { target: apiOrigin } },
      hmr: { server: hmrServer, port: sitePort, clientPort: sitePort },
      ...server,
    },
  })
  const middlewares = () => {}
  const deps = {
    startFixtureServer: async ({ state }) => {
      events.push('api:listen')
      return { port: apiPort, close: async () => events.push('api:close'), state }
    },
    startSiteListener: async () => {
      events.push('site:listen')
      return {
        server: hmrServer,
        port: sitePort,
        origin: `http://127.0.0.1:${sitePort}`,
        serve: handler => events.push(handler === middlewares ? 'site:serve' : 'site:serve-other'),
        close: async () => events.push('site:close'),
      }
    },
    prepareSite: async ({ apiOrigin, sitePort: port, hmrServer: hmr, wrapperDir, cacheDir }) => {
      events.push('vite:load-config')
      assert.equal(port, sitePort)
      assert.equal(hmr, hmrServer)
      assert.ok(wrapperDir.startsWith(runtimeDir), 'the config wrapper sits under the runtime folder')
      assert.ok(cacheDir.startsWith(path.resolve('/harness-out')), "Vite's cache sits under the output folder")
      return {
        resolve: async () => {
          events.push('vite:resolve')
          resolveHook?.(env)
          return configFor(apiOrigin)
        },
        create: async () => {
          events.push('vite:create')
          return { config: configFor(apiOrigin, createHook?.() ?? {}), middlewares, close: async () => events.push('vite:close') }
        },
      }
    },
    launchBrowser: async args => {
      events.push('browser:launch')
      events.launchArgs = args
      return { close: async () => events.push('browser:close') }
    },
    driveViewport: async (_browser, { viewport, steps: planned }) => {
      events.push(`browser:drive:${viewport.name}`)
      return {
        name: viewport.name,
        steps: planned.map((step, index) => ({ index: index + 1, label: step.action, ...(stepError && index === 0 ? { error: stepError } : {}) })),
      }
    },
    probeFromBrowser: async () => {
      events.push('probe:browser')
      return probes?.browser ?? { from: 'the browser', reached: false, detail: 'net::ERR_BLOCKED_BY_CLIENT' }
    },
    probeFromNode: async () => {
      events.push('probe:node')
      return probes?.node ?? { from: 'Node', reached: false, detail: 'UND_ERR_SOCKET' }
    },
    now: () => new Date('2026-10-26T12:00:00Z'),
    envExampleNames,
    indexHtml,
  }
  const printed = []
  const print = line => {
    printed.push(line)
    events.push(`print:${line.split(':')[0]}`)
  }
  const cleanup = createCleanup()
  const run = createRunRecord({ opts, startedAt: new Date('2026-10-26T12:00:00Z') })
  const internal = { outDir: path.resolve('/harness-out'), runtimeDir, tmpDir, sinkPort, chrome: '/opt/chrome' }
  const go = async () => {
    const code = await runHermetic({ opts, steps, internal, env, platform: 'linux', runtime, deps, print, cleanup, run })
    await cleanup.run()
    return code
  }
  return { go, events, printed, env, run }
}

const okLines = printed => printed.filter(line => line.startsWith('hermetic-guard: ok'))
const refusedLine = printed => printed.find(line => line.startsWith('hermetic-guard: refused: '))

test('a clean run prints the guard line once, with the site port, before the site serves or a browser starts', async () => {
  const { go, events, printed, run } = harness()
  assert.equal(await go(), EXIT.ok)
  assert.deepEqual(okLines(printed), [`hermetic-guard: ok port ${sitePort}`])
  const at = name => events.indexOf(name)
  assert.ok(at('vite:resolve') < at('vite:create'), 'the config is checked before the server is created')
  assert.ok(at('print:hermetic-guard') < at('site:serve'), 'the guard line comes before the site answers')
  assert.ok(at('site:serve') < at('browser:launch'))
  assert.deepEqual(events.launchArgs.allowedPorts, [sitePort, apiPort])
  assert.equal(events.launchArgs.sinkPort, sinkPort)
  assert.ok(events.includes('browser:drive:phone') && events.includes('browser:drive:desktop'))
  assert.deepEqual(
    events.filter(e => e.endsWith(':close')),
    ['browser:close', 'vite:close', 'site:close', 'api:close'],
    'everything started is stopped, last started first',
  )
  assert.equal(run.report.guard, 'ok')
  assert.deepEqual(run.report.ports, { api: apiPort, sink: sinkPort, site: sitePort })
})

for (const [caseName, planted] of [
  ['env', GUARD_TEST_STRAY_NAME],
  ['target', 'VITE_API_URL'],
  ['target-loopback', 'VITE_API_URL'],
]) {
  test(`--guard-test=${caseName} is refused before the client's config loads, the site serves or a browser starts`, async () => {
    const { go, events, printed, env, run } = harness({ opts: parseArgs(['--out', '/harness-out', `--guard-test=${caseName}`]) })
    assert.equal(await go(), EXIT.refused)
    assert.ok(printed.some(line => line.startsWith(`site-harness: guard-test ${caseName}: planted`)))
    assert.ok(refusedLine(printed)?.includes(planted), printed.join('\n'))
    assert.deepEqual(okLines(printed), [])
    for (const never of ['vite:load-config', 'site:serve', 'browser:launch']) assert.ok(!events.includes(never), never)
    assert.ok(events.includes('api:close'), 'the fixture API is stopped')
    assert.equal(run.report.guard, 'refused')
    if (caseName === 'env') assert.equal(env[GUARD_TEST_STRAY_NAME], 'planted', 'planted into the cleared environment')
  })
}

test('a variable the client config adds while it loads (a dotenv loader) is refused before any server exists', async () => {
  const { go, events, printed } = harness({ resolveHook: env => (env.DATABASE_URL = 'postgres://db.example.invalid/x') })
  assert.equal(await go(), EXIT.refused)
  assert.match(refusedLine(printed), /DATABASE_URL, which is on no allowlist/)
  for (const never of ['vite:create', 'site:serve', 'browser:launch']) assert.ok(!events.includes(never), never)
  assert.ok(events.includes('site:close'))
})

test("a temp folder moved off the launcher's private one while the client config loads is refused before any server exists", async () => {
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) {
    const { go, events, printed } = harness({ resolveHook: env => (env[name] = path.join(runtimeDir, 'tmp')) })
    assert.equal(await go(), EXIT.refused, name)
    assert.ok(refusedLine(printed)?.includes(`${name} is not the launcher's private temp folder`), printed.join('\n'))
    for (const never of ['vite:create', 'site:serve', 'browser:launch']) assert.ok(!events.includes(never), `${name}: ${never}`)
  }
})

test('a server config that differs from the checked one is refused before the site serves', async () => {
  const { go, events, printed } = harness({ createHook: () => ({ proxy: { '/api': 'http://localhost:3001' } }) })
  assert.equal(await go(), EXIT.refused)
  assert.match(refusedLine(printed), /dev proxy for \/api/)
  for (const never of ['site:serve', 'browser:launch']) assert.ok(!events.includes(never), never)
  assert.ok(events.includes('vite:close'), 'the created server is stopped')
})

test('a Node that would ignore the proxy variables is refused before anything starts', async () => {
  const { go, events, printed } = harness({ runtime: { ...goodRuntime, allowedNodeEnvironmentFlags: new Set() } })
  assert.equal(await go(), EXIT.refused)
  assert.match(refusedLine(printed), /NODE_USE_ENV_PROXY/)
  assert.ok(!events.includes('api:listen'))
})

test('--guard-test=network is refused when the GET fails from the browser and from Node, and drives no viewport', async () => {
  const { go, events, printed, run } = harness({ opts: parseArgs(['--out', '/harness-out', '--guard-test=network']) })
  assert.equal(await go(), EXIT.refused)
  assert.ok(okLines(printed).length === 1, 'the assertions passed: nothing was planted in the environment')
  assert.ok(refusedLine(printed).includes(GUARD_TEST_NETWORK_URL))
  assert.ok(events.includes('probe:browser') && events.includes('probe:node'))
  assert.ok(!events.some(e => e.startsWith('browser:drive')))
  assert.equal(run.report.networkTest.refused, true)
})

test('--guard-test=network exits 0 and says so when a probe gets through, so the negative test shows the broken block', async () => {
  const { go, printed } = harness({
    opts: parseArgs(['--out', '/harness-out', '--guard-test=network']),
    probes: { node: { from: 'Node', reached: true, detail: 'HTTP 200' } },
  })
  assert.equal(await go(), EXIT.ok)
  assert.ok(printed.some(line => line.startsWith('hermetic-guard: NOT refused: guard-test network reached') && line.includes('from Node')))
})

test('a step that fails makes the run exit 1', async () => {
  const { go, printed } = harness({ stepError: 'Waiting for selector `.nope` failed' })
  assert.equal(await go(), EXIT.failed)
  assert.ok(printed.some(line => line.includes('step 1 (goto) failed')))
})

test('the cleanup runs each closer once, last first, survives one that throws or hangs, and runs late arrivals at once', async () => {
  const order = []
  const cleanup = createCleanup({ timeoutMs: 50 })
  cleanup.add('first', () => order.push('first'))
  cleanup.add('throws', () => {
    throw new Error('x')
  })
  cleanup.add('hangs', () => new Promise(() => {}))
  cleanup.add('last', () => order.push('last'))
  assert.deepEqual(await cleanup.run(), ['hangs', 'throws'])
  assert.deepEqual(await cleanup.run(), ['hangs', 'throws'], 'a second run returns the first')
  assert.deepEqual(order, ['last', 'first'])
  cleanup.add('late', () => order.push('late'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['last', 'first', 'late'])
})

test('the outputs: report, console, blocked requests and API requests, counts included', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-out-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const run = createRunRecord({ opts: parseArgs(['--out', out, '--fail', '/api/homepage=500']), startedAt: new Date('2026-10-26T12:00:00Z') })
  run.blocked.push({ viewport: 'phone', step: 1, url: 'https://scripts.simpleanalyticscdn.com/latest.js', method: 'GET', resourceType: 'script' })
  run.api.push(
    { method: 'GET', path: '/api/homepage', status: 500, handled: true, injected: true },
    { method: 'GET', path: '/api/nothing', status: 404, handled: false, injected: false },
  )
  writeOutputs(out, run, { code: 0, reason: 'ok', finishedAt: new Date('2026-10-26T12:01:00Z') })
  assert.deepEqual(fs.readdirSync(out).sort(), ['api-requests.json', 'blocked-requests.json', 'console.json', 'report.json'])
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'))
  assert.deepEqual(report.exit, { code: 0, reason: 'ok' })
  assert.deepEqual(report.counts, { blockedRequests: 1, consoleMessages: 0, apiRequests: 2, apiRequestsUnanswered: 1 })
  assert.deepEqual(report.parameters.failures, [{ path: '/api/homepage', status: 500 }])
  assert.equal(report.parameters.steps, null)
})

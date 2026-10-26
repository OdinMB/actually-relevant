/**
 * The hermetic run, inside the cleared environment the launcher started it in (README.md, "The
 * guard"). In order: plant a negative-test case if one was asked for; start the fixture API; check
 * the environment; open the site listener; load and resolve the client's own Vite config; check
 * everything again; only then print the guard line, serve and browse.
 *
 * Whatever serves, resolves or browses comes in through `deps`, so the tests can show with
 * stand-ins that each negative-test case is refused before anything is served.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createApiState } from './fixture-api.mjs'
import { buildFixtures } from './fixtures.mjs'
import {
  assertHermetic,
  checkEnvExample,
  checkEnvironment,
  checkRuntime,
  EXIT,
  GUARD_TEST_STRAY_NAME,
  GUARD_TEST_TARGETS,
  guardOkLine,
  guardRefusedLine,
  networkTestVerdict,
  plantGuardTest,
  runtimeDirs,
} from './guard.mjs'
import { planSteps } from './options.mjs'

/** The longest the `network` case waits for each of its probes. */
const NETWORK_PROBE_TIMEOUT_MS = 15_000

/**
 * A stack of closers, run once, last added first, each given a bounded time. A closer added once
 * the stack has run (something that finished starting during shutdown) runs at once.
 */
export function createCleanup({ timeoutMs = 10_000 } = {}) {
  const tasks = []
  let running = null
  const runOne = async ({ name, close }) => {
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(close),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), timeoutMs)
        }),
      ])
      return null
    } catch {
      return name
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    add(name, close) {
      if (running) void runOne({ name, close })
      else tasks.push({ name, close })
    },
    run() {
      running ??= (async () => {
        const failed = []
        for (const task of tasks.splice(0).reverse()) {
          const name = await runOne(task)
          if (name) failed.push(name)
        }
        return failed
      })()
      return running
    },
  }
}

/** What one run records: the report, and the events its outputs list. */
export function createRunRecord({ opts, startedAt }) {
  return {
    report: {
      harness: 'harness/site',
      startedAt: startedAt.toISOString(),
      parameters: {
        routes: opts.routes,
        viewports: opts.viewports.map(({ name, width, height }) => ({ name, width, height })),
        steps: opts.stepsFile ? path.basename(opts.stepsFile) : null,
        failures: opts.failures,
        delays: opts.delays,
        timeoutSec: opts.timeoutSec,
        stepTimeoutSec: opts.stepTimeoutSec,
        fullPage: opts.fullPage,
        guardTest: opts.guardTest ?? null,
      },
      guard: 'not reached',
    },
    blocked: [],
    console: [],
    api: [],
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

/** Writes report.json, console.json, blocked-requests.json and api-requests.json (README.md, "Outputs"). */
export function writeOutputs(outDir, run, { code, reason, finishedAt }) {
  writeJson(path.join(outDir, 'report.json'), {
    ...run.report,
    finishedAt: finishedAt.toISOString(),
    exit: { code, reason },
    counts: {
      blockedRequests: run.blocked.length,
      consoleMessages: run.console.length,
      apiRequests: run.api.length,
      apiRequestsUnanswered: run.api.filter(entry => !entry.handled).length,
    },
  })
  writeJson(path.join(outDir, 'console.json'), run.console)
  writeJson(path.join(outDir, 'blocked-requests.json'), run.blocked)
  writeJson(path.join(outDir, 'api-requests.json'), run.api)
}

/**
 * The run itself. `env` is the process environment Vite reads (`process.env` in the run), `steps`
 * the parsed steps file, `internal` what the launcher prepared (output, runtime folder, proxy sink,
 * browser). Returns the exit code; `cleanup` holds everything started.
 */
export async function runHermetic({ opts, steps, internal, env, platform, runtime, deps, print, cleanup, run }) {
  const { outDir, runtimeDir, sinkPort } = internal
  const refuse = problems => {
    run.report.guard = 'refused'
    run.report.problems = problems
    print(guardRefusedLine(problems))
    return EXIT.refused
  }

  let problems = checkRuntime(runtime)
  if (problems.length > 0) return refuse(problems)

  // A negative-test case is planted here, after the launcher cleared the environment
  if (plantGuardTest(opts.guardTest, 'cleared', env)) print(`site-harness: guard-test env: planted ${GUARD_TEST_STRAY_NAME} after the environment was cleared`)

  let siteOrigin
  const apiState = createApiState({ fixtures: null, apiOrigin: null, failures: opts.failures, delays: opts.delays })
  const api = await deps.startFixtureServer({ state: apiState, allowedOrigins: () => (siteOrigin ? [siteOrigin] : []), log: run.api })
  cleanup.add('the fixture API', api.close)
  const apiOrigin = `http://127.0.0.1:${api.port}`
  apiState.apiOrigin = apiOrigin
  apiState.fixtures = buildFixtures(deps.now(), apiOrigin)
  env.VITE_API_URL = apiOrigin
  run.report.ports = { api: api.port, sink: sinkPort }
  if (plantGuardTest(opts.guardTest, 'api-started', env)) {
    print(`site-harness: guard-test ${opts.guardTest}: planted ${GUARD_TEST_TARGETS[opts.guardTest]} as VITE_API_URL, where the client reads its API base URL`)
  }

  // Before the client's config runs: refuse a stray environment at once
  problems = [...checkEnvironment(env, { platform, runtimeDir, sinkPort, apiOrigin }), ...checkEnvExample(deps.envExampleNames, env, { platform, apiOrigin })]
  if (problems.length > 0) return refuse(problems)

  const site = await deps.startSiteListener()
  cleanup.add('the site server', site.close)
  siteOrigin = site.origin
  run.report.ports.site = site.port

  const dirs = runtimeDirs(runtimeDir)
  const prepared = await deps.prepareSite({
    apiOrigin,
    sitePort: site.port,
    hmrServer: site.server,
    wrapperDir: dirs.viteConfig,
    cacheDir: path.join(outDir, '.cache', 'vite'),
  })
  const check = resolvedConfig =>
    assertHermetic({
      env,
      platform,
      runtimeDir,
      sinkPort,
      apiOrigin,
      siteOrigin,
      envExampleNames: deps.envExampleNames,
      resolvedConfig,
      hmrServer: site.server,
      indexHtml: deps.indexHtml,
    })
  // After the client's config ran (a dotenv loader there shows up now), before any server exists
  problems = check(await prepared.resolve())
  if (problems.length > 0) return refuse(problems)
  const vite = await prepared.create()
  cleanup.add('Vite', vite.close)
  // The configuration the server runs with, before it answers a request
  problems = check(vite.config)
  if (problems.length > 0) return refuse(problems)

  run.report.guard = 'ok'
  print(guardOkLine(site.port))
  print(`site-harness: site ${siteOrigin}, fixture API on port ${api.port}, proxy sink on port ${sinkPort}`)
  site.serve(vite.middlewares)

  const startedOrigins = [siteOrigin, apiOrigin]
  const browser = await deps.launchBrowser({ chrome: internal.chrome, sinkPort, allowedPorts: [site.port, api.port], profileDir: dirs.chromeProfile, env })
  cleanup.add('the browser', () => browser.close())

  if (opts.guardTest === 'network') {
    const probes = [
      await deps.probeFromBrowser(browser, { startedOrigins, siteOrigin, events: run, timeoutMs: NETWORK_PROBE_TIMEOUT_MS }),
      await deps.probeFromNode({ timeoutMs: NETWORK_PROBE_TIMEOUT_MS }),
    ]
    const verdict = networkTestVerdict(probes)
    run.report.networkTest = { probes, refused: verdict.refused }
    print(verdict.line)
    // A negative test that exits 0 means the guard let the case through
    return verdict.refused ? EXIT.refused : EXIT.ok
  }

  const allSteps = planSteps(opts.routes, steps)
  run.report.viewports = []
  for (const viewport of opts.viewports) {
    print(`site-harness: ${viewport.name} (${viewport.width}x${viewport.height}), ${allSteps.length} step(s)`)
    const result = await deps.driveViewport(browser, {
      viewport,
      steps: allSteps,
      siteOrigin,
      startedOrigins,
      outDir,
      fullPage: opts.fullPage,
      stepTimeoutMs: opts.stepTimeoutSec * 1000,
      events: run,
    })
    run.report.viewports.push(result)
    for (const step of result.steps) {
      if (step.error) print(`site-harness: ${viewport.name}, step ${step.index} (${step.label}) failed: ${step.error}`)
    }
  }
  return run.report.viewports.some(viewport => viewport.steps.some(step => step.error)) ? EXIT.failed : EXIT.ok
}

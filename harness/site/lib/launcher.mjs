/**
 * The launcher: the process the caller starts. It checks the parameters, prepares the output
 * folder, holds the proxy sink, and starts the run itself as a child process with a cleared
 * environment (lib/guard.mjs, `buildChildEnv`): nothing of the caller's environment but PATH and
 * the Windows system variables reaches the run. It stops the run, and everything the run started,
 * on exit, timeout or a signal.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildChildEnv, checkRuntime, EXIT, runtimeDirs } from './guard.mjs'
import { parseArgs, parseSteps, prepareOutDir, UsageError } from './options.mjs'
import { clientDir, harnessDir, importFromClient, repoRoot } from './paths.mjs'
import { startSink } from './sink.mjs'

/** The launcher starts the run as `node run.mjs <CHILD_FLAG> <settings>`; never a parameter of its own. */
export const CHILD_FLAG = '--hermetic-run'

/** How long after the run's own timeout the launcher stops it by force. */
const WATCHDOG_GRACE_SEC = 30
/** How long a run has to stop after a signal before the launcher stops it by force. */
const SIGNAL_GRACE_MS = 15_000

export const USAGE = `Usage: node harness/site/run.mjs --out <folder> [parameters]

Shows the public website (client/) with invented data in headless Chrome, fully hermetic.
README.md in harness/site documents every parameter, the outputs and the guard.

  --out <folder>             where every output goes; outside the repository (required)
  --route <path>             a page to capture, such as /newsletter (repeatable; default /)
  --viewport <v>             phone (390x844), desktop (1440x900) or <w>x<h> (repeatable; default both)
  --steps <file>             a JSON steps file: goto, click, hover, type, press, wait, scroll
  --chrome <path>            the Chrome or Chromium to drive (default: Puppeteer's own install)
  --fail <path>=<status>     make a fixture API path fail: 400-599, optionally :CODE, or drop
  --delay <path>=<ms>        delay a fixture API path (paths may end in *)
  --timeout <s>              stop the whole run after this many seconds (default 300)
  --step-timeout <s>         per step and page load (default 30)
  --viewport-only            screenshots of the viewport instead of the full page
  --guard-test=<case>        negative test: env, target, target-loopback or network
  --list-routes              print the pages the invented data fills, start nothing
  --help                     this text`

/** The paths `--list-routes` prints: shared/routes.json's static pages and the fixtures' own pages. */
export async function listRoutes(now = new Date()) {
  const { buildFixtures, fixtureRoutes } = await import('./fixtures.mjs')
  const staticPaths = JSON.parse(fs.readFileSync(path.join(repoRoot, 'shared', 'routes.json'), 'utf8')).routes.map(route => route.path)
  return fixtureRoutes(buildFixtures(now, 'http://127.0.0.1:0'), staticPaths)
}

/** The settings the run gets from the launcher, on its command line. */
export function encodeRunSettings(settings) {
  return Buffer.from(JSON.stringify(settings), 'utf8').toString('base64url')
}

/** Reads the run's settings back; throws on anything but what `encodeRunSettings` wrote. */
export function decodeRunSettings(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('the run settings are missing or malformed')
  const settings = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  const { opts, outDir, runtimeDir, sinkPort, chrome } = settings ?? {}
  const absolute = value => typeof value === 'string' && path.isAbsolute(value)
  if (!opts || typeof opts !== 'object' || !absolute(outDir) || !absolute(runtimeDir) || !absolute(chrome) || !Number.isInteger(sinkPort) || sinkPort <= 0) {
    throw new Error('the run settings are incomplete')
  }
  if (opts.stepsFile !== undefined && !absolute(opts.stepsFile)) throw new Error('the run settings name a relative steps file')
  return settings
}

/**
 * How the run is started: the cleared environment and nothing merged into it, no stdin, and on
 * POSIX a process group of its own, so the launcher can stop the browser and Vite's helpers with
 * it. It runs in client/, as `vite dev` does: Tailwind finds its config and content globs from the
 * working folder. Nothing the run writes is relative to it.
 */
export function childSpawnOptions({ env, cwd = clientDir, platform }) {
  return { env, cwd, stdio: ['ignore', 'inherit', 'inherit'], detached: platform !== 'win32', windowsHide: true, shell: false }
}

/** The run's command line: Node, with no options of the caller's, the entry point and its settings. */
export function childArgs(settings) {
  return ['--disable-warning=ExperimentalWarning', path.join(harnessDir, 'run.mjs'), CHILD_FLAG, encodeRunSettings(settings)]
}

/** Stops a run and everything it started: its process group on POSIX, its process tree on Windows. */
export function stopTree(pid, platform) {
  if (!pid) return
  if (platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // the group is already gone
  }
}

/** The browser: the one given, or the one Puppeteer installed for the client. Must be a file. */
export async function resolveChrome(given, findDefault) {
  const candidate = given ? path.resolve(given) : await findDefault()
  if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new UsageError(
      given ? `--chrome: there is no browser at ${candidate}` : 'no browser where Puppeteer installs one; give --chrome <path to Chrome or Chromium>',
    )
  }
  return candidate
}

async function puppeteerChrome() {
  try {
    const puppeteer = (await importFromClient('puppeteer')).default
    return await puppeteer.executablePath()
  } catch {
    return undefined
  }
}

function supervise(child, { platform, timeoutMs, printError }) {
  return new Promise(resolve => {
    let timedOut = false
    let stopping = false
    let forceTimer
    const signals = platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']
    const watchdog = setTimeout(() => {
      timedOut = true
      printError('site-harness: the run did not stop in time; stopping it and everything it started')
      stopTree(child.pid, platform)
    }, timeoutMs)
    const onSignal = signal => {
      if (stopping) return stopTree(child.pid, platform)
      stopping = true
      printError(`site-harness: ${signal}: stopping the run`)
      // On Windows the run gets the console's Ctrl+C itself; elsewhere it gets SIGTERM and cleans up
      if (platform !== 'win32') child.kill('SIGTERM')
      forceTimer = setTimeout(() => stopTree(child.pid, platform), SIGNAL_GRACE_MS)
    }
    for (const signal of signals) process.on(signal, onSignal)
    let finished = false
    const done = code => {
      if (finished) return
      finished = true
      clearTimeout(watchdog)
      clearTimeout(forceTimer)
      for (const signal of signals) process.off(signal, onSignal)
      // Whatever the run left behind
      if (platform !== 'win32') stopTree(child.pid, platform)
      resolve(timedOut ? EXIT.timeout : code)
    }
    child.once('error', err => {
      printError(`site-harness: could not start the run: ${err.message}`)
      done(EXIT.failed)
    })
    child.once('exit', (code, signal) => done(code ?? (signal ? EXIT.interrupted : EXIT.failed)))
  })
}

/**
 * The entry point's parent side: returns the exit code. `io` holds the caller's environment and
 * platform, Node's runtime facts, and where to print.
 */
export async function launch(argv, io) {
  const { parentEnv, platform, runtime, print, printError, execPath = process.execPath, findDefaultChrome = puppeteerChrome } = io
  let opts
  let chrome
  let outDir
  try {
    opts = parseArgs(argv)
    if (opts.help) {
      print(USAGE)
      return EXIT.ok
    }
    const runtimeProblems = checkRuntime(runtime)
    if (runtimeProblems.length > 0) throw new UsageError(runtimeProblems.join('; '))
    if (opts.listRoutes) {
      print((await listRoutes()).join('\n'))
      return EXIT.ok
    }
    if (opts.stepsFile) {
      opts.stepsFile = path.resolve(opts.stepsFile)
      let json
      try {
        json = JSON.parse(fs.readFileSync(opts.stepsFile, 'utf8'))
      } catch (err) {
        throw new UsageError(`--steps: cannot read ${opts.stepsFile} as JSON (${err instanceof Error ? err.message : err})`)
      }
      parseSteps(json)
    }
    chrome = await resolveChrome(opts.chrome, findDefaultChrome)
    outDir = prepareOutDir(opts.out, repoRoot)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    printError(`site-harness: ${err.message}`)
    return EXIT.usage
  }

  const runtimeDir = path.join(outDir, '.runtime')
  for (const dir of Object.values(runtimeDirs(runtimeDir))) fs.mkdirSync(dir, { recursive: true })
  const sink = await startSink()
  try {
    const env = buildChildEnv({ parentEnv, platform, runtimeDir, sinkPort: sink.port })
    const settings = { opts: { ...opts, out: outDir, chrome }, outDir, runtimeDir, sinkPort: sink.port, chrome }
    const child = spawn(execPath, childArgs(settings), childSpawnOptions({ env, platform }))
    const code = await supervise(child, { platform, timeoutMs: (opts.timeoutSec + WATCHDOG_GRACE_SEC) * 1000, printError })
    const dropped = sink.dropped()
    fs.writeFileSync(path.join(outDir, 'proxy-sink.json'), `${JSON.stringify({ port: sink.port, droppedConnections: dropped }, null, 2)}\n`)
    print(`site-harness: finished with exit code ${code}; the proxy sink dropped ${dropped} connection(s); outputs in ${outDir}`)
    return code
  } finally {
    await sink.close()
    try {
      fs.rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (err) {
      printError(`site-harness: could not remove ${runtimeDir} (${err instanceof Error ? err.message : err}); a later run clears it`)
    }
  }
}

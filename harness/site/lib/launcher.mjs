/**
 * The launcher: the process the caller starts. It checks the parameters, prepares the output
 * folder, holds the proxy sink, and starts the run itself as a child process with a cleared
 * environment (lib/guard.mjs, `buildChildEnv`): nothing of the caller's environment but PATH and
 * the Windows system variables reaches the run. It stops the run, and everything the run started,
 * on exit, timeout or a signal.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildChildEnv, checkRuntime, EXIT, runtimeDirs } from './guard.mjs'
import { isInsideCheckout, parseArgs, parseSteps, prepareOutDir, UsageError } from './options.mjs'
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
  const { opts, outDir, runtimeDir, tmpDir, sinkPort, chrome } = settings ?? {}
  const absolute = value => typeof value === 'string' && path.isAbsolute(value)
  if (
    !opts ||
    typeof opts !== 'object' ||
    !absolute(outDir) ||
    !absolute(runtimeDir) ||
    !absolute(tmpDir) ||
    !absolute(chrome) ||
    !Number.isInteger(sinkPort) ||
    sinkPort <= 0
  ) {
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

/**
 * Node's options for the run, and none of the caller's: no warnings about the experimental features
 * it relies on (type stripping, and the env proxy agent NODE_USE_ENV_PROXY starts).
 */
export const RUN_NODE_OPTIONS = ['--disable-warning=ExperimentalWarning', '--disable-warning=UNDICI-EHPA']

/** The run's command line: Node's options for it, the entry point and its settings. */
export function childArgs(settings) {
  return [...RUN_NODE_OPTIONS, path.join(harnessDir, 'run.mjs'), CHILD_FLAG, encodeRunSettings(settings)]
}

/** The name of the run's private temp folder under the system temp folder; mkdtemp adds six characters. */
export const RUN_TMP_PREFIX = 'site-harness-'

/** The private temp folder the launcher will make under `tmpRoot`, with its six random characters as X. */
export function runTmpTemplate(tmpRoot) {
  return path.join(path.resolve(tmpRoot), `${RUN_TMP_PREFIX}XXXXXX`)
}

/**
 * Where Chrome puts its singleton socket under TMPDIR: in a folder Chromium names
 * `org.chromium.Chromium.XXXXXX`, counted here with a leading dot as some versions write it.
 */
export function chromeSocketPath(tmpDir) {
  return path.join(tmpDir, '.org.chromium.Chromium.XXXXXX', 'SingletonSocket')
}

/** The longest socket path the OS takes, in bytes: sun_path holds 108 on Linux and 104 on macOS, the closing NUL included. */
function socketPathMax(platform) {
  return platform === 'darwin' ? 103 : 107
}

/**
 * Why the run's private temp folder cannot go under `tmpRoot` (the system temp folder), or null. It
 * must not be in the repository, and Chrome's socket path under it must fit the OS's limit: Chrome
 * aborts on a longer one ("Socket path too long"), which Puppeteer reports only as "Target closed".
 * Chrome on Windows uses no such socket.
 */
export function runTmpProblem(tmpRoot, { platform, repoRoot: root }) {
  const resolved = path.resolve(tmpRoot)
  if (isInsideCheckout(resolved, root)) {
    return `the system temp folder (${resolved}) is inside the repository; set TMPDIR to a folder outside it, such as /tmp`
  }
  if (platform === 'win32') return null
  const bytes = Buffer.byteLength(chromeSocketPath(runTmpTemplate(resolved)), 'utf8')
  const max = socketPathMax(platform)
  if (bytes <= max) return null
  return `the system temp folder (${resolved}) is too deep for Chrome: its socket path would be ${bytes} bytes, over the ${max} this system allows, so Chrome could not start; set TMPDIR to a shorter folder, such as /tmp`
}

/** Removes a folder the launcher made; says so when it cannot. */
function removeFolder(dir, { printError, leftover }) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    printError(`site-harness: could not remove ${dir} (${err instanceof Error ? err.message : err}); ${leftover}`)
  }
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

/**
 * The launcher's hold on the signals that stop a run, taken before it makes its first folder and
 * released once it has removed them: without it, Node's default would end the launcher at once and
 * leave the folders behind. A signal before the run starts is kept in `received`, and the run then
 * never starts; while the run is supervised, signals go to the supervisor's handler.
 */
function holdSignals(platform, printError) {
  const names = platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']
  const hold = { received: null, handler: null }
  const onSignal = signal => {
    if (hold.handler) return hold.handler(signal)
    if (hold.received) return
    hold.received = signal
    printError(`site-harness: ${signal}: stopping`)
  }
  for (const name of names) process.on(name, onSignal)
  hold.release = () => {
    for (const name of names) process.off(name, onSignal)
  }
  return hold
}

function supervise(child, { platform, timeoutMs, printError, signals }) {
  return new Promise(resolve => {
    let timedOut = false
    let stopping = false
    let forceTimer
    const watchdog = setTimeout(() => {
      timedOut = true
      printError('site-harness: the run did not stop in time; stopping it and everything it started')
      stopTree(child.pid, platform)
    }, timeoutMs)
    signals.handler = signal => {
      if (stopping) return stopTree(child.pid, platform)
      stopping = true
      printError(`site-harness: ${signal}: stopping the run`)
      // On Windows the run gets the console's Ctrl+C itself; elsewhere it gets SIGTERM and cleans up
      if (platform !== 'win32') child.kill('SIGTERM')
      forceTimer = setTimeout(() => stopTree(child.pid, platform), SIGNAL_GRACE_MS)
    }
    let finished = false
    const done = code => {
      if (finished) return
      finished = true
      clearTimeout(watchdog)
      clearTimeout(forceTimer)
      // A signal from here on waits for the launcher's own cleanup (holdSignals)
      signals.handler = null
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
 * platform, Node's runtime facts, where to print, and the system temp folder (the caller's, read
 * before its environment is cleared); the tests replace how the run and the proxy sink start.
 */
export async function launch(argv, io) {
  const {
    parentEnv,
    platform,
    runtime,
    print,
    printError,
    execPath = process.execPath,
    findDefaultChrome = puppeteerChrome,
    tmpRoot = os.tmpdir(),
    spawnRun = spawn,
    startSink: startProxySink = startSink,
  } = io
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
    const tmpProblem = runTmpProblem(tmpRoot, { platform, repoRoot })
    if (tmpProblem) throw new UsageError(tmpProblem)
    outDir = prepareOutDir(opts.out, repoRoot)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    printError(`site-harness: ${err.message}`)
    return EXIT.usage
  }

  const runtimeDir = path.join(outDir, '.runtime')
  let tmpDir
  let sink
  // Before the first folder is made, so a signal from here on still reaches the cleanup below
  const signals = holdSignals(platform, printError)
  try {
    for (const dir of Object.values(runtimeDirs(runtimeDir))) fs.mkdirSync(dir, { recursive: true })
    // The one folder outside --out: Chrome's socket path under it fits the OS's limit (runTmpProblem)
    tmpDir = fs.mkdtempSync(path.join(path.resolve(tmpRoot), RUN_TMP_PREFIX))
    sink = await startProxySink()
    if (signals.received) return EXIT.interrupted
    const env = buildChildEnv({ parentEnv, platform, runtimeDir, tmpDir, sinkPort: sink.port })
    const settings = { opts: { ...opts, out: outDir, chrome }, outDir, runtimeDir, tmpDir, sinkPort: sink.port, chrome }
    const child = spawnRun(execPath, childArgs(settings), childSpawnOptions({ env, platform }))
    const code = await supervise(child, { platform, timeoutMs: (opts.timeoutSec + WATCHDOG_GRACE_SEC) * 1000, printError, signals })
    const dropped = sink.dropped()
    fs.writeFileSync(path.join(outDir, 'proxy-sink.json'), `${JSON.stringify({ port: sink.port, droppedConnections: dropped }, null, 2)}\n`)
    print(`site-harness: finished with exit code ${code}; the proxy sink dropped ${dropped} connection(s); outputs in ${outDir}`)
    return code
  } finally {
    // Reached on every way the run ends (exit, error, timeout, signal) once it and its group are gone
    removeFolder(runtimeDir, { printError, leftover: 'a later run clears it' })
    if (tmpDir) removeFolder(tmpDir, { printError, leftover: 'delete it by hand' })
    await sink?.close()
    signals.release()
  }
}

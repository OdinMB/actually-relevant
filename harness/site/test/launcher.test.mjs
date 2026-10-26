/**
 * The launcher, up to the point where it would start the run: parameters it refuses, how the run's
 * process is started, and that Node's fetch in the run's environment goes to the proxy sink. The
 * run itself is never started here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { allowedEnvNames, buildChildEnv, EXIT } from '../lib/guard.mjs'
import {
  CHILD_FLAG,
  childArgs,
  childSpawnOptions,
  chromeSocketPath,
  decodeRunSettings,
  encodeRunSettings,
  launch,
  resolveChrome,
  RUN_NODE_OPTIONS,
  RUN_TMP_PREFIX,
  runTmpProblem,
  runTmpTemplate,
  USAGE,
} from '../lib/launcher.mjs'
import { UsageError } from '../lib/options.mjs'
import { clientDir, harnessDir, repoRoot } from '../lib/paths.mjs'
import { startSink } from '../lib/sink.mjs'

const goodRuntime = { version: 'v22.23.4', features: { typescript: 'strip' }, allowedNodeEnvironmentFlags: new Set(['--use-env-proxy']) }

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Calls the launcher with a Node that does not exist, so nothing could start even by mistake. */
async function launchRefused(argv, overrides = {}) {
  const printed = []
  const code = await launch(argv, {
    parentEnv: { PATH: '/usr/bin' },
    platform: 'linux',
    runtime: goodRuntime,
    print: line => printed.push(line),
    printError: line => printed.push(line),
    execPath: path.join(os.tmpdir(), 'no-such-node-binary'),
    findDefaultChrome: async () => undefined,
    ...overrides,
  })
  return { code, printed: printed.join('\n') }
}

/**
 * A stand-in for starting the run: records how the launcher started it and what its temp folder
 * looked like then, and plays the run's part with `act(child)`. Nothing is started. The stand-in
 * has no pid, so the launcher's stopTree leaves it alone.
 */
function standInSpawn(act) {
  const calls = []
  const spawnRun = (file, args, options) => {
    const child = new EventEmitter()
    child.kill = signal => setImmediate(() => child.emit('exit', null, signal))
    const tmp = options.env.TMPDIR
    const exists = typeof tmp === 'string' && fs.existsSync(tmp)
    calls.push({ file, args, options, tmpExisted: exists && fs.statSync(tmp).isDirectory(), tmpMode: exists ? fs.statSync(tmp).mode & 0o777 : null })
    setImmediate(() => act(child))
    return child
  }
  return { spawnRun, calls }
}

/** A folder for outputs and a stand-in browser file. */
function launchFolder(t) {
  const base = tempDir(t, 'sh-l-')
  const chrome = path.join(base, 'chrome')
  fs.writeFileSync(chrome, '')
  return { base, chrome }
}

test('the run settings travel on the command line and are refused when malformed', () => {
  const settings = {
    opts: { routes: ['/'] },
    outDir: path.resolve('/out'),
    runtimeDir: path.resolve('/out/.runtime'),
    tmpDir: path.resolve('/tmp/site-harness-Ab12Cd'),
    sinkPort: 40001,
    chrome: path.resolve('/opt/chrome'),
  }
  assert.deepEqual(decodeRunSettings(encodeRunSettings(settings)), settings)
  const refused = [
    undefined,
    'not base64 at all!',
    encodeRunSettings({ ...settings, outDir: 'relative/out' }),
    encodeRunSettings({ ...settings, tmpDir: undefined }),
    encodeRunSettings({ ...settings, tmpDir: 'relative/tmp' }),
    encodeRunSettings({ ...settings, sinkPort: 0 }),
    encodeRunSettings({ ...settings, chrome: undefined }),
    encodeRunSettings({ ...settings, opts: { stepsFile: 'steps.json' } }),
  ]
  for (const value of refused) assert.throws(() => decodeRunSettings(value), Error, String(value))
})

test('the run is started with the cleared environment only, in client/ as vite dev runs, in a group of its own on POSIX', () => {
  const env = { PATH: '/usr/bin' }
  const posix = childSpawnOptions({ env, platform: 'linux' })
  assert.equal(posix.env, env, 'the cleared environment itself, nothing merged into it')
  assert.deepEqual(
    { cwd: posix.cwd, stdio: posix.stdio, detached: posix.detached, shell: posix.shell },
    { cwd: clientDir, stdio: ['ignore', 'inherit', 'inherit'], detached: true, shell: false },
  )
  assert.ok(fs.existsSync(path.join(posix.cwd, 'tailwind.config.js')), 'Tailwind finds its config and content from there')
  assert.equal(childSpawnOptions({ env, platform: 'win32' }).detached, false)
  const args = childArgs({ opts: {} })
  assert.deepEqual(args.slice(0, RUN_NODE_OPTIONS.length), RUN_NODE_OPTIONS)
  assert.deepEqual(args.slice(RUN_NODE_OPTIONS.length, RUN_NODE_OPTIONS.length + 2), [path.join(harnessDir, 'run.mjs'), CHILD_FLAG])
  assert.ok(
    !args.some(arg => arg.startsWith('--require') || arg.startsWith('--import') || arg.startsWith('--env-file')),
    'no preload and no env file reach the run',
  )
})

test('the entry point and the dispatcher parse', async () => {
  const { main } = await import('../lib/main.mjs')
  assert.equal(typeof main, 'function')
  const check = spawnSync(process.execPath, ['--check', path.join(harnessDir, 'run.mjs')], { encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr)
})

test('the browser: the one given or the one Puppeteer installed, and it must exist', async t => {
  const dir = tempDir(t, 'site-harness-chrome-')
  const binary = path.join(dir, 'chrome')
  fs.writeFileSync(binary, '')
  assert.equal(await resolveChrome(binary, async () => undefined), binary)
  assert.equal(await resolveChrome(undefined, async () => binary), binary)
  await assert.rejects(
    resolveChrome(path.join(dir, 'missing'), async () => binary),
    UsageError,
  )
  await assert.rejects(
    resolveChrome(undefined, async () => undefined),
    UsageError,
  )
  await assert.rejects(
    resolveChrome(dir, async () => undefined),
    UsageError,
    'a folder is not a browser',
  )
})

test('--help prints the parameters and starts nothing', async () => {
  const { code, printed } = await launchRefused(['--help'])
  assert.equal(code, EXIT.ok)
  assert.equal(printed, USAGE)
  for (const flag of [
    '--out',
    '--route',
    '--viewport',
    '--steps',
    '--chrome',
    '--fail',
    '--delay',
    '--timeout',
    '--step-timeout',
    '--viewport-only',
    '--guard-test',
  ]) {
    assert.ok(USAGE.includes(flag), flag)
  }
})

test('--list-routes prints the static pages and the pages the invented data fills, and starts nothing', async () => {
  const { code, printed } = await launchRefused(['--list-routes'])
  assert.equal(code, EXIT.ok)
  const routes = printed.split('\n')
  for (const route of [
    '/',
    '/issues/planet-climate',
    '/newsletter',
    '/podcast',
    '/issues/energy',
    '/newsletter/fixture-issue-3',
    '/podcast/fixture-episode-3/transcript',
  ]) {
    assert.ok(routes.includes(route), route)
  }
  assert.equal(routes.filter(route => route.startsWith('/stories/')).length, 20)
  assert.equal(new Set(routes).size, routes.length, 'each route once')
})

test('the launcher refuses bad parameters with exit 64 before it prepares anything or starts the run', async t => {
  const base = tempDir(t, 'site-harness-launch-')
  const chrome = path.join(base, 'chrome')
  fs.writeFileSync(chrome, '')
  const badSteps = path.join(base, 'steps.json')
  fs.writeFileSync(badSteps, '[{"goto": "https://example.com/"}]')
  const out = path.join(base, 'out')
  const cases = {
    'no --out': [[]],
    'a live URL': [['--out', out, '--route', 'https://actuallyrelevant.news/']],
    'an unknown parameter': [['--out', out, '--url', 'http://127.0.0.1:5173/']],
    'the run flag given by hand': [['--out', out, CHILD_FLAG, 'x']],
    'a steps file leaving the site': [['--out', out, '--steps', badSteps, '--chrome', chrome]],
    'a steps file that is not there': [['--out', out, '--steps', path.join(base, 'none.json'), '--chrome', chrome]],
    'no browser': [['--out', out]],
    'a browser that is not there': [['--out', out, '--chrome', path.join(base, 'none')]],
    'an output folder inside the repository': [['--out', path.join(repoRoot, 'harness-out'), '--chrome', chrome]],
    'a Node that ignores the proxy variables': [['--out', out, '--chrome', chrome], { runtime: { ...goodRuntime, allowedNodeEnvironmentFlags: new Set() } }],
  }
  for (const [label, [argv, overrides]] of Object.entries(cases)) {
    const { code, printed } = await launchRefused(argv, overrides)
    assert.equal(code, EXIT.usage, `${label}: ${printed}`)
    assert.match(printed, /^site-harness: /, label)
  }
  assert.equal(fs.existsSync(out), false, 'no output folder was made')
  assert.equal(fs.existsSync(path.join(repoRoot, 'harness-out')), false)
})

test("with a 100-character --out, the run's TMPDIR, TMP and TEMP are one private folder under the system temp folder, short enough for Chrome's socket, removed once the run exits", async t => {
  const { base, chrome } = launchFolder(t)
  const tmpRoot = tempDir(t, 'sh-t-')
  const out = path.join(base, 'o'.repeat(99 - base.length))
  assert.equal(out.length, 100)
  const { spawnRun, calls } = standInSpawn(child => child.emit('exit', 0, null))
  const { code, printed } = await launchRefused(['--out', out, '--chrome', chrome], { tmpRoot, spawnRun })
  assert.equal(code, EXIT.ok, printed)
  assert.equal(calls.length, 1)
  const { env } = calls[0].options
  assert.ok(typeof env.TMPDIR === 'string' && env.TMP === env.TMPDIR && env.TEMP === env.TMPDIR, 'TMPDIR, TMP and TEMP are one folder')
  assert.equal(path.dirname(env.TMPDIR), tmpRoot, 'under the system temp folder, not under --out')
  assert.ok(path.basename(env.TMPDIR).startsWith(RUN_TMP_PREFIX), path.basename(env.TMPDIR))
  const socket = `${env.TMPDIR}/org.chromium.Chromium.XXXXXX/SingletonSocket`
  assert.ok(Buffer.byteLength(socket) <= 107, `${Buffer.byteLength(socket)} bytes: ${socket}`)
  assert.ok(Buffer.byteLength(chromeSocketPath(env.TMPDIR)) <= 107)
  assert.ok(calls[0].tmpExisted, 'the folder exists while the run does')
  if (process.platform !== 'win32') assert.equal(calls[0].tmpMode, 0o700, 'only this user can open it')
  assert.equal(decodeRunSettings(calls[0].args.at(-1)).tmpDir, env.TMPDIR, 'the run gets the folder its guard holds TMPDIR, TMP and TEMP to')
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'the folder is removed once the run has exited')
  assert.equal(fs.existsSync(path.join(out, '.runtime')), false)
})

test('the private temp folder is removed when the run fails, cannot start, is stopped by a signal, or the launcher fails after making it', async t => {
  const { base, chrome } = launchFolder(t)
  const tmpRoot = tempDir(t, 'sh-t-')
  const exits = {
    'the run fails': [child => child.emit('exit', 1, null), EXIT.failed],
    'the run cannot start': [child => child.emit('error', new Error('spawn ENOENT')), EXIT.failed],
    // As a signal reaches the launcher: it asks the run to stop, and the run exits
    'a signal stops it': [() => process.emit('SIGHUP', 'SIGHUP'), EXIT.interrupted],
  }
  for (const [label, [act, expected]] of Object.entries(exits)) {
    const { spawnRun, calls } = standInSpawn(act)
    const { code, printed } = await launchRefused(['--out', path.join(base, label.replaceAll(' ', '-')), '--chrome', chrome], { tmpRoot, spawnRun })
    assert.equal(code, expected, `${label}: ${printed}`)
    assert.ok(calls[0]?.tmpExisted, `${label}: the folder existed while the run did`)
    assert.deepEqual(fs.readdirSync(tmpRoot), [], `${label}: the folder is gone`)
  }
  const failing = () => {
    throw new Error('the stand-in could not start the run')
  }
  await assert.rejects(
    launchRefused(['--out', path.join(base, 'launcher-fails'), '--chrome', chrome], { tmpRoot, spawnRun: failing }),
    /could not start the run/,
  )
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'the launcher failed: the folder is gone')
})

test('a signal after the launcher made its folders but before the run started: the run never starts, the folders are removed, exit 130', async t => {
  const { base, chrome } = launchFolder(t)
  const tmpRoot = tempDir(t, 'sh-t-')
  const out = path.join(base, 'out')
  const { spawnRun, calls } = standInSpawn(child => child.emit('exit', 0, null))
  const listening = process.listenerCount('SIGHUP')
  // The signal arrives while the launcher starts the proxy sink, after it made the private temp folder
  const startSinkThenSignal = async () => {
    const sink = await startSink()
    assert.equal(fs.readdirSync(tmpRoot).length, 1, 'the private temp folder exists by then')
    process.emit('SIGHUP', 'SIGHUP')
    return sink
  }
  const { code, printed } = await launchRefused(['--out', out, '--chrome', chrome], { tmpRoot, spawnRun, startSink: startSinkThenSignal })
  assert.equal(code, EXIT.interrupted, printed)
  assert.match(printed, /site-harness: SIGHUP: stopping/)
  assert.equal(calls.length, 0, 'the run was not started')
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'the private temp folder is gone')
  assert.equal(fs.existsSync(path.join(out, '.runtime')), false)
  assert.equal(process.listenerCount('SIGHUP'), listening, 'the launcher stops listening once it is done')
})

test("a system temp folder too deep for Chrome's socket is refused with exit 64 and the cause, before anything is made or started", async t => {
  const { base, chrome } = launchFolder(t)
  const tmpRoot = path.join(base, 'd'.repeat(70))
  fs.mkdirSync(tmpRoot)
  const out = path.join(base, 'out')
  const { spawnRun, calls } = standInSpawn(child => child.emit('exit', 0, null))
  const { code, printed } = await launchRefused(['--out', out, '--chrome', chrome], { tmpRoot, spawnRun })
  assert.equal(code, EXIT.usage, printed)
  assert.match(
    printed,
    /^site-harness: the system temp folder \(.+\) is too deep for Chrome: its socket path would be \d+ bytes, over the 107 this system allows, .*set TMPDIR to a shorter folder/,
  )
  assert.equal(calls.length, 0, 'the run was not started')
  assert.equal(fs.existsSync(out), false, 'no output folder was made')
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'no temp folder was made')
})

test("the private temp folder's limits: Chrome's socket path within the OS's, counted in bytes; never inside the repository", () => {
  const prefix = path.resolve('/')
  const rootOfBytes = n => prefix + 'r'.repeat(n - Buffer.byteLength(prefix))
  const beyondRoot = Buffer.byteLength(chromeSocketPath(runTmpTemplate(rootOfBytes(10)))) - 10
  const opts = { platform: 'linux', repoRoot }
  assert.ok(chromeSocketPath(runTmpTemplate(rootOfBytes(10))).endsWith(path.join('org.chromium.Chromium.XXXXXX', 'SingletonSocket')))
  assert.equal(runTmpProblem(rootOfBytes(107 - beyondRoot), opts), null, '107 bytes fits')
  assert.match(runTmpProblem(rootOfBytes(108 - beyondRoot), opts), /would be 108 bytes, over the 107 /)
  assert.match(runTmpProblem(rootOfBytes(104 - beyondRoot), { ...opts, platform: 'darwin' }), /would be 104 bytes, over the 103 /)
  assert.equal(runTmpProblem(rootOfBytes(300), { ...opts, platform: 'win32' }), null, 'Chrome on Windows uses no such socket')
  const accented = prefix + 'é'.repeat(Math.ceil((108 - beyondRoot - Buffer.byteLength(prefix)) / 2))
  assert.ok(accented.length + beyondRoot <= 107, 'fits in characters')
  assert.notEqual(runTmpProblem(accented, opts), null, 'but not in bytes')
  assert.match(runTmpProblem(path.join(repoRoot, 'tmp'), opts), /inside the repository/)
})

test('the run refuses to start outside its launcher', async t => {
  const { childMain } = await import('../lib/child.mjs')
  const saved = process.env.SITE_HARNESS_CHILD
  t.after(() => {
    if (saved === undefined) delete process.env.SITE_HARNESS_CHILD
    else process.env.SITE_HARNESS_CHILD = saved
  })
  const writes = []
  const write = process.stdout.write
  process.stdout.write = chunk => writes.push(String(chunk)) > 0
  try {
    delete process.env.SITE_HARNESS_CHILD
    assert.equal(await childMain(encodeRunSettings({})), EXIT.refused)
    process.env.SITE_HARNESS_CHILD = '1'
    assert.equal(await childMain('not-settings'), EXIT.refused)
  } finally {
    process.stdout.write = write
  }
  assert.match(writes[0], /^hermetic-guard: refused: the run was started outside its launcher/)
  assert.match(writes[1], /^hermetic-guard: refused: /)
})

test("Node's fetch in the run's environment goes to the proxy sink and fails, with no warning printed; nothing else of the caller's environment arrives", async t => {
  const dir = tempDir(t, 'site-harness-probe-')
  const sink = await startSink()
  t.after(() => sink.close())
  const env = buildChildEnv({
    parentEnv: { ...process.env, SOME_CALLER_SETTING: 'x' },
    platform: process.platform,
    runtimeDir: path.join(dir, '.runtime'),
    tmpDir: dir,
    sinkPort: sink.port,
  })
  const options = { ...childSpawnOptions({ env, cwd: dir, platform: process.platform }), stdio: ['ignore', 'pipe', 'pipe'] }
  // With the run's own Node options, as the launcher starts it
  const child = spawn(process.execPath, [...RUN_NODE_OPTIONS, path.join(harnessDir, 'support', 'probe-in-env.mjs'), 'https://guard-test.invalid/'], options)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => (stdout += chunk))
  child.stderr.on('data', chunk => (stderr += chunk))
  const code = await new Promise(resolve => child.on('exit', resolve))
  assert.equal(code, 0, stderr)
  assert.doesNotMatch(stderr, /EnvHttpProxyAgent|UNDICI-EHPA|Warning:/, 'no experimental-feature warning on every run')
  const { probe, envNames } = JSON.parse(stdout)
  assert.equal(probe.reached, false)
  assert.ok(sink.dropped() >= 1, `the request went to the sink (${probe.detail})`)
  const allowed = allowedEnvNames(process.platform)
  const normalize = name => (process.platform === 'win32' ? name.toUpperCase() : name)
  assert.deepEqual(
    envNames.filter(name => !allowed.has(normalize(name)) && !name.startsWith('=')),
    [],
  )
})

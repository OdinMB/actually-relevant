/**
 * The launcher, up to the point where it would start the run: parameters it refuses, how the run's
 * process is started, and that Node's fetch in the run's environment goes to the proxy sink. The
 * run itself is never started here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { allowedEnvNames, buildChildEnv, EXIT } from '../lib/guard.mjs'
import { CHILD_FLAG, childArgs, childSpawnOptions, decodeRunSettings, encodeRunSettings, launch, resolveChrome, USAGE } from '../lib/launcher.mjs'
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

test('the run settings travel on the command line and are refused when malformed', () => {
  const settings = {
    opts: { routes: ['/'] },
    outDir: path.resolve('/out'),
    runtimeDir: path.resolve('/out/.runtime'),
    sinkPort: 40001,
    chrome: path.resolve('/opt/chrome'),
  }
  assert.deepEqual(decodeRunSettings(encodeRunSettings(settings)), settings)
  const refused = [
    undefined,
    'not base64 at all!',
    encodeRunSettings({ ...settings, outDir: 'relative/out' }),
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
  assert.deepEqual(args.slice(1, 3), [path.join(harnessDir, 'run.mjs'), CHILD_FLAG])
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

test("Node's fetch in the run's environment goes to the proxy sink and fails; nothing else of the caller's environment arrives", async t => {
  const dir = tempDir(t, 'site-harness-probe-')
  const sink = await startSink()
  t.after(() => sink.close())
  const env = buildChildEnv({
    parentEnv: { ...process.env, SOME_CALLER_SETTING: 'x' },
    platform: process.platform,
    runtimeDir: path.join(dir, '.runtime'),
    sinkPort: sink.port,
  })
  const options = { ...childSpawnOptions({ env, cwd: dir, platform: process.platform }), stdio: ['ignore', 'pipe', 'pipe'] }
  const child = spawn(process.execPath, [path.join(harnessDir, 'support', 'probe-in-env.mjs'), 'https://guard-test.invalid/'], options)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => (stdout += chunk))
  child.stderr.on('data', chunk => (stderr += chunk))
  const code = await new Promise(resolve => child.on('exit', resolve))
  assert.equal(code, 0, stderr)
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

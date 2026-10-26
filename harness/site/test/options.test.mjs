import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkoutRoots, OUT_MARKER, OUTPUT_FILES, parseArgs, parseSteps, planSteps, prepareOutDir, stepLabel, UsageError } from '../lib/options.mjs'
import { repoRoot } from '../lib/paths.mjs'

test('defaults: phone and desktop, the homepage, full-page screenshots', () => {
  const opts = parseArgs(['--out', '/tmp/x'])
  assert.deepEqual(
    opts.viewports.map(v => [v.name, v.width, v.height, v.isMobile]),
    [
      ['phone', 390, 844, true],
      ['desktop', 1440, 900, false],
    ],
  )
  assert.deepEqual(opts.routes, ['/'])
  assert.equal(opts.fullPage, true)
  assert.equal(opts.timeoutSec, 300)
  assert.equal(opts.guardTest, undefined)
})

test('every parameter, in both spellings', () => {
  const opts = parseArgs([
    '--out=/tmp/x',
    '--route',
    '/newsletter',
    '--route=/stories/some-slug?ref=a',
    '--viewport',
    'phone',
    '--viewport=768x1024',
    '--steps',
    'steps.json',
    '--chrome',
    '/opt/chrome',
    '--fail',
    '/api/homepage=500',
    '--fail=/api/subscribe=503:SIGNUPS_PAUSED',
    '--fail',
    '/api/stories/*=drop',
    '--delay',
    '/api/podcast=2500',
    '--timeout',
    '120',
    '--step-timeout=10',
    '--viewport-only',
    '--guard-test=target',
  ])
  assert.deepEqual(opts.routes, ['/newsletter', '/stories/some-slug?ref=a'])
  assert.deepEqual(
    opts.viewports.map(v => v.name),
    ['phone', '768x1024'],
  )
  assert.equal(opts.stepsFile, 'steps.json')
  assert.equal(opts.chrome, '/opt/chrome')
  assert.deepEqual(opts.failures, [
    { path: '/api/homepage', status: 500 },
    { path: '/api/subscribe', status: 503, code: 'SIGNUPS_PAUSED' },
    { path: '/api/stories/*', status: 'drop' },
  ])
  assert.deepEqual(opts.delays, [{ path: '/api/podcast', ms: 2500 }])
  assert.equal(opts.timeoutSec, 120)
  assert.equal(opts.stepTimeoutSec, 10)
  assert.equal(opts.fullPage, false)
  assert.equal(opts.guardTest, 'target')
})

test('--help and --list-routes need no output folder', () => {
  assert.equal(parseArgs(['--help']).help, true)
  assert.equal(parseArgs(['--list-routes']).listRoutes, true)
  assert.throws(() => parseArgs(['--list-routes=yes']), UsageError)
})

test('a steps file without routes visits nothing first', () => {
  assert.deepEqual(parseArgs(['--out', '/tmp/x', '--steps', 's.json']).routes, [])
})

test('refused parameters', () => {
  const refused = [
    [],
    ['--out'],
    ['--out', '/tmp/x', '--route', 'https://actuallyrelevant.news/'],
    ['--out', '/tmp/x', '--route', '//example.com/'],
    ['--out', '/tmp/x', '--route', 'newsletter'],
    ['--out', '/tmp/x', '--url', 'http://127.0.0.1:5173/'],
    ['--out', '/tmp/x', '--viewport', 'tablet'],
    ['--out', '/tmp/x', '--viewport', 'phone', '--viewport', 'phone'],
    ['--out', '/tmp/x', '--fail', '/api/homepage'],
    ['--out', '/tmp/x', '--fail', '/api/homepage=200'],
    ['--out', '/tmp/x', '--fail', 'api/homepage=500'],
    ['--out', '/tmp/x', '--fail', '/api/*/x=500'],
    ['--out', '/tmp/x', '--delay', '/api/homepage=soon'],
    ['--out', '/tmp/x', '--timeout', '0'],
    ['--out', '/tmp/x', '--guard-test=everything'],
    ['--out', '/tmp/x', '--viewport-only=yes'],
  ]
  for (const argv of refused) assert.throws(() => parseArgs(argv), UsageError, argv.join(' '))
})

test('steps: each action, labels and capture', () => {
  const steps = parseSteps({
    steps: [
      { goto: '/newsletter' },
      { click: '::-p-text(Subscribe)', name: 'open signup' },
      { type: 'reader@example.com', into: 'input[type=email]' },
      { press: 'Enter', capture: false },
      { wait: 500 },
      { wait: '[role=status]' },
      { scroll: 'bottom' },
      { scroll: 600 },
      { scroll: 'footer' },
      { hover: 'nav a' },
    ],
  })
  assert.deepEqual(
    steps.map(s => s.action),
    ['goto', 'click', 'type', 'press', 'wait', 'wait', 'scroll', 'scroll', 'scroll', 'hover'],
  )
  assert.deepEqual(steps[2], { action: 'type', text: 'reader@example.com', selector: 'input[type=email]', capture: true })
  assert.equal(steps[3].capture, false)
  assert.deepEqual(steps.map(stepLabel), [
    'newsletter',
    'open-signup',
    'type-input-type-email',
    'press-enter',
    'wait-500',
    'wait-role-status',
    'scroll-bottom',
    'scroll-600',
    'scroll-footer',
    'hover-nav-a',
  ])
  assert.deepEqual(parseSteps([{ goto: '/' }]).length, 1)
  assert.deepEqual(
    planSteps(['/', '/podcast'], steps.slice(0, 1)).map(s => s.path),
    ['/', '/podcast', '/newsletter'],
  )
  assert.equal(stepLabel({ action: 'goto', path: '/' }), 'home')
})

test('refused steps', () => {
  const refused = [
    'not steps',
    { steps: 'x' },
    [{ goto: 'https://example.com/' }],
    [{ goto: '/', click: 'a' }],
    [{ type: 'x' }],
    [{ type: 'x', into: 'input', extra: 1 }],
    [{ click: '' }],
    [{ wait: -1 }],
    [{ scroll: {} }],
    [{ fly: 'away' }],
    [{ goto: '/', capture: 'no' }],
    [null],
  ]
  for (const json of refused) assert.throws(() => parseSteps(json), UsageError, JSON.stringify(json))
})

test('the output folder: outside the repository, new, empty or the harness own', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-test-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))

  assert.throws(() => prepareOutDir(path.join(repoRoot, 'harness-output'), repoRoot), UsageError)
  assert.throws(() => prepareOutDir(path.dirname(repoRoot), repoRoot), UsageError)

  const fresh = prepareOutDir(path.join(base, 'new'), repoRoot)
  assert.ok(fs.existsSync(path.join(fresh, OUT_MARKER)))

  const foreign = path.join(base, 'foreign')
  fs.mkdirSync(path.join(foreign, 'desktop'), { recursive: true })
  assert.throws(() => prepareOutDir(foreign, repoRoot), UsageError)
  assert.ok(fs.existsSync(path.join(foreign, 'desktop')), 'a folder without the marker is left alone')

  for (const name of ['phone', '.runtime/home', '.cache/vite', 'notes']) fs.mkdirSync(path.join(fresh, name), { recursive: true })
  for (const name of OUTPUT_FILES) fs.writeFileSync(path.join(fresh, name), '{}')
  prepareOutDir(fresh, repoRoot)
  assert.deepEqual(fs.readdirSync(fresh).sort(), ['.cache', OUT_MARKER, 'notes'].sort())
})

test('a worktree nested in the main checkout: the output folder must be outside both', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-checkout-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const main = path.join(base, 'main')
  const worktree = path.join(main, '.claude', 'worktrees', 'item')
  fs.mkdirSync(path.join(main, '.git'), { recursive: true })
  fs.mkdirSync(worktree, { recursive: true })
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/item\n')
  assert.deepEqual(checkoutRoots(worktree), [worktree, main])
  assert.throws(() => prepareOutDir(path.join(main, 'harness-out'), worktree), UsageError)
  assert.throws(() => prepareOutDir(path.join(worktree, 'out'), worktree), UsageError)
  assert.ok(fs.existsSync(path.join(prepareOutDir(path.join(base, 'out'), worktree), OUT_MARKER)))
})

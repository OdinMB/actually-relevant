/**
 * The browser side with a stand-in page: the request policy, each step's action, and one
 * viewport's pass through the steps with its captures. No browser starts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  capture,
  captureBaseName,
  createRequestPolicy,
  describeStep,
  driveViewport,
  FIRST_LOAD_TIMEOUT_MS,
  launchBrowser,
  performStep,
  reportUrl,
  watchPage,
} from '../lib/browser.mjs'
import { parseSteps, parseViewport, planSteps } from '../lib/options.mjs'

const siteOrigin = 'http://127.0.0.1:40003'
const apiOrigin = 'http://127.0.0.1:40002'
const startedOrigins = [siteOrigin, apiOrigin]

test('the browser starts over a pipe, from the given binary, with the run environment, its own profile and the network flags', async () => {
  let options
  const puppeteer = { launch: async given => (options = given) }
  const env = { PATH: '/usr/bin', HOME: '/out/.runtime/home' }
  await launchBrowser(puppeteer, {
    chrome: '/opt/chrome',
    sinkPort: 40001,
    allowedPorts: [40003, 40002],
    profileDir: '/out/.runtime/chrome-profile',
    env,
    protocolTimeoutMs: 60_000,
  })
  assert.equal(options.executablePath, '/opt/chrome')
  assert.equal(options.pipe, true, 'no DevTools port is opened')
  assert.equal(options.headless, true)
  assert.equal(options.env, env)
  assert.equal(options.userDataDir, '/out/.runtime/chrome-profile')
  assert.ok(options.args.includes('--proxy-server=http://127.0.0.1:40001'))
  assert.ok(options.args.includes('--proxy-bypass-list=<-loopback>;127.0.0.1:40003;127.0.0.1:40002'), 'the run’s two ports go direct (test/guard.test.mjs)')
  assert.ok(options.args.some(arg => arg.startsWith('--host-resolver-rules=')))
  assert.deepEqual(options.ignoreDefaultArgs, ['--enable-automation'], 'navigator.webdriver stays false')
  assert.equal(options.handleSIGINT, false, 'the run stops the browser itself')
})

function fakeRequest(url, { handled = false } = {}) {
  const calls = []
  return {
    calls,
    url: () => url,
    method: () => 'GET',
    resourceType: () => 'script',
    isInterceptResolutionHandled: () => handled,
    continue: async () => calls.push('continue'),
    abort: async reason => calls.push(`abort:${reason}`),
    failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }),
  }
}

/** A page that records what it was asked to do; `failOn` is a selector that never appears. */
function fakePage({ failOn } = {}) {
  const calls = []
  const handlers = {}
  let current = 'about:blank'
  const locator = selector => {
    const fail = async () => {
      if (selector === failOn) throw new Error(`Waiting for ${selector} failed: timeout exceeded`)
    }
    const loc = {
      setTimeout: timeout => {
        calls.push(['timeout', selector, timeout])
        return loc
      },
      click: async () => {
        await fail()
        calls.push(['click', selector])
      },
      hover: async () => {
        await fail()
        calls.push(['hover', selector])
      },
      fill: async text => {
        await fail()
        calls.push(['fill', selector, text])
      },
    }
    return loc
  }
  return {
    calls,
    handlers,
    on: (event, handler) => (handlers[event] = handler),
    setViewport: async viewport => calls.push(['viewport', viewport.width, viewport.height, viewport.isMobile]),
    setRequestInterception: async on => calls.push(['interception', on]),
    goto: async (url, options) => {
      calls.push(['goto', url, options.timeout])
      current = url
      return { status: () => 200 }
    },
    url: () => current,
    locator,
    keyboard: { press: async key => calls.push(['press', key]) },
    waitForSelector: async (selector, options) => {
      calls.push(['waitForSelector', selector, options.timeout])
      return { scrollIntoView: async () => calls.push(['scrollIntoView', selector]), dispose: async () => {} }
    },
    evaluate: async (fn, arg) => {
      const source = String(fn)
      if (source.includes('innerText')) return 'Visible page text'
      if (source.includes('webdriver')) return false
      if (source.includes('scroll')) calls.push(['scroll', arg])
      return undefined
    },
    waitForNetworkIdle: async () => {},
    waitForFunction: async () => {},
    screenshot: async ({ path: file, fullPage }) => {
      calls.push(['screenshot', path.basename(file), fullPage])
      fs.writeFileSync(file, 'not really a png')
    },
    accessibility: { snapshot: async () => ({ role: 'RootWebArea', name: 'Fixture page' }) },
    title: async () => 'Fixture page',
  }
}

function fakeBrowser(page) {
  const log = []
  return {
    log,
    createBrowserContext: async () => {
      log.push('context')
      return {
        newPage: async () => page,
        close: async () => log.push('context-closed'),
      }
    },
  }
}

test('the request policy lets the run’s own ports through and aborts and reports the rest', () => {
  const blocked = []
  const policy = createRequestPolicy({ startedOrigins, onBlocked: entry => blocked.push(entry) })
  const own = fakeRequest(`${apiOrigin}/api/homepage`)
  policy(own)
  assert.deepEqual(own.calls, ['continue'])
  const outside = fakeRequest('https://scripts.simpleanalyticscdn.com/latest.js')
  policy(outside)
  assert.deepEqual(outside.calls, ['abort:blockedbyclient'])
  assert.deepEqual(blocked, [{ url: 'https://scripts.simpleanalyticscdn.com/latest.js', method: 'GET', resourceType: 'script' }])
  const handled = fakeRequest('https://example.com/', { handled: true })
  policy(handled)
  assert.deepEqual(handled.calls, [])
})

test('each action does what its step says, within the step timeout', async () => {
  const page = fakePage()
  const run = step => performStep(page, step, { siteOrigin, timeoutMs: 1234 })
  assert.deepEqual(await run({ action: 'goto', path: '/newsletter?page=2' }), { status: 200 })
  await run({ action: 'click', selector: 'a.more' })
  await run({ action: 'hover', selector: 'nav a' })
  await run({ action: 'type', selector: 'input[type=email]', text: 'reader@example.com' })
  await run({ action: 'press', key: 'Enter' })
  await run({ action: 'wait', selector: '[role=status]' })
  await run({ action: 'wait', ms: 1 })
  await run({ action: 'scroll', to: 'bottom' })
  await run({ action: 'scroll', by: 600 })
  await run({ action: 'scroll', selector: 'footer' })
  assert.deepEqual(page.calls, [
    ['goto', `${siteOrigin}/newsletter?page=2`, 1234],
    ['timeout', 'a.more', 1234],
    ['click', 'a.more'],
    ['timeout', 'nav a', 1234],
    ['hover', 'nav a'],
    ['timeout', 'input[type=email]', 1234],
    ['fill', 'input[type=email]', 'reader@example.com'],
    ['press', 'Enter'],
    ['waitForSelector', '[role=status]', 1234],
    ['scroll', 'bottom'],
    ['scroll', 600],
    ['waitForSelector', 'footer', 1234],
    ['scrollIntoView', 'footer'],
  ])
  await assert.rejects(run({ action: 'fly' }), /unknown action/)
})

test('report helpers: local paths, step details, numbered file names', () => {
  assert.equal(reportUrl(`${siteOrigin}/stories/x?y=1#z`, siteOrigin), '/stories/x?y=1#z')
  assert.equal(reportUrl('https://example.org/fixture/a', siteOrigin), 'https://example.org/fixture/a')
  assert.deepEqual(describeStep({ action: 'click', selector: 'a', capture: true, name: 'open' }), { action: 'click', selector: 'a' })
  assert.equal(captureBaseName(0, { action: 'goto', path: '/' }), '01-home')
  assert.equal(captureBaseName(11, { action: 'click', selector: 'a.more', name: 'Read more' }), '12-read-more')
})

test('one viewport: a fresh context, its size and the request block before the first page, captures per step, stop at the first failure', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-drive-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const page = fakePage({ failOn: '.missing' })
  const browser = fakeBrowser(page)
  const events = { blocked: [], console: [] }
  const steps = planSteps(
    ['/'],
    parseSteps([{ click: 'a.more', capture: false }, { type: 'x@example.com', into: 'input' }, { click: '.missing' }, { goto: '/never' }]),
  )
  const result = await driveViewport(browser, {
    viewport: parseViewport('phone'),
    steps,
    siteOrigin,
    startedOrigins,
    outDir: out,
    fullPage: true,
    stepTimeoutMs: 1000,
    events,
  })
  assert.deepEqual(browser.log, ['context', 'context-closed'])
  assert.deepEqual(
    page.calls.slice(0, 3),
    [
      ['viewport', 390, 844, true],
      ['interception', true],
      ['goto', `${siteOrigin}/`, FIRST_LOAD_TIMEOUT_MS],
    ],
    'the first page may wait for Vite; later steps get the step timeout',
  )
  assert.ok(page.calls.some(call => call[0] === 'timeout' && call[1] === 'a.more' && call[2] === 1000))
  assert.deepEqual(
    result.steps.map(s => [s.index, s.label, s.error ?? null, s.files ?? null]),
    [
      [1, 'home', null, ['phone/01-home.png', 'phone/01-home.txt', 'phone/01-home.a11y.json']],
      [2, 'click-a-more', null, null],
      [3, 'type-input', null, ['phone/03-type-input.png', 'phone/03-type-input.txt', 'phone/03-type-input.a11y.json']],
      [
        4,
        'click-missing',
        'Waiting for .missing failed: timeout exceeded',
        ['phone/04-click-missing.png', 'phone/04-click-missing.txt', 'phone/04-click-missing.a11y.json'],
      ],
    ],
  )
  assert.equal(result.skippedSteps, 1)
  assert.equal(result.webdriver, false)
  assert.equal(result.steps[0].url, '/')
  assert.equal(result.steps[0].title, 'Fixture page')
  assert.equal(fs.readFileSync(path.join(out, 'phone', '01-home.txt'), 'utf8'), 'Visible page text')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'phone', '01-home.a11y.json'), 'utf8')), { role: 'RootWebArea', name: 'Fixture page' })
  assert.ok(!page.calls.some(call => call[0] === 'goto' && call[1].endsWith('/never')), 'nothing runs after the failed step')
})

/** What Chrome answers while a navigation swaps the page's document, such as a failed load committing its error page. */
const NOT_ACTIVE = 'Protocol error (Page.captureScreenshot): Not attached to an active page'

/** Makes the fake page's `method` (or `accessibility.snapshot`) throw `error` on its first `times` calls; returns a call counter. */
function failing(page, method, error, times = Infinity) {
  const owner = method === 'snapshot' ? page.accessibility : page
  const original = owner[method]
  let calls = 0
  owner[method] = async (...args) => {
    calls++
    if (calls <= times) throw new Error(error)
    return original(...args)
  }
  return () => calls
}

test('a capture waits out a page between two documents, then takes every part', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-capture-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const page = fakePage()
  const screenshots = failing(page, 'screenshot', NOT_ACTIVE, 2)
  const result = await capture(page, { dir: out, base: '01-home', fullPage: true })
  assert.equal(screenshots(), 3, 'refused twice while the page was between documents, then taken')
  assert.deepEqual(result, { files: ['01-home.png', '01-home.txt', '01-home.a11y.json'], title: 'Fixture page', errors: {} })
  assert.ok(fs.existsSync(path.join(out, '01-home.png')))
})

test('a part the capture cannot take is recorded under its name, and the other parts are kept', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-capture-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const page = fakePage()
  const screenshots = failing(page, 'screenshot', 'Protocol error (Page.captureScreenshot): Unable to capture screenshot')
  const result = await capture(page, { dir: out, base: '02-x', fullPage: true })
  assert.equal(screenshots(), 1, 'an error that is not about a document swap is not tried again')
  assert.deepEqual(result, {
    files: ['02-x.txt', '02-x.a11y.json'],
    title: 'Fixture page',
    errors: { screenshot: 'Protocol error (Page.captureScreenshot): Unable to capture screenshot' },
  })
  assert.equal(fs.readFileSync(path.join(out, '02-x.txt'), 'utf8'), 'Visible page text')
})

test('a page that never leaves the in-between state: the capture stops waiting at its bound, records every part and throws nothing', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-capture-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const page = fakePage()
  for (const method of ['screenshot', 'evaluate', 'snapshot', 'title']) failing(page, method, NOT_ACTIVE)
  const started = Date.now()
  const result = await capture(page, { dir: out, base: '03-x', fullPage: true, waitMs: 60 })
  assert.ok(Date.now() - started < 2000, 'bounded by waitMs')
  assert.deepEqual(result.files, [])
  assert.equal(result.title, undefined)
  assert.deepEqual(Object.keys(result.errors), ['screenshot', 'text', 'accessibility', 'title'])
  assert.ok(Object.values(result.errors).every(error => error === NOT_ACTIVE))
  assert.deepEqual(fs.readdirSync(out), [])
})

test('a closed page is not waited for', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-capture-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const page = fakePage()
  page.isClosed = () => true
  const screenshots = failing(page, 'screenshot', NOT_ACTIVE)
  const result = await capture(page, { dir: out, base: '04-x', fullPage: true })
  assert.equal(screenshots(), 1)
  assert.equal(result.errors.screenshot, NOT_ACTIVE)
})

test('a page load that fails is captured as it left the page, once the error page has committed', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-drive-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const page = fakePage()
  page.goto = async url => {
    throw new Error(`net::ERR_CONNECTION_RESET at ${url}`)
  }
  failing(page, 'screenshot', NOT_ACTIVE, 1)
  const result = await driveViewport(fakeBrowser(page), {
    viewport: parseViewport('desktop'),
    steps: planSteps(['/', '/newsletter']),
    siteOrigin,
    startedOrigins,
    outDir: out,
    fullPage: true,
    stepTimeoutMs: 1000,
    events: { blocked: [], console: [] },
  })
  assert.equal(result.steps.length, 1)
  assert.equal(result.steps[0].error, `net::ERR_CONNECTION_RESET at ${siteOrigin}/`)
  assert.deepEqual(result.steps[0].files, ['desktop/01-home.png', 'desktop/01-home.txt', 'desktop/01-home.a11y.json'])
  assert.equal(result.steps[0].captureErrors, undefined)
  assert.equal(result.skippedSteps, 1)
})

test('what a failed step could not capture is in its report entry', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-drive-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const page = fakePage({ failOn: '.missing' })
  failing(page, 'screenshot', 'Protocol error (Page.captureScreenshot): Unable to capture screenshot')
  const result = await driveViewport(fakeBrowser(page), {
    viewport: parseViewport('phone'),
    steps: planSteps([], parseSteps([{ click: '.missing' }])),
    siteOrigin,
    startedOrigins,
    outDir: out,
    fullPage: true,
    stepTimeoutMs: 1000,
    events: { blocked: [], console: [] },
  })
  assert.deepEqual(result.steps[0].files, ['phone/01-click-missing.txt', 'phone/01-click-missing.a11y.json'])
  assert.deepEqual(result.steps[0].captureErrors, { screenshot: 'Protocol error (Page.captureScreenshot): Unable to capture screenshot' })
})

test('the page watch reports blocked requests, console errors, failed requests and popups by viewport and step', () => {
  const page = fakePage()
  const events = { blocked: [], console: [] }
  watchPage(page, { startedOrigins, siteOrigin, events, where: () => ({ viewport: 'desktop', step: 2 }) })
  page.handlers.request(fakeRequest('https://challenges.cloudflare.com/turnstile/v0/api.js'))
  page.handlers.console({ type: () => 'error', text: () => 'Failed to load resource', location: () => ({ url: `${siteOrigin}/src/main.tsx`, lineNumber: 4 }) })
  page.handlers.console({ type: () => 'log', text: () => '[vite] connected.', location: () => ({}) })
  page.handlers.pageerror(new Error('Boom\n    at somewhere'))
  page.handlers.requestfailed(fakeRequest(`${apiOrigin}/api/stories/x`))
  page.handlers.requestfailed(fakeRequest('https://example.com/blocked-already'))
  let closed = false
  page.handlers.popup({ url: () => 'https://bsky.app/profile/fixture', close: async () => (closed = true) })
  assert.deepEqual(events.blocked, [
    { viewport: 'desktop', step: 2, url: 'https://challenges.cloudflare.com/turnstile/v0/api.js', method: 'GET', resourceType: 'script' },
    { viewport: 'desktop', step: 2, url: 'https://bsky.app/profile/fixture', method: 'GET', resourceType: 'popup' },
  ])
  assert.deepEqual(events.console, [
    { viewport: 'desktop', step: 2, type: 'error', text: 'Failed to load resource', source: '/src/main.tsx', line: 4 },
    { viewport: 'desktop', step: 2, type: 'pageerror', text: 'Boom' },
    { viewport: 'desktop', step: 2, type: 'requestfailed', text: `GET ${apiOrigin}/api/stories/x: net::ERR_CONNECTION_RESET` },
  ])
  assert.equal(closed, true)
})

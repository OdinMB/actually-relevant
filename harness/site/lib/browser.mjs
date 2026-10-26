/**
 * The browser side of a run: headless Chrome through Puppeteer (the client's own devDependency).
 * Every request not to a port the run started is blocked and reported; each viewport gets a fresh
 * browser context, walks the steps, and after each step saves a screenshot, the page's text and
 * its accessibility tree under the output folder.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROUTE_FALLBACK_ATTR } from '../../../client/src/lib/renderComplete.ts'
import { chromeArgs, GUARD_TEST_NETWORK_URL, isAllowedRequest } from './guard.mjs'
import { stepLabel } from './options.mjs'

/** How long the page must make no request before a step counts as settled. */
const NETWORK_IDLE_MS = 500
/** A last pause after settling, for transitions that start once data arrives. */
const SETTLE_PAUSE_MS = 250
/** The first page of a viewport may wait while Vite prepares the client's dependencies. */
export const FIRST_LOAD_TIMEOUT_MS = 120_000

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function message(err) {
  return err instanceof Error ? err.message.split('\n')[0] : String(err)
}

/**
 * Launches the browser over a pipe (no DevTools port is opened), with the run's cleared
 * environment, a profile under the output folder, and the flags that send every request but the
 * run's own ports to the proxy sink.
 */
export function launchBrowser(puppeteer, { chrome, sinkPort, allowedPorts, profileDir, env, protocolTimeoutMs }) {
  return puppeteer.launch({
    executablePath: chrome,
    headless: true,
    pipe: true,
    userDataDir: profileDir,
    args: chromeArgs({ sinkPort, allowedPorts }),
    // navigator.webdriver stays false (see chromeArgs)
    ignoreDefaultArgs: ['--enable-automation'],
    env,
    defaultViewport: null,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    protocolTimeout: protocolTimeoutMs,
  })
}

/**
 * The page's request handler: lets through only the run's own origins, aborts everything else
 * and reports it through `onBlocked`.
 */
export function createRequestPolicy({ startedOrigins, onBlocked }) {
  return request => {
    if (request.isInterceptResolutionHandled?.()) return
    const url = request.url()
    if (isAllowedRequest(url, startedOrigins)) {
      request.continue().catch(() => {})
      return
    }
    onBlocked({ url, method: request.method(), resourceType: request.resourceType() })
    request.abort('blockedbyclient').catch(() => {})
  }
}

/** A URL as the report shows it: a path for the local site, the whole URL for anything else. */
export function reportUrl(url, siteOrigin) {
  try {
    const parsed = new URL(url)
    return parsed.origin === siteOrigin ? parsed.pathname + parsed.search + parsed.hash : url
  } catch {
    return url
  }
}

/** What a step did, for the report. */
export function describeStep(step) {
  const { action, capture: _capture, name: _name, ...detail } = step
  return { action, ...detail }
}

/** Runs one step on the page. Throws when its element or page does not appear in time. */
export async function performStep(page, step, { siteOrigin, timeoutMs }) {
  switch (step.action) {
    case 'goto': {
      const response = await page.goto(`${siteOrigin}${step.path}`, { waitUntil: 'load', timeout: timeoutMs })
      return { status: response ? response.status() : null }
    }
    case 'click':
      await page.locator(step.selector).setTimeout(timeoutMs).click()
      return {}
    case 'hover':
      await page.locator(step.selector).setTimeout(timeoutMs).hover()
      return {}
    case 'type':
      await page.locator(step.selector).setTimeout(timeoutMs).fill(step.text)
      return {}
    case 'press':
      await page.keyboard.press(step.key)
      return {}
    case 'wait':
      if (step.ms !== undefined) await delay(step.ms)
      else await page.waitForSelector(step.selector, { timeout: timeoutMs })
      return {}
    case 'scroll': {
      if (step.to !== undefined) {
        await page.evaluate(to => window.scrollTo(0, to === 'top' ? 0 : document.documentElement.scrollHeight), step.to)
      } else if (step.by !== undefined) {
        await page.evaluate(by => window.scrollBy(0, by), step.by)
      } else {
        const handle = await page.waitForSelector(step.selector, { timeout: timeoutMs })
        if (!handle) throw new Error(`nothing matches ${step.selector}`)
        await handle.scrollIntoView()
        await handle.dispose()
      }
      return {}
    }
    default:
      throw new Error(`unknown action ${step.action}`)
  }
}

/**
 * Waits until the page has made no request for a moment, no page chunk is still loading (the
 * client's own route-fallback marker), and its fonts are ready. Returns notes on what timed out.
 */
export async function settle(page, timeoutMs) {
  const notes = []
  try {
    await page.waitForNetworkIdle({ idleTime: NETWORK_IDLE_MS, timeout: timeoutMs })
  } catch {
    notes.push(`the page was still making requests after ${Math.round(timeoutMs / 1000)} s`)
  }
  try {
    await page.waitForFunction(attr => document.readyState === 'complete' && !document.querySelector(`[${attr}]`), { timeout: timeoutMs }, ROUTE_FALLBACK_ATTR)
  } catch {
    notes.push('a page chunk was still loading')
  }
  try {
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
  } catch {
    // a navigation replaced the document; the capture waits for the new one
  }
  await delay(SETTLE_PAUSE_MS)
  return notes
}

/** The file names of one step's captures, `NN-label`, numbered from 1. */
export function captureBaseName(index, step) {
  return `${String(index + 1).padStart(2, '0')}-${stepLabel(step)}`
}

/** How long one capture may wait, in all, for a page between two documents to commit the new one. */
export const CAPTURE_WAIT_MS = 10_000
/** The pause before a part is tried again; a wait for the page's requests to calm follows it. */
const CAPTURE_RETRY_PAUSE_MS = 250

/**
 * What Chrome and Puppeteer answer while a navigation swaps the page's document: a failed page load
 * commits Chrome's error page (in another process), a click or a redirect starts a new page. The
 * page is between two documents, and the answer passes once the new one has committed.
 */
function isBetweenDocuments(err) {
  return /not attached to an active page|context was destroyed|cannot find context|navigat|detached/i.test(message(err))
}

/**
 * Saves the screenshot, the visible text and the accessibility tree of the page as it is now, and
 * reads its title. Each part is taken on its own, so a part that fails costs only itself: its error
 * is returned under its name, and the parts that worked are kept. A part refused while the page is
 * between two documents is tried again, within `waitMs` for the whole capture. Never throws.
 */
export async function capture(page, { dir, base, fullPage, waitMs = CAPTURE_WAIT_MS }) {
  const deadline = Date.now() + waitMs
  const files = []
  const errors = {}
  const take = async (part, fn) => {
    for (;;) {
      try {
        return await fn()
      } catch (err) {
        const left = deadline - Date.now()
        if (left <= 0 || !isBetweenDocuments(err) || page.isClosed?.()) {
          errors[part] = message(err)
          return undefined
        }
        await delay(Math.min(CAPTURE_RETRY_PAUSE_MS, left))
        try {
          // Puppeteer reads a timeout of 0 as none
          await page.waitForNetworkIdle({ idleTime: NETWORK_IDLE_MS, timeout: Math.max(1, deadline - Date.now()) })
        } catch {
          // the wait only gives the new document time to load; the next attempt tells
        }
      }
    }
  }
  const save = async (part, file, write) => {
    const saved = await take(part, async () => {
      await write(path.join(dir, file))
      return true
    })
    if (saved) files.push(file)
  }
  await save('screenshot', `${base}.png`, file => page.screenshot({ path: file, fullPage }))
  await save('text', `${base}.txt`, async file => fs.writeFileSync(file, await page.evaluate(() => document.body?.innerText ?? '')))
  await save('accessibility', `${base}.a11y.json`, async file => {
    const tree = await page.accessibility.snapshot({ interestingOnly: true })
    fs.writeFileSync(file, `${JSON.stringify(tree, null, 2)}\n`)
  })
  const title = await take('title', () => page.title())
  return { files, title, errors }
}

/** Watches one page: blocked requests, console errors and warnings, page errors, failed requests, popups. */
export function watchPage(page, { startedOrigins, siteOrigin, events, where }) {
  page.on(
    'request',
    createRequestPolicy({
      startedOrigins,
      onBlocked: request => events.blocked.push({ ...where(), ...request }),
    }),
  )
  page.on('console', msg => {
    const type = msg.type()
    if (type !== 'error' && type !== 'warn') return
    const location = msg.location()
    events.console.push({
      ...where(),
      type,
      text: msg.text(),
      ...(location?.url ? { source: reportUrl(location.url, siteOrigin), line: location.lineNumber } : {}),
    })
  })
  page.on('pageerror', err => events.console.push({ ...where(), type: 'pageerror', text: message(err) }))
  page.on('requestfailed', request => {
    const url = request.url()
    // A request the policy blocked is already reported as blocked
    if (!isAllowedRequest(url, startedOrigins)) return
    events.console.push({
      ...where(),
      type: 'requestfailed',
      text: `${request.method()} ${reportUrl(url, siteOrigin)}: ${request.failure()?.errorText ?? 'failed'}`,
    })
  })
  page.on('popup', popup => {
    if (!popup) return
    events.blocked.push({ ...where(), url: popup.url(), method: 'GET', resourceType: 'popup' })
    popup.close().catch(() => {})
  })
}

/**
 * One viewport's pass through the steps, in a fresh browser context (no storage carried over).
 * Stops at the first step that fails, after capturing the page as that step left it.
 */
export async function driveViewport(browser, { viewport, steps, siteOrigin, startedOrigins, outDir, fullPage, stepTimeoutMs, events }) {
  const context = await browser.createBrowserContext()
  const result = { name: viewport.name, width: viewport.width, height: viewport.height, steps: [] }
  try {
    const page = await context.newPage()
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
    })
    await page.setRequestInterception(true)
    let current = 0
    watchPage(page, { startedOrigins, siteOrigin, events, where: () => ({ viewport: viewport.name, step: current }) })
    const dir = path.join(outDir, viewport.name)
    fs.mkdirSync(dir, { recursive: true })

    let loaded = false
    for (const [index, step] of steps.entries()) {
      current = index + 1
      const entry = { index: index + 1, label: stepLabel(step), ...describeStep(step), notes: [] }
      const timeoutMs = step.action === 'goto' && !loaded ? Math.max(stepTimeoutMs, FIRST_LOAD_TIMEOUT_MS) : stepTimeoutMs
      try {
        Object.assign(entry, await performStep(page, step, { siteOrigin, timeoutMs }))
        if (step.action === 'goto') loaded = true
        entry.notes = await settle(page, timeoutMs)
      } catch (err) {
        entry.error = message(err)
      }
      entry.url = reportUrl(page.url(), siteOrigin)
      if (step.capture || entry.error) {
        const { files, title, errors } = await capture(page, { dir, base: captureBaseName(index, step), fullPage })
        entry.files = files.map(file => `${viewport.name}/${file}`)
        if (title !== undefined) entry.title = title
        if (Object.keys(errors).length > 0) entry.captureErrors = errors
      }
      result.steps.push(entry)
      if (entry.error) {
        result.skippedSteps = steps.length - index - 1
        break
      }
    }
    // The client treats a webdriver browser as its prerenderer and hides API error states then
    result.webdriver = await page.evaluate(() => navigator.webdriver).catch(() => null)
  } finally {
    await context.close().catch(() => {})
  }
  return result
}

/** The `network` case's browser probe: one GET to the off-machine target, which must fail. */
export async function probeFromBrowser(browser, { startedOrigins, siteOrigin, events, timeoutMs }) {
  const context = await browser.createBrowserContext()
  try {
    const page = await context.newPage()
    await page.setRequestInterception(true)
    watchPage(page, { startedOrigins, siteOrigin, events, where: () => ({ viewport: null, step: 'guard-test network' }) })
    try {
      const response = await page.goto(GUARD_TEST_NETWORK_URL, { waitUntil: 'load', timeout: timeoutMs })
      return { from: 'the browser', reached: true, detail: `HTTP ${response ? response.status() : 'answer'}` }
    } catch (err) {
      return { from: 'the browser', reached: false, detail: message(err) }
    }
  } finally {
    await context.close().catch(() => {})
  }
}

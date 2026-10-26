/**
 * The Vite side of the guard, on the client's real vite.config.ts: it is loaded and resolved as the
 * run does it (no server is created, nothing listens, no browser starts), and the guard's config
 * check must accept the result and refuse it once a negative-test target is planted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkSiteConfig, GUARD_TEST_TARGETS, PRERENDER_PLUGIN_NAME } from '../lib/guard.mjs'
import { clientDir, importFromClient } from '../lib/paths.mjs'
import { buildInlineConfig, configWrapperSource, loadProductConfig, prepareSite } from '../lib/site.mjs'

const apiOrigin = 'http://127.0.0.1:40002'
const sitePort = 40003
const siteOrigin = `http://127.0.0.1:${sitePort}`
const hmrServer = { name: 'the site server' }

test('the wrapper re-exports the client config by a relative path', () => {
  const source = configWrapperSource(path.join('/out', '.runtime', 'vite-config'), path.join('/repo', 'client', 'vite.config.ts'))
  assert.match(source, /export \{ default \} from "\.\.\/\.\.\/\.\.\/repo\/client\/vite\.config\.ts"/)
})

test('the overrides drop the dev proxy to :3001 and the prerender plugin, and keep the rest', () => {
  const product = {
    resolve: { alias: { '@shared': '/repo/shared' } },
    define: { __BUILD_ID__: '"x"' },
    plugins: [{ name: 'html-transform' }, [{ name: 'vite:react-babel' }], { name: PRERENDER_PLUGIN_NAME }],
    server: { proxy: { '/api': 'http://localhost:3001' }, headers: { 'X-Kept': '1' } },
    test: { environment: 'jsdom' },
  }
  const inline = buildInlineConfig(product, { clientDir: '/repo/client', cacheDir: '/out/.cache/vite', apiOrigin, sitePort, hmrServer })
  assert.deepEqual(
    inline.plugins.map(p => p.name),
    ['html-transform', 'vite:react-babel'],
  )
  assert.deepEqual(inline.server.proxy, { '/api': { target: apiOrigin, changeOrigin: false } })
  assert.deepEqual(inline.server.headers, { 'X-Kept': '1' })
  assert.equal(inline.server.watch, null)
  assert.equal(inline.server.middlewareMode, true)
  assert.equal(inline.envDir, false)
  assert.equal(inline.configFile, false)
  assert.equal(inline.test, undefined)
  assert.deepEqual(inline.resolve, product.resolve)
})

test("Vite logs through the run's logger, which falls silent once the run closes Vite, so a dependency scan the close cuts off prints nothing", async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-logger-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const printed = []
  const viteLogger = {
    hasWarned: false,
    info: msg => printed.push(`info: ${msg}`),
    warn: msg => {
      viteLogger.hasWarned = true
      printed.push(`warn: ${msg}`)
    },
    warnOnce: msg => printed.push(`warnOnce: ${msg}`),
    error: msg => printed.push(`error: ${msg}`),
    clearScreen: () => {},
    hasErrorLogged: () => false,
  }
  // A stand-in for Vite whose server logs through the configured logger, as Vite's does; its close
  // cuts off a dependency scan, which then logs its failure
  const vite = {
    loadConfigFromFile: async () => ({ config: { plugins: [] } }),
    createLogger: level => {
      assert.equal(level, 'warn')
      return viteLogger
    },
    resolveConfig: async inline => inline,
    createServer: async inline => ({
      config: inline,
      middlewares: () => {},
      close: async () => {
        await new Promise(resolve => setImmediate(resolve))
        inline.customLogger.error('(!) Failed to run dependency scan. Error: The server is being restarted or closed. Request is outdated')
      },
    }),
  }
  const prepared = await prepareSite(vite, {
    clientDir,
    wrapperDir: path.join(base, 'vite-config'),
    cacheDir: path.join(base, 'cache'),
    apiOrigin,
    sitePort,
    hmrServer,
  })
  const server = await prepared.create()
  const logger = server.config.customLogger
  logger.warn('a warning while the run works')
  logger.error('an error while the run works')
  assert.equal(logger.hasWarned, true)
  await server.close()
  for (const level of ['info', 'warn', 'warnOnce', 'error']) logger[level](`a late ${level}`)
  assert.deepEqual(printed, ['warn: a warning while the run works', 'error: an error while the run works'])
})

test('the client config, loaded and resolved as the run does it, passes the guard; a planted target is refused', async t => {
  const vite = await importFromClient('vite')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'site-harness-config-'))
  const saved = { VITE_API_URL: process.env.VITE_API_URL, VITE_TURNSTILE_SITE_KEY: process.env.VITE_TURNSTILE_SITE_KEY }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(base, { recursive: true, force: true })
  })
  // Only the fixture names reach import.meta.env: other VITE_ variables of this shell are cleared
  for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key]

  const wrapperDir = path.join(base, '.runtime', 'vite-config')
  const product = await loadProductConfig(vite, { clientDir, wrapperDir })
  assert.ok(
    product.plugins.flat(Infinity).some(p => p?.name === PRERENDER_PLUGIN_NAME),
    'the real config was loaded',
  )
  assert.equal(product.server.proxy['/api'], 'http://localhost:3001')
  assert.deepEqual(fs.readdirSync(path.join(wrapperDir, 'node_modules')).sort(), ['.vite-temp'], "Vite's temporary file stays under the output folder")

  const resolve = async apiUrl => {
    process.env.VITE_API_URL = apiUrl
    process.env.VITE_TURNSTILE_SITE_KEY = ''
    const inline = buildInlineConfig(product, { clientDir, cacheDir: path.join(base, '.cache', 'vite'), apiOrigin, sitePort, hmrServer })
    return vite.resolveConfig(inline, 'serve')
  }

  assert.deepEqual(checkSiteConfig(await resolve(apiOrigin), { apiOrigin, siteOrigin, hmrServer }), [])
  for (const planted of Object.values(GUARD_TEST_TARGETS)) {
    const problems = checkSiteConfig(await resolve(planted), { apiOrigin, siteOrigin, hmrServer })
    assert.ok(
      problems.some(p => p.startsWith('VITE_API_URL')),
      `${planted}: ${problems.join('; ')}`,
    )
  }

  // As the run prepares it, with real Vite: the resolved config logs through the run's logger
  process.env.VITE_API_URL = apiOrigin
  const prepared = await prepareSite(vite, { clientDir, wrapperDir, cacheDir: path.join(base, '.cache', 'vite'), apiOrigin, sitePort, hmrServer })
  const resolved = await prepared.resolve()
  assert.deepEqual(checkSiteConfig(resolved, { apiOrigin, siteOrigin, hmrServer }), [])
  assert.ok(resolved.customLogger, "the run's logger is in the config")
  assert.equal(resolved.logger, resolved.customLogger, 'and Vite logs through it')
  assert.equal(fs.existsSync(path.join(base, '.cache')), false, 'resolving writes no cache')
})

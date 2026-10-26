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
import { buildInlineConfig, configWrapperSource, loadProductConfig } from '../lib/site.mjs'

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
  assert.equal(fs.existsSync(path.join(base, '.cache')), false, 'resolving writes no cache')
})

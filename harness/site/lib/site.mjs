/**
 * Serving the client through Vite, from the client's own vite.config.ts, with the harness's
 * overrides: no env files, no prerender, no dev proxy to the real API, HMR on the site's own port,
 * no file watching, and Vite's caches under the output folder. Vite runs in middleware mode behind
 * a listener the harness opens itself on 127.0.0.1, which answers 503 until the guard has passed.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { PRERENDER_PLUGIN_NAME } from './guard.mjs'

/**
 * A one-line config module that re-exports the client's. Vite bundles a config into a temporary
 * file in the nearest node_modules; loading this wrapper from `<out>/.runtime/vite-config/`, which
 * has an empty node_modules of its own, puts that file under the output folder.
 */
export function configWrapperSource(wrapperDir, productConfigPath) {
  let spec = path.relative(wrapperDir, productConfigPath)
  if (path.isAbsolute(spec)) spec = productConfigPath // another drive on Windows
  spec = spec.split(path.sep).join('/')
  if (!spec.startsWith('.') && !spec.startsWith('/') && !/^[A-Za-z]:\//.test(spec)) spec = `./${spec}`
  return `// Written by harness/site for one run: the client's own Vite config\nexport { default } from ${JSON.stringify(spec)}\n`
}

/** Loads client/vite.config.ts as `vite dev` would, through the wrapper. */
export async function loadProductConfig(vite, { clientDir, wrapperDir }) {
  fs.mkdirSync(path.join(wrapperDir, 'node_modules'), { recursive: true })
  const wrapper = path.join(wrapperDir, 'vite.config.mjs')
  fs.writeFileSync(wrapper, configWrapperSource(wrapperDir, path.join(clientDir, 'vite.config.ts')))
  const loaded = await vite.loadConfigFromFile({ command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false }, wrapper, clientDir, 'warn')
  if (!loaded) throw new Error('could not load client/vite.config.ts')
  return loaded.config
}

function isPrerenderPlugin(plugin) {
  return plugin !== null && typeof plugin === 'object' && !Array.isArray(plugin) && plugin.name === PRERENDER_PLUGIN_NAME
}

/** The client's config with the harness's overrides; `configFile: false`, so nothing reloads it. */
export function buildInlineConfig(productConfig, { clientDir, cacheDir, apiOrigin, sitePort, hmrServer }) {
  const { test: _vitest, server: productServer = {}, plugins = [], ...rest } = productConfig
  const { proxy: _productProxy, ...server } = productServer
  return {
    ...rest,
    configFile: false,
    root: clientDir,
    mode: 'development',
    envDir: false,
    cacheDir,
    logLevel: 'warn',
    clearScreen: false,
    appType: 'spa',
    plugins: plugins.flat(Infinity).filter(plugin => !isPrerenderPlugin(plugin)),
    server: {
      ...server,
      middlewareMode: true,
      host: '127.0.0.1',
      port: sitePort,
      strictPort: true,
      open: false,
      // Same-origin /api calls, if any, reach the fixture API, never the dev server on :3001
      proxy: { '/api': { target: apiOrigin, changeOrigin: false } },
      hmr: { server: hmrServer, port: sitePort, clientPort: sitePort },
      // null switches Vite's file watcher off (mergeConfig would drop it, so it is set here)
      watch: null,
    },
  }
}

/**
 * The Vite side of one run, from the client's own config with the harness's overrides. The run
 * calls `resolve()` for the guard to check before any server exists, then `create()`, whose
 * `config` the guard checks again before the site answers a request.
 */
export async function prepareSite(vite, { clientDir, wrapperDir, cacheDir, apiOrigin, sitePort, hmrServer }) {
  const productConfig = await loadProductConfig(vite, { clientDir, wrapperDir })
  const inline = buildInlineConfig(productConfig, { clientDir, cacheDir, apiOrigin, sitePort, hmrServer })
  return {
    resolve: () => vite.resolveConfig(inline, 'serve'),
    create: async () => {
      const server = await vite.createServer(inline)
      return { config: server.config, middlewares: server.middlewares, close: () => server.close() }
    },
  }
}

/** The site listener: 127.0.0.1 at a port the OS picks, 503 until `serve()` hands it Vite. */
export function startSiteListener() {
  let handler = null
  const server = http.createServer((req, res) => {
    if (!handler) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' })
      res.end('The site harness is not ready.')
      return
    }
    handler(req, res)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        server,
        port,
        origin: `http://127.0.0.1:${port}`,
        serve: fn => (handler = fn),
        close: () =>
          new Promise(done => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}

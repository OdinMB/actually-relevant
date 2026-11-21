/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import prerender from '@prerenderer/rollup-plugin'
import { routePaths } from './src/routes'
import { BRAND } from './src/config'
import { PRERENDER_FLAG } from './src/lib/prerenderFlag'
import path from 'path'

// Plugin to inject preconnect for cross-origin API and brand copy
function htmlTransformPlugin(): Plugin {
  return {
    name: 'html-transform',
    transformIndexHtml(html) {
      // Inject brand description (meta description and og:description)
      html = html.replaceAll('__BRAND_DESCRIPTION__', `${BRAND.claim} ${BRAND.claimSupport}`)

      // Inject preconnect for cross-origin API
      const apiUrl = process.env.VITE_API_URL
      if (apiUrl) {
        const origin = new URL(apiUrl).origin
        const preconnectTags = `
    <link rel="preconnect" href="${origin}" crossorigin />
    <link rel="dns-prefetch" href="${origin}" />`
        html = html.replace('<head>', '<head>' + preconnectTags)
      }

      return html
    },
  }
}

// One id per build: compiled into the bundle and written to dist/version.json, so an open admin tab
// can notice that a newer build is deployed (client/src/lib/buildVersion.ts).
const BUILD_ID = Date.now().toString(36)

function buildVersionPlugin(): Plugin {
  return {
    name: 'build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId: BUILD_ID }) })
    },
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  plugins: [
    htmlTransformPlugin(),
    buildVersionPlugin(),
    react(),
    prerender({
      routes: routePaths,
      renderer: '@prerenderer/renderer-puppeteer',
      rendererOptions: {
        maxConcurrentRoutes: 1,
        renderAfterDocumentEvent: 'render-complete',
        // Tells the page it is being prerendered (isPrerendering() in src/lib/renderComplete.ts), set before its scripts run
        injectProperty: PRERENDER_FLAG,
        inject: true,
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        },
      },
      postProcess(renderedRoute) {
        if (!renderedRoute.html.startsWith('<!DOCTYPE')) {
          renderedRoute.html = '<!DOCTYPE html>' + renderedRoute.html
        }

        // Preload homepage API data to avoid JS→API chain
        const apiUrl = process.env.VITE_API_URL
        if (renderedRoute.route === '/' && apiUrl) {
          const preloadTag = `<link rel="preload" href="${apiUrl}/api/homepage" as="fetch" crossorigin />`
          renderedRoute.html = renderedRoute.html.replace('</head>', preloadTag + '\n</head>')
        }

        return renderedRoute
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Let Rollup handle chunking automatically. Admin code will be
        // code-split via React.lazy() dynamic imports in App.tsx.
        // No manualChunks needed - this avoids the React internals issue
        // where admin-vendor would pull in shared React code.
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Tests see the defaults, not a local `.env` (which Vite also loads in test mode): an API address
    // there turns every same-origin `/api/...` the tests expect into `http://localhost:3001/api/...`
    env: { VITE_API_URL: '', VITE_TURNSTILE_SITE_KEY: '' },
    // `npm run test:coverage` (CI): a ratchet set just below the coverage measured when it was
    // introduced. Raise a threshold when coverage rises; never lower one to land a change.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
      // Measured 2026-10-25: statements 53.42, branches 53.68, functions 44.12, lines 53.53; raised the
      // same day with the newsletter admin's tests: 55.11, 56.06, 45.31, 55.31; raised 2026-11-05
      // (coverage had risen since without a raise): 63.58, 63.88, 53.53, 63.81; raised 2026-11-16 with
      // the Spending card (risen again since): 81.64, 80.37, 70.80, 82.41; raised 2026-11-17 with the
      // story context client: 82.38, 80.64, 72.08, 83.09; raised 2026-11-17 with the story page and the
      // stories list's tests: 84.27, 82.72, 74.46, 84.98; raised 2026-11-17 with the story page's tabs
      // and action bar: 84.58, 83.25, 74.90, 85.32; raised 2026-11-18 with the research pass's
      // interfaces: 85.35, 84.31, 76.09, 86.02
      thresholds: { statements: 85, branches: 84, functions: 76, lines: 86 },
    },
  },
})

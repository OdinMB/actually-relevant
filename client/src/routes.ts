/**
 * The site's static pages, read from shared/routes.json: the one list the server sitemap reads
 * too (server/src/lib/staticRoutes.ts), so the two cannot drift (.context/seo.md).
 * Used by React Router's prerender (vite.config.ts) and the legacy sitemap script.
 *
 * When adding a new page:
 * 1. Add its entry to shared/routes.json (path, priority, changefreq)
 * 2. Create page component in src/pages/
 * 3. Add route in App.tsx
 * 4. Add its rewrite (`/<path>` → `/<path>/index.html`) to the static site's routes in render.yaml,
 *    above the catch-all, so its no-slash address serves the prerendered page;
 *    server/src/blueprint.test.ts fails until it is there
 */
import staticRoutes from '../../shared/routes.json'

export type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'

export interface RouteConfig {
  path: string
  priority: number
  changefreq: ChangeFreq
  /** false: prerendered but left out of the sitemap (its reason is in `sitemapNote`) */
  sitemap?: boolean
  sitemapNote?: string
}

/** Every static page; all of them are prerendered. */
export const routes = staticRoutes.routes as RouteConfig[]

/** The static pages listed in the sitemap. */
export const sitemapRoutes = routes.filter(r => r.sitemap !== false)

export const routePaths = routes.map(r => r.path)

export type Route = (typeof routePaths)[number]

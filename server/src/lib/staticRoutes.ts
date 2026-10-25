import { readFileSync } from 'fs'
import { z } from 'zod'

/**
 * The site's static pages, from shared/routes.json: the one list the client's prerender
 * (client/src/routes.ts) reads too, so the sitemap and the prerendered pages cannot drift
 * (.context/seo.md). The server's tsconfig cannot import files outside `src/`, so it reads the
 * file at startup instead. The path is the same from `src/lib/` (tsx, tests) and `dist/lib/`
 * (production); a missing or malformed file stops the server at boot, so Render keeps the
 * previous instance serving.
 */
export const ROUTES_FILE = new URL('../../../shared/routes.json', import.meta.url)

const routesFileSchema = z.object({
  routes: z.array(
    z.object({
      path: z.string().startsWith('/'),
      priority: z.number().min(0).max(1),
      changefreq: z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']),
      sitemap: z.boolean().optional(),
    }),
  ),
})

export type StaticRoute = z.infer<typeof routesFileSchema>['routes'][number]

/** The static routes listed in the sitemap: every entry except those marked `"sitemap": false`. */
export function loadSitemapRoutes(file: URL | string = ROUTES_FILE): StaticRoute[] {
  const parsed = routesFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  return parsed.routes.filter(route => route.sitemap !== false)
}

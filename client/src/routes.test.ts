import { describe, it, expect } from 'vitest'
import { routes, routePaths, sitemapRoutes } from './routes'

const CHANGEFREQS = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']

describe('static routes (shared/routes.json)', () => {
  it('prerenders every static page, /saved included', () => {
    expect(routePaths).toContain('/feedback')
    expect(routePaths).toContain('/saved')
    expect(routePaths).toHaveLength(routes.length)
  })

  it('keeps /saved out of the sitemap on purpose, with its reason', () => {
    const saved = routes.find(r => r.path === '/saved')
    expect(saved?.sitemap).toBe(false)
    expect(saved?.sitemapNote).toBeTruthy()
    expect(sitemapRoutes.map(r => r.path)).not.toContain('/saved')
    expect(sitemapRoutes.map(r => r.path)).toContain('/feedback')
  })

  it('gives every route a path, a priority between 0 and 1 and a sitemap change frequency, once', () => {
    for (const route of routes) {
      expect(route.path.startsWith('/')).toBe(true)
      expect(route.priority).toBeGreaterThanOrEqual(0)
      expect(route.priority).toBeLessThanOrEqual(1)
      expect(CHANGEFREQS).toContain(route.changefreq)
    }
    expect(new Set(routePaths).size).toBe(routePaths.length)
  })
})

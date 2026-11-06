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

  it('prerenders /subscribed, the newsletter confirmation page, but keeps it out of the sitemap, with its reason', () => {
    const subscribed = routes.find(r => r.path === '/subscribed')
    expect(routePaths).toContain('/subscribed')
    expect(subscribed?.sitemap).toBe(false)
    expect(subscribed?.sitemapNote).toBeTruthy()
    expect(sitemapRoutes.map(r => r.path)).not.toContain('/subscribed')
  })

  it('prerenders /newsletter-edition, the footer switch page, but keeps it out of the sitemap, with its reason', () => {
    const page = routes.find(r => r.path === '/newsletter-edition')
    expect(page?.sitemap).toBe(false)
    expect(page?.sitemapNote).toBeTruthy()
    expect(sitemapRoutes.map(r => r.path)).not.toContain('/newsletter-edition')
  })

  it('prerenders the Actually Uplifting landing page and lists it in the sitemap', () => {
    expect(routePaths).toContain('/uplifting')
    expect(sitemapRoutes.map(r => r.path)).toContain('/uplifting')
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

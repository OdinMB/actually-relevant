import { Router } from 'express'
import { config } from '../../config.js'
import { createLogger } from '../../lib/logger.js'
import { TTLCache, cached } from '../../lib/cache.js'
import { registerPublicCache } from '../../lib/publicCaches.js'
import { failsWith } from '../../middleware/routeErrors.js'
import prisma from '../../lib/prisma.js'
import { listPublishedEpisodeDates } from '../../services/podcastPublish.js'
import { listPublishedIssueDates } from '../../services/newsletterArchive.js'
import { loadSitemapRoutes } from '../../lib/staticRoutes.js'

const router = Router()
const log = createLogger('sitemap')

export const sitemapCache = new TTLCache<string>(config.sitemap.cacheMaxAge * 1000)
registerPublicCache('sitemap', sitemapCache)

function getSiteUrl(): string {
  return config.siteUrl
}

// The static pages, from shared/routes.json (the list the client prerenders), read once at
// startup. Entries marked "sitemap": false (/saved) are left out.
const STATIC_ROUTES = loadSitemapRoutes()

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildSitemapXml(
  baseUrl: string,
  stories: { slug: string; datePublished: Date | null }[],
  episodes: { id: string; publishedAt: Date }[],
  issues: { slug: string; publishedAt: Date }[] = [],
): string {
  const staticUrls = STATIC_ROUTES.map(
    route => `  <url>
    <loc>${baseUrl}${route.path}</loc>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority.toFixed(1)}</priority>
  </url>`,
  )

  const storyUrls = stories.map(story => {
    const lastmod = story.datePublished ? `\n    <lastmod>${formatDate(story.datePublished)}</lastmod>` : ''
    return `  <url>
    <loc>${baseUrl}/stories/${story.slug}</loc>${lastmod}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`
  })

  // Each published episode's transcript page (its id never changes once published)
  const transcriptUrls = episodes.map(
    episode => `  <url>
    <loc>${baseUrl}/podcast/${episode.id}/transcript</loc>
    <lastmod>${formatDate(episode.publishedAt)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`,
  )

  // Each published newsletter issue's web edition (its slug never changes)
  const issueUrls = issues.map(
    issue => `  <url>
    <loc>${baseUrl}/newsletter/${issue.slug}</loc>
    <lastmod>${formatDate(issue.publishedAt)}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>`,
  )

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...storyUrls, ...transcriptUrls, ...issueUrls].join('\n')}
</urlset>
`
}

router.get('/', failsWith('Failed to generate sitemap'), async (_req, res) => {
  const xml = await cached(sitemapCache, 'sitemap', async () => {
    const stories = await prisma.story.findMany({
      where: { status: 'published', slug: { not: null } },
      select: { slug: true, datePublished: true },
      orderBy: { datePublished: 'desc' },
    })

    const episodes = await listPublishedEpisodeDates()
    const issues = await listPublishedIssueDates()

    log.info({ storyCount: stories.length, episodeCount: episodes.length, issueCount: issues.length }, 'generated sitemap')
    return buildSitemapXml(getSiteUrl(), stories as { slug: string; datePublished: Date | null }[], episodes, issues)
  })

  res.set('Content-Type', 'application/xml; charset=utf-8')
  res.set('Cache-Control', `public, max-age=${config.sitemap.cacheMaxAge}`)
  res.send(xml)
})

export default router

/**
 * Shared pieces of the site's RSS 2.0 feeds built with the `feed` package: the story feeds
 * (routes/public/feed.ts) and the newsletter feed (routes/public/newsletters.ts). The podcast
 * feed is hand-built (services/podcastFeed.ts).
 */
import type { Response } from 'express'
import { Feed } from 'feed'
import { config } from '../config.js'

/** A channel on the site, its self link at `feedPath` (absolute path on the API, e.g. `/api/feed`). */
export function buildFeed(options: { title: string; description: string; feedPath: string; link?: string }): Feed {
  const siteUrl = config.siteUrl
  return new Feed({
    title: options.title,
    description: options.description,
    id: options.link ?? siteUrl,
    link: options.link ?? siteUrl,
    language: 'en',
    copyright: `© ${new Date().getFullYear()} Actually Relevant`,
    feedLinks: {
      rss: `${siteUrl}${options.feedPath}`,
    },
  })
}

export function setRssHeaders(res: Response): void {
  res.set('Content-Type', 'application/rss+xml; charset=utf-8')
  res.set('Cache-Control', `public, max-age=${config.feed.cacheMaxAge}`)
}

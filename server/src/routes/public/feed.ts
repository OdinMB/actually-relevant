import { Router } from 'express'
import { config } from '../../config.js'
import { createLogger } from '../../lib/logger.js'
import { TTLCache, cached } from '../../lib/cache.js'
import { RSS_ITEM_PREFIX, rssChannelDescription } from '../../lib/aiLabelCopy.js'
import { Feed } from 'feed'
import * as storyService from '../../services/story.js'
import * as issueService from '../../services/issue.js'
import { validateQuery } from '../../middleware/validate.js'
import { feedQuerySchema } from '../../schemas/story.js'

const router = Router()
const log = createLogger('feed')

const feedCache = new TTLCache<string>(config.feed.cacheMaxAge * 1000)

type FeedStory = Awaited<ReturnType<typeof storyService.getPublishedStories>>['data'][number]

function getSiteUrl(): string {
  return config.siteUrl
}

function buildFeed(options: { title: string; description: string; feedPath: string }) {
  const siteUrl = getSiteUrl()
  return new Feed({
    title: options.title,
    description: options.description,
    id: siteUrl,
    link: siteUrl,
    language: 'en',
    copyright: `© ${new Date().getFullYear()} Actually Relevant`,
    feedLinks: {
      rss: `${siteUrl}${options.feedPath}`,
    },
  })
}

/**
 * Add one item per story. RSS readers never show the website's labels, so every item
 * description carries its own AI label (AI Act Art. 50(4)).
 */
function addStoryItems(feed: Feed, stories: FeedStory[]) {
  const siteUrl = getSiteUrl()
  for (const story of stories) {
    feed.addItem({
      title: story.title || story.sourceTitle,
      id: story.id,
      link: `${siteUrl}/stories/${story.slug || story.id}`,
      description: story.summary ? `${RSS_ITEM_PREFIX}${story.summary}` : undefined,
      date: story.datePublished ? new Date(story.datePublished) : new Date(story.dateCrawled),
      category: [{ name: (story.issue ?? story.feed?.issue)?.name || 'General' }],
    })
  }
}

function setRssHeaders(res: import('express').Response) {
  res.set('Content-Type', 'application/rss+xml; charset=utf-8')
  res.set('Cache-Control', `public, max-age=${config.feed.cacheMaxAge}`)
}

/**
 * The feed variant a request asks for. The in-memory cache key carries it, so a filtered and
 * an unfiltered feed never share an entry; minRelevance has ten values, which keeps the key
 * space bounded. HTTP caches (browsers, Cloudflare) key on the full URL, query included.
 */
function feedVariant(minRelevance: number | undefined) {
  return {
    cacheSuffix: minRelevance === undefined ? '' : `:minRelevance=${minRelevance}`,
    query: minRelevance === undefined ? '' : `?minRelevance=${minRelevance}`,
    titleSuffix: minRelevance === undefined ? '' : ` (relevance ${minRelevance}+)`,
  }
}

// Global feed — all published stories
router.get('/', validateQuery(feedQuerySchema), async (req, res) => {
  try {
    const { minRelevance } = req.parsedQuery as { minRelevance?: number }
    const variant = feedVariant(minRelevance)
    const xml = await cached(feedCache, `feed:global${variant.cacheSuffix}`, async () => {
      const result = await storyService.getPublishedStories({ page: 1, pageSize: config.feed.size, minRelevance })

      const feed = buildFeed({
        title: `Actually Relevant${variant.titleSuffix}`,
        description: rssChannelDescription(),
        feedPath: `/api/feed${variant.query}`,
      })
      addStoryItems(feed, result.data)

      return feed.rss2()
    })

    setRssHeaders(res)
    res.send(xml)
  } catch (err) {
    log.error({ err }, 'failed to generate global RSS feed')
    res.status(500).json({ error: 'Failed to generate feed' })
  }
})

// Per-issue feed
router.get('/:issueSlug', validateQuery(feedQuerySchema), async (req, res) => {
  try {
    const { issueSlug } = req.params
    const { minRelevance } = req.parsedQuery as { minRelevance?: number }
    const issue = await issueService.getIssueBySlug(issueSlug)
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' })
      return
    }

    const variant = feedVariant(minRelevance)
    const xml = await cached(feedCache, `feed:issue:${issueSlug}${variant.cacheSuffix}`, async () => {
      const result = await storyService.getPublishedStories({
        page: 1,
        pageSize: config.feed.size,
        issueSlug,
        minRelevance,
      })

      const feed = buildFeed({
        title: `Actually Relevant — ${issue.name}${variant.titleSuffix}`,
        description: rssChannelDescription(issue.name),
        feedPath: `/api/feed/${issueSlug}${variant.query}`,
      })
      addStoryItems(feed, result.data)

      return feed.rss2()
    })

    setRssHeaders(res)
    res.send(xml)
  } catch (err) {
    log.error({ err }, 'failed to generate issue RSS feed')
    res.status(500).json({ error: 'Failed to generate feed' })
  }
})

export default router

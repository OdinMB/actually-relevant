import { Router } from 'express'
import { config } from '../../config.js'
import { TTLCache, cached } from '../../lib/cache.js'
import { registerPublicCache } from '../../lib/publicCaches.js'
import { RSS_ITEM_PREFIX, rssChannelDescription } from '../../lib/aiLabelCopy.js'
import type { Feed } from 'feed'
import { buildFeed, setRssHeaders } from '../../lib/rssFeed.js'
import * as storyService from '../../services/story.js'
import * as issueService from '../../services/issue.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateQuery } from '../../middleware/validate.js'
import { feedQuerySchema } from '../../schemas/story.js'

const router = Router()

const feedCache = new TTLCache<string>(config.feed.cacheMaxAge * 1000)
registerPublicCache('rss-feeds', feedCache)

type FeedStory = Awaited<ReturnType<typeof storyService.getPublishedStories>>['data'][number]

/**
 * Add one item per story. RSS readers never show the website's labels, so every item
 * description carries its own AI label (AI Act Art. 50(4)).
 */
function addStoryItems(feed: Feed, stories: FeedStory[]) {
  const siteUrl = config.siteUrl
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
router.get('/', failsWith('Failed to generate feed'), validateQuery(feedQuerySchema), async (req, res) => {
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
})

// Per-issue feed
router.get('/:issueSlug', failsWith('Failed to generate feed'), validateQuery(feedQuerySchema), async (req, res) => {
  const { issueSlug } = req.params
  const { minRelevance } = req.parsedQuery as { minRelevance?: number }
  const issue = await issueService.getIssueBySlug(issueSlug!)
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
})

export default router

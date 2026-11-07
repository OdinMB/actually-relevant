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
import { FEED_MIX_NAMES, UPLIFTING_FEED_MIX, mixFeedStories, type FeedMix } from '../../lib/feedMix.js'

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

/** The homepage's positive and negative pools (`getHomepageData`): calm counts as positive. */
const POSITIVE_TAGS = ['uplifting', 'calm'] as const
const NEGATIVE_TAGS = ['frustrating', 'scary'] as const

interface FeedQuery {
  minRelevance?: number
  mix?: FeedMix
}

/** How a dial position below "Only uplifting" shows in the channel title; that one renames the brand instead. */
const MIX_TITLE: Record<Exclude<FeedMix, 100>, string> = {
  0: 'heavy',
  25: 'mostly heavy',
  50: 'balanced',
  75: 'mostly uplifting',
}

/**
 * The feed variant a request asks for. The in-memory cache key carries it, so feeds that differ
 * never share an entry; minRelevance has ten values and mix five, which keeps the key space
 * bounded. HTTP caches (browsers, Cloudflare) key on the full URL, query included.
 */
function feedVariant({ minRelevance, mix }: FeedQuery) {
  const params = new URLSearchParams()
  if (minRelevance !== undefined) params.set('minRelevance', String(minRelevance))
  if (mix !== undefined) params.set('mix', FEED_MIX_NAMES[mix])
  const query = params.toString()
  const labels = [
    ...(mix !== undefined && mix !== UPLIFTING_FEED_MIX ? [MIX_TITLE[mix]] : []),
    ...(minRelevance !== undefined ? [`relevance ${minRelevance}+`] : []),
  ]
  return {
    cacheSuffix: `${minRelevance === undefined ? '' : `:minRelevance=${minRelevance}`}${mix === undefined ? '' : `:mix=${mix}`}`,
    query: query ? `?${query}` : '',
    brand: mix === UPLIFTING_FEED_MIX ? 'Actually Uplifting' : 'Actually Relevant',
    titleSuffix: labels.length > 0 ? ` (${labels.join(', ')})` : '',
  }
}

/**
 * The newest published stories a feed shows. Without `mix`, every story. At "Only uplifting",
 * only uplifting ones, as the Actually Uplifting edition shows. At the other positions, the
 * homepage's mix of positive and negative stories (`lib/feedMix.ts`); untagged stories, which the
 * homepage never shows either, are left out.
 */
async function loadFeedStories({ minRelevance, mix }: FeedQuery, issueSlug?: string): Promise<FeedStory[]> {
  const base = { page: 1, pageSize: config.feed.size, issueSlug, minRelevance }
  if (mix === undefined) return (await storyService.getPublishedStories(base)).data
  if (mix === UPLIFTING_FEED_MIX) return (await storyService.getPublishedStories({ ...base, emotionTags: ['uplifting'] })).data
  const [positive, negative] = await Promise.all([
    storyService.getPublishedStories({ ...base, emotionTags: [...POSITIVE_TAGS] }),
    storyService.getPublishedStories({ ...base, emotionTags: [...NEGATIVE_TAGS] }),
  ])
  return mixFeedStories(positive.data, negative.data, config.feed.size, mix)
}

// Global feed — all published stories, or the dial's mix of them
router.get('/', failsWith('Failed to generate feed'), validateQuery(feedQuerySchema), async (req, res) => {
  const query = req.parsedQuery as FeedQuery
  const variant = feedVariant(query)
  const xml = await cached(feedCache, `feed:global${variant.cacheSuffix}`, async () => {
    const stories = await loadFeedStories(query)

    const feed = buildFeed({
      title: `${variant.brand}${variant.titleSuffix}`,
      description: rssChannelDescription(query.mix === UPLIFTING_FEED_MIX ? 'Actually Uplifting' : undefined),
      feedPath: `/api/feed${variant.query}`,
    })
    addStoryItems(feed, stories)

    return feed.rss2()
  })

  setRssHeaders(res)
  res.send(xml)
})

// Per-issue feed
router.get('/:issueSlug', failsWith('Failed to generate feed'), validateQuery(feedQuerySchema), async (req, res) => {
  const { issueSlug } = req.params
  const query = req.parsedQuery as FeedQuery
  const issue = await issueService.getIssueBySlug(issueSlug!)
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  const variant = feedVariant(query)
  const xml = await cached(feedCache, `feed:issue:${issueSlug}${variant.cacheSuffix}`, async () => {
    const stories = await loadFeedStories(query, issueSlug)

    const feed = buildFeed({
      title: `${variant.brand} — ${issue.name}${variant.titleSuffix}`,
      description: rssChannelDescription(issue.name),
      feedPath: `/api/feed/${issueSlug}${variant.query}`,
    })
    addStoryItems(feed, stories)

    return feed.rss2()
  })

  setRssHeaders(res)
  res.send(xml)
})

export default router

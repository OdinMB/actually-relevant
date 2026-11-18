import { crawlAllDueFeeds } from '../services/crawler.js'
import { createLogger } from '../lib/logger.js'
import { countOf, reportRunResult } from '../lib/runUsage.js'

const log = createLogger('crawl_feeds')

export async function runCrawlFeeds(): Promise<void> {
  log.info('starting crawl')
  const results = await crawlAllDueFeeds()
  const totalNew = results.reduce((sum, r) => sum + r.newStories, 0)
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0)
  log.info({ feedCount: results.length, newStories: totalNew, errors: totalErrors }, 'crawl finished')
  reportRunResult(
    results.length === 0
      ? 'No feed was due'
      : `${countOf(totalNew, 'new story', 'new stories')} from ${countOf(results.length, 'feed')}${totalErrors > 0 ? `, ${countOf(totalErrors, 'error')}` : ''}`,
  )
}

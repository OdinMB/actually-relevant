import { describe, it, expect } from 'vitest'
import { makeFeed, makeQuality } from '../../test/feeds'
import { findFeedProblems } from './feedProblems'

describe('findFeedProblems', () => {
  it('finds nothing wrong with an active feed that crawls and publishes', () => {
    expect(findFeedProblems(makeFeed(), makeQuality())).toEqual([])
  })

  it('flags a feed whose last crawl could not fetch the RSS feed', () => {
    const feed = makeFeed({ lastCrawlResult: 'RSS fetch failed: HTTP 404', lastCrawlError: 'RSS fetch failed: HTTP 404', consecutiveFailedCrawls: 2 })
    expect(findFeedProblems(feed, makeQuality())).toEqual(['rss-fetch-failed'])
  })

  it('does not flag an RSS error that is still shown after a later crawl reached the feed', () => {
    const feed = makeFeed({ lastCrawlResult: '304 not modified', lastCrawlError: 'RSS fetch failed: timeout' })
    expect(findFeedProblems(feed, makeQuality())).toEqual([])
  })

  it('flags extraction failures only when more than half of the articles failed', () => {
    const withError = (lastCrawlError: string) => findFeedProblems(makeFeed({ lastCrawlError }), makeQuality())

    expect(withError('6 of 10 articles failed extraction')).toEqual(['extraction-failing'])
    expect(withError('1 of 1 articles failed extraction')).toEqual(['extraction-failing'])
    expect(withError('5 of 10 articles failed extraction')).toEqual([])
    expect(withError('Crawl failed: connection terminated')).toEqual([])
  })

  it('flags a feed that has gone stale', () => {
    expect(findFeedProblems(makeFeed({ isStale: true, consecutiveEmptyCrawls: 7 }), makeQuality())).toEqual(['stale'])
  })

  it('flags a crawled feed none of whose stories was analyzed or published', () => {
    const quality = makeQuality({ totalCrawled: 12, publishedCount: 0, publishRate: 0, avgRelevance: null })
    expect(findFeedProblems(makeFeed(), quality)).toEqual(['nothing-analyzed'])
  })

  it('does not flag a feed with no stories yet, or one whose stories were analyzed but not published', () => {
    expect(findFeedProblems(makeFeed(), makeQuality({ totalCrawled: 0, publishedCount: 0, publishRate: 0, avgRelevance: null }))).toEqual([])
    expect(findFeedProblems(makeFeed(), makeQuality({ publishedCount: 0, publishRate: 0, avgRelevance: 3.2 }))).toEqual([])
  })

  it('judges only the crawl state when there are no quality metrics for the feed', () => {
    expect(findFeedProblems(makeFeed(), undefined)).toEqual([])
    expect(findFeedProblems(makeFeed({ lastCrawlResult: 'RSS fetch failed: timeout' }), undefined)).toEqual(['rss-fetch-failed'])
  })

  it('lists every problem a feed has', () => {
    const feed = makeFeed({ lastCrawlResult: 'RSS fetch failed: HTTP 403', lastCrawlError: '9 of 10 articles failed extraction', isStale: true })
    const quality = makeQuality({ publishedCount: 0, publishRate: 0, avgRelevance: null })
    expect(findFeedProblems(feed, quality)).toEqual(['rss-fetch-failed', 'extraction-failing', 'stale', 'nothing-analyzed'])
  })

  it('never flags an inactive feed', () => {
    const feed = makeFeed({ active: false, lastCrawlResult: 'RSS fetch failed: HTTP 404', lastCrawlError: '9 of 10 articles failed extraction', isStale: true })
    expect(findFeedProblems(feed, makeQuality({ publishedCount: 0, avgRelevance: null }))).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { feedIssues, makeFeed, makeQuality } from '../../test/feeds'
import { buildChangesetInstructions } from './feedChangesetInstructions'
import { buildFeedExport } from './feedExport'
import { buildCoverageGapsPrompt, buildFixProblemFeedsPrompt } from './feedExportPrompts'

const healthy = makeFeed({ id: 'feed-healthy', rssUrl: 'https://healthy.example/feed.xml' })
const broken = makeFeed({ id: 'feed-broken', rssUrl: 'https://broken.example/rss', lastCrawlResult: 'RSS fetch failed: HTTP 404' })
const input = {
  feeds: [healthy, broken],
  issues: feedIssues,
  quality: { 'feed-healthy': makeQuality(), 'feed-broken': makeQuality() },
  now: new Date('2026-11-01T09:30:00.000Z'),
}

describe('buildFixProblemFeedsPrompt', () => {
  it('embeds the export of the feeds with problems and the full changeset instructions', () => {
    const prompt = buildFixProblemFeedsPrompt(input)

    expect(prompt).toContain(JSON.stringify(buildFeedExport(input, 'problems'), null, 2))
    expect(prompt).toContain(buildChangesetInstructions(feedIssues))
    expect(prompt).not.toContain(healthy.rssUrl)
  })
})

describe('buildCoverageGapsPrompt', () => {
  it('embeds the export of every feed and the full changeset instructions', () => {
    const prompt = buildCoverageGapsPrompt(input)

    expect(prompt).toContain(JSON.stringify(buildFeedExport(input, 'all'), null, 2))
    expect(prompt).toContain(buildChangesetInstructions(feedIssues))
  })
})

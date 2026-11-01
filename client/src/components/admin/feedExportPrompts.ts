import { FEED_CHANGESET } from '@shared/constants'
import type { IssueNode } from '../../lib/issues'
import { buildChangesetInstructions, CRAWLER_USER_AGENT } from './feedChangesetInstructions'
import { buildFeedExport, type FeedExport, type FeedExportInput } from './feedExport'

/**
 * The two prompts the feed export dialog copies, each complete for an AI agent: the task, the full
 * changeset instructions (`feedChangesetInstructions.ts`) and the export JSON. "Fix problem feeds"
 * holds the feeds with problems, "Analyze coverage gaps" every feed. Both ask for changeset files,
 * which the owner uploads with "Import changes" (`.context/feed-management.md`, "Export").
 */

const SITE = 'Actually Relevant is a news site that crawls RSS feeds and uses AI to rate how relevant each article is to humanity.'

const UPLOAD = 'The owner uploads a changeset file on the admin Feeds page with "Import changes", checks the preview and applies it in one step.'

const READING_THE_EXPORT = [
  'READING THE EXPORT',
  'The export at the end lists each feed with its settings, its crawl state and the quality of its stories, and the issue tree ("issues": slugs and names, each sub-issue under its parent).',
  '- "problems" names what the site detected, as codes that "problemDefinitions" explains. An empty list means none was detected.',
  '- "lastCrawlResult" is the outcome of the most recent crawl. "lastCrawlError" is the most recent error, which stays until a later crawl succeeds, so compare "lastCrawlErrorAt" with "lastCrawledAt".',
  '- "quality": "crawled" counts every story ever crawled from the feed and "published" those published, "publishRate" is published divided by crawled, "avgRelevance" is the mean relevance rating of its analyzed stories (higher is more relevant), and "dominantMethod" is the extraction method behind most of its stories ("rss" when the text comes from the feed). "quality" is null when the site has no metrics for the feed.',
]

const RULES = [
  'RULES',
  '- Never invent or guess a feed URL. Use only feed addresses you found on the publisher\'s site (a feed link, or the page\'s <link rel="alternate"> tag) or in its documentation, and fetched yourself.',
  '- Match an existing feed by its "id" from the export.',
  '- Change only what you verified, and say in each reason what you found and what you checked.',
]

function closingSections(data: FeedExport, issues: IssueNode[]): string[] {
  return [
    'CHANGESET INSTRUCTIONS',
    'Write every changeset file exactly as these instructions say.',
    '',
    buildChangesetInstructions(issues),
    '',
    'EXPORT',
    JSON.stringify(data, null, 2),
  ]
}

/** For an agent that finds out why each feed with problems fails and writes the changeset that fixes or removes it. */
export function buildFixProblemFeedsPrompt(input: FeedExportInput): string {
  const data = buildFeedExport(input, 'problems')
  return [
    `You are fixing the problem feeds of Actually Relevant. ${SITE} The site owner exported the active feeds in which the site detected a problem, ${data.feeds.length} of them. For each one, find out why it fails and how to fix it, then write a feed changeset: one JSON file of feed changes. ${UPLOAD}`,
    '',
    ...READING_THE_EXPORT,
    '',
    'FOR EACH FEED',
    `- Fetch its rssUrl with the crawler's user agent "${CRAWLER_USER_AGENT}" and note the HTTP status, any redirect and the content type.`,
    '- Find the cause. The usual ones:',
    "  - Moved feed: a 404 or 410, a redirect to a page that is not a feed, or a feed without new items for weeks. Look for the current feed address on the publisher's site.",
    '  - Bot block: a 403, a 429 or a challenge page for our user agent while the site works in a browser. If the feed carries each whole article and the publisher allows it, "contentSource": "rss" avoids fetching the pages; otherwise the source cannot be crawled.',
    '  - Parse error: the address returns HTML, or XML that is not RSS or Atom. Find the real feed address.',
    '  - Paywall: article pages show a login wall or only a teaser. Adjust "paywallDetection" or "paywallTitleMarker" where that classifies the articles correctly, or delete a source whose articles are mostly locked.',
    '  - Extraction: article pages load, but the text is not found. Find a CSS selector for the article body ("htmlSelector") that works on three article pages, or use "contentSource": "rss" when the feed carries the full text.',
    '  - Nothing analyzed or published: check that the articles belong to the feed\'s issue and that the extracted text is the article itself. A feed created in the last few days ("createdAt") may not have been analyzed yet; leave it as it is.',
    '- Check the source policy in the changeset instructions below. A feed whose publisher has made a reservation that applies to us is deleted, whatever else is wrong with it.',
    '- Write at most one change per feed: an update that sets only the verified fields (a fixed "rssUrl", an "htmlSelector", "contentSource", the paywall settings), or a delete when the source cannot be fixed or the source policy excludes it.',
    '- When you cannot find the cause or a verified fix, leave the feed out of the changeset and say so in the report.',
    '',
    ...RULES,
    '',
    'WHAT TO HAND BACK',
    `- The changeset as a JSON file, with the changes for these feeds (at most ${FEED_CHANGESET.maxChanges}).`,
    '- A short report: for each feed, the cause you found, the evidence, and the change you wrote, or why there is none.',
    '',
    ...closingSections(data, input.issues),
  ].join('\n')
}

/** For an agent that assesses coverage per issue, region and language and writes changesets with fixes, then additions. */
export function buildCoverageGapsPrompt(input: FeedExportInput): string {
  const data = buildFeedExport(input, 'all')
  const withProblems = data.feeds.filter(feed => feed.problems.length > 0).length
  return [
    `You are analyzing the source coverage of Actually Relevant. ${SITE} The site owner exported every feed, ${data.feeds.length} of them, ${withProblems} with a detected problem. Find where coverage is thin, propose replacement and additional sources, verify each one, and write feed changesets: JSON files of feed changes. ${UPLOAD}`,
    '',
    ...READING_THE_EXPORT,
    '',
    'WHAT COUNTS AS COVERAGE',
    '- Only active feeds without problems. A feed with a non-empty "problems" list is unreliable: it may deliver nothing, so do not count it.',
    '- Inactive feeds ("active": false) are not crawled and do not count, but each keeps its rssUrl. To bring one back, update it with "active": true instead of creating it again.',
    '',
    'STEP 1: ASSESS COVERAGE',
    '- For each issue and each sub-issue in "issues", list its reliable feeds and look at their crawled and published counts, publish rates and average relevance.',
    '- Look at the spread of regions ("region") and languages ("language") within each issue: which are missing, and which depend on a single source.',
    '- Name the gaps: issues or sub-issues with few reliable feeds or few published stories, and coverage that comes from one region, one language or one publisher.',
    '',
    'STEP 2: FIND SOURCES',
    '- For each feed with problems, look for a fix first (the publisher\'s current feed address, an "htmlSelector", "contentSource": "rss"), and otherwise for a replacement that covers the same ground.',
    "- Check each active feed's publisher against the source policy in the changeset instructions below. A feed the policy excludes is deleted, and its issue may need a replacement.",
    '- For each gap, look for additional sources that report substantively on the issue: research institutes, international and public bodies, specialist publications and reputable regional outlets.',
    "- Compare with the export's rssUrl values, active and inactive, so that you never add a feed that already exists.",
    '',
    'STEP 3: VERIFY EVERY SOURCE YOU ADD OR FIX',
    '- The feed parses as RSS or Atom and has items from the last few weeks.',
    `- Three article pages from the feed fetch with the crawler's user agent "${CRAWLER_USER_AGENT}" and return the article text, not a block page, a login wall or a teaser.`,
    '- The source policy allows it.',
    'Leave out a source that fails a check, and list it in the report with the reason.',
    '',
    'STEP 4: WRITE THE CHANGESETS',
    'Write two changeset files, which the owner applies in this order:',
    '- First, fixes and deletions: updates that fix feeds with problems, deletions of feeds the source policy excludes, and deletions of feeds with problems that cannot be fixed.',
    '- Then additions: new feeds, and inactive feeds brought back with "active": true.',
    `Each file holds at most ${FEED_CHANGESET.maxChanges} changes. Leave out a file that would be empty.`,
    '',
    ...RULES,
    '',
    'WHAT TO HAND BACK',
    '- The fixes changeset file and the additions changeset file, as JSON, named so that the order is clear.',
    '- A short report: coverage per issue and sub-issue before and after the changes (reliable feeds, regions, languages), the gaps you found and which remain, each source you added or fixed, and each source you checked and left out, with why.',
    '',
    ...closingSections(data, input.issues),
  ].join('\n')
}

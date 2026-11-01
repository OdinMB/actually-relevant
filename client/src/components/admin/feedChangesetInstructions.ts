import { FEED_CHANGESET, FEED_REGIONS } from '@shared/constants'
import { issueTree, type IssueNode } from '../../lib/issues'

/**
 * The instructions an AI agent gets for researching and writing a feed changeset, copied from the
 * info dialog beside "Import changes" on the Feeds page. Issue slugs come from the live issue list,
 * and regions and format constants from `@shared/constants`, so they cannot drift from what the
 * server accepts (`server/src/schemas/feedChangeset.ts`; `.context/feed-management.md`, "Changesets"
 * and "Source policy").
 */

/** The crawler's user agent (`server/src/services/extractor.ts`), which the agent fetches pages with. */
export const CRAWLER_USER_AGENT = 'ActuallyRelevant/1.0 (news curation bot; +https://actuallyrelevant.news)'

/** Issues as `- slug: Name`, each parent followed by its children, indented. */
function issueLines(issues: IssueNode[]): string[] {
  return issueTree(issues).flatMap(({ parent, children }) => [`- ${parent.slug}: ${parent.name}`, ...children.map(child => `  - ${child.slug}: ${child.name}`)])
}

function example(issueSlug: string): string {
  return JSON.stringify(
    {
      format: FEED_CHANGESET.format,
      version: FEED_CHANGESET.version,
      title: 'Fix moved feeds and remove sources excluded by the source policy',
      createdAt: '2026-11-01',
      changes: [
        {
          action: 'update',
          match: { title: 'SIPRI' },
          set: { rssUrl: 'https://www.sipri.org/rss/combined.xml' },
          reason: 'Old feed URL returns 404; new URL linked from sipri.org, parses, 20 items this month',
        },
        { action: 'delete', match: { title: 'The Lancet' }, reason: 'Elsevier declares a TDM reservation (tdmrep.json); article pages refuse the crawler' },
        {
          action: 'create',
          feed: {
            title: 'ECDC',
            rssUrl: 'https://example.org/feed.xml',
            url: 'https://www.ecdc.europa.eu/',
            issue: issueSlug,
            language: 'en',
            region: 'western_europe',
            contentSource: 'page',
          },
          reason: 'Fills a gap in pandemic coverage; feed parses, three article pages fetched, no reservation found',
        },
      ],
    },
    null,
    2,
  )
}

export function buildChangesetInstructions(issues: IssueNode[]): string {
  const issueList = issueLines(issues)
  const exampleSlug = issues.find(issue => issue.parentId)?.slug ?? issues[0]?.slug ?? 'issue-slug'
  return [
    'You are preparing a feed changeset for Actually Relevant, a news site that crawls RSS feeds and uses AI to rate how relevant each article is to humanity. A changeset is one JSON file of feed changes (add, change or remove feeds) that the site owner uploads in the admin, previews and applies in one step. Research every change, verify it as described below, and write the file exactly in this format.',
    '',
    'FILE FORMAT',
    '{',
    `  "format": "${FEED_CHANGESET.format}",`,
    `  "version": ${FEED_CHANGESET.version},`,
    '  "title": "Short summary of the changeset (optional)",',
    '  "createdAt": "YYYY-MM-DD (optional)",',
    `  "changes": [ at least 1 and at most ${FEED_CHANGESET.maxChanges} changes ]`,
    '}',
    '',
    `Every change has an "action" and a "reason". The reason is required (at most ${FEED_CHANGESET.maxReasonLength} characters): say what you found and what you checked. Fields not listed here are rejected.`,
    '- create: { "action": "create", "feed": { feed fields }, "reason": "..." }. The feed needs "title", "rssUrl" and "issue"; the other fields are optional.',
    '- update: { "action": "update", "match": { ... }, "set": { only the fields to change }, "reason": "..." }',
    '- delete: { "action": "delete", "match": { ... }, "reason": "..." }. A feed that already has stories is deactivated instead of deleted, so its stories keep their source.',
    '',
    '"match" names one existing feed (active or not) by exactly one of "id", "rssUrl" (exact) or "title" (exact and case-sensitive). Use "rssUrl" or "id" when two feeds share a title. A feed may appear in only one change. Changes apply in file order and all or nothing: if any change has an error, nothing is applied.',
    '',
    'FEED FIELDS',
    '- title (text): the feed name in the admin.',
    '- rssUrl (URL): the RSS or Atom feed. No other feed may use it.',
    '- url (URL, or null): the publisher homepage.',
    '- displayTitle (text): the name readers see, if it differs from title.',
    "- issue (slug from ISSUES): the issue area of the feed's stories.",
    '- language (language code, default "en"): for example "en", "de", "fr".',
    '- region (value from REGIONS, or null).',
    '- crawlIntervalHours (whole number, default 24): hours between crawls.',
    '- htmlSelector (CSS selector; null in "set" to clear it): where the article text is on the page. Only when the default extraction fails.',
    '- contentSource ("page" or "rss", default "page"): see CONTENT SOURCE.',
    '- paywallDetection (true or false, default true): false for a metered publisher whose full-text articles are marked as paid.',
    '- paywallTitleMarker (regular expression, or null): a title pattern that marks subscriber-only articles, for example "^\\\\(S\\\\+\\\\)". At most 200 characters, and no group containing + or * that is itself repeated.',
    '- active (true or false, update only): false stops crawling the feed, true resumes it.',
    '',
    'ISSUES (use the slug)',
    ...(issueList.length > 0 ? issueList : ['- (no issues found; ask the owner for the issue slugs)']),
    '',
    'REGIONS',
    ...FEED_REGIONS.map(region => `- ${region.value}: ${region.label}`),
    '',
    'CONTENT SOURCE',
    '- "page" (default): the crawler fetches each article page and extracts its text.',
    '- "rss": the crawler takes the full text from the RSS item (content:encoded) and never fetches the article page. Use it only when the publisher forbids fetching its pages but its feed carries each whole article, as Substack newsletters do. Items whose feed text is under about 300 characters, such as paid posts that show only a preview, are skipped.',
    '',
    'SOURCE POLICY: CHECK EVERY SOURCE YOU ADD OR KEEP',
    'Leave a source out, or delete it, when its publisher has reserved its content in a way that applies to us:',
    '- TDMRep: /.well-known/tdmrep.json, a "tdm-reservation: 1" HTTP header or the matching meta tag reserves text and data mining.',
    '- A Content-Signal (in robots.txt or an HTTP header) says ai-input=no.',
    '- robots.txt disallows all user agents (*), or ours (ActuallyRelevant), for the article pages.',
    '- The terms of use forbid AI processing, summarizing, or text and data mining of the content.',
    "These do not apply to us: robots.txt rules that block only named AI companies' crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended and the like), and terms that forbid only AI training. We do not train models, our crawler identifies itself and fetches one page per article, and every story links to the original.",
    '',
    'VERIFY EVERY CHANGE',
    '- Never invent or guess a feed URL. Find it on the publisher\'s site (a feed link, or the page\'s <link rel="alternate"> tag) and fetch it.',
    '- The feed must parse as RSS or Atom and have items from the last few weeks.',
    `- Fetch three article pages from the feed with the user agent "${CRAWLER_USER_AGENT}". Each must return the article text, not a block page, a login wall or a teaser. If they do not, but the feed carries the full text and the publisher allows it, use "contentSource": "rss"; otherwise leave the source out.`,
    '- Check robots.txt, TDMRep, Content-Signal and the terms of use as described above, and say in the reason what you found.',
    '- For an update or a delete, match the feed exactly as it is named in the admin, and change only what you verified.',
    '',
    'EXAMPLE',
    example(exampleSlug),
  ].join('\n')
}

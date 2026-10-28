/**
 * What a newsletter issue says: the reads, creating an issue, and the builders the lifecycle's
 * moves write from (longlist, model-picked shortlist, markdown, the HTML email), plus the
 * carousel, the send list and send stats. Nothing here writes an issue's lifecycle fields or its
 * sends; that is `newsletterLifecycle.ts`.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { HumanMessage } from '@langchain/core/messages'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { type Prisma, ContentStatus, StoryStatus } from '@prisma/client'
import { paginate } from '../lib/paginate.js'
import { generateCarouselZip, type CarouselStory } from './carousel.js'
import * as plunk from './plunk.js'
import { createLogger } from '../lib/logger.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { NEWSLETTER_TOP_LABEL } from '../lib/aiLabelCopy.js'
import { escapeHtml } from '../lib/xml.js'
import { parseStoryHeading, storyHeading } from './newsletterContent.js'
import { newsletterIssue, newsletterOrder, newsletterSelectInput } from './promptInputs.js'
import { buildNewsletterSelectPrompt } from '../prompts/index.js'
import { newsletterSelectResultSchema } from '../schemas/llm.js'
import { BadRequestError, NotFoundError } from '../utils/errors.js'

const log = createLogger('newsletter')

/** Issue slug → dot color hex for email HTML (mirrors client/src/lib/category-colors.ts) */
const ISSUE_DOT_COLORS: Record<string, string> = {
  'human-development': '#fbbf24',
  'planet-climate': '#2dd4bf',
  'existential-threats': '#f87171',
  'science-technology': '#818cf8',
}
const DEFAULT_DOT_COLOR = '#f472b6'

function getIssueDotColor(slug: string): string {
  return ISSUE_DOT_COLORS[slug] ?? DEFAULT_DOT_COLOR
}

interface NewsletterFilters {
  status?: string
  page?: number
  pageSize?: number
}

export async function getNewsletters(filters: NewsletterFilters) {
  const page = filters.page || 1
  const pageSize = filters.pageSize || 25
  const where: Prisma.NewsletterWhereInput = {}
  if (filters.status) where.status = filters.status as ContentStatus

  return paginate({
    findMany: () =>
      prisma.newsletter.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    count: () => prisma.newsletter.count({ where }),
    page,
    pageSize,
  })
}

export async function getNewsletterById(id: string) {
  return prisma.newsletter.findUnique({ where: { id } })
}

/** `weekKey` is set only by the generate_newsletter job (its weekly guard keys on it). */
export async function createNewsletter(data: { title: string; weekKey?: string }) {
  return prisma.newsletter.create({ data: { title: data.title, weekKey: data.weekKey } })
}

// --- Content builders: they compute, and newsletterLifecycle.ts writes what they return ---

/** The longlist: ids of the stories published in the last `storyAssignmentDays` days, newest first. */
export async function recentStoryIds(client: Prisma.TransactionClient = prisma): Promise<string[]> {
  const stories = await client.story.findMany({
    where: {
      status: StoryStatus.published,
      dateCrawled: { gte: new Date(Date.now() - config.content.storyAssignmentDays * 24 * 60 * 60 * 1000) },
    },
    orderBy: { dateCrawled: 'desc' },
    select: { id: true },
  })

  const storyIds = stories.map(s => s.id)
  if (storyIds.length === 0) throw new Error('No recent stories to assign')
  return storyIds
}

/** The shortlist the model picks from the issue's (non-empty) longlist; only longlist ids are kept. */
export async function pickShortlist(newsletter: { id: string; storyIds: string[] }): Promise<string[]> {
  const newsletterId = newsletter.id

  // Fetch stories with title, summary, and issue info
  const stories = await prisma.story.findMany({
    where: { id: { in: newsletter.storyIds } },
    select: {
      id: true,
      title: true,
      sourceTitle: true,
      summary: true,
      emotionTag: true,
      issue: { select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } },
      feed: { select: { issue: { select: { name: true, parentId: true, parent: { select: { name: true } } } } } },
    },
  })

  // Each story under its top-level issue name, and the distinct names
  const { stories: storiesForPrompt, issueNames } = newsletterSelectInput(stories)

  log.info({ newsletterId, storyCount: stories.length, issueCount: issueNames.length }, 'selecting stories for newsletter')

  const prompt = buildNewsletterSelectPrompt(storiesForPrompt, config.newsletter.storiesPerIssue, issueNames)

  await rateLimitDelay()
  const llm = getLLMByTier(config.newsletter.selectModelTier)
  const structuredLlm = llm.withStructuredOutput(newsletterSelectResultSchema)
  // Retried by the OpenAI SDK (maxRetries in createChatModel), not by withRetry
  const response = await structuredLlm.invoke([new HumanMessage(prompt)])

  // Only keep IDs that exist in the longlist
  const longlistSet = new Set(newsletter.storyIds)
  const selectedIds = response.selectedIds.filter(id => longlistSet.has(id))

  log.info(
    { newsletterId, selectedCount: selectedIds.length, requestedCount: config.newsletter.storiesPerIssue * issueNames.length },
    'newsletter story selection complete',
  )

  return selectedIds
}

/** The issue's markdown, built from its (non-empty) shortlist by the template alone (no model call). */
export async function buildContent(newsletter: { selectedStoryIds: string[] }): Promise<string> {
  const loaded = await prisma.story.findMany({
    where: { id: { in: newsletter.selectedStoryIds } },
    select: {
      id: true,
      title: true,
      sourceTitle: true,
      sourceUrl: true,
      slug: true,
      summary: true,
      relevanceSummary: true,
      marketingBlurb: true,
      quote: true,
      quoteAttribution: true,
      emotionTag: true,
      sourceDatePublished: true,
      dateCrawled: true,
      feed: {
        select: {
          id: true,
          title: true,
          displayTitle: true,
          issue: { select: { name: true, slug: true, parentId: true, parent: { select: { name: true, slug: true } } } },
        },
      },
      issue: { select: { name: true, slug: true, parentId: true, parent: { select: { name: true, slug: true } } } },
    },
    orderBy: { dateCrawled: 'desc' },
  })

  // Sort by fixed issue order, then by title within each group
  const stories = newsletterOrder(loaded)

  // Build markdown content with issue section headers. No intro: the owner dropped the
  // model-written intro on 2026-10-26, so the content opens with the first section.
  let content = ''
  let currentIssue = ''
  for (const [i, story] of stories.entries()) {
    const resolved = newsletterIssue(story)
    const issueName = resolved.name
    const issueSlug = resolved.slug
    const publisher = story.feed?.displayTitle || story.feed?.title || 'Unknown'
    const relevanceUrl = story.slug ? `${config.siteUrl}/stories/${story.slug}` : ''

    // Add issue section header when the group changes
    if (issueName !== currentIssue) {
      if (currentIssue) content += `---\n\n` // separator between issue groups
      currentIssue = issueName
      content += `# ${issueName} {${issueSlug}}\n\n`
    }

    content += `${storyHeading(story.title || story.sourceTitle, story.id)}\n`
    const feedId = story.feed?.id || ''
    const linkParts = [feedId ? `{feed:${feedId}} ${publisher}` : publisher]
    linkParts.push(`[original article](${story.sourceUrl})`)
    if (relevanceUrl) linkParts.push(`[relevance analysis](${relevanceUrl})`)
    content += `${linkParts.join(' · ')}\n\n`

    // Alternate between relevanceSummary (2/3) and quote (1/3)
    const useQuote = i % 3 === 2 && story.quote && story.quoteAttribution
    if (useQuote) {
      content += `> "${story.quote}"\n`
      content += `> — ${story.quoteAttribution}\n\n`
    } else {
      const summary = story.relevanceSummary || story.marketingBlurb || ''
      if (summary) content += `${summary}\n\n`
    }
  }

  return content.trim()
}

export async function generateCarouselForNewsletter(newsletterId: string): Promise<string> {
  const newsletter = await prisma.newsletter.findUnique({ where: { id: newsletterId } })
  if (!newsletter) throw new NotFoundError('Newsletter not found')
  if (newsletter.selectedStoryIds.length === 0) throw new BadRequestError('No stories selected')

  const stories = await prisma.story.findMany({
    where: { id: { in: newsletter.selectedStoryIds } },
    include: { feed: { include: { issue: true } }, issue: true },
    orderBy: { dateCrawled: 'desc' },
  })

  // Sort by issue name for grouping
  stories.sort((a, b) => {
    const nameA = a.issue?.name || a.feed?.issue?.name || ''
    const nameB = b.issue?.name || b.feed?.issue?.name || ''
    return nameA.localeCompare(nameB)
  })

  const carouselStories: CarouselStory[] = stories.map(s => ({
    title: s.title || s.sourceTitle,
    category: s.issue?.name || s.feed?.issue?.name || 'General',
    summary: s.summary || '',
    publisher: s.feed?.title || 'Unknown',
    date: s.sourceDatePublished?.toISOString() || null,
  }))

  const outputDir = join(tmpdir(), `carousel_${newsletterId}_${Date.now()}`)
  return generateCarouselZip(carouselStories, outputDir)
}

// --- HTML generation ---

/**
 * Converts newsletter markdown content into an HTML email template.
 * Parses the markdown structure produced by buildContent():
 * - Optional text before the first heading: generated issues no longer have it, but issues
 *   generated before 2026-10-26 open with a model-written intro, which still renders here
 *   (as does an opening a person writes by hand)
 * - Issue section headers (# IssueName)
 * - Story blocks: h2 heading, publisher + "Read original article" link row,
 *   body text (relevanceSummary or blockquote with quote + attribution)
 *
 * `webUrl` is the web edition's address, for "View in browser"; it opens once the issue is published.
 */
export function renderHtml(newsletter: { title: string; content: string }, webUrl: string): string {
  // Split on --- separators to get individual blocks
  const sections = newsletter.content.split(/\n---\n/).filter(s => s.trim())

  // Extract intro (sections before the first one containing ## heading)
  let introHtml = ''
  const contentSections: string[] = []

  for (const section of sections) {
    const trimmed = section.trim()
    if (!introHtml && !trimmed.startsWith('#')) {
      // This is the intro — plain text before any headings
      introHtml = trimmed
        .split('\n')
        .filter(l => l.trim())
        .map(l => `<p style="margin: 0 0 8px; font-size: 15px; color: #525252; line-height: 1.6;">${escapeHtml(l.trim())}</p>`)
        .join('\n              ')
    } else {
      contentSections.push(trimmed)
    }
  }

  // Parse content sections into HTML blocks (issue headers + stories)
  const htmlBlocks: string[] = []

  for (const section of contentSections) {
    const lines = section.split('\n').filter(l => l.trim())

    // Check if this section starts with an issue header (# IssueName {slug})
    let issueHeader = ''
    let issueSlug = ''
    const storyChunks: string[][] = []
    let currentChunk: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        // Parse "# Issue Name {slug}"
        const headerMatch = trimmed.slice(2).match(/^(.+?)\s*\{([^}]+)\}\s*$/)
        if (headerMatch) {
          issueHeader = headerMatch[1]!
          issueSlug = headerMatch[2]!
        } else {
          issueHeader = trimmed.slice(2)
        }
      } else if (trimmed.startsWith('## ') && currentChunk.length > 0) {
        // Start of a new story — save previous chunk
        storyChunks.push(currentChunk)
        currentChunk = [trimmed]
      } else {
        currentChunk.push(trimmed)
      }
    }
    if (currentChunk.length > 0) storyChunks.push(currentChunk)

    // Render issue header with colored dot (matching website design)
    if (issueHeader) {
      const dotColor = getIssueDotColor(issueSlug)
      htmlBlocks.push(`
    <tr>
      <td style="padding: 32px 0 12px; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;"><tr>
          <td style="vertical-align: middle; padding-right: 12px;"><div style="width: 40px; border-top: 1px solid #e5e5e5;"></div></td>
          <td style="vertical-align: middle; padding-right: 8px; line-height: 0;"><div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${dotColor};"></div></td>
          <td style="vertical-align: middle; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #404040; white-space: nowrap;">${escapeHtml(issueHeader)}</td>
          <td style="vertical-align: middle; padding-left: 12px;"><div style="width: 40px; border-top: 1px solid #e5e5e5;"></div></td>
        </tr></table>
      </td>
    </tr>`)
    }

    // Render each story in this section
    for (const storyLines of storyChunks) {
      let title = ''
      let metaLine = ''
      const bodyParts: string[] = []

      for (const trimmed of storyLines) {
        if (trimmed.startsWith('## ')) {
          title = parseStoryHeading(trimmed).headline
        } else if (!title) {
          continue
        } else if (!metaLine && trimmed.match(/\[.*\]\(https?:\/\//)) {
          metaLine = trimmed
        } else if (trimmed.startsWith('> "') || trimmed.startsWith('> \u201C')) {
          const quoteText = trimmed
            .slice(2)
            .replace(/^[""\u201C]|[""\u201D]$/g, '')
            .trim()
          bodyParts.push(
            `<p style="margin: 0 0 4px; font-size: 15px; font-style: italic; color: #525252; line-height: 1.6;">\u201C${escapeHtml(quoteText)}\u201D</p>`,
          )
        } else if (trimmed.startsWith('> \u2014') || trimmed.startsWith('> —')) {
          const attribution = trimmed.replace(/^> [—\u2014]\s*/, '').trim()
          bodyParts.push(`<p style="margin: 0 0 10px; font-size: 13px; color: #737373;">\u2014 ${escapeHtml(attribution)}</p>`)
        } else if (trimmed) {
          bodyParts.push(`<p style="margin: 0 0 10px; font-size: 15px; color: #525252; line-height: 1.6;">${escapeHtml(trimmed)}</p>`)
        }
      }

      if (title) {
        // Parse meta: "Publisher · [original article](sourceUrl) · [relevance analysis](relevanceUrl)"
        let originalUrl = ''
        let relevanceUrl = ''
        let publisherName = ''
        let feedId = ''
        if (metaLine) {
          const links = [...metaLine.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
          for (const link of links) {
            if (link[1] === 'original article') originalUrl = link[2]!
            else if (link[1] === 'relevance analysis') relevanceUrl = link[2]!
          }
          // Extract feed ID if present: {feed:uuid}
          const feedMatch = metaLine.match(/\{feed:([^}]+)\}/)
          if (feedMatch) feedId = feedMatch[1]!
          // Publisher is plain text before the first link (after optional {feed:...} tag)
          const firstBracket = metaLine.indexOf('[')
          if (firstBracket > 0) {
            publisherName = metaLine
              .slice(0, firstBracket)
              .replace(/\{feed:[^}]+\}\s*/, '')
              .replace(/·\s*$/, '')
              .trim()
          }
        }

        const titleHtml = originalUrl
          ? `<a href="${escapeHtml(originalUrl)}" style="color: #171717; text-decoration: none;">${escapeHtml(title)}</a>`
          : escapeHtml(title)

        let metaHtml = ''
        if (publisherName || originalUrl) {
          const parts: string[] = []
          const faviconHtml = feedId
            ? `<img src="${config.siteUrl}/images/feeds/${feedId}.png" alt="" width="14" height="14" style="display: inline-block; width: 14px; height: 14px; vertical-align: middle; border-radius: 2px; margin-right: 4px;">`
            : ''
          if (publisherName) parts.push(`${faviconHtml}<span style="vertical-align: middle;">${escapeHtml(publisherName)}</span>`)
          if (originalUrl)
            parts.push(`<a href="${escapeHtml(originalUrl)}" style="color: #2563eb; text-decoration: none; vertical-align: middle;">original article</a>`)
          if (relevanceUrl)
            parts.push(`<a href="${escapeHtml(relevanceUrl)}" style="color: #2563eb; text-decoration: none; vertical-align: middle;">relevance analysis</a>`)
          metaHtml = `<p style="margin: 0 0 12px; font-size: 13px; color: #737373; line-height: 20px;">${parts.join(' <span style="vertical-align: middle;">&middot;</span> ')}</p>`
        }

        htmlBlocks.push(`
    <tr>
      <td style="padding: 20px 0 4px;">
        <h2 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #171717; line-height: 1.3;">${titleHtml}</h2>
        ${metaHtml}
        ${bodyParts.join('\n        ')}
      </td>
    </tr>`)
      }
    }
  }

  const introSection = introHtml
    ? `
          <!-- Intro -->
          <tr>
            <td style="padding: 12px 32px 8px;">
              ${introHtml}
            </td>
          </tr>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(newsletter.title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Web edition -->
          <tr>
            <td style="padding: 12px 32px 0; text-align: center;">
              <a href="${escapeHtml(webUrl)}" style="font-size: 12px; color: #a3a3a3; text-decoration: underline;">View in browser</a>
            </td>
          </tr>
          <!-- Header -->
          <tr>
            <td style="padding: 20px 32px 12px; text-align: center;">
              <a href="${config.siteUrl}" style="text-decoration: none;">
                <img src="${config.siteUrl}/images/logo-text-horizontal.png" alt="Actually Relevant" width="200" style="display: inline-block; max-width: 200px; height: auto;" />
              </a>
              <p style="margin: -2px 0 0; font-size: 15px; font-style: italic; color: #a3a3a3;">News that matter to humanity</p>
            </td>
          </tr>
          <!-- Color strip -->
          <tr>
            <td style="padding: 16px 0 0; font-size: 0; line-height: 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="width: 25%; height: 4px; background-color: #fbbf24;"></td>
                <td style="width: 25%; height: 4px; background-color: #2dd4bf;"></td>
                <td style="width: 25%; height: 4px; background-color: #f87171;"></td>
                <td style="width: 25%; height: 4px; background-color: #818cf8;"></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding: 14px 32px 12px; text-align: center;">
              <p style="margin: 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #404040;">${escapeHtml(newsletter.title)}</p>
              <!-- AI label at the top of every issue, not only in the footer (AI Act Art. 50(4)) -->
              <p style="margin: 8px 0 0; font-size: 13px; color: #525252; line-height: 1.5;"><strong>${NEWSLETTER_TOP_LABEL.lead}</strong> ${NEWSLETTER_TOP_LABEL.text}</p>
            </td>
          </tr>
${introSection}
          <!-- Stories -->
          <tr>
            <td style="padding: 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${htmlBlocks.join('\n')}
              </table>
            </td>
          </tr>

          <!-- Support -->
          <tr>
            <td style="padding: 28px 32px; text-align: center; border-top: 1px solid #e5e5e5;">
              <p style="margin: 0 0 14px; font-size: 14px; color: #525252;">Free. Independent. Without ads. Help us keep it that way.</p>
              <a href="${config.links.kofi}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 10px 24px; font-size: 14px; font-weight: 600; color: #ffffff; background-color: #171717; border-radius: 8px; text-decoration: none;">&#10084; Support Us</a>
            </td>
          </tr>

          <!-- AI disclosure -->
          <tr>
            <td style="padding: 28px 32px 16px; text-align: center; border-top: 1px solid #e5e5e5;">
              <p style="margin: 0; font-size: 16px; font-style: italic; color: #737373;">Curated and written with care by AI</p>
              <p style="margin: 12px 0 0; font-size: 13px; color: #a3a3a3; line-height: 1.5;">Our app might have bugs. AI can make mistakes.<br>If something seems off, please reply to this email and let us know.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px 24px; text-align: center; background-color: #fafafa; border-top: 1px solid #e5e5e5; margin-top: 16px;">
              <p style="margin: 0 0 10px; font-size: 12px; color: #a3a3a3;">
                <a href="${config.siteUrl}" style="color: #2563eb; text-decoration: none;">actuallyrelevant.news</a>
              </p>
              <p style="margin: 0 0 10px; font-size: 12px; color: #a3a3a3;">
                <a href="${config.links.blueskyProfile}" style="color: #737373; text-decoration: none; vertical-align: middle;"><img src="${config.siteUrl}/images/social/bluesky.png" alt="Bluesky" width="14" height="14" style="display: inline-block; width: 14px; height: 14px; vertical-align: middle; margin-right: 3px;">Bluesky</a>
                <span style="color: #d4d4d4; margin: 0 6px;">&middot;</span>
                <a href="${config.links.mastodonProfile}" rel="me" style="color: #737373; text-decoration: none; vertical-align: middle;"><img src="${config.siteUrl}/images/social/mastodon.png" alt="Mastodon" width="14" height="14" style="display: inline-block; width: 14px; height: 14px; vertical-align: middle; margin-right: 3px;">Mastodon</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return html
}

// --- Newsletter sends ---

export async function getNewsletterSends(newsletterId: string) {
  return prisma.newsletterSend.findMany({
    where: { newsletterId },
    orderBy: { createdAt: 'desc' },
  })
}

/** Fetch a send's Plunk campaign stats and store them (`stats` only: not a lifecycle field). */
export async function refreshSendStats(sendId: string) {
  const send = await prisma.newsletterSend.findUniqueOrThrow({ where: { id: sendId } })
  if (!send.plunkCampaignId) throw new BadRequestError('No Plunk campaign ID')

  const stats = await plunk.getCampaignStats(send.plunkCampaignId)

  return prisma.newsletterSend.update({
    where: { id: sendId },
    data: { stats: stats as unknown as Prisma.JsonObject },
  })
}

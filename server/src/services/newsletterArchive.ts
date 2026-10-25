/**
 * The newsletter's public web edition (.context/newsletter-podcast.md, "Web edition"): an issue
 * is public once its admin status is `published`, at `/newsletter/<slug>`, listed on
 * `/newsletter` (whose old `/newsletter/archive` URL redirects there) and in the sitemap. Unpublishing takes it off the web again; its slug
 * and first publication date stay, so republishing restores the same URL.
 */
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { paginate } from '../lib/paginate.js'
import { NEWSLETTER_TOP_LABEL } from '../lib/aiLabelCopy.js'
import { AI_GENERATED_NEWSLETTER_FIELDS, IPTC_TRAINED_ALGORITHMIC_MEDIA } from '../lib/aiProvenance.js'

const log = createLogger('newsletter-archive')

/** Path segments under /newsletter/ that belong to pages or redirects, never to an issue. */
const RESERVED_SLUGS = new Set(['archive'])
const SLUG_MAX_LENGTH = 80

/** "Week 42, 2026" -> "week-42-2026". The migration that added slugs backfilled with the same rule. */
export function newsletterSlugBase(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'issue'
  return RESERVED_SLUGS.has(base) ? `${base}-issue` : base.slice(0, SLUG_MAX_LENGTH)
}

/** The issue's slug, assigning a free one from its title the first time. Never changes it. */
export async function ensureNewsletterSlug(newsletter: { id: string; title: string; slug?: string | null }): Promise<string> {
  if (newsletter.slug) return newsletter.slug
  const base = newsletterSlugBase(newsletter.title)
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    const taken = await prisma.newsletter.findFirst({ where: { slug: candidate }, select: { id: true } })
    if (taken) continue
    try {
      await prisma.newsletter.update({ where: { id: newsletter.id }, data: { slug: candidate } })
      return candidate
    } catch (err) {
      // Taken between the check and the write: try the next one
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
  throw new Error('Could not find a free newsletter slug')
}

/**
 * Extra fields for an admin update that publishes an issue: its slug (if it has none yet) and
 * `publishedAt` the first time. Called by updateNewsletter before it writes.
 */
export async function publicationFields(id: string, status: unknown): Promise<Prisma.NewsletterUpdateInput> {
  if (status !== 'published') return {}
  const current = await prisma.newsletter.findUnique({ where: { id }, select: { id: true, title: true, slug: true, publishedAt: true } })
  if (!current) return {} // the update itself answers 404
  const slug = await ensureNewsletterSlug(current)
  log.info({ newsletterId: id, slug }, 'newsletter published on the web')
  return current.publishedAt ? {} : { publishedAt: new Date() }
}

/** Public web address of an issue. */
export function newsletterIssueUrl(slug: string): string {
  return `${config.siteUrl}/newsletter/${slug}`
}

const PUBLIC_WHERE = { status: 'published', slug: { not: null } } as const satisfies Prisma.NewsletterWhereInput

export async function listPublishedIssues(page: number, pageSize: number) {
  const result = await paginate({
    findMany: () =>
      prisma.newsletter.findMany({
        where: PUBLIC_WHERE,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { slug: true, title: true, publishedAt: true, createdAt: true, selectedStoryIds: true },
      }),
    count: () => prisma.newsletter.count({ where: PUBLIC_WHERE }),
    page,
    pageSize,
  })
  return {
    ...result,
    data: result.data.map(issue => ({
      slug: issue.slug!,
      title: issue.title,
      publishedAt: (issue.publishedAt ?? issue.createdAt).toISOString(),
      storyCount: issue.selectedStoryIds.length,
    })),
  }
}

/** Slugs and dates of every public issue, for the sitemap. */
export async function listPublishedIssueDates(): Promise<{ slug: string; publishedAt: Date }[]> {
  const issues = await prisma.newsletter.findMany({
    where: PUBLIC_WHERE,
    select: { slug: true, publishedAt: true, createdAt: true },
    orderBy: { publishedAt: 'desc' },
  })
  return issues.map(issue => ({ slug: issue.slug!, publishedAt: issue.publishedAt ?? issue.createdAt }))
}

/**
 * The stored markdown as the web edition shows it: without the template's machine tags, the
 * `{feed:<id>}` favicon marker in each metadata line and the ` {issue-slug}` after each section
 * heading, which the email template turns into a favicon and a colored dot.
 */
export function toWebMarkdown(content: string): string {
  return content.replace(/\{feed:[^}\s]*\}[ \t]*/g, '').replace(/^(#[ \t].*?)[ \t]*\{[a-z0-9-]+\}[ \t]*$/gm, '$1')
}

/** One public issue with its stories, or null unless it is published. */
export async function getPublishedIssue(slug: string) {
  const issue = await prisma.newsletter.findFirst({
    where: { ...PUBLIC_WHERE, slug },
    select: { slug: true, title: true, content: true, publishedAt: true, createdAt: true, selectedStoryIds: true },
  })
  if (!issue) return null

  const stories = issue.selectedStoryIds.length
    ? await prisma.story.findMany({
        where: { id: { in: issue.selectedStoryIds } },
        select: {
          id: true,
          slug: true,
          status: true,
          title: true,
          titleLabel: true,
          sourceTitle: true,
          sourceUrl: true,
          feed: { select: { title: true, displayTitle: true } },
        },
      })
    : []

  return {
    slug: issue.slug!,
    title: issue.title,
    publishedAt: (issue.publishedAt ?? issue.createdAt).toISOString(),
    aiLabel: NEWSLETTER_TOP_LABEL,
    content: toWebMarkdown(issue.content),
    stories: stories.map(story => ({
      // The `## ` heading generateContent wrote for this story, to match it in the content
      headline: story.title || story.sourceTitle,
      title: story.title,
      titleLabel: story.titleLabel,
      sourceTitle: story.sourceTitle,
      sourceUrl: story.sourceUrl,
      publisher: story.feed?.displayTitle || story.feed?.title || '',
      // Only a published story has a page to link to
      slug: story.status === 'published' ? story.slug : null,
    })),
    aiGenerated: { fields: [...AI_GENERATED_NEWSLETTER_FIELDS], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA },
  }
}

export type PublicNewsletterIssue = NonNullable<Awaited<ReturnType<typeof getPublishedIssue>>>

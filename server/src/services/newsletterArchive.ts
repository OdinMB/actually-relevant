/**
 * The newsletter's public web edition (.context/newsletter-podcast.md, "Web edition"): an issue
 * is public once its admin status is `published`, at `/newsletter/<slug>`, listed on
 * `/newsletter` (whose old `/newsletter/archive` URL redirects there) and in the sitemap. Unpublishing takes it off the web again; its slug
 * and first publication date stay, so republishing restores the same URL. Publishing and
 * unpublishing are moves of `newsletterLifecycle.ts`; this module holds slugs and the public reads.
 */
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { paginate } from '../lib/paginate.js'
import { isUniqueViolation } from '../utils/errors.js'
import { NEWSLETTER_TOP_LABEL } from '../lib/aiLabelCopy.js'
import { AI_GENERATED_NEWSLETTER_FIELDS, IPTC_TRAINED_ALGORITHMIC_MEDIA } from '../lib/aiProvenance.js'
import { storyHeadlines, toWebMarkdown } from './newsletterContent.js'

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
      if (isUniqueViolation(err)) continue
      throw err
    }
  }
  throw new Error('Could not find a free newsletter slug')
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
 * One public issue with its stories, or null unless it is published. The stories are those its
 * content's story headings name (`newsletterContent.ts`) plus its shortlist; a marked story's
 * `headline` is its heading as it stands in the content, an unmarked one's (an issue generated
 * before the marker) its title, which is what that heading was generated from.
 */
export async function getPublishedIssue(slug: string) {
  const issue = await prisma.newsletter.findFirst({
    where: { ...PUBLIC_WHERE, slug },
    select: { slug: true, title: true, content: true, publishedAt: true, createdAt: true, selectedStoryIds: true },
  })
  if (!issue) return null

  const markedHeadlines = new Map(storyHeadlines(issue.content).map(h => [h.storyId, h.headline]))
  const storyIds = [...new Set([...markedHeadlines.keys(), ...issue.selectedStoryIds])]
  const stories = storyIds.length
    ? await prisma.story.findMany({
        where: { id: { in: storyIds } },
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
      // The `## ` heading this story has in the content, to match it there
      headline: markedHeadlines.get(story.id) ?? (story.title || story.sourceTitle),
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

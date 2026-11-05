/**
 * Which pages of the site get their own link preview, and what each one's says (.context/seo.md,
 * "Link previews"). Each entry reads its page's record and gives the values that page's Helmet
 * sets in the client, so a crawler that runs no JavaScript sees what a browser shows once the
 * page has loaded; `linkPreview.ts` writes them into the shell. Change a page's Helmet and its
 * entry here together. The static site's rewrites (render.yaml, `lib/linkPreviewPaths.ts`) send
 * these pages to the backend.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import type { PreviewedSection } from '../lib/linkPreviewPaths.js'
import { SITE_NAME, SITE_OG_IMAGE, type LinkPreview, type PreviewTarget } from './linkPreview.js'
import { findStoryLinkPreview, storyOgImage } from './storyPreview.js'
import { findPublishedIssueHead, newsletterIssueUrl } from './newsletterArchive.js'
import { storyHeadings } from './newsletterContent.js'
import { byRelevance, leadLine } from './newsletterInbox.js'
import { findPublishedEpisodeHead } from './podcastPublish.js'

// --- A newsletter issue, /newsletter/<slug> (IssueHead in NewsletterIssuePage.tsx) ---

/** The issue's most relevant story that still has a page, with its heading as the issue shows it. */
async function leadStory(content: string): Promise<{ headline: string; slug: string } | null> {
  const headings = storyHeadings(content)
  const ids = [...new Set(headings.flatMap(heading => (heading.storyId ? [heading.storyId] : [])))]
  if (ids.length === 0) return null
  const stories = await prisma.story.findMany({
    where: { id: { in: ids }, status: 'published', slug: { not: null } },
    select: { id: true, slug: true, relevance: true },
  })
  const byId = new Map(stories.map(story => [story.id, story]))
  const published = headings.flatMap(({ headline, storyId }) => {
    const story = storyId ? byId.get(storyId) : undefined
    return story?.slug ? [{ headline, slug: story.slug, relevance: story.relevance }] : []
  })
  return byRelevance(published)[0] ?? null
}

/**
 * The page's title and description. Its card title is the email's subject line, the week and the
 * lead story's headline, with that story's image, so the AI headline travels with the image's
 * "AI-generated" footer. An issue whose stories all lost their pages (or whose headings predate the
 * story markers) keeps the page's title and the site image.
 */
async function newsletterIssuePreview(slug: string): Promise<LinkPreview | null> {
  const issue = await findPublishedIssueHead(slug)
  if (!issue?.slug) return null
  const documentTitle = `${issue.title} - Actually Relevant Newsletter`
  const lead = await leadStory(issue.content)
  return {
    documentTitle,
    title: lead ? leadLine(issue.title, lead.headline) : documentTitle,
    description: `${issue.title} of the Actually Relevant weekly newsletter: the stories that matter to humanity this week, to read on the web.`,
    url: newsletterIssueUrl(issue.slug),
    canonical: true,
    type: 'article',
    image: lead ? storyOgImage(lead.slug) : SITE_OG_IMAGE,
    publishedTime: (issue.publishedAt ?? issue.createdAt).toISOString(),
  }
}

// --- A podcast episode's transcript, /podcast/<id>/transcript (EpisodeHead in PodcastTranscriptPage.tsx) ---

async function podcastTranscriptPreview(id: string): Promise<LinkPreview | null> {
  const episode = await findPublishedEpisodeHead(id)
  if (!episode) return null
  const title = `Transcript: ${episode.title} - ${SITE_NAME}`
  return {
    documentTitle: title,
    title,
    description: episode.summary,
    url: `${config.siteUrl}/podcast/${encodeURIComponent(episode.id)}/transcript`,
    canonical: true,
    type: 'article',
    image: SITE_OG_IMAGE,
    publishedTime: episode.publishedAt.toISOString(),
  }
}

// --- A topic page, /issues/<slug> (IssuePage.tsx); the four top-level topics are prerendered ---

async function topicPreview(slug: string): Promise<LinkPreview | null> {
  const issue = await prisma.issue.findFirst({ where: { slug }, select: { slug: true, name: true, intro: true, description: true } })
  if (!issue) return null
  const title = `${issue.name} - ${SITE_NAME}`
  return {
    documentTitle: title,
    title,
    description: issue.intro || issue.description,
    url: `${config.siteUrl}/issues/${issue.slug}`,
    // IssuePage sets no canonical link
    canonical: false,
    type: 'website',
    image: SITE_OG_IMAGE,
  }
}

// --- The table ---

interface PagePreview {
  /** The page's record key from the path segments after the section; null for a path that is no such page. */
  keyOf(rest: (string | null)[]): string | null
  find(key: string): Promise<LinkPreview | null>
}

const onlySegment = (rest: (string | null)[]) => (rest.length === 1 ? (rest[0] ?? null) : null)

const PAGES: Record<PreviewedSection, PagePreview> = {
  // The first segment, whatever follows it: what the story-page route has always done
  stories: { keyOf: rest => rest[0] ?? null, find: findStoryLinkPreview },
  newsletter: { keyOf: onlySegment, find: newsletterIssuePreview },
  podcast: { keyOf: rest => (rest.length === 2 && rest[1] === 'transcript' ? (rest[0] ?? null) : null), find: podcastTranscriptPreview },
  issues: { keyOf: onlySegment, find: topicPreview },
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** The page with a preview at this path of the site (`/newsletter/week-43-2026`), or null when there is none. */
export function previewTargetOf(sitePath: string): PreviewTarget | null {
  const [section, ...rest] = sitePath.split('/').filter(Boolean).map(decodeSegment)
  const page = section && Object.hasOwn(PAGES, section) ? PAGES[section as PreviewedSection] : undefined
  const key = page?.keyOf(rest)
  return page && key ? { key: `/${section}/${key}`, find: () => page.find(key) } : null
}

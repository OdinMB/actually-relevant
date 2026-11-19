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
import { OVERVIEW_AI_LABEL, PODCAST_TRANSCRIPT_DESCRIPTION_PREFIX } from '../lib/aiLabelCopy.js'
import { publicOverviewHead } from './overviewPublic.js'
import type { PreviewedSection } from '../lib/linkPreviewPaths.js'
import { SITE_NAME, type LinkPreview, type PreviewTarget } from './linkPreview.js'
import { findStoryLinkPreview } from './storyPreview.js'
import { sectionImage, topicImage } from './sectionPreview.js'
import { findPublishedIssueHead, newsletterIssueUrl } from './newsletterArchive.js'
import { storyHeadings } from './newsletterContent.js'
import { byRelevance, leadLine } from './newsletterInbox.js'
import { editionCopy, labeledTitle } from './newsletterEdition.js'
import { findPublishedEpisodeHead } from './podcastPublish.js'

// --- A newsletter issue, /newsletter/<slug> (IssueHead in NewsletterIssuePage.tsx) ---

/** The heading of the issue's most relevant story that still has a page, as the issue shows it. */
async function leadHeadline(content: string): Promise<string | null> {
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
    return story?.slug ? [{ headline, relevance: story.relevance }] : []
  })
  return byRelevance(published)[0]?.headline ?? null
}

/**
 * The issue card's title, description and image. With a lead story, the title is the email's subject
 * line, the week and the lead's AI headline, and the image is the newsletter's with the website's
 * "AI" badge, the label that travels with the card. Without one (its stories all lost their pages, or
 * its headings predate the story markers), the page's own title and the plain newsletter image. The
 * badge as the label is the owner's decision (2026-11-05); this function alone makes the choice.
 */
function newsletterIssueCard(pageTitle: string, description: string, aiTitle: string | null): Pick<LinkPreview, 'title' | 'description' | 'image'> {
  return aiTitle
    ? { title: aiTitle, description, image: sectionImage('newsletter-issue') }
    : { title: pageTitle, description, image: sectionImage('newsletter') }
}

async function newsletterIssuePreview(slug: string): Promise<LinkPreview | null> {
  const issue = await findPublishedIssueHead(slug)
  if (!issue?.slug) return null
  // An Actually Uplifting issue's title names its edition, so it is not taken for the full issue of its week
  const documentTitle = `${labeledTitle(issue.edition, issue.title)} - Actually Relevant Newsletter`
  const headline = await leadHeadline(issue.content)
  return {
    documentTitle,
    ...newsletterIssueCard(
      documentTitle,
      `${issue.title} of the Actually Relevant weekly newsletter: the stories that matter to humanity this week, to read on the web.`,
      headline && leadLine(issue.title, headline, editionCopy(issue.edition).label),
    ),
    url: newsletterIssueUrl(issue.slug),
    canonical: true,
    type: 'article',
    publishedTime: (issue.publishedAt ?? issue.createdAt).toISOString(),
  }
}

// --- A podcast episode's transcript, /podcast/<id>/transcript (EpisodeHead in PodcastTranscriptPage.tsx) ---

/** The page's title, and its AI episode summary behind the AI label as the description. */
async function podcastTranscriptPreview(id: string): Promise<LinkPreview | null> {
  const episode = await findPublishedEpisodeHead(id)
  if (!episode) return null
  const title = `Transcript: ${episode.title} - ${SITE_NAME}`
  return {
    documentTitle: title,
    title,
    description: `${PODCAST_TRANSCRIPT_DESCRIPTION_PREFIX}${episode.summary}`,
    url: `${config.siteUrl}/podcast/${encodeURIComponent(episode.id)}/transcript`,
    canonical: true,
    type: 'article',
    image: sectionImage('podcast'),
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
    image: topicImage(issue.slug),
  }
}

// --- An ongoing story, /ongoing/<slug> (OverviewPage.tsx), only while it is public ---

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The page's title and description as its Helmet sets them (`overviewHead` in the client), the AI label last, and the ongoing-story image with the "AI" badge. */
async function overviewPreview(slug: string): Promise<LinkPreview | null> {
  const o = await publicOverviewHead(slug)
  if (!o) return null
  const title = `${o.title}: ongoing story - ${SITE_NAME}`
  const count = `${o.stories} ${o.stories === 1 ? 'story' : 'stories'} since ${MONTH_YEAR.format(o.since)}`
  return {
    documentTitle: title,
    title,
    // Short enough that the 160-character cut never reaches the label
    description: `${count}, followed as one ongoing story. ${OVERVIEW_AI_LABEL}`,
    url: `${config.siteUrl}/ongoing/${encodeURIComponent(o.slug)}`,
    canonical: true,
    type: 'website',
    image: sectionImage('ongoing'),
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
  ongoing: { keyOf: onlySegment, find: overviewPreview },
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

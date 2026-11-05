/**
 * Story link previews (.context/seo.md, "Story link previews"):
 * - the per-story og:image, rendered with the carousel's canvas renderer at 1200x630;
 * - what the story page's head says, for the shared link-preview pages (`linkPreview.ts`): the
 *   story's title, description, canonical, og:* and twitter:* tags, as StoryPage's Helmet sets them.
 * Both serve published stories only.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { BoundedCache } from '../lib/boundedCache.js'
import { registerPublicCache } from '../lib/publicCaches.js'
import { storyOgImageUrl } from '../lib/storyPreviewUrls.js'
import { markdownToPlainText } from '../lib/plainText.js'
import { createStoryImage, OG_IMAGE_SIZE } from './carousel.js'
import { _resetLinkPreviewCaches, SITE_NAME, type LinkPreview, type PreviewImage } from './linkPreview.js'

/** The same author line StoryPage's Helmet sets. */
const STORY_AUTHOR = 'RelevanceAI by Actually Relevant'

const PREVIEW_STORY_SELECT = {
  slug: true,
  title: true,
  titleLabel: true,
  sourceTitle: true,
  summary: true,
  datePublished: true,
  sourceDatePublished: true,
  issue: { select: { name: true } },
  feed: { select: { title: true, displayTitle: true, issue: { select: { name: true } } } },
} as const

export async function findPreviewStory(slug: string) {
  return prisma.story.findFirst({ where: { slug, status: 'published' }, select: PREVIEW_STORY_SELECT })
}

export type PreviewStory = NonNullable<Awaited<ReturnType<typeof findPreviewStory>>>

// --- Titles (mirrors client/src/lib/title-label.ts) ---

function titleLabelOf(story: PreviewStory): string | null {
  if (story.titleLabel) return story.titleLabel
  if (!story.title) return null
  const colonIdx = story.title.indexOf(':')
  return colonIdx > 0 && colonIdx <= 40 ? story.title.slice(0, colonIdx).trim() : null
}

function headlineOf(story: PreviewStory): string {
  const title = story.title || story.sourceTitle
  if (story.titleLabel || !story.title) return title
  const colonIdx = story.title.indexOf(':')
  if (colonIdx > 0 && colonIdx <= 40) {
    const afterColon = story.title.slice(colonIdx + 1).trim()
    if (afterColon) return afterColon
  }
  return title
}

/** "Label: Headline", as the story page's title and og:title show it. */
export function displayTitleOf(story: PreviewStory): string {
  const label = titleLabelOf(story)
  const headline = headlineOf(story)
  return label ? `${label}: ${headline}` : headline
}

// --- og:image ---

const imageCache = new BoundedCache<Buffer>(config.storyPreview.imageCacheEntries, config.storyPreview.imageCacheTtlSeconds * 1000)
registerPublicCache('story-preview-images', imageCache)

/** The story's 1200x630 preview PNG (AI-marked in pixels and XMP), or null if it is not published. */
export async function getStoryOgImage(slug: string): Promise<Buffer | null> {
  const hit = imageCache.get(slug)
  if (hit) return hit
  const story = await findPreviewStory(slug)
  if (!story) return null
  const png = createStoryImage(
    {
      title: headlineOf(story),
      category: story.issue?.name || story.feed?.issue?.name || 'General',
      summary: story.summary || '',
      publisher: story.feed?.displayTitle || story.feed?.title || '',
      date: (story.sourceDatePublished ?? story.datePublished)?.toISOString() ?? null,
    },
    OG_IMAGE_SIZE,
  )
  imageCache.set(slug, png)
  return png
}

/** A published story's preview image as a card names it. It carries "AI-generated" in its pixels and XMP. */
export function storyOgImage(slug: string): PreviewImage {
  return { url: storyOgImageUrl(slug), type: 'image/png', width: OG_IMAGE_SIZE.width, height: OG_IMAGE_SIZE.height }
}

/** Tests only: forget the cached shell, pages and images. */
export function _resetStoryPreviewCaches(): void {
  _resetLinkPreviewCaches()
  imageCache.clear()
}

// --- The story page's head ---

/** What the story page's Helmet sets: the title label and headline, the summary as plain text. */
export function storyLinkPreview(story: PreviewStory): LinkPreview {
  const displayTitle = displayTitleOf(story)
  return {
    documentTitle: `${displayTitle} - ${SITE_NAME}`,
    title: displayTitle,
    // Preview cards cannot render Markdown: the summary goes in as plain text, as StoryPage's Helmet sets it
    description: markdownToPlainText(story.summary ?? '') || displayTitle,
    url: `${config.siteUrl}/stories/${story.slug}`,
    canonical: true,
    type: 'article',
    image: storyOgImage(story.slug!),
    author: STORY_AUTHOR,
    publishedTime: story.datePublished?.toISOString(),
  }
}

/** The story page's preview, or null unless the story is published. */
export async function findStoryLinkPreview(slug: string): Promise<LinkPreview | null> {
  const story = await findPreviewStory(slug)
  return story && storyLinkPreview(story)
}

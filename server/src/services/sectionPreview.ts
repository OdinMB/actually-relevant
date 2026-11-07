/**
 * Section preview images (.context/seo.md, "Section preview images"): the card image of a newsletter
 * issue, a podcast transcript and a topic page, which shows the logo and the section's name, and on
 * an issue card with an AI title the "AI" badge (`sectionImage.ts` draws it). Here: their URLs, as
 * the pages' heads name them, and the images, rendered on request and cached in memory.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { BoundedCache } from '../lib/boundedCache.js'
import { registerPublicCache } from '../lib/publicCaches.js'
import { SECTION_IMAGE_MOUNT } from '../lib/linkPreviewPaths.js'
import { topicColor } from '../lib/topicColors.js'
import { PREVIEW_IMAGE_AI_BADGE } from '../lib/aiLabelCopy.js'
import { OG_IMAGE_SIZE } from './previewImageParts.js'
import type { PreviewImage } from './linkPreview.js'
import { createSectionImage, type SectionLabel } from './sectionImage.js'

/**
 * The images shared by all pages of a section, and what each shows. `newsletter-issue` is the
 * newsletter image with the website's "AI" badge, for an issue card whose title is its lead story's
 * AI headline (`newsletterIssueCard()` in pagePreviews.ts). The podcast's always carries the badge:
 * the podcast is written and voiced by AI.
 */
const SECTION_LABELS = {
  newsletter: { text: 'Newsletter' },
  'newsletter-issue': { text: 'Newsletter', badge: PREVIEW_IMAGE_AI_BADGE },
  podcast: { text: 'Podcast', badge: PREVIEW_IMAGE_AI_BADGE },
} as const satisfies Record<string, SectionLabel>

export type ImageSection = keyof typeof SECTION_LABELS

function previewImage(path: string): PreviewImage {
  return { url: `${config.apiUrl}${SECTION_IMAGE_MOUNT}/${path}`, type: 'image/png', width: OG_IMAGE_SIZE.width, height: OG_IMAGE_SIZE.height }
}

/** The card image of a section's pages: a newsletter issue page (with or without the badge) or a podcast transcript page. */
export function sectionImage(section: ImageSection): PreviewImage {
  return previewImage(`${section}.png`)
}

/** The card image of a topic page. */
export function topicImage(slug: string): PreviewImage {
  return previewImage(`issues/${encodeURIComponent(slug)}.png`)
}

const cache = new BoundedCache<Buffer>(config.storyPreview.sectionImageCacheEntries, config.storyPreview.imageCacheTtlSeconds * 1000)
registerPublicCache('section-preview-images', cache)

async function cached(key: string, label: () => Promise<SectionLabel | null>): Promise<Buffer | null> {
  const hit = cache.get(key)
  if (hit) return hit
  const found = await label()
  if (!found) return null
  const png = await createSectionImage(found)
  cache.set(key, png)
  return png
}

/** The section's image, or null for a name that is no such section. */
export function getSectionImage(section: string): Promise<Buffer | null> {
  if (!Object.hasOwn(SECTION_LABELS, section)) return Promise.resolve(null)
  return cached(section, async () => SECTION_LABELS[section as ImageSection])
}

/** The topic's image, with a dot in its color (a subtopic's parent's), or null when there is no such topic. */
export function getTopicImage(slug: string): Promise<Buffer | null> {
  return cached(`issues/${slug}`, async () => {
    const issue = await prisma.issue.findFirst({ where: { slug }, select: { name: true, slug: true, parent: { select: { slug: true } } } })
    return issue && { text: issue.name, accent: topicColor(issue.parent?.slug ?? issue.slug) }
  })
}

/** Tests only: forget the cached images. */
export function _resetSectionImageCache(): void {
  cache.clear()
}

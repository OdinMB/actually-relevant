/**
 * Where a published story appeared in the site's two weekly products, for the end of its page
 * (.context/public-website.md, "Cross-links"): the first public newsletter issue and the first
 * published podcast episode that carried it, each in the shape its own public list serves, so the
 * episode keeps its AI line and machine-readable marker.
 */
import prisma from '../lib/prisma.js'
import { findFirstIssueWithStory } from './newsletterArchive.js'
import { getFirstPublishedEpisodeWithStory } from './podcastPublish.js'
import { toPublicEpisode } from './podcastShow.js'

/** Both null for a story in neither, and for a slug with no published story. */
export async function getStoryAppearances(slug: string) {
  const story = await prisma.story.findFirst({ where: { slug, status: 'published' }, select: { id: true } })
  if (!story) return { newsletterIssue: null, podcastEpisode: null }
  const [newsletterIssue, episode] = await Promise.all([findFirstIssueWithStory(story.id), getFirstPublishedEpisodeWithStory(story.id)])
  return { newsletterIssue, podcastEpisode: episode && toPublicEpisode(episode) }
}

/**
 * Everything that differs between the podcast's two shows (ADR-0053; `.context/podcast.md`, "Actually
 * Uplifting show"): Actually Relevant (`full`), fed by every published story of the week, and Actually Uplifting
 * (`uplifting`), fed by the week's uplifting stories only. Per show: its title, description, page,
 * feed, channel GUID, artwork and listen links, its two jobs, the name its notices use, its storage
 * prefix and show-notes line; and whether the uplifting show is open. Every gate that keeps a closed
 * show invisible and spending nothing asks `isEditionOpen` (a run asks `editionRunRefusal`), so there
 * is one switch, PODCAST_UPLIFTING_ENABLED, with its preconditions named.
 */
import type { PodcastEdition } from '@prisma/client'
import { config } from '../config.js'
import { PODCAST_SHOW_DESCRIPTION, PODCAST_UPLIFTING_COPY_CONFIRMED, PODCAST_UPLIFTING_SHOW_DESCRIPTION } from '../lib/aiLabelCopy.js'

/** The job rows of each show's weekly episode; the automatic paths re-check their own row. */
export const GENERATE_PODCAST_JOB = 'generate_podcast'
export const PUBLISH_PODCAST_JOB = 'publish_podcast'
export const GENERATE_UPLIFTING_PODCAST_JOB = 'generate_uplifting_podcast'
export const PUBLISH_UPLIFTING_PODCAST_JOB = 'publish_uplifting_podcast'

export const PODCAST_EDITIONS: readonly PodcastEdition[] = ['full', 'uplifting']

export interface PodcastEditionInfo {
  showTitle: string
  /** The standing AI description of the show (feed channel, public JSON). */
  description: string
  /** The show page on the website. */
  pagePath: string
  /** The public feed path (a Render rewrite to the API's feed route). */
  feedPath: string
  /** The channel's `podcast:guid`, fixed for good. */
  feedGuid: string
  artworkUrl: string
  listenLinks: { name: string; url: string }[]
  generateJob: string
  publishJob: string
  /** What notices call the show's episodes ("podcast episode", "Actually Uplifting episode"). */
  noticeName: string
  /** In front of the week key in the episode's storage paths ('' for the main show). */
  objectPrefix: string
  /** The show-notes line before the donation ask, pointing to more of the show's kind of news; none for the main show. */
  moreLink: { text: string; url: string } | null
}

export function podcastEditionInfo(edition: PodcastEdition): PodcastEditionInfo {
  const p = config.podcast
  if (edition === 'uplifting') {
    const u = p.uplifting
    return {
      showTitle: u.showTitle,
      description: PODCAST_UPLIFTING_SHOW_DESCRIPTION,
      pagePath: u.pagePath,
      feedPath: u.feedPath,
      feedGuid: u.feedGuid,
      artworkUrl: u.artworkUrl,
      listenLinks: u.listenLinks,
      generateJob: GENERATE_UPLIFTING_PODCAST_JOB,
      publishJob: PUBLISH_UPLIFTING_PODCAST_JOB,
      noticeName: u.showTitle,
      objectPrefix: 'uplifting-',
      moreLink: { text: 'More uplifting news', url: `${config.siteUrl}/uplifting` },
    }
  }
  return {
    showTitle: p.showTitle,
    description: PODCAST_SHOW_DESCRIPTION,
    pagePath: '/podcast',
    feedPath: p.feedPath,
    feedGuid: p.feedGuid,
    artworkUrl: p.artworkUrl,
    listenLinks: p.listenLinks,
    generateJob: GENERATE_PODCAST_JOB,
    publishJob: PUBLISH_PODCAST_JOB,
    noticeName: 'podcast',
    objectPrefix: '',
    moreLink: null,
  }
}

/** A notice title about one of the show's episodes: "Podcast episode ready", "Actually Uplifting episode ready". */
export function episodeNoticeTitle(edition: PodcastEdition, event: string): string {
  const name = podcastEditionInfo(edition).noticeName
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} episode ${event}`
}

/** What Actually Uplifting needs to open. */
export interface UpliftingShowState {
  /** PODCAST_UPLIFTING_ENABLED, the owner's switch. */
  enabled: boolean
  /** The owner confirmed the show description (`PODCAST_UPLIFTING_COPY_CONFIRMED`). */
  copyConfirmed: boolean
  artworkUrl: string
}

const currentUpliftingState = (): UpliftingShowState => ({
  enabled: config.podcast.uplifting.enabled,
  copyConfirmed: PODCAST_UPLIFTING_COPY_CONFIRMED,
  artworkUrl: config.podcast.uplifting.artworkUrl,
})

/** Why Actually Uplifting is closed, naming every missing precondition; null when it is open. */
export function upliftingShowProblem(state: UpliftingShowState = currentUpliftingState()): string | null {
  const missing: string[] = []
  if (!state.enabled) missing.push('PODCAST_UPLIFTING_ENABLED is not "true" on the API service')
  if (!state.copyConfirmed) {
    missing.push("its show description awaits the owner's confirmation (PODCAST_UPLIFTING_COPY_CONFIRMED in server/src/lib/aiLabelCopy.ts)")
  }
  if (!state.artworkUrl) missing.push('it has no show artwork (config.podcast.uplifting.artworkUrl)')
  return missing.length === 0 ? null : `Actually Uplifting is switched off: ${missing.join('; ')}`
}

/** Why the show is closed, or null when it is open (the main show always is). */
export function editionClosedReason(edition: PodcastEdition): string | null {
  return edition === 'uplifting' ? upliftingShowProblem() : null
}

/**
 * Whether the show is open: its page, feed and episodes are public, its episodes may be voiced live
 * and published, and its jobs may be enabled.
 */
export function isEditionOpen(edition: PodcastEdition): boolean {
  return editionClosedReason(edition) === null
}

/** The open shows: the editions whose published episodes the public surfaces list. */
export function openEditions(): PodcastEdition[] {
  return PODCAST_EDITIONS.filter(isEditionOpen)
}

/**
 * Why the show's weekly episode may not be created or run now, or null when it may. A live run needs
 * the show open; a dry run (development) needs only PODCAST_UPLIFTING_ENABLED, so a developer can
 * read an uplifting transcript before the owner confirms the copy or supplies the artwork.
 */
export function editionRunRefusal(edition: PodcastEdition, dryRun: boolean): string | null {
  if (edition === 'full' || (dryRun && config.podcast.uplifting.enabled)) return null
  return upliftingShowProblem()
}

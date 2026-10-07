import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { isBlueskyConfigured } from '../lib/bluesky.js'
import { isMastodonConfigured } from '../lib/mastodon.js'
import { findAutoPostCandidates, pickBestStoryForSocial } from '../services/socialMedia.js'
import type { SocialChannelName } from '../services/socialMedia.js'
import {
  generateDraft as generateBlueskyDraft,
  publishPost as publishBlueskyPost,
} from '../services/bluesky.js'
import {
  generateDraft as generateMastodonDraft,
  publishPost as publishMastodonPost,
} from '../services/mastodon.js'
import prisma from '../lib/prisma.js'

const log = createLogger('social_auto_post')

interface ChannelConfig {
  name: SocialChannelName
  enabled: boolean
  configured: boolean
  /** Check if this story already has a post on this channel, in any status (generateDraft refuses any). */
  hasPost: (storyId: string) => Promise<boolean>
  generateDraft: (storyId: string) => Promise<{ id: string }>
  publishPost: (postId: string) => Promise<unknown>
}

function getEnabledChannels(): ChannelConfig[] {
  const channels: ChannelConfig[] = []

  if (config.bluesky.autoPost.enabled && isBlueskyConfigured()) {
    channels.push({
      name: 'bluesky',
      enabled: true,
      configured: true,
      hasPost: async (storyId) => {
        const existing = await prisma.blueskyPost.findFirst({ where: { storyId } })
        return existing !== null
      },
      generateDraft: async (storyId) => generateBlueskyDraft(storyId),
      publishPost: async (postId) => publishBlueskyPost(postId),
    })
  }

  if (config.mastodon.autoPost.enabled && isMastodonConfigured()) {
    channels.push({
      name: 'mastodon',
      enabled: true,
      configured: true,
      hasPost: async (storyId) => {
        const existing = await prisma.mastodonPost.findFirst({ where: { storyId } })
        return existing !== null
      },
      generateDraft: async (storyId) => generateMastodonDraft(storyId),
      publishPost: async (postId) => publishMastodonPost(postId),
    })
  }

  return channels
}

export async function runSocialAutoPost(): Promise<void> {
  log.info('starting social auto-post job')

  const channels = getEnabledChannels()
  if (channels.length === 0) {
    log.info('no social media channels enabled for auto-posting')
    return
  }

  log.info({ channels: channels.map((c) => c.name) }, 'enabled channels')

  // Find candidates across the enabled channels only
  const lookbackHours = config.socialAutoPost.lookbackHours
  const candidates = await findAutoPostCandidates(lookbackHours, channels.map((c) => c.name))

  if (candidates.length === 0) {
    log.info('no candidate stories found for social posting')
    return
  }

  log.info({ candidateCount: candidates.length }, 'found candidate stories')

  // Pick best story (one LLM call for all channels)
  const { storyId, reasoning } = await pickBestStoryForSocial(candidates)
  log.info({ storyId, reasoning }, 'best story selected for social media')

  // Post to each enabled channel that hasn't posted this story yet. One channel's failure never
  // blocks the others; the run fails (and the job-failure alert fires) only when every channel it
  // tried failed. A channel that already has the story is not an attempt.
  let attempts = 0
  const failures: string[] = []
  for (const channel of channels) {
    try {
      if (await postToChannel(channel, storyId) === 'skipped') continue
      attempts++
    } catch (err) {
      attempts++
      failures.push(`${channel.name}: ${err instanceof Error ? err.message : String(err)}`)
      log.error({ err, channel: channel.name, storyId }, 'auto-post failed for channel')
    }
  }

  if (attempts > 0 && failures.length === attempts) {
    throw new Error(`social auto-post failed on every channel it tried (story ${storyId}): ${failures.join('; ')}`)
  }
  log.info('social auto-post job complete')
}

/** Pause after a publish, to be polite to the next channel's API. */
const PUBLISH_PAUSE_MS = 2000

/** Draft and publish the story on one channel; `skipped` when the channel already has it. */
async function postToChannel(channel: ChannelConfig, storyId: string): Promise<'posted' | 'skipped'> {
  if (await channel.hasPost(storyId)) {
    log.info({ channel: channel.name, storyId }, 'story already posted to channel, skipping')
    return 'skipped'
  }

  log.info({ channel: channel.name, storyId }, 'generating draft')
  const draft = await channel.generateDraft(storyId)

  log.info({ channel: channel.name, postId: draft.id }, 'publishing')
  await channel.publishPost(draft.id)

  log.info({ channel: channel.name, storyId }, 'auto-post published successfully')
  await new Promise((resolve) => setTimeout(resolve, PUBLISH_PAUSE_MS))
  return 'posted'
}

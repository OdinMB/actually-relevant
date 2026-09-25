import { ComAtprotoLabelDefs, type AppBskyActorProfile, type Un$Typed } from '@atproto/api'

/**
 * Profile updates that mark the automated Bluesky and Mastodon accounts as bots
 * (label copy review ACR-11 and ACR-12). Applied by scripts/set-social-bot-profile.ts,
 * which only the owner runs; nothing in the app changes the live profiles.
 */

/** atproto label value for automated accounts. */
export const BOT_SELF_LABEL = 'bot'
const SELF_LABELS_TYPE = 'com.atproto.label.defs#selfLabels' as const

/**
 * The Bluesky profile record with the bot bio and the "bot" self-label added. Every other field
 * and every existing self-label is kept; a labels object of another type is replaced.
 */
export function withBotProfile(
  existing: AppBskyActorProfile.Record | undefined,
  bio: string,
): Un$Typed<AppBskyActorProfile.Record> {
  const current = existing?.labels && ComAtprotoLabelDefs.isSelfLabels(existing.labels) ? existing.labels.values : []
  const values = current.some((label) => label.val === BOT_SELF_LABEL) ? current : [...current, { val: BOT_SELF_LABEL }]
  return { ...existing, description: bio, labels: { $type: SELF_LABELS_TYPE, values } }
}

/** The Mastodon update_credentials parameters: only the bio and the bot flag change. */
export function mastodonBotUpdate(bio: string): { note: string; bot: true } {
  return { note: bio, bot: true }
}
